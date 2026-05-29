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
import { parseFileRef, shouldReadFileInline } from "./file-ref";
import { pickRejectOption, shouldRejectPermission } from "./plan-gate";
import { appendPlanEntry, decideRestoreState } from "./plan-restore";
import { GROK_PRIMER } from "./grok-primer";
import {
  SessionListEntry,
  SessionMetaOverrides,
  defaultFs,
  deleteSessionDir,
  listSessions,
  resolveGrokHome,
  sessionsDirFor,
} from "./sessions";

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
  | { type: "exitPlanAnswer"; requestId: number | string; verdict: "approved" | "abandoned" | "rejected"; comment?: string }
  | { type: "setModel"; modelId: string }
  | { type: "runInstallCmd" }
  | { type: "runGrokLogin" }
  | { type: "recheckConnection" }
  | { type: "listSessions" }
  | { type: "resumeSession"; id: string }
  | { type: "renameSession"; id: string; name: string }
  | { type: "deleteSession"; id: string; name?: string }
  | { type: "pickFile" };

const SESSION_META_KEY = "grok.sessionMeta";

// grok's non-plan ("act") mode id on the wire. The CLI reports this via
// current_mode_update after leaving plan mode (verified against grok 0.2.3 —
// see research/plan-mode.md). The UI labels it "Agent"; the wire calls it
// "default".
const ACT_MODE_ID = "default";

export class GrokSidebar implements vscode.WebviewViewProvider {
  public static readonly viewId = "grok.chat";
  private view?: vscode.WebviewView;
  private client?: AcpClient;
  private output: vscode.OutputChannel;
  private chips: FileChip[] = [];
  private editorWatcher?: vscode.Disposable;
  private terminalManager = new TerminalManager();
  private autoApprove = false;
  private planActive = false;
  // Deferred post-turn action. The CLI's exit_plan_mode arrives *during* an
  // in-flight session/prompt, so we can't send a new prompt/set_mode from the
  // approval handler — we'd collide with the running turn. We stash the action
  // here and run it once the current prompt resolves (see handleSend).
  private afterTurn?: () => Promise<void>;
  private cliPath?: string;
  private sessionGen = 0;
  private hasHistory = false;
  private suppressContent = false;
  // Plan-reject specific suppression: drop streaming output (the false-approval
  // ramble) but let lifecycle events through so the webview clears `busy` and
  // re-enables the send button when the cancelled turn finally ends.
  private suppressPlanReject = false;
  private lastPlanText = "";
  // Plan text currently shown in the live exit_plan_mode card. Set when we post
  // the card to the webview, read by persistPlanVerdict when the user picks a
  // verdict, then cleared. Decoupled from lastPlanText (which gets nuked the
  // moment we render the card) so the saved history actually has content.
  private pendingPlanText = "";
  // Count of user messages that have entered this session (replayed + live).
  // Persisted on each resolved plan as `afterUserMessage` so the resume view
  // can render plan cards inline with the conversation rather than at the end.
  private userMessageCount = 0;
  // True while a sequence of user_message_chunk events is mid-flight, so we
  // only increment userMessageCount once per user message during replay.
  private inUserMessage = false;
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

  /**
   * Development / testing helper. Posts a realistic dummy `exitPlanRequest` so
   * the plan-review card (Approve / Reject / Cancel) appears in the webview.
   * Lets you exercise the three options, the feedback textarea, the resolved
   * state, and the downstream notice/mode logic without a live grok process.
   * The "Reject" button is the one labeled "Keep planning" in the real flow.
   */
  debugShowDummyPlan(): void {
    const dummyPlan = `# Refactor authentication helper

## Summary
Introduce a small \`auth.ts\` module and migrate the two call sites in the API layer. No behavior change for end users.

## Detailed steps
1. Create \`src/lib/auth.ts\` exporting \`getSessionToken()\` and \`isTokenExpired()\`.
2. Update \`src/api/client.ts\` (two call sites) to delegate to the new helper.
3. Add unit tests in \`tests/auth.test.ts\` covering expiry + refresh paths.
4. Run the integration suite to confirm nothing regressed.

## Risk / notes
- Token format is unchanged.
- One new (already-transitive) dependency on \`jsonwebtoken\`.

\`\`\`ts
// proposed addition to src/lib/auth.ts
export async function getSessionToken(): Promise<string> {
  const cached = getFromCache();
  if (cached && !isTokenExpired(cached)) return cached;
  return refresh();
}
\`\`\`

See design doc for the full state machine diagram.`;

    this.post({
      type: "exitPlanRequest",
      req: {
        id: "dummy-plan-" + Date.now(),
        sessionId: this.activeSessionId || "dummy-session",
        plan: dummyPlan,
      },
    });

    // Make the bottom mode button reflect Plan during the manual test.
    this.post({ type: "modeChanged", modeId: "plan" });
  }

