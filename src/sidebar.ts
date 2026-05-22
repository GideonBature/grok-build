import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { AcpClient, EffortLevel, ExitPlanRequest, PermissionRequest } from "./acp";
import { locateGrokCli } from "./cli-locator";
import { TerminalManager } from "./terminal-manager";
import {
  FileChip,
  clearImplicitChips,
  makeExplicitChip,
  makeImplicitChip,
  removeChip,
  toggleChip,
} from "./chips";
import { buildPrompt } from "./prompt-builder";
import {
  SessionListEntry,
  SessionMetaOverrides,
  defaultFs,
  deleteSessionDir,
  listSessions,
  pickSessionTitle,
  resolveGrokHome,
} from "./sessions";
import { parseFileRef } from "./file-ref";

type WebviewMsg =
  | { type: "ready" }
  | { type: "send"; text: string; chips: FileChip[] }
  | { type: "newSession" }
  | { type: "cancel" }
  | { type: "pickModel" }
  | { type: "setMode"; modeId: "agent" | "plan" | "yolo" }
  | { type: "removeChip"; id: string }
  | { type: "toggleChip"; id: string }
  | { type: "openFile"; path: string }
  | { type: "openUrl"; url: string }
  | { type: "openDiff"; path: string; oldText: string; newText: string }
  | { type: "setEffort"; level: string }
  | { type: "openGlobalConfig" }
  | { type: "openProjectConfig" }
  | { type: "runMcpList" }
  | { type: "showLogs" }
  | { type: "dropFile"; path: string; shift: boolean }
  | { type: "permissionAnswer"; requestId: number | string; optionId: string }
  | { type: "exitPlanAnswer"; requestId: number | string; verdict: "approved" | "abandoned" | "rejected" }
  | { type: "setModel"; modelId: string }
  | { type: "runInstallCmd" }
  | { type: "runGrokLogin" }
  | { type: "recheckConnection" }
  | { type: "listSessions" }
  | { type: "resumeSession"; id: string }
  | { type: "renameSession"; id: string; name: string }
  | { type: "deleteSession"; id: string }
  | { type: "pickFile" };

const SESSION_META_KEY = "grok.sessionMeta";

export class GrokSidebar implements vscode.WebviewViewProvider {
  public static readonly viewId = "grok.chat";
  private view?: vscode.WebviewView;
  private client?: AcpClient;
  private output: vscode.OutputChannel;
  private chips: FileChip[] = [];
  private editorWatcher?: vscode.Disposable;
  private terminalManager = new TerminalManager();
  private autoApprove = false;
  private cliPath?: string;
  private sessionGen = 0;
  private hasHistory = false;
  private suppressContent = false;
  private lastPlanText = "";
  private activeSessionId?: string;
  private titleGenerated = false;
  private firstUserMessageForTitle?: string;

