import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface, Interface } from "node:readline";
import { EventEmitter } from "node:events";
import {
  extractPromptMeta,
  makeAckResponse,
  makeExitPlanResponse,
  makePermissionResponse,
  makeRequest,
  parseAcpLine,
  routeSessionUpdate,
} from "./acp-dispatch";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface AcpClientOptions {
  cliPath: string;
  cwd: string;
  effort?: EffortLevel;
  env?: NodeJS.ProcessEnv;
  log: (msg: string) => void;
}

export interface ModelInfo {
  modelId: string;
  name: string;
  description?: string;
  totalContextTokens?: number;
}

export interface SlashCommand {
  name: string;
  description?: string;
  input?: { hint?: string };
}

export interface PromptResultMeta {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelId?: string;
}

export interface PermissionOption {
  optionId: string;
  kind: string; // "allow_always" | "allow_once" | "reject_once" | ...
  name: string;
}

export interface PermissionRequest {
  id: number | string;
  sessionId: string;
  toolCall: {
    toolCallId: string;
    kind: string; // "edit" | "execute" | "read" | ...
    title: string;
    rawInput?: any;
  };
  options: PermissionOption[];
}

export interface ExitPlanRequest {
  id: number | string;
  sessionId: string;
  plan: string;
}

export interface FsReadHandler {
  (path: string): Promise<string>;
}
export interface FsWriteHandler {
  (path: string, content: string): Promise<void>;
}
export interface TerminalHandler {
  create(params: { command: string; env?: Array<{ name: string; value: string }>; cwd?: string; outputByteLimit?: number }): { terminalId: string };
  output(terminalId: string): { output: string; exitStatus: { exitCode: number } | null; truncated: boolean };
  waitForExit(terminalId: string): Promise<{ exitCode: number }>;
  kill(terminalId: string): void;
  release(terminalId: string): void;
}

type Pending = { resolve: (v: any) => void; reject: (e: any) => void };

export class AcpClient extends EventEmitter {
  private proc?: ChildProcessWithoutNullStreams;
  private rl?: Interface;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  sessionId?: string;
  currentModelId?: string;
  currentModeId?: string;
  availableModels: ModelInfo[] = [];
  availableCommands: SlashCommand[] = [];
  lastMeta?: PromptResultMeta;

  /** Set by the host to satisfy server→client fs requests. */
  fsRead?: FsReadHandler;
  fsWrite?: FsWriteHandler;
  /** Set by the host to satisfy server→client terminal/* requests. */
  terminal?: TerminalHandler;

  constructor(private opts: AcpClientOptions) {
    super();
  }