  /**
   * The mode the UI should show. Plan and YOLO are *client* states that the CLI
   * doesn't model (the CLI only knows agent/plan), so we derive the button label
   * here rather than echoing the CLI's raw mode id.
   */
  private displayMode(): "agent" | "plan" | "yolo" {
    if (this.planActive) return "plan";
    if (this.autoApprove) return "yolo";
    return "agent";
  }

  private postMode(): void {
    this.post({ type: "modeChanged", modeId: this.displayMode() });
  }

  /** Toggle the client-enforced plan gate and keep the live client in sync. */
  private setPlanActive(v: boolean): void {
    this.planActive = v;
    if (this.client) this.client.planActive = v;
    this.postMode();
  }

  async setMode(modeId: "agent" | "plan" | "yolo"): Promise<void> {
    // Agent/plan/yolo are mutually exclusive. Plan = client write/exec gate;
    // YOLO = auto-approve. Both ride on top of the CLI's agent mode, except
    // Plan which also tells the CLI to plan instead of act.
    if (modeId === "yolo") {
      this.autoApprove = true;
      this.setPlanActive(false); // posts displayMode → "yolo"
      if (this.client) {
        try { await this.client.setMode(ACT_MODE_ID); } catch { /* CLI stays put; gate is what matters */ }
      }
      return;
    }
    this.autoApprove = false;
    if (modeId === "plan") {
      this.setPlanActive(true); // posts displayMode → "plan"
      if (this.client) {
        try { await this.client.setMode("plan"); }
        catch (e) { vscode.window.showErrorMessage(`Couldn't switch mode: ${(e as Error).message}`); }
      }
      return;
    }
    // agent
    this.setPlanActive(false); // posts displayMode → "agent"
    if (this.client) {
      try { await this.client.setMode(ACT_MODE_ID); }
      catch (e) { vscode.window.showErrorMessage(`Couldn't switch mode: ${(e as Error).message}`); }
    }
  }