  constructor(
    private context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
  ) {
    this.output = output;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        vscode.Uri.joinPath(this.context.extensionUri, "resources"),
      ],
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((m: WebviewMsg) => this.onMessage(m));
    this.watchActiveEditor();
  }

  insertActiveMention(opts?: { selection?: boolean; uri?: vscode.Uri }): void {
    const editor = vscode.window.activeTextEditor;
    const uri = opts?.uri ?? editor?.document.uri;
    if (!uri) return;
    const relPath = vscode.workspace.asRelativePath(uri);
    let selStart: number | undefined;
    let selEnd: number | undefined;
    if (opts?.selection && editor && !editor.selection.isEmpty) {
      selStart = editor.selection.start.line + 1;
      selEnd = editor.selection.end.line + 1;
    }
    this.chips.push(makeExplicitChip(uri.fsPath, relPath, selStart, selEnd));
    this.postChips();
    this.reveal();
  }

  newSession(): void {
    void this.startSession();
  }

  async pickModel(): Promise<void> {
    if (!this.client || !this.client.availableModels.length) {
      vscode.window.showInformationMessage("Start a session first.");
      return;
    }
    const items = this.client.availableModels.map((m) => ({
      label: m.name ?? m.modelId,
      description: m.modelId === this.client!.currentModelId ? "$(check) current" : "",
      detail: m.description,
      modelId: m.modelId,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Pick a Grok model",
    });
    if (picked) {
      await this.client.setModel(picked.modelId);
      this.post({ type: "modelChanged", modelId: picked.modelId });
    }
  }

  openModePopover(): void {
    this.post({ type: "openModePopover" });
  }

  async setMode(modeId: "agent" | "plan" | "yolo"): Promise<void> {
    if (modeId === "yolo") {
      this.autoApprove = true;
      this.post({ type: "modeChanged", modeId: "yolo" });
      return;
    }
    this.autoApprove = false;
    if (!this.client) return;
    try {
      await this.client.setMode(modeId);
    } catch (e) {
      vscode.window.showErrorMessage(`Couldn't switch mode: ${(e as Error).message}`);
    }
  }

  dispose(): void {
    this.client?.dispose();
    this.editorWatcher?.dispose();
    this.terminalManager.disposeAll();
  }

  // ---------- internals ----------

  private async ensureClient(): Promise<AcpClient | undefined> {
    if (this.client) return this.client;
    return this.startSession();
  }

  private async startSession(resumeId?: string): Promise<AcpClient | undefined> {
    const gen = ++this.sessionGen;
    this.client?.dispose();
    this.client = undefined;
    this.autoApprove = false;
    this.hasHistory = false;
    this.suppressContent = false;
    this.lastPlanText = "";
    this.activeSessionId = undefined;
    this.titleGenerated = false;
    this.firstUserMessageForTitle = undefined;
    this.post({ type: "modeChanged", modeId: "agent" });
    if (resumeId) this.post({ type: "clearMessages" });

    const cfg = vscode.workspace.getConfiguration("grok");
    const cliPath = locateGrokCli(cfg.get<string>("cliPath", ""));
    this.cliPath = cliPath || undefined;
    if (!cliPath) {
      if (gen !== this.sessionGen) return undefined;
      this.post({ type: "onboarding", state: "missing-cli", platform: process.platform });
      return undefined;
    }

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const env = this.buildEnv(cwd);
    const effortStr = cfg.get<string>("defaultEffort", "");
    const effort = effortStr ? (effortStr as EffortLevel) : undefined;
    const client = new AcpClient({
      cliPath,
      cwd,
      env,
      effort,
      log: (msg) => this.output.appendLine(msg),
    });
    this.client = client;

    // fs handlers (mandatory — the agent calls these to read/write files)
    client.fsRead = async (p: string) => {
      try {
        const uri = vscode.Uri.file(p);
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString("utf8");
      } catch {
        return fs.readFileSync(p, "utf8");
      }
    };
    client.fsWrite = async (p: string, content: string) => {
      try {
        const uri = vscode.Uri.file(p);
        const dir = vscode.Uri.file(path.dirname(p));
        await vscode.workspace.fs.createDirectory(dir);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
      } catch {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content, "utf8");
      }
    };
    client.terminal = this.terminalManager;

    client.on("initialized", (init) => {
      if (gen !== this.sessionGen) return;
      this.post({
        type: "initialized",
        info: {
          cliPath,
          cwd,
          version: init?.serverInfo?.version ?? init?.version ?? null,
          init: { protocolVersion: init?.protocolVersion },
        },
      });
    });
    client.on("session", (res) => {
      if (gen !== this.sessionGen) return;
      if (res?.sessionId) this.activeSessionId = res.sessionId;
      this.post({
        type: "session",
        sessionId: res.sessionId,
        models: client.availableModels,
        currentModelId: client.currentModelId,
      });
    });
    client.on("modelChanged", (id) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "modelChanged", modelId: id });
    });
    client.on("modeChanged", (id) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "modeChanged", modeId: id });
    });
    client.on("commandsUpdate", (cmds) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "commandsUpdate", commands: cmds });
    });
    client.on("userMessage", (text: string) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "userMessage", text, chips: [] });
    });
    client.on("messageChunk", (text: string) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "messageChunk", text });
    });
    client.on("thoughtChunk", (text: string) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "thoughtChunk", text });
    });
    client.on("toolCall", (u) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "toolCall", call: u });
    });
    client.on("toolCallUpdate", (u) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "toolCallUpdate", call: u });
    });
    client.on("plan", (u) => {
      if (gen !== this.sessionGen) return;
      // Stash plan text — x.ai/exit_plan_mode params are typically empty
      this.lastPlanText =
        (typeof u?.plan === "string" ? u.plan : "") ||
        (typeof u?.planText === "string" ? u.planText : "") ||
        (typeof u?.content === "string" ? u.content : "") ||
        (typeof u?.content?.text === "string" ? u.content.text : "");
      this.output.appendLine(`[plan] event payload keys: ${Object.keys(u ?? {}).join(", ")}`);
    });
    client.on("promptComplete", (meta) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "promptComplete", meta });
    });
    client.on("xaiNotification", (u) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "xaiNotification", update: u });
    });
    client.on("permissionRequest", (req: PermissionRequest) => {
      if (gen !== this.sessionGen) return;
      if (this.autoApprove) {
        const opt = req.options.find((o) => o.kind === "allow_always") ??
                    req.options.find((o) => o.kind === "allow_once");
        if (opt) { client.respondPermission(req.id, opt.optionId); return; }
      }
      this.post({ type: "permissionRequest", req });
    });
    client.on("exitPlanRequest", (req: ExitPlanRequest) => {
      if (gen !== this.sessionGen) return;
      const plan = req.plan || this.lastPlanText;
      this.lastPlanText = "";
      this.post({ type: "exitPlanRequest", req: { ...req, plan } });
    });
    client.on("exit", (code) => {
      if (gen !== this.sessionGen) return; // suppress exit events from disposed/replaced clients
      this.post({ type: "exit", code });
    });
    client.on("stderr", (text: string) => this.output.append(text));

    try {
      await client.start();
      if (gen !== this.sessionGen) { client.dispose(); return undefined; }
      const defaultModel = cfg.get<string>("defaultModel", "");
      if (resumeId) {
        await client.loadSession(resumeId, defaultModel || undefined);
        this.activeSessionId = resumeId;
        this.titleGenerated = true; // existing session, name already in storage
        this.hasHistory = true;
      } else {
        await client.newSession(defaultModel || undefined);
        this.activeSessionId = client.sessionId;
      }
      if (gen !== this.sessionGen) { client.dispose(); this.client = undefined; return undefined; }
    } catch (err) {
      if (gen !== this.sessionGen) { client.dispose(); return undefined; }
      const msg = (err as any).message ?? String(err);
      client.dispose();
      this.client = undefined;
      if (/auth|unauthor|forbidden|401|403|api[_\s-]?key|credential|sign.?in/i.test(msg)) {
        this.post({ type: "onboarding", state: "auth-required" });
      } else {
        this.post({ type: "error", text: `Failed to start Grok: ${msg}` });
      }
      return undefined;
    }
    return client;
  }

  private async onMessage(msg: WebviewMsg): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.postInitialState();
        break;
      case "send":
        await this.handleSend(msg.text, msg.chips);
        break;
      case "newSession":
        await this.startSession();
        break;
      case "cancel":
        await this.client?.cancel();
        break;
      case "pickModel":
        await this.pickModel();
        break;
      case "setMode":
        await this.setMode(msg.modeId);
        break;
      case "removeChip":
        this.chips = removeChip(this.chips, msg.id);
        this.postChips();
        break;
      case "toggleChip":
        this.chips = toggleChip(this.chips, msg.id);
        this.postChips();
        break;
      case "openFile": {
        const ref = parseFileRef(msg.path);
        let p = ref.path;
        if (!path.isAbsolute(p)) {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (root) p = path.join(root, p);
        }
        const uri = vscode.Uri.file(p);
        if (ref.startLine != null) {
          const startLine = ref.startLine - 1;
          const endLine = (ref.endLine ?? ref.startLine) - 1;
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER),
            });
          } catch {
            void vscode.commands.executeCommand("vscode.open", uri);
          }
        } else {
          void vscode.commands.executeCommand("vscode.open", uri);
        }
        break;
      }
      case "openUrl":
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      case "openDiff":
        await this.openDiffEditor(msg.path, msg.oldText, msg.newText);
        break;
      case "dropFile":
        this.addDroppedFile(msg.path, msg.shift);
        break;
      case "permissionAnswer":
        this.client?.respondPermission(msg.requestId, msg.optionId);
        break;
      case "exitPlanAnswer":
        this.client?.respondExitPlan(msg.requestId, msg.verdict);
        break;
      case "setModel":
        if (this.client) {
          try { await this.client.setModel(msg.modelId); }
          catch (e) { vscode.window.showErrorMessage(`Failed to set model: ${(e as Error).message}`); }
        }
        break;
      case "setEffort": {
        const newLevel = msg.level;
        const cfg2 = vscode.workspace.getConfiguration("grok");

        if (!this.hasHistory || !this.client) {
          await cfg2.update("defaultEffort", newLevel, vscode.ConfigurationTarget.Global);
          await this.startSession();
          break;
        }

        const choice = await vscode.window.showInformationMessage(
          "Changing reasoning effort requires restarting the session.",
          "Summarize & Restart",
          "Just Restart",
        );
        if (!choice) break; // dismissed

        await cfg2.update("defaultEffort", newLevel, vscode.ConfigurationTarget.Global);

        if (choice === "Just Restart") {
          this.post({ type: "clearMessages" });
          await this.startSession();
          break;
        }

        // "Summarize & Restart": silently capture summary, inject as context in new session
        const currentClient = this.client;
        this.post({ type: "summarizing" });
        const chunks: string[] = [];
        const captureChunk = (t: string) => chunks.push(t);
        currentClient.on("messageChunk", captureChunk);
        this.suppressContent = true;
        try {
          await currentClient.prompt(
            "Summarize our conversation so far in a concise paragraph. Be brief.",
          );
        } catch { /* best effort */ } finally {
          currentClient.off("messageChunk", captureChunk);
          this.suppressContent = false;
        }
        const summary = chunks.join("").trim();

        await this.startSession(); // resets suppressContent to false

        if (summary && this.client) {
          this.post({ type: "sessionContext" });
          this.suppressContent = true;
          try {
            await this.client.prompt(`[Context from previous session]\n${summary}`);
          } catch { /* best effort */ } finally {
            this.suppressContent = false;
          }
        }
        break;
      }
      case "openGlobalConfig": {
        const home = process.env.HOME || process.env.USERPROFILE || "";
        const globalCfg = path.join(home, ".grok", "config.toml");
        if (!fs.existsSync(globalCfg)) {
          fs.mkdirSync(path.dirname(globalCfg), { recursive: true });
          fs.writeFileSync(globalCfg, "# Grok global configuration\n");
        }
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(globalCfg));
        break;
      }
      case "openProjectConfig": {
        const cwd2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const projCfg = path.join(cwd2, ".grok", "config.toml");
        if (!fs.existsSync(projCfg)) {
          fs.mkdirSync(path.dirname(projCfg), { recursive: true });
          fs.writeFileSync(projCfg, "# Grok project configuration\n# MCP servers here apply to this workspace only.\n");
        }
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(projCfg));
        break;
      }
      case "runMcpList": {
        const term = vscode.window.createTerminal("Grok MCP");
        term.show();
        term.sendText(`"${this.cliPath || "grok"}" mcp`);
        break;
      }
      case "showLogs":
        this.output.show();
        break;
      case "runInstallCmd": {
        const term = vscode.window.createTerminal("Install Grok");
        term.show();
        term.sendText(
          'curl -fsSL https://x.ai/cli/install.sh | bash && echo "\\nDone. Click \'Re-check connection\' in the Grok sidebar."',
        );
        break;
      }
      case "runGrokLogin": {
        const cliPath = this.cliPath || locateGrokCli(
          vscode.workspace.getConfiguration("grok").get<string>("cliPath", ""),
        );
        if (!cliPath) {
          this.post({ type: "onboarding", state: "missing-cli" });
          break;
        }
        const term = vscode.window.createTerminal("Grok Login");
        term.show();
        term.sendText(`"${cliPath}" /login`);
        break;
      }
      case "recheckConnection":
        await this.startSession();
        break;
      case "listSessions":
        this.postSessionsList();
        break;
      case "resumeSession":
        await this.startSession(msg.id);
        break;
      case "renameSession":
        this.renameSession(msg.id, msg.name);
        break;
      case "deleteSession":
        await this.deleteSession(msg.id);
        break;
      case "pickFile":
        await this.pickFileFromComputer();
        break;
    }

  }

  private postSessionsList(): void {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    const entries = listSessions({
      fs: defaultFs,
      grokHome: resolveGrokHome(process.env),
      cwd,
      overrides,
      log: (m) => this.output.appendLine(m),
    });
    this.post({
      type: "sessions",
      entries,
      activeId: this.activeSessionId,
    });
  }

  private renameSession(id: string, name: string): void {
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    const trimmed = (name || "").trim();
    const next: SessionMetaOverrides = { ...overrides };
    if (!trimmed) {
      const cur = next[id];
      if (cur) {
        const { customName: _drop, ...rest } = cur;
        if (Object.keys(rest).length === 0) delete next[id];
        else next[id] = rest;
      }
    } else {
      next[id] = { ...(next[id] ?? {}), customName: trimmed };
    }
    void this.context.globalState.update(SESSION_META_KEY, next);
    this.postSessionsList();
  }

  private async deleteSession(id: string): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    try {
      deleteSessionDir({
        fs: defaultFs,
        grokHome: resolveGrokHome(process.env),
        cwd,
        id,
      });
    } catch (e) {
      this.output.appendLine(`[sessions] delete failed for ${id}: ${(e as Error).message}`);
    }
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    if (overrides[id]) {
      const next = { ...overrides };
      delete next[id];
      void this.context.globalState.update(SESSION_META_KEY, next);
    }
    if (this.activeSessionId === id) {
      await this.startSession();
    }
    this.postSessionsList();
  }

  private async pickFileFromComputer(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: "Add to chat",
    });
    if (!picked || picked.length === 0) return;
    for (const uri of picked) {
      this.addDroppedFile(uri.fsPath, false);
    }
    this.reveal();
  }

  private async openDiffEditor(filePath: string, oldText: string, newText: string): Promise<void> {
    const tmp = vscode.Uri.parse(`untitled:${filePath}.before`);
    const after = vscode.Uri.file(filePath);
    // Write oldText into a virtual untitled doc, then diff against the file on disk that contains newText.
    const beforeDoc = await vscode.workspace.openTextDocument({ content: oldText, language: "plaintext" });
    const afterDoc = await vscode.workspace.openTextDocument({ content: newText, language: "plaintext" });
    await vscode.commands.executeCommand(
      "vscode.diff",
      beforeDoc.uri,
      afterDoc.uri,
      `Grok proposed: ${path.basename(filePath)}`,
    );
    // (tmp/after refs intentionally unused — we use openTextDocument's auto URIs)
    void tmp; void after;
  }

  private addDroppedFile(absPath: string, shiftHeld: boolean): void {
    if (!fs.existsSync(absPath)) return;
    const uri = vscode.Uri.file(absPath);
    const relPath = vscode.workspace.asRelativePath(uri);
    if (shiftHeld) {
      let totalLines = 1;
      try {
        totalLines = fs.readFileSync(absPath, "utf8").split("\n").length;
      } catch {
        /* keep 1 */
      }
      this.chips.push(makeExplicitChip(absPath, relPath, 1, totalLines));
    } else {
      this.chips.push(makeExplicitChip(absPath, relPath));
    }
    this.postChips();
  }

  private async handleSend(text: string, chips: FileChip[]): Promise<void> {
    const client = await this.ensureClient();
    if (!client) return;

    const finalPrompt = buildPrompt(text, chips, {
      readFile: (p) => fs.readFileSync(p, "utf8"),
      extName: (p) => path.extname(p),
    });

    this.chips = [];
    this.postChips();

    const isFirstSend = !this.hasHistory;
    this.hasHistory = true;
    if (isFirstSend) this.firstUserMessageForTitle = text;
    const sentChips = chips.filter((c) => !c.hidden);
    this.post({ type: "userMessage", text, chips: sentChips });
    this.post({ type: "agentStart" });

    try {
      const meta = await client.prompt(finalPrompt);
      this.post({ type: "agentEnd", meta });
      this.maybeGenerateTitle();
    } catch (err) {
      const e = err as any;
      const message = e?.data?.message ?? e?.message ?? String(err);
      this.post({ type: "agentError", text: message });
    }
  }

  private maybeGenerateTitle(): void {
    if (this.titleGenerated) return;
    const sid = this.client?.sessionId ?? this.activeSessionId;
    const first = this.firstUserMessageForTitle;
    if (!sid || !first) return;
    this.titleGenerated = true;
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    if (overrides[sid]?.customName) return;
    const title = pickSessionTitle(first);
    if (!title) return;
    const next: SessionMetaOverrides = {
      ...overrides,
      [sid]: { ...(overrides[sid] ?? {}), customName: title },
    };
    void this.context.globalState.update(SESSION_META_KEY, next);
  }

  private postInitialState(): void {
    const cfg = vscode.workspace.getConfiguration("grok");
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    this.post({
      type: "initialState",
      effort: cfg.get("defaultEffort", ""),
      cwd,
      useCtrlEnter: cfg.get("useCtrlEnterToSend", false),
    });
    if (cfg.get<boolean>("includeActiveFileByDefault", true)) {
      this.addActiveEditorChip();
    }
    void this.startSession();
  }

  private postChips(): void {
    this.post({ type: "chips", chips: this.chips });
  }

  private static readonly SUPPRESS_TYPES = new Set([
    "messageChunk", "thoughtChunk", "toolCall", "toolCallUpdate",
    "promptComplete", "xaiNotification", "userMessage", "agentStart", "agentEnd",
  ]);

  private post(message: any): void {
    if (this.suppressContent && GrokSidebar.SUPPRESS_TYPES.has(message.type)) return;
    this.view?.webview.postMessage(message);
  }

  private reveal(): void {
    this.view?.show?.(true);
  }

  private watchActiveEditor(): void {
    this.editorWatcher?.dispose();
    this.editorWatcher = vscode.window.onDidChangeActiveTextEditor(() => {
      const includeActive = vscode.workspace
        .getConfiguration("grok")
        .get<boolean>("includeActiveFileByDefault", true);
      if (!includeActive) return;
      this.chips = clearImplicitChips(this.chips);
      this.addActiveEditorChip();
    });
  }

  private addActiveEditorChip(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") return;
    const relPath = vscode.workspace.asRelativePath(editor.document.uri);
    this.chips.push(makeImplicitChip(editor.document.uri.fsPath, relPath));
    this.postChips();
  }

  private buildEnv(cwd: string): NodeJS.ProcessEnv {
    const dotEnv: Record<string, string> = {};
    try {
      const content = fs.readFileSync(path.join(cwd, ".env"), "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (key) dotEnv[key] = val;
      }
    } catch { /* no .env — fine */ }

    const env: NodeJS.ProcessEnv = { ...process.env, ...dotEnv };

    // XAI_API_KEY is the generic xAI key name; grok CLI needs GROK_CODE_XAI_API_KEY.
    // Map from either source (workspace .env or the user's shell environment).
    if (env["XAI_API_KEY"] && !env["GROK_CODE_XAI_API_KEY"]) {
      env["GROK_CODE_XAI_API_KEY"] = env["XAI_API_KEY"];
    }

    if (Object.keys(dotEnv).length > 0) {
      this.output.appendLine(`[env] loaded ${Object.keys(dotEnv).length} var(s) from .env`);
    }
    return env;
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const mediaUri = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", file));
    const resourceUri = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "resources", file));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${mediaUri("chat.css")}" />
