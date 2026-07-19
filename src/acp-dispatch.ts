/**
 * Pure dispatch helpers for the ACP wire protocol.
 *
 * Kept separate from `AcpClient` (which spawns + I/Os) so we can unit-test
 * the line-parsing, response correlation, and update routing without faking
 * a child process.
 */

import { fileUriToPath } from "./file-ref";

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
 * A generated-media reference (image or video) normalized out of a tool result.
 * `media` discriminates `<img>` vs `<video>` rendering. `data` is base64 with an
 * inline `mimeType` (renders straight to a data: URI); `path` is a local file
 * (grok writes `/imagine` + `/imagine-video` output into the session dir — the
 * host reads + inlines it); `uri` is a remote/other URL opened as a link.
 */
export type MediaKind = "image" | "video";
export type MediaRef =
  | { media: MediaKind; kind: "data"; mimeType: string; data: string }
  | { media: MediaKind; kind: "path"; path: string; mimeType?: string }
  | { media: MediaKind; kind: "uri"; uri: string; mimeType?: string };

export type UpdateRoute =
  | { event: "messageChunk"; text: string }
  | { event: "userMessageChunk"; text: string }
  | { event: "thoughtChunk"; text: string }
  | { event: "mediaContent"; media: MediaRef }
  | { event: "toolCall"; payload: any }
  | { event: "toolCallUpdate"; payload: any }
  | { event: "plan"; payload: any }
  | { event: "modeChanged"; modeId: string }
  | { event: "commandsUpdate"; commands: any[] }
  | { event: "taskBackgrounded"; payload: any }
  | { event: "taskCompleted"; payload: any }
  | { event: "update"; payload: any };

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v)$/i;