  /**
   * Resolve a plan-review card. The CLI's `exit_plan_mode` treats *any* response
   * as approval, so the protocol verdict is cosmetic — our gate is the real
   * decision. Crucially, this fires *during* the planning prompt's turn, so we
   * only respond here and defer any new prompt/set_mode to `afterTurn`, which
   * runs once that turn completes (handleSend).
   *
   * Three verdicts:
   *  - `approved`: drop gate, return CLI to act mode, send "implement now".
   *  - `rejected`: keep gate up. If the user left a comment, send it as a plain
   *    user message after the turn ends and let grok decide what to do next
   *    (re-plan, ask clarifying questions, etc.) — we don't force a specific
   *    "revise the plan" framing.
   *  - `abandoned`: drop gate (exit plan mode entirely), no follow-up prompt.
   *    The user wants to back out and continue freely.
   *
   * `rejected`/`abandoned` cut off the CLI's false-approval continuation via
   * `cancel()` + a content-only suppression flag. Lifecycle events
   * (`promptComplete`, `agentEnd`) still reach the webview so `busy` clears and
   * the send button re-enables when the cancelled turn finally ends.
   */
  private handleExitPlan(
    requestId: number | string,
    verdict: "approved" | "abandoned" | "rejected",
    comment?: string,
  ): void {
    const client = this.client;
    if (!client) return;
    const gen = this.sessionGen;
    client.respondExitPlan(requestId, verdict);
    this.persistPlanVerdict(verdict);

    const feedback = comment?.trim();

    if (verdict === "approved") {
      // Drop the gate now, then once the planning turn ends, return the CLI to
      // act mode and have it implement. The wire-level prompt uses the same
      // [Plan approved] marker the primer trained grok to recognize, so all
      // three verdicts speak a consistent protocol. If the user attached a
      // comment, post it as their user bubble immediately and append it to the
      // wire-level prompt — same pattern as reject/cancel.
      this.setPlanActive(false);
      if (feedback) {
        this.userMessageCount += 1;
        this.post({ type: "userMessage", text: feedback, chips: [] });
      }
      this.post({ type: "planProcessing" }); // indicator while we wait for grok
      const promptToGrok = feedback ? `[Plan approved] ${feedback}` : "[Plan approved]";
      this.afterTurn = async () => {
        try { await client.setMode(ACT_MODE_ID); } catch { /* CLI usually auto-exits already */ }
        this.post({ type: "agentStart" });
        try {
          const meta = await client.prompt(promptToGrok);
          if (gen !== this.sessionGen) return;
          this.post({ type: "agentEnd", meta });
        } catch (err) {
          if (gen !== this.sessionGen) return;
          const e = err as any;
          this.post({ type: "agentError", text: e?.data?.message ?? e?.message ?? String(err) });
        }
      };
      return;
    }

    // rejected / abandoned: cancel the in-flight turn and suppress its content
    // so the false-approval response doesn't reach the screen.
    void client.cancel();
    this.post({ type: "agentReset" });
    this.suppressPlanReject = true;

    // If the user attached a comment, post it as their user bubble IMMEDIATELY
    // (not deferred to afterTurn) so it lands in the conversation right after
    // the verdict click. Same text gets sent to grok later, verbatim — what the
    // user sees IS what grok receives, no wire-level boilerplate prefix.
    if (feedback) {
      this.userMessageCount += 1;
      this.post({ type: "userMessage", text: feedback, chips: [] });
      this.post({ type: "planProcessing" }); // grok will process this comment
    }

    if (verdict === "rejected") {
      // Stay in plan mode. The wire-level prompt is always prefixed with the
      // [Plan rejected] marker the primer trained grok to recognize — even when
      // the user typed a comment, grok needs the unambiguous verdict tag in
      // front of it to distinguish "Reject + free-form note" from a regular
      // user message. The webview's user bubble (posted earlier in this
      // function) still shows just the user's words.
      this.setPlanActive(true);
      if (!feedback) {
        this.post({
          type: "planNotice",
          text: "Plan rejected — staying in Plan mode. Grok is processing the rejection…",
        });
        this.post({ type: "planProcessing" });
      }
      const promptToGrok = feedback ? `[Plan rejected] ${feedback}` : "[Plan rejected]";
      this.afterTurn = async () => {
        this.suppressPlanReject = false;
        try { await client.setMode("plan"); } catch { /* gate still enforces */ }
        this.post({ type: "agentStart" });
        try {
          const meta = await client.prompt(promptToGrok);
          if (gen !== this.sessionGen) return;
          this.post({ type: "agentEnd", meta });
        } catch (err) {
          if (gen !== this.sessionGen) return;
          const e = err as any;
          this.post({ type: "agentError", text: e?.data?.message ?? e?.message ?? String(err) });
        }
      };
      return;
    }

    // abandoned: drop the gate, return to agent mode. The wire-level prompt is
    // always prefixed with the [Plan cancelled] marker (per the primer
    // contract). With a comment, the marker precedes the user's words; without
    // one, the marker stands alone.
    this.setPlanActive(false);
    if (!feedback) {
      this.post({
        type: "planNotice",
        text: "Plan abandoned — switched to Agent mode. Grok is processing the cancellation…",
      });
      this.post({ type: "planProcessing" });
    }
    const promptToGrok = feedback ? `[Plan cancelled] ${feedback}` : "[Plan cancelled]";
    this.afterTurn = async () => {
      this.suppressPlanReject = false;
      try { await client.setMode(ACT_MODE_ID); } catch { /* best-effort */ }
      this.post({ type: "agentStart" });
      try {
        const meta = await client.prompt(promptToGrok);
        if (gen !== this.sessionGen) return;
        this.post({ type: "agentEnd", meta });
      } catch (err) {
        if (gen !== this.sessionGen) return;
        const e = err as any;
        this.post({ type: "agentError", text: e?.data?.message ?? e?.message ?? String(err) });
      }
    };
  }

  /** Send the extension's standing instructions to grok at session start.
   *  Suppresses both the user-side bubble and grok's acknowledgment in the live
   *  chat so the conversation reads clean. Posts setBusy true/false so the
   *  user can't fire a concurrent prompt during the primer's brief turn —
   *  while busy, the send button reverts to a stop icon. */
  private async primeGrok(client: AcpClient, gen: number): Promise<void> {
    // Locked busy: the send button shows a spinner and is disabled. The user
    // can't cancel the primer mid-flight — leaving grok un-primed would
    // silently break the verdict protocol the primer establishes.
    this.post({ type: "setBusy", value: true, locked: true });
    this.suppressContent = true;
    try {
      await client.prompt(GROK_PRIMER);
    } catch (e) {
      // Best-effort: a failed primer doesn't block the session, the gate is
      // still the real defense. Log it for debugging.
      this.output.appendLine(`[primer] failed: ${(e as Error).message}`);
    } finally {
      this.suppressContent = false;
      if (gen === this.sessionGen) this.post({ type: "setBusy", value: false });
    }
  }