</head>
<body>

  <header class="top-bar">
    <button id="history-btn" class="toolbar-btn" title="Session history"></button>
    <button id="new-btn" class="toolbar-btn" title="New session"></button>
    <div id="history-popover" class="toolbar-popover history-popover" hidden></div>
  </header>

  <main id="messages" class="messages">
    <div class="welcome" id="welcome">
      <img src="${resourceUri("grok-mark-light.svg")}" alt="Grok" class="welcome-mark" />
      <h2>Grok Build</h2>
      <p class="welcome-byline muted">by Paweł Huryn (<a href="https://www.productcompass.pm" class="muted-link">productcompass.pm</a>)</p>
      <p id="welcome-version" class="muted">starting...</p>
      <ul class="welcome-tips" id="welcome-tips">
        <li>Type your prompt below. <kbd>Enter</kbd> to send.</li>
        <li>Slash commands: <code>/compact</code>, <code>/new</code>, <code>/plan</code>, <code>/context</code>, <code>/yolo</code>.</li>
        <li>Active files appear in the toolbar below — click to toggle in/out of context.</li>
      </ul>
      <div id="welcome-onboarding"></div>
    </div>
  </main>

  <footer class="composer">
    <textarea id="input" placeholder="Ask Grok..." rows="3"></textarea>
    <div class="composer-toolbar">
      <div class="toolbar-left">
        <button id="add-btn" class="toolbar-btn" title="Add context"></button>
        <button id="gear-btn" class="toolbar-btn" title="Settings"></button>
        <div class="context-donut" id="donut" title="Context usage">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="5" fill="none" stroke="var(--vscode-editorWidget-border,#444)" stroke-width="3"/>
            <circle id="donut-arc" cx="8" cy="8" r="5" fill="none" stroke="var(--vscode-charts-green,#4ec9b0)" stroke-width="3" stroke-dasharray="0 999" transform="rotate(-90 8 8)"/>
          </svg>
          <span id="donut-label" class="small muted">0%</span>
        </div>
        <div id="chips"></div>
      </div>
      <div class="toolbar-right">
        <button id="mode-btn" class="toolbar-btn" title="Pick mode"></button>
        <button id="send-btn" class="send"></button>
      </div>
    </div>
    <div id="mode-popover" class="toolbar-popover" hidden></div>
    <div id="gear-popover" class="toolbar-popover gear-popover" hidden></div>
    <div id="add-popover" class="toolbar-popover" hidden></div>
    <div id="slash-popover" class="slash-popover" hidden></div>
  </footer>

  <script nonce="${nonce}" src="${mediaUri("webview-helpers.js")}"></script>
  <script nonce="${nonce}" src="${mediaUri("chat.js")}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
