/**
 * Pure dispatch helpers for the ACP wire protocol.
 *
 * Kept separate from `AcpClient` (which spawns + I/Os) so we can unit-test
 * the line-parsing, response correlation, and update routing without faking
 * a child process.
 */

export type DispatchEvent =
  | { kind: "response"; id: number | string; result?: any; error?: any }
  | { kind: "session-update"; update: any }
  | { kind: "server-request"; id?: number | string; method: string; params: any }
  | { kind: "non-json"; line: string };

export function parseAcpLine(line: string): DispatchEvent | null {
  if (!line.trim()) return null;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return { kind: "non-json", line };
  }
  if (msg.id != null && msg.method == null) {
    return { kind: "response", id: msg.id, result: msg.result, error: msg.error };
  }
  if (msg.method === "session/update") {
    return { kind: "session-update", update: msg.params?.update };
  }
  if (msg.method) {
    return { kind: "server-request", id: msg.id, method: msg.method, params: msg.params };
  }
  return null;
}

export type UpdateRoute =
  | { event: "userMessage"; text: string }
  | { event: "messageChunk"; text: string }
  | { event: "thoughtChunk"; text: string }
  | { event: "toolCall"; payload: any }
  | { event: "toolCallUpdate"; payload: any }
  | { event: "plan"; payload: any }
  | { event: "modeChanged"; modeId: string }
  | { event: "commandsUpdate"; commands: any[] }
  | { event: "update"; payload: any };

export function routeSessionUpdate(u: any): UpdateRoute | null {
  if (!u) return null;
  switch (u.sessionUpdate) {
    // Only emitted while replaying history via session/load. Routing it lets the
    // host re-render past user turns and reset the active agent bubble so the
    // next replayed agent turn starts a fresh message.
    case "user_message_chunk":
      return { event: "userMessage", text: u.content?.text ?? "" };
    case "agent_message_chunk":
      return { event: "messageChunk", text: u.content?.text ?? "" };
    case "agent_thought_chunk":
      return { event: "thoughtChunk", text: u.content?.text ?? "" };
    case "tool_call":
      return { event: "toolCall", payload: u };
    case "tool_call_update":
      return { event: "toolCallUpdate", payload: u };
    case "plan":
      return { event: "plan", payload: u };
    case "current_mode_update":
      return { event: "modeChanged", modeId: u.currentModeId };
    case "available_commands_update":
      return { event: "commandsUpdate", commands: u.availableCommands ?? [] };
    default:
      return { event: "update", payload: u };
  }
}

export interface PromptResultMeta {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelId?: string;
}

export function extractPromptMeta(result: any): PromptResultMeta {
  const m = result?._meta ?? {};
  return {
    totalTokens: m.totalTokens,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cachedReadTokens: m.cachedReadTokens,
    reasoningTokens: m.reasoningTokens,
    modelId: m.modelId,
  };
}

export function makePermissionResponse(id: number | string, optionId: string) {
  return {
    jsonrpc: "2.0",
    id,
    result: { outcome: { outcome: "selected", optionId } },
  };
}

export function makeExitPlanResponse(
  id: number | string,
  verdict: "approved" | "abandoned" | "rejected",
) {
  if (verdict === "approved") {
    return { jsonrpc: "2.0", id, result: { outcome: "approved" } };
  }
  // Reject and Abandon must be sent as JSON-RPC errors — the CLI treats any
  // successful result as approval regardless of the outcome value.
  const message = verdict === "rejected" ? "User rejected the plan" : "User abandoned the plan";
  return { jsonrpc: "2.0", id, error: { code: -32000, message } };
}

export function makeAckResponse(id: number | string, result: any = {}) {
  return { jsonrpc: "2.0", id, result };
}

export function makeRequest(id: number, method: string, params: any) {
  return { jsonrpc: "2.0", id, method, params };
}