  /** Persist this plan (text + verdict) so the resume view can replay every plan
   *  the user resolved in this session — grok's on-disk plan.md only retains the
   *  latest, so we'd otherwise lose plans the agent overwrote later. */
  private persistPlanVerdict(verdict: "approved" | "abandoned" | "rejected"): void {
    const sid = this.activeSessionId ?? this.client?.sessionId;
    if (!sid) return;
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    const cur = overrides[sid] ?? {};
    const planText = this.pendingPlanText || "";
    this.pendingPlanText = "";
    const plans = appendPlanEntry(cur.plans, {
      text: planText,
      verdict,
      afterUserMessage: this.userMessageCount,
    });
    const next: SessionMetaOverrides = {
      ...overrides,
      [sid]: { ...cur, lastPlanVerdict: verdict, plans },
    };
    void this.context.globalState.update(SESSION_META_KEY, next);
  }

  /** Run and clear any deferred post-turn action set by `handleExitPlan`. */
  private async runAfterTurn(): Promise<void> {
    const fn = this.afterTurn;
    if (!fn) return;
    this.afterTurn = undefined;
    await fn();
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
    this.planActive = false;
    this.afterTurn = undefined;
    this.hasHistory = false;
    this.suppressContent = false;
    this.suppressPlanReject = false;
    this.lastPlanText = "";
    this.pendingPlanText = "";
    this.userMessageCount = 0;
    this.inUserMessage = false;
    this.activeSessionId = undefined;
    this.titleGenerated = false;
    this.firstUserMessageForTitle = undefined;
    this.post({ type: "modeChanged", modeId: "agent" });
    if (resumeId) this.post({ type: "clearMessages" });

    // Lock the composer (spinner, disabled) for the whole session-start window —
    // start() + newSession()/load + primer — so a prompt can't be sent before
    // the session exists, which would otherwise throw "no session". primeGrok
    // clears it on success; the failure paths below clear it too.
    this.post({ type: "setBusy", value: true, locked: true });

    const cfg = vscode.workspace.getConfiguration("grok");
    const cliPath = locateGrokCli(cfg.get<string>("cliPath", ""));
    this.cliPath = cliPath || undefined;
    if (!cliPath) {
      if (gen !== this.sessionGen) return undefined;
      this.post({ type: "setBusy", value: false });
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
      if (id === "plan") {
        // CLI entered plan mode (covers the agent self-initiating it from a
        // natural-language request). Raise our gate so the exit is enforced.
        this.autoApprove = false;
        this.setPlanActive(true);
      } else {
        // CLI reports a non-plan mode. Do NOT auto-drop the gate here: the buggy
        // exit_plan_mode emits "default" even when the user chose to keep
        // planning. The gate is lowered only by explicit user action (approve,
        // or pick Agent/YOLO). Just refresh the button label.
        this.postMode();
      }
    });
    client.on("commandsUpdate", (cmds) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "commandsUpdate", commands: cmds });
    });
    client.on("messageChunk", (text: string) => {
      if (gen !== this.sessionGen) return;
      this.inUserMessage = false;
      this.post({ type: "messageChunk", text });
    });
    client.on("userMessageChunk", (text: string) => {
      if (gen !== this.sessionGen) return;
      // Only the CLI replays these (during session/load). Live prompts render
      // their user bubble from send(); the agent never echoes them back. The
      // first chunk after a non-user chunk marks the start of a new user
      // message — count it so the next persisted plan knows where it lives.
      if (!this.inUserMessage) {
        this.userMessageCount += 1;
        this.inUserMessage = true;
      }
      this.post({ type: "userMessageChunk", text });
    });
    client.on("thoughtChunk", (text: string) => {
      if (gen !== this.sessionGen) return;
      this.inUserMessage = false;
      this.post({ type: "thoughtChunk", text });
    });
    client.on("toolCall", (u) => {
      if (gen !== this.sessionGen) return;
      this.inUserMessage = false;
      this.post({ type: "toolCall", call: u });
    });
    client.on("toolCallUpdate", (u) => {
      if (gen !== this.sessionGen) return;
      this.inUserMessage = false;
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
      // While planning, decline any mutating permission outright. Agent mode
      // skips this prompt for edits it deems safe — the fs/terminal gate is the
      // real backstop — but if the CLI *does* ask, we say no without bothering
      // the user.
      if (this.planActive && shouldRejectPermission(req.toolCall?.kind, {
        active: true,
        workspaceRoot: cwd,
      })) {
        const rejectId = pickRejectOption(req.options);
        if (rejectId) {
          client.respondPermission(req.id, rejectId);
          this.post({
            type: "planNotice",
            text: `Plan mode declined a ${req.toolCall?.kind ?? "tool"} request — approve the plan first.`,
          });
          return;
        }
        // No decline option offered — fall through and let the user decide.
      }
      if (this.autoApprove) {
        const opt = req.options.find((o) => o.kind === "allow_always") ??
                    req.options.find((o) => o.kind === "allow_once");
        if (opt) { client.respondPermission(req.id, opt.optionId); return; }
      }
      this.post({ type: "permissionRequest", req });
    });
    client.on("mutationBlocked", (info: { kind: string; target: string }) => {
      if (gen !== this.sessionGen) return;
      this.post({ type: "planBlocked", kind: info.kind, target: info.target });
    });
    client.on("planFileContent", (content: string) => {
      if (gen !== this.sessionGen) return;
      if (typeof content === "string" && content.trim()) this.lastPlanText = content;
    });
    client.on("exitPlanRequest", (req: ExitPlanRequest) => {
      if (gen !== this.sessionGen) return;
      const plan = req.plan || this.lastPlanText;
      // Hold onto the plan text until the user picks a verdict so persistPlanVerdict
      // can save it. Cleared (via resolved/pending) so the next plan starts fresh.
      this.pendingPlanText = plan;
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
        // Queue any saved plans BEFORE replay starts so the webview can interleave
        // them inline with user messages as they replay (instead of dumping all
        // cards at the bottom).
        const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
        const saved = overrides[resumeId]?.plans ?? [];
        if (saved.length > 0) {
          this.post({ type: "planHistoryQueue", plans: saved });
          this.lastPlanText = saved[saved.length - 1].text;
        } else {
          // Legacy session (no per-plan persistence): fall back to the on-disk
          // latest plan, which we'll render at the bottom after replay.
          const planPath = path.join(sessionsDirFor(resolveGrokHome(process.env), cwd), resumeId, "plan.md");
          if (fs.existsSync(planPath)) {
            try {
              const planText = fs.readFileSync(planPath, "utf8");
              this.post({ type: "planHistoryQueue", plans: [{ text: planText, verdict: undefined as any }] });
              this.lastPlanText = planText;
            } catch (e) {
              this.output.appendLine(`[plan-restore] ${(e as Error).message}`);
            }
          }
        }

        // Bracket the replay so the webview can render finalized "Thought"
        // headers (no elapsed time — the original timing isn't in the stream).
        this.post({ type: "historyReplay", active: true });
        try {
          await client.loadSession(resumeId, defaultModel || undefined);
        } finally {
          this.post({ type: "historyReplay", active: false });
        }
        this.activeSessionId = resumeId;
        this.titleGenerated = true; // existing session, name already in storage
        this.hasHistory = true;

        // Plan-gate restoration: the CLI replays its own current_mode_update
        // events during loadSession, which our modeChanged handler honors by
        // raising the gate. Override that here with the actual verdict-driven
        // decision (see plan-restore.ts) so a Cancelled or Approved session
        // doesn't come back stuck in Plan mode.
        const decision = decideRestoreState(saved);
        this.setPlanActive(decision.planActive);
        const targetMode = decision.cliMode === "plan" ? "plan" : ACT_MODE_ID;
        try { await client.setMode(targetMode); } catch { /* best-effort */ }
      } else {
        await client.newSession(defaultModel || undefined);
        this.activeSessionId = client.sessionId;
      }
      if (gen !== this.sessionGen) { client.dispose(); this.client = undefined; return undefined; }

      // Send our "system prompt" to grok — once per session start (new AND
      // restored). The CLI's exit_plan_mode bug can't be patched at the wire
      // layer, so we tell grok in plain English to ignore the wire verdict
      // and read it from the follow-up message. See src/grok-primer.ts.
      await this.primeGrok(client, gen);
      if (gen !== this.sessionGen) { client.dispose(); this.client = undefined; return undefined; }
    } catch (err) {
      if (gen !== this.sessionGen) { client.dispose(); return undefined; }
      const msg = (err as any).message ?? String(err);
      client.dispose();
      this.client = undefined;
      this.post({ type: "setBusy", value: false });
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
          const startLine = Math.max(0, ref.startLine - 1);
          const endLine = ref.endLine != null ? Math.max(startLine, ref.endLine - 1) : startLine;
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
        this.handleExitPlan(msg.requestId, msg.verdict, msg.comment);
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
        await cfg2.update("defaultEffort", newLevel, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage(
          "Grok Build ACP sessions currently use the CLI default effort; this setting is saved for future support.",
        );
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
        // Windows ships a native CLI installed via PowerShell; the default VS Code
        // terminal there is PowerShell, so use its syntax. Everything else is POSIX.
        const done = "Done. Click 'Re-check connection' in the Grok sidebar.";
        term.sendText(
          process.platform === "win32"
            ? `irm https://x.ai/cli/install.ps1 | iex; Write-Host "\`n${done}"`
            : `curl -fsSL https://x.ai/cli/install.sh | bash && echo "\\n${done}"`,
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
        await this.deleteSession(msg.id, msg.name);
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

  private async deleteSession(id: string, name?: string): Promise<void> {
    const label = name ? `session "${name}"` : "this session";
    const choice = await vscode.window.showWarningMessage(
      `Delete ${label}? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (choice !== "Delete") return;
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
      // Only read the whole file (to count lines for an inline selection) when
      // it's small enough not to freeze the host thread. Large files fall back
      // to a plain no-selection chip.
      let totalLines: number | undefined;
      try {
        if (shouldReadFileInline(fs.statSync(absPath).size)) {
          totalLines = fs.readFileSync(absPath, "utf8").split("\n").length;
        }
      } catch {
        /* fall back to a no-selection chip */
      }
      this.chips.push(
        totalLines != null
          ? makeExplicitChip(absPath, relPath, 1, totalLines)
          : makeExplicitChip(absPath, relPath),
      );
    } else {
      this.chips.push(makeExplicitChip(absPath, relPath));
    }
    this.postChips();
  }

  private async handleSend(text: string, chips: FileChip[]): Promise<void> {
    const client = await this.ensureClient();
    if (!client) return;
    const gen = this.sessionGen;

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
    this.userMessageCount += 1;
    this.inUserMessage = false; // live send isn't part of the streamed-chunk count path
    this.post({ type: "userMessage", text, chips: sentChips });
    this.post({ type: "agentStart" });

    try {
      const meta = await client.prompt(finalPrompt);
      if (gen !== this.sessionGen) return; // session was switched mid-turn
      // Skip agentEnd if a verdict was clicked mid-turn (afterTurn is queued).
      // Otherwise busy clears here, then the user could send during the brief
      // gap before afterTurn's own client.prompt starts. afterTurn emits its
      // own agentEnd at the end of its prompt, so busy stays true throughout.
      if (!this.afterTurn) {
        this.post({ type: "agentEnd", meta });
      }
      this.maybeGenerateTitle();
    } catch (err) {
      if (gen !== this.sessionGen) return; // prompt rejected because we disposed the old client — don't leak the error into the new session
      const e = err as any;
      const message = e?.data?.message ?? e?.message ?? String(err);
      this.post({ type: "agentError", text: message });
    } finally {
      // If the user approved/declined a plan mid-turn, the follow-up action was
      // deferred until now (a new prompt can't overlap the one above).
      try { await this.runAfterTurn(); }
      finally { this.suppressPlanReject = false; } // safety net for plan-reject suppression
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
    const cleaned = first.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const title = cleaned.length > 50 ? cleaned.slice(0, 47) + "…" : cleaned;
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
    "messageChunk", "userMessageChunk", "thoughtChunk", "toolCall", "toolCallUpdate",
    "promptComplete", "xaiNotification", "userMessage", "agentStart", "agentEnd",
  ]);
  // Subset: content only, not lifecycle. Lets promptComplete/agentEnd through so
  // the webview's `busy` state clears when the false-approval turn ends.
  private static readonly PLAN_REJECT_SUPPRESS = new Set([
    "messageChunk", "userMessageChunk", "thoughtChunk", "toolCall", "toolCallUpdate", "xaiNotification",
  ]);

  private post(message: any): void {
    if (this.suppressContent && GrokSidebar.SUPPRESS_TYPES.has(message.type)) return;
    if (this.suppressPlanReject && GrokSidebar.PLAN_REJECT_SUPPRESS.has(message.type)) return;
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