// An absolute path (Windows drive / `\\?\` extended-length / UNC, or POSIX)
// ending in a known media extension, possibly embedded mid-sentence. Used to
// recover the file path from native-Windows grok's PROSE result ("Image
// generated and saved to <path>.") which — unlike the Linux/macOS JSON result —
// isn't machine-parseable. The trailing lookahead stops at the sentence's
// punctuation/whitespace so a trailing "." isn't swallowed into the path.
const MEDIA_PATH_IN_TEXT_RE =
  /(?:\\\\\?\\)?(?:[A-Za-z]:[\\/]|\/|\\\\)[^\r\n"'<>|?*]*?\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|mov|webm|m4v)(?=$|[\s.,;:)"'\]])/gi;

/** Drop a Windows `\\?\` extended-length prefix so the path is canonical for fs + Uri.file. */
function cleanMediaPath(p: string): string {
  return p.replace(/^\\\\\?\\/, "");
}

function isImageMime(m: unknown): boolean {
  return typeof m === "string" && m.toLowerCase().startsWith("image/");
}

/** Classify a file path/uri as image or video by extension, or null. */
function mediaKindForPath(p: string): MediaKind | null {
  if (IMAGE_EXT_RE.test(p)) return "image";
  if (VIDEO_EXT_RE.test(p)) return "video";
  return null;
}

/** Normalize a file://-or-path URI to a {kind:"path"|"uri"} MediaRef. */
function refFromUri(media: MediaKind, uri: string, mimeType?: string): MediaRef {
  if (uri.startsWith("file://")) {
    try {
      // fileUriToPath, not URL#pathname: the latter yields `/C:/x` for Windows
      // URIs and drops UNC hosts entirely.
      return { media, kind: "path", path: fileUriToPath(uri), mimeType };
    } catch {
      return { media, kind: "path", path: uri.replace(/^file:\/\//, ""), mimeType };
    }
  }
  if (/^[a-z]+:\/\//i.test(uri)) return { media, kind: "uri", uri, mimeType };
  // Bare filesystem path (absolute or relative).
  return { media, kind: "path", path: uri, mimeType };
}

/**
 * Pull an image out of a single ACP content block, or null if it isn't one.
 * grok's `/imagine` doesn't actually use these (it reports a path — see
 * `extractGeneratedMediaPaths`); this is kept as a forward-compatible fallback
 * for the standard ACP `image` block, embedded `resource`, and `resource_link`
 * shapes in case a future grok/tool emits them.
 */
export function extractImageContent(block: any): MediaRef | null {
  if (!block || typeof block !== "object") return null;
  if (block.type === "image" && typeof block.data === "string") {
    return { media: "image", kind: "data", mimeType: block.mimeType || "image/png", data: block.data };
  }
  if (block.type === "resource" && block.resource && typeof block.resource === "object") {
    const r = block.resource;
    if (typeof r.blob === "string" && (isImageMime(r.mimeType) || IMAGE_EXT_RE.test(String(r.uri ?? "")))) {
      return { media: "image", kind: "data", mimeType: isImageMime(r.mimeType) ? r.mimeType : "image/png", data: r.blob };
    }
    if (typeof r.uri === "string" && (isImageMime(r.mimeType) || IMAGE_EXT_RE.test(r.uri))) {
      return refFromUri("image", r.uri, isImageMime(r.mimeType) ? r.mimeType : undefined);
    }
  }
  if (block.type === "resource_link" && typeof block.uri === "string" &&
      (isImageMime(block.mimeType) || IMAGE_EXT_RE.test(block.uri))) {
    return refFromUri("image", block.uri, isImageMime(block.mimeType) ? block.mimeType : undefined);
  }
  return null;
}

/**
 * Collect ACP-standard image blocks out of a tool call's `content` array. Items
 * are either a bare content block or the ACP `{type:"content", content:<block>}`
 * wrapper. Forward-compat fallback — grok's real output path is
 * `extractGeneratedMediaPaths`.
 */
export function collectToolImages(payload: any): MediaRef[] {
  const arr = payload?.content;
  if (!Array.isArray(arr)) return [];
  const out: MediaRef[] = [];
  for (const item of arr) {
    const ref = extractImageContent(item?.type === "content" ? item.content : item);
    if (ref) out.push(ref);
  }
  return out;
}

/**
 * True for grok's media-generation tool calls (`/imagine`, `/imagine-video`).
 * The raw tool name and relabeled title differ by build/platform — confirmed
 * live against native-Windows grok 0.2.x AND the Linux 0.2.33 probes:
 *   - `/imagine`       → tool `image_gen`,  title `imagine: <prompt>`,        variant `ImageGen`
 *   - `/imagine` (edit of a reference image) → tool `image_edit`, title `imagine-edit: <prompt>`, variant `ImageEdit`
 *   - `/imagine-video` → tool `video_gen`,  title `imagine-video: <prompt>`,  variant `VideoGen`
 *     (older/Linux builds surfaced this as `image_to_video` / `image-to-video:`)
 *   - `reference_to_video` likewise.
 * See research/image-generation.md. The host tracks these ids so the *completed*
 * update (whose title is null) can still be recognized.
 */
export function isMediaGenToolCall(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  const title = String(payload.title ?? "");
  if (/^imagine(-video|-edit)?:/i.test(title)) return true;                   // relabeled titles
  if (/^(image_gen|image_edit|video_gen|image_to_video|reference_to_video)\b/i.test(title)) return true; // raw tool names
  if (/^(image-to-video:|reference-to-video:)/i.test(title)) return true;     // legacy relabels
  const ri = payload.rawInput;
  return !!(ri && typeof ri === "object" && typeof ri.variant === "string" &&
    /imagegen|imageedit|videogen|imagetovideo|referencetovideo/i.test(ri.variant));
}

/**
 * Pull generated-media file paths out of a completed image_gen/image_to_video
 * tool result. grok does NOT use an ACP image/resource block — it writes the
 * file to the session dir and reports the path inside a `text` content block, in
 * one of two shapes depending on the build:
 *
 *  - **JSON** (Linux/macOS, older builds): `{"path":"…/images/1.jpg",…}` for
 *    `/imagine`, `{"path":"…/videos/1.mp4",…}` for `/imagine-video`.
 *  - **Prose** (native-Windows grok 0.2.x): a human sentence with the path
 *    embedded, e.g. `Image generated and saved to \\?\C:\…\images\1.jpg.` —
 *    `JSON.parse` can't see this, so we scan the text for an absolute media path.
 *
 * We hand back a path MediaRef (the host inlines it), classifying image vs video
 * by extension. Only paths with a known image/video extension are accepted, so a
 * non-media result can't masquerade as one.
 */
export function extractGeneratedMediaPaths(payload: any): MediaRef[] {
  const arr = payload?.content;
  if (!Array.isArray(arr)) return [];
  const out: MediaRef[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const p = cleanMediaPath(raw);
    const media = mediaKindForPath(p);
    if (media && !seen.has(p)) { seen.add(p); out.push({ media, kind: "path", path: p }); }
  };
  for (const item of arr) {
    const block = item?.type === "content" ? item.content : item;
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    let parsed: any;
    try { parsed = JSON.parse(block.text); } catch { /* prose, not JSON */ }
    if (parsed && typeof parsed.path === "string") {
      add(parsed.path);                                   // machine-readable JSON form
    } else if (parsed === undefined) {
      for (const m of block.text.matchAll(MEDIA_PATH_IN_TEXT_RE)) add(m[0]); // prose form
    }
  }
  return out;
}

export function routeSessionUpdate(u: any): UpdateRoute | null {
  if (!u) return null;
  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const c = u.content;
      if (c && c.type && c.type !== "text") {
        const media = extractImageContent(c);
        if (media) return { event: "mediaContent", media };
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
    case "task_backgrounded":
      return { event: "taskBackgrounded", payload: u };
    case "task_completed":
      return { event: "taskCompleted", payload: u };
    default:
      return { event: "update", payload: u };
  }
}

/**
 * A prompt's BILLING account — `_meta.usage`, aggregated over the whole prompt
 * (every model call in the turn), not the last call. Distinct from the flat
 * siblings on `PromptResultMeta`, which are the LAST model call only: one probed
 * turn reported flat `outputTokens: 42` against `usage.outputTokens: 158` across
 * `modelCalls: 2`. Also distinct from `totalTokens` (CONTEXT size) — same turn,
 * 16371 context vs 32488 billed. The two never decompose into each other, so the
 * donut arc stays context-only and this drives the popover's usage rows (#53).
 *
 * There is **no cache-CREATION field** anywhere in the CLI — only `cachedRead`.
 * Wire capture: research/grok-build-oss-findings.md § 3b.
 */
export interface PromptUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelCalls?: number;
  apiDurationMs?: number;
  numTurns?: number;
}

export interface PromptResultMeta {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelId?: string;
  usage?: PromptUsage;
}

/** Pull the nested `_meta.usage` (see `PromptUsage`). Returns undefined when the
 *  CLI didn't send one — an older build, or a turn that ran no inference — so a
 *  caller can tell "no data" from "zero", and never invents fields. */
export function extractPromptUsage(meta: any): PromptUsage | undefined {
  const u = meta?.usage;
  if (!u || typeof u !== "object") return undefined;
  const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const out: PromptUsage = {
    inputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    totalTokens: num(u.totalTokens),
    cachedReadTokens: num(u.cachedReadTokens),
    reasoningTokens: num(u.reasoningTokens),
    modelCalls: num(u.modelCalls),
    apiDurationMs: num(u.apiDurationMs),
    numTurns: num(u.numTurns),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
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
    usage: extractPromptUsage(m),
  };
}

/**
 * Sum two prompt usages into the session-cumulative total (#53). grok reports
 * usage per prompt and never a session total, so this number is OURS — the CLI's
 * `signals.json` carries only context size, which is why a cold restore has no
 * breakdown to seed from and we persist our own running total instead.
 *
 * `undefined + undefined` stays undefined (never invents a 0 for a field the CLI
 * doesn't report), but a present field added to an absent one keeps the present
 * value. `apiDurationMs` and `numTurns` sum too — both are per-prompt totals.
 */
export function addUsage(a: PromptUsage | undefined, b: PromptUsage | undefined): PromptUsage | undefined {
  if (!a) return b ? { ...b } : undefined;
  if (!b) return { ...a };
  const keys: (keyof PromptUsage)[] = [
    "inputTokens", "outputTokens", "totalTokens", "cachedReadTokens",
    "reasoningTokens", "modelCalls", "apiDurationMs", "numTurns",
  ];
  const out: PromptUsage = {};
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (x === undefined && y === undefined) continue;
    out[k] = (x ?? 0) + (y ?? 0);
  }
  return out;
}

/**
 * Whether a turn's usage is a real measurement worth counting (#53).
 *
 * A `/compact` (or `/session-info`) turn runs no inference of its own, and grok
 * captures `_meta` BEFORE the slash-command match — so it replays the PREVIOUS
 * turn's input/output/cache numbers verbatim. `gateZeroTokenMeta` already strips
 * the bogus `totalTokens: 0` those turns carry, and that same 0 is the tell here:
 * counting the stale siblings would double-bill the prior turn into the session
 * total on every compact.
 */
export function usageIsRealMeasurement(meta: PromptResultMeta): boolean {
  return meta.totalTokens !== 0 && !!meta.usage;
}

/**
 * A JSON-RPC `-32601 method not found` — the CLI doesn't dispatch this method at
 * all. The `_x.ai/*` RPCs we use for Steer (#52) and Fork (#48) ship unadvertised,
 * so an older build answers -32601 and the feature must hide itself rather than
 * error at the user. `acp.ts` rejects with the RAW JSON-RPC error object (not an
 * Error), so the code survives; the message check is a belt-and-braces fallback.
 *
 * Note -32602 (`invalid params`) deliberately does NOT count: that means the
 * method EXISTS and we sent the wrong shape — a bug to fix, not a capability gap.
 */
export function isMethodNotFoundError(e: any): boolean {
  if (!e) return false;
  if (e.code === -32601) return true;
  return /method not found|method_not_found/i.test(String(e.message ?? e));
}

/**
 * Strip a turn's `totalTokens: 0` report — it is never a real measurement
 * (#39). grok reports 0 both for `/session-info` (context untouched — the 0
 * zeroed the donut) and for `/compact` (context SHRUNK, not emptied — 0 is
 * wrong there too; the "Compacted." bubble is the it-worked signal, and the
 * next turn reports the true post-compact size). `undefined` means "no
 * update": the donut keeps its last real value. Non-zero counts pass through.
 */
export function gateZeroTokenMeta(meta: PromptResultMeta): PromptResultMeta {
  if (meta.totalTokens !== 0) return meta;
  return { ...meta, totalTokens: undefined };
}

/**
 * The fresh post-compaction context size from an `_x.ai/session_notification`
 * update, or `null` when the update isn't a compaction-completed event or
 * carries no usable count. grok fires `auto_compact_completed` on BOTH a manual
 * `/compact` and the CLI's automatic compaction; `tokens_after` is the
 * post-compact used-token count. This live notification is the only instant
 * source of that number — the compact turn's own meta reports 0 (see
 * `gateZeroTokenMeta`) and signals.json keeps the pre-compact count until the
 * next inference turn's flush (research/oss-surfaces-probe.cjs, grok 0.2.101).
 * The donut tracks the context window itself (from `modelChanged`), so only
 * `used` is returned; a zero/negative/non-numeric `tokens_after` yields `null`
 * (the donut keeps its last real value).
 */
export function contextUsedFromCompactNotification(update: unknown): number | null {
  const u = update as { sessionUpdate?: unknown; tokens_after?: unknown } | null | undefined;
  if (!u || u.sessionUpdate !== "auto_compact_completed") return null;
  const used = u.tokens_after;
  return typeof used === "number" && Number.isFinite(used) && used > 0 ? used : null;
}

/**
 * True when an `_x.ai/session_notification` update is a subagent lifecycle event
 * the webview's cards ACT ON — `subagent_spawned` (tags the card with the child
 * id) or `subagent_finished` (fills `duration_ms` + the child's output, which the
 * Composer agent's tool-channel completion lacks). These ride the LIVE
 * notification rail; the webview's `subagentUpdate` handler was historically fed
 * by the persist/replay `_x.ai/session/update` rail (which never carried them
 * live — grok 0.2.93 only logged them), so re-routing the live events there
 * activates the existing card logic. **`subagent_progress` is deliberately
 * EXCLUDED** — the webview has no behavior for it, and upstream can emit it every
 * ~2s, so routing it would only pile up no-op entries in the session replay
 * buffer.
 */
export function isSubagentLifecycleUpdate(update: unknown): boolean {
  const k = (update as { sessionUpdate?: unknown } | null | undefined)?.sessionUpdate;
  return k === "subagent_spawned" || k === "subagent_finished";
}

/**
 * A user-facing note for the CLI's AUTOMATIC (context-full) compaction, or null
 * when the update isn't an `auto_compact_started`. This fires ONLY on the
 * auto-compaction path (`compaction.rs` — `run_compact` for a manual `/compact`
 * emits only `auto_compact_completed`, never `_started`), so it cleanly
 * distinguishes the two: a manual `/compact` already paints "Compacted." from
 * the slash-command path, while automatic compaction was previously silent — the
 * turn's context would just shrink with no explanation. Auto-compaction runs
 * before a sampling attempt — usually at a turn's start, but possibly between
 * tool-loop passes — so the host renders it as a dedicated notice (not a message
 * chunk) that finalizes any active bubble first. Plain text (styled as a notice);
 * percentage included when present.
 */
export function autoCompactStartedNote(update: unknown): string | null {
  const u = update as { sessionUpdate?: unknown; percentage?: unknown } | null | undefined;
  if (!u || u.sessionUpdate !== "auto_compact_started") return null;
  const pct = typeof u.percentage === "number" && Number.isFinite(u.percentage) ? u.percentage : null;
  return pct != null
    ? `Auto-compacting context (${pct}% full)…`
    : `Auto-compacting context…`;
}

/**
 * Parse the context line out of `/session-info`'s reply text — grok 0.2.x
 * renders `**Context:** 16017 / 512000 tokens (3%)`. The post-/compact donut
 * refresh prefers the live `auto_compact_completed` notification
 * (`contextUsedFromCompactNotification`); this parser drives the hidden
 * /session-info FALLBACK for CLIs that predate that rail (e.g. the Windows
 * downgrade target). Tolerant of bold markers, casing, and thousands
 * separators; null when the line is missing or the numbers don't parse
 * (callers fall back silently — the post-compact re-prime's signals.json read
 * is the second backup).
 */
export function parseSessionInfoContext(text: string): { used: number; window: number } | null {
  const m = /context:\*{0,2}\s*([\d][\d,]*)\s*\/\s*([\d][\d,]*)\s*tokens/i.exec(text ?? "");
  if (!m) return null;
  const num = (s: string) => Number(s.replace(/,/g, ""));
  const used = num(m[1]);
  const window = num(m[2]);
  if (!Number.isFinite(used) || used <= 0 || !Number.isFinite(window) || window <= 0) return null;
  return { used, window };
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
  // Reject and Abandon are sent as JSON-RPC errors. NOTE: the old rationale here
  // ("the CLI treats any successful result as approval") is obsolete — grok
  // 0.2.101 DOES honor a success `{outcome:"cancelled"|"abandoned"}` (mode stays
  // plan on cancel; probe: research/oss-surfaces-probe.cjs --scenario=planoutcome).
  // We keep the error form for now on purpose: our verdict UX is driven by the
  // hidden primer + `[Plan approved/rejected/cancelled]` follow-up markers and the
  // client-side gate, and switching to the outcome protocol touches that whole
  // flow — deferred until plan-mode enforcement stabilizes CLI-side (§2.1). The
  // error path keeps the session in plan mode, which is what we need meanwhile.
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

/** Classify a permission answer as allowed vs rejected from the chosen option's
 *  kind (`allow_once`/`allow_always` → allowed, `reject_*`/`deny_*` → rejected).
 *  Used to persist the answer so a resumed session can replay the collapsed card. */
export function permissionOutcomeFor(
  options: { optionId: string; kind: string }[] | undefined,
  optionId: string,
): "allowed" | "rejected" {
  const opt = (options ?? []).find((o) => o.optionId === optionId);
  return opt && /reject|deny/i.test(opt.kind) ? "rejected" : "allowed";
}

/** Compress a (possibly huge) background shell command into a one-line label for
 *  a notification — collapse whitespace and clip to a readable length. */
export function summarizeBackgroundCommand(cmd: string, max = 80): string {
  const flat = (cmd || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1).trimEnd() + "…";
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

/**
 * True when a turn error looks like an expired/invalid credential rather than a
 * real fault. A long-lived pooled `grok agent stdio` process can wedge on an
 * expired OAuth access token when its 401-refresh loses a rotation race with the
 * sibling processes (or `grok login`) that share `~/.grok/auth.json`; a fresh
 * process re-reads the current disk token, so the host transparently restarts
 * the wedged process instead of making the user sign out and back in. Kept
 * deliberately broad — this is ONLY the gate for that one guarded reload+retry,
 * never for what the retry's failure ultimately shows (that split is
 * `isCredentialError` vs `entitlementNoticeText`, #58): a false match costs one
 * reload, then the real error surfaces on the retry.
 * A rate/usage-limit message yields to `isRateLimitErrorText` first (#57): a
 * weekly-limit error carries the same billing-flavored wording, but routing it
 * here ends on the login screen, which can't fix a limit.
 */
export function isAuthErrorText(msg: unknown): boolean {
  const s = String(msg ?? "");
  if (isRateLimitErrorText(s)) return false;
  if (/\b(401|403)\b|unauthor|forbidden|\bcredential|\bapi[_\s-]?key\b|not (?:signed|logged) ?in|(?:sign|log) ?in again|re-?login|authenticat\w*\s*(?:failed|required|error|expired)|token (?:has )?expired|expired\s+token|session (?:has )?expired/i.test(s)) return true;
  // Billing/entitlement wording joins the retry gate: it CAN be a wedged token,
  // and if it isn't, the retry's failure shows the entitlement notice instead.
  return /\bpay(?:ment)?\b|\bbilling\b|\bsubscription\b|\bentitl\w+|\bunpaid\b|\bcredits?\s+(?:exhaust|remain|requir)/i.test(s);
}

/**
 * ACP error code for a genuine credential failure (`auth_required`). The CLI
 * funnels EVERY prompt-turn auth failure (HTTP 401 / its internal Auth error)
 * through this code with one of two fixed "Session expired… / Authentication
 * failed… run `grok login`" strings (OSS `session_setup.rs` `to_acp_error` +
 * `auth_method.rs`), which makes the code the authoritative credential signal.
 */
export const AUTH_REQUIRED_ERROR_CODE = -32000;

/**
 * True when a turn failure is a genuine CREDENTIAL problem — the thing a
 * re-login can actually fix — as opposed to the billing/entitlement family that
 * merely *sounds* like one (#58). Primary signal: the structured
 * `AUTH_REQUIRED_ERROR_CODE`; the text branch is the fallback for surfaces that
 * flatten the error. The text branch deliberately EXCLUDES `403`/`forbidden`
 * (the CLI maps 403 to a plain internal error precisely because the credential
 * was accepted — entitlement/content-policy, not auth), bare "api key" (the
 * CLI's 403-subscription message can embed "You have an API key set
 * (XAI_API_KEY)… run `grok logout`" — advice the login overlay would invert),
 * and all billing wording. Only this classifier may route to the sign-in
 * overlay; everything else shows in chat.
 */
export function isCredentialError(err: unknown): boolean {
  const e = err as any;
  if (e?.code === AUTH_REQUIRED_ERROR_CODE) return true;
  const s = errorDetail(e);
  if (isRateLimitErrorText(s)) return false;
  return /\b401\b|unauthor|\bcredential|not (?:signed|logged) ?in|(?:sign|log) ?in again|re-?login|authenticat\w*\s*(?:failed|required|error|expired)|token (?:has )?expired|expired\s+token|session (?:has )?expired|invalid\s+api[_\s-]?key|api[_\s-]?key\s+(?:is\s+)?(?:invalid|expired|revoked|missing)/i.test(s);
}

/**
 * ACP error code the CLI uses for HTTP 429 rate-limit failures. Its documented
 * contract (OSS `sampling/error.rs`): clients suppress the error detail and
 * show a friendly limit message instead of a generic failure.
 */
export const RATE_LIMITED_ERROR_CODE = -32003;

/** The CLI's own OAuth-plan rate-limit copy, reused verbatim when a -32003
 *  arrives with no usable detail. */
const GENERIC_RATE_LIMIT_TEXT =
  "You\u{2019}ve hit the rate limit for your plan. Upgrade your account or try again later.";

/** The human detail a grok ACP error carries: `data` is either the bare detail
 *  string or a `{message}` object (the CLI's attach_prompt_usage wrapper).
 *  Exported so host error surfaces read the same field order — the ad-hoc
 *  `e?.data?.message ?? e?.message` they used dropped the bare-string `data`
 *  shape, classifying real detail as the generic "Internal error" envelope. */
export function errorDetail(err: any): string {
  const d = err?.data;
  if (typeof d === "string") return d;
  if (typeof d?.message === "string") return d.message;
  return typeof err?.message === "string" ? err.message : String(err ?? "");
}

/**
 * True when a message reads as a rate/usage-limit rather than a real fault.
 * Phrasings mirror the CLI's own copy (OSS `sampling/error.rs` + pager
 * `billing.rs`): "rate limit" (OAuth/API-key/plain "Rate limited"), the
 * weekly/usage-limit and spending-cap upsells, the well-known
 * `subscription:free-usage-exhausted` code, and raw HTTP-429 phrasing.
 * Deliberately NOT a bare "limit reached/exceeded" — a context-window overflow
 * must not read as a usage limit.
 */
export function isRateLimitErrorText(msg: unknown): boolean {
  const s = String(msg ?? "");
  return /rate.?limit|too many requests|\b429\b|(?:usage|weekly|monthly|daily)\s+limit|spending\s+(?:cap|limit)|free.usage.exhausted/i.test(s);
}

/**
 * True when a turn failure is a rate/usage-limit: the structured -32003 code
 * wins regardless of wording; the text classifier is the fallback for
 * surfaces that flatten the error to a string (retry-exhaustion notes).
 */
export function isRateLimitError(err: unknown): boolean {
  const e = err as any;
  if (e?.code === RATE_LIMITED_ERROR_CODE) return true;
  return isRateLimitErrorText(errorDetail(e));
}

/**
 * User-facing notice for a rate-limited turn (#57). Leads with the
 * not-a-sign-in clarification (the reported confusion was exactly "limit
 * reached → login screen"), then the wire detail when it says anything (the
 * bare "Rate limited" doesn't), else the CLI's own generic copy. No reset date
 * is shown because none exists on the wire — the quota window is
 * backend-config-driven and the CLI deliberately promises no duration.
 */
export function rateLimitNoticeText(err: unknown): string {
  const raw = errorDetail(err)
    .replace(/^subscription:free-usage-exhausted:?\s*/i, "")
    .trim();
  const body = raw && !/^rate ?limited\.?$/i.test(raw) ? raw : GENERIC_RATE_LIMIT_TEXT;
  return `Usage limit reached \u{2014} not a sign-in issue. ${body}`;
}

/**
 * User-facing notice for a billing/entitlement-flavored turn failure that is
 * NOT a credential problem (#58). Leads with the not-a-sign-in clarification —
 * the reported loop was exactly "no entitlement → sign-in screen → sign-in
 * can't fix it". The "no Grok Build access" diagnosis is added only when the
 * wording actually says subscription/entitlement (a generic billing message
 * must not be over-diagnosed). The CLI's own text carries the actionable
 * advice — including its "API key shadowed by cached OAuth session → run
 * `grok logout`" hint — so it's shown verbatim.
 */
export function entitlementNoticeText(err: unknown): string {
  const detail = errorDetail(err).trim();
  const noAccess = /\bsubscription\b|\bentitl/i.test(detail)
    ? "This account doesn't have Grok Build access (it needs SuperGrok or X Premium+ — or sign out to use an XAI_API_KEY instead). "
    : "";
  return `Not a sign-in issue \u{2014} signing in again won't fix this. ${noAccess}${detail}`;
}

/**
 * The text a failed prompt turn surfaces in chat: the friendly limit notice
 * for a rate-limited error, the entitlement notice for billing-flavored
 * wording that is not a credential failure (#58), else the error's own
 * message.
 */
export function promptErrorText(err: unknown): string {
  if (isRateLimitError(err)) return rateLimitNoticeText(err);
  const detail = errorDetail(err);
  if (!isCredentialError(err) && isAuthErrorText(detail)) return entitlementNoticeText(err);
  return detail;
}

/**
 * Map a model id reported by grok onto the id present in `availableModels`.
 * grok's `session/set_model` (and, on some builds, session load) echoes a
 * **versioned** id — e.g. it resolves a request for `grok-build` to
 * `grok-build-0.1` — but the model *list* still uses the base `grok-build`.
 * Left unreconciled, `currentModelId` matches nothing, so the toolbar shows the
 * raw id instead of "Grok Build" and the context-window lookup falls back to the
 * default (200K instead of grok-build's 512K). Exact match wins; otherwise a
 * base-id prefix match (`grok-build-0.1` → `grok-build`); otherwise the input is
 * returned unchanged. The prefix match prefers the **longest** (most specific)
 * candidate, so a future `grok-build-mini-0.1` resolves to `grok-build-mini`, not
 * `grok-build`. Pure.
 */
export function resolveModelId(
  id: string | undefined,
  availableModels: { modelId: string }[] | undefined,
): string | undefined {
  if (!id || !availableModels?.length) return id;
  if (availableModels.some((m) => m.modelId === id)) return id;
  let best: string | undefined;
  for (const m of availableModels) {
    if (id.startsWith(m.modelId) || m.modelId.startsWith(id)) {
      if (!best || m.modelId.length > best.length) best = m.modelId;
    }
  }
  return best ?? id;
}
