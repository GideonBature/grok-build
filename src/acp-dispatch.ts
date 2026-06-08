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

/**
 * A generated-image reference normalized out of an ACP content block. `data` is
 * base64 with an inline `mimeType` (renders straight to a data: URI); `path` is
 * a local file (grok writes `/imagine` output into the session dir — the host
 * reads + inlines it); `uri` is a remote/other URL the webview opens as a link.
 */
export type ImageRef =
  | { kind: "data"; mimeType: string; data: string }
  | { kind: "path"; path: string; mimeType?: string }
  | { kind: "uri"; uri: string; mimeType?: string };

export type UpdateRoute =
  | { event: "messageChunk"; text: string }
  | { event: "userMessageChunk"; text: string }
  | { event: "thoughtChunk"; text: string }
  | { event: "imageContent"; image: ImageRef }
  | { event: "toolCall"; payload: any }
  | { event: "toolCallUpdate"; payload: any }
  | { event: "plan"; payload: any }
  | { event: "modeChanged"; modeId: string }
  | { event: "commandsUpdate"; commands: any[] }
  | { event: "update"; payload: any };

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function isImageMime(m: unknown): boolean {
  return typeof m === "string" && m.toLowerCase().startsWith("image/");
}

/** Normalize a file://-or-path URI to a {kind:"path"|"uri"} ImageRef. */
function refFromUri(uri: string, mimeType?: string): ImageRef {
  if (uri.startsWith("file://")) {
    try {
      return { kind: "path", path: decodeURIComponent(new URL(uri).pathname), mimeType };
    } catch {
      return { kind: "path", path: uri.replace(/^file:\/\//, ""), mimeType };
    }
  }
  if (/^[a-z]+:\/\//i.test(uri)) return { kind: "uri", uri, mimeType };
  // Bare filesystem path (absolute or relative).
  return { kind: "path", path: uri, mimeType };
}

/**
 * Pull an image out of a single ACP content block, or null if it isn't one.
 * Covers the three shapes grok could use for `/imagine` output: an inline
 * `image` block (base64), an embedded `resource` (blob or uri), and a
 * `resource_link` to the written-out file. Verified shapes live in
 * research/image-generation.md — the routing is deliberately permissive so a
 * subscription smoke test only has to confirm which one fires.
 */
export function extractImageContent(block: any): ImageRef | null {
  if (!block || typeof block !== "object") return null;
  if (block.type === "image" && typeof block.data === "string") {
    return { kind: "data", mimeType: block.mimeType || "image/png", data: block.data };
  }
  if (block.type === "resource" && block.resource && typeof block.resource === "object") {
    const r = block.resource;
    if (typeof r.blob === "string" && (isImageMime(r.mimeType) || IMAGE_EXT_RE.test(String(r.uri ?? "")))) {
      return { kind: "data", mimeType: isImageMime(r.mimeType) ? r.mimeType : "image/png", data: r.blob };
    }
    if (typeof r.uri === "string" && (isImageMime(r.mimeType) || IMAGE_EXT_RE.test(r.uri))) {
      return refFromUri(r.uri, isImageMime(r.mimeType) ? r.mimeType : undefined);
    }
  }
  if (block.type === "resource_link" && typeof block.uri === "string" &&
      (isImageMime(block.mimeType) || IMAGE_EXT_RE.test(block.uri))) {
    return refFromUri(block.uri, isImageMime(block.mimeType) ? block.mimeType : undefined);
  }
  return null;
}

/**
 * Collect every image out of a tool call's `content` array. Items are either a
 * bare content block or the ACP `{type:"content", content:<block>}` wrapper —
 * grok attaches generated images to the tool result this way.
 */
export function collectToolImages(payload: any): ImageRef[] {
  const arr = payload?.content;
  if (!Array.isArray(arr)) return [];
  const out: ImageRef[] = [];
  for (const item of arr) {
    const ref = extractImageContent(item?.type === "content" ? item.content : item);
    if (ref) out.push(ref);
  }
  return out;
}

export function routeSessionUpdate(u: any): UpdateRoute | null {
  if (!u) return null;
  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const c = u.content;
      if (c && c.type && c.type !== "text") {
        const img = extractImageContent(c);
        if (img) return { event: "imageContent", image: img };
      }
      return { event: "messageChunk", text: c?.text ?? "" };
    }
    case "user_message_chunk":
      return { event: "userMessageChunk", text: u.content?.text ?? "" };
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

/**
 * Response to grok's `x.ai/ask_user_question` request (Rust struct
 * `AskUserQuestionExtResponse` — an internally-tagged enum on field `outcome`,
 * variants `accepted` | `chat_about_this` | `skip_interview` | `cancelled`).
 * The `accepted` variant carries `answers` (question text → chosen option label,
 * multi-select labels joined) and `annotations` (question text → { notes,
 * preview }). The old catch-all replied with a bare `{}`, which grok's
 * deserializer rejects with "missing field `outcome` at line 1 column 2" so the
 * tool reports failure (issue #12).
 */
export function makeQuestionResponse(
  id: number | string,
  answers: Record<string, string>,
  annotations: Record<string, { notes?: string; preview?: string }> = {},
) {
  return { jsonrpc: "2.0", id, result: { outcome: "accepted", answers, annotations } };
}

/** User dismissed the question without answering → grok's `cancelled` outcome. */
export function makeQuestionCancelledResponse(id: number | string) {
  return { jsonrpc: "2.0", id, result: { outcome: "cancelled" } };
}

export function makeAckResponse(id: number | string, result: any = {}) {
  return { jsonrpc: "2.0", id, result };
}

export function makeRequest(id: number, method: string, params: any) {
  return { jsonrpc: "2.0", id, method, params };
}

/**
 * True when `session/set_model` was rejected because the target model belongs
 * to a different agent than the one this session is bound to. The CLI binds the
 * agent at spawn time and locks it after the first turn (including our hidden
 * primer), so the model can only be applied on a fresh session — `newSession`
 * sets it before the primer runs, while the agent is still rebindable. The host
 * uses this to fall back to a restart instead of surfacing the raw error.
 */
export function isIncompatibleAgentError(err: any): boolean {
  if (err?.data?.code === "MODEL_SWITCH_INCOMPATIBLE_AGENT") return true;
  // Fallback if a future CLI keeps the message but drops the structured code.
  return /requires agent .+ but the active agent/i.test(err?.message ?? "");
}