  async start(): Promise<void> {
    const args: string[] = ["agent"];
    if (this.opts.effort) {
      args.push("--reasoning-effort", this.opts.effort);
    }
    args.push("stdio");

    this.opts.log(`spawning ${this.opts.cliPath} ${args.join(" ")} (cwd=${this.opts.cwd})`);
    this.proc = spawn(this.opts.cliPath, args, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
    });

    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this.onLine(line));

    this.proc.stderr.on("data", (d) => {
      const text = d.toString();
      this.opts.log(`[stderr] ${text}`);
      this.emit("stderr", text);
    });
    this.proc.on("exit", (code) => {
      this.opts.log(`grok exited with code ${code}`);
      this.emit("exit", code);
      for (const [id, p] of this.pending) {
        this.pending.delete(id);
        p.reject(new Error(`Grok process exited (code ${code})`));
      }
    });
    this.proc.on("error", (err) => {
      this.opts.log(`spawn error: ${err.message}`);
      this.emit("error", err);
    });

    const init = await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    this.emit("initialized", init);
  }

  async newSession(modelId?: string): Promise<{ sessionId: string }> {
    const res = await this.request("session/new", {
      cwd: this.opts.cwd,
      mcpServers: [],
    });
    this.sessionId = res.sessionId;
    this.currentModelId = res.models?.currentModelId;
    this.availableModels = (res.models?.availableModels ?? []).map((m: any) => ({
      modelId: m.modelId,
      name: m.name,
      description: m.description,
      totalContextTokens: m._meta?.totalContextTokens,
    }));
    this.emit("session", res);

    if (modelId && modelId !== this.currentModelId) {
      await this.setModel(modelId);
    }
    return { sessionId: res.sessionId };
  }

  async loadSession(sessionId: string, modelId?: string): Promise<{ sessionId: string }> {
    const res = await this.request("session/load", {
      sessionId,
      cwd: this.opts.cwd,
      mcpServers: [],
    });
    this.sessionId = sessionId;
    this.currentModelId = res?.models?.currentModelId ?? this.currentModelId;
    if (res?.models?.availableModels) {
      this.availableModels = res.models.availableModels.map((m: any) => ({
        modelId: m.modelId,
        name: m.name,
        description: m.description,
        totalContextTokens: m._meta?.totalContextTokens,
      }));
    }
    this.emit("session", { sessionId, ...(res ?? {}) });
    this.emit("sessionLoaded", { sessionId });
    if (modelId && modelId !== this.currentModelId) {
      await this.setModel(modelId);
    }
    return { sessionId };
  }

  async setModel(modelId: string): Promise<void> {
    if (!this.sessionId) throw new Error("no session");
    const res = await this.request("session/set_model", {
      sessionId: this.sessionId,
      modelId,
    });
    const ok = res?._meta?.model?.Ok;
    if (ok) {
      this.currentModelId = ok;
      this.emit("modelChanged", ok);
    }
  }

  async setMode(modeId: "plan" | "agent"): Promise<void> {
    if (!this.sessionId) throw new Error("no session");
    await this.request("session/set_mode", {
      sessionId: this.sessionId,
      modeId,
    });
    // current_mode_update will arrive as a session/update
  }

  async prompt(text: string): Promise<PromptResultMeta> {
    if (!this.sessionId) throw new Error("no session");
    const result = await this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
    const meta = extractPromptMeta(result);
    this.lastMeta = meta;
    this.emit("promptComplete", meta);
    return meta;
  }

  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.request("session/cancel", { sessionId: this.sessionId });
    } catch {
      /* best-effort */
    }
  }

  /** Respond to a pending permission request (from the agent) with the chosen option id. */
  respondPermission(requestId: number | string, optionId: string): void {
    this.proc?.stdin.write(JSON.stringify(makePermissionResponse(requestId, optionId)) + "\n");
  }

  /** Respond to a pending exit_plan_mode request with the user's verdict. */
  respondExitPlan(requestId: number | string, type: "approved" | "abandoned" | "rejected"): void {
    this.proc?.stdin.write(JSON.stringify(makeExitPlanResponse(requestId, type)) + "\n");
  }

  dispose(): void {
    this.rl?.close();
    this.proc?.kill();
  }

  // ---------- internals ----------

  private request(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc?.stdin.write(JSON.stringify(makeRequest(id, method, params)) + "\n");
      const timeoutMs = method === "session/prompt" ? 1_800_000 : 120_000;
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`ACP request timed out: ${method}`));
        }
      }, timeoutMs);
    });
  }

  private respondOk(id: number | string, result: any = {}): void {
    this.proc?.stdin.write(JSON.stringify(makeAckResponse(id, result)) + "\n");
  }

  private respondError(id: number | string, code: number, message: string): void {
    this.proc?.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
    );
  }

  private onLine(line: string): void {
    const ev = parseAcpLine(line);
    if (!ev) return;
    if (ev.kind === "non-json") {
      this.opts.log(`[non-json] ${ev.line.slice(0, 200)}`);
      return;
    }
    if (ev.kind === "response") {
      const p = this.pending.get(ev.id as number);
      if (p) {
        this.pending.delete(ev.id as number);
        if (ev.error) p.reject(ev.error);
        else p.resolve(ev.result);
      }
      return;
    }
    if (ev.kind === "session-update") {
      this.handleSessionUpdate(ev.update);
      return;
    }
    void this.handleServerRequest({ id: ev.id, method: ev.method, params: ev.params });
  }

  private handleSessionUpdate(u: any): void {
    const r = routeSessionUpdate(u);
    if (!r) return;
    if (r.event === "modeChanged") {
      this.currentModeId = r.modeId;
      this.emit("modeChanged", r.modeId);
      return;
    }
    if (r.event === "commandsUpdate") {
      this.availableCommands = r.commands;
      this.emit("commandsUpdate", r.commands);
      return;
    }
    if (r.event === "userMessage") this.emit("userMessage", r.text);
    else if (r.event === "messageChunk") this.emit("messageChunk", r.text);
    else if (r.event === "thoughtChunk") this.emit("thoughtChunk", r.text);
    else if (r.event === "toolCall") this.emit("toolCall", r.payload);
    else if (r.event === "toolCallUpdate") this.emit("toolCallUpdate", r.payload);
    else if (r.event === "plan") this.emit("plan", r.payload);
    else this.emit("update", r.payload);
  }

  private async handleServerRequest(msg: any): Promise<void> {
    const { method, id, params } = msg;
    try {
      if (method === "fs/read_text_file") {
        if (!this.fsRead) throw new Error("fsRead handler not registered");
        const content = await this.fsRead(params.path);
        this.respondOk(id, { content });
        return;
      }
      if (method === "fs/write_text_file") {
        if (!this.fsWrite) throw new Error("fsWrite handler not registered");
        await this.fsWrite(params.path, params.content);
        this.respondOk(id, {});
        return;
      }
      if (method === "terminal/create") {
        if (!this.terminal) throw new Error("terminal handler not registered");
        this.respondOk(id, this.terminal.create(params));
        return;
      }
      if (method === "terminal/output") {
        if (!this.terminal) throw new Error("terminal handler not registered");
        this.respondOk(id, this.terminal.output(params.terminalId));
        return;
      }
      if (method === "terminal/wait_for_exit") {
        if (!this.terminal) throw new Error("terminal handler not registered");
        const r = await this.terminal.waitForExit(params.terminalId);
        this.respondOk(id, r);
        return;
      }
      if (method === "terminal/kill") {
        if (!this.terminal) throw new Error("terminal handler not registered");
        this.terminal.kill(params.terminalId);
        this.respondOk(id, {});
        return;
      }
      if (method === "terminal/release") {
        if (!this.terminal) throw new Error("terminal handler not registered");
        this.terminal.release(params.terminalId);
        this.respondOk(id, {});
        return;
      }
      if (method === "session/request_permission") {
        const req: PermissionRequest = {
          id,
          sessionId: params.sessionId,
          toolCall: params.toolCall,
          options: params.options ?? [],
        };
        this.emit("permissionRequest", req);
        return; // response is async, host calls respondPermission()
      }
      if (
        method === "x.ai/exit_plan_mode" ||
        method === "_x.ai/exit_plan_mode"
      ) {
        const req: ExitPlanRequest = {
          id,
          sessionId: params?.sessionId ?? this.sessionId ?? "",
          plan: params?.planContent ?? params?.plan ?? params?.input?.plan ?? "",
        };
        this.emit("exitPlanRequest", req);
        return;
      }
      if (
        method === "_x.ai/session_notification" ||
        method === "x.ai/session_notification"
      ) {
        this.emit("xaiNotification", params?.update);
        if (id != null) this.respondOk(id, {});
        return;
      }
      if (
        method === "_x.ai/session/prompt_complete" ||
        method === "x.ai/session/prompt_complete"
      ) {
        this.emit("xaiPromptComplete", params);
        if (id != null) this.respondOk(id, {});
        return;
      }

      // unknown server request: emit + ack so the agent doesn't hang
      this.emit("serverRequest", msg);
      if (id != null) this.respondOk(id, {});
    } catch (err) {
      this.opts.log(`server request handler error (${method}): ${(err as Error).message}`);
      if (id != null) {
        this.respondError(id, -32603, (err as Error).message || "Internal error");
      }
    }
  }
}
