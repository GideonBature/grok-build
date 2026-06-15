# Architecture

How the Grok Build VS Code extension is put together, and the one place it
deliberately stops being "thin." For day-to-day usage see the
[README](../README.md); for the test layers see [TESTS.md](../TESTS.md).

## The thin-client boundary

The extension is a UI shell over `grok agent stdio`. It speaks JSON-RPC over the
[Agent Client Protocol (ACP)](https://agentclientprotocol.com) on the CLI's
stdin/stdout and renders the results. Almost all real state lives in the CLI
process, not the extension.

| Lives in the CLI | Lives in the extension |
|---|---|
| Conversation history, memory, `~/.grok/` | Chips list (active editor + drag-added files) |
| MCP servers, subagents, plugins | YOLO flag (auto-approval) |
| Tool execution, model state | Plan-mode gate + per-plan verdict log |
| Plan text on disk (`~/.grok/sessions/<…>/plan.md`) | Webview UI state, popovers, slash filter, pending diff per `toolCallId` |

Kill the extension and the `grok` child dies with it; kill `grok` and the
extension surfaces an error and offers a fresh session. Restarting the session
(the **+** button) kills the CLI child and spawns a new one — memory the CLI
persisted under `~/.grok/` survives.

## Message flow

```
VS Code webview ──postMessage──► extension host ──JSON-RPC over stdin/stdout──► grok agent stdio
                                                  ◄── session/update (message chunks, thought chunks, tool calls, mode changes)
                                                  ◄── fs/read_text_file, fs/write_text_file
                                                  ◄── terminal/create, terminal/output, terminal/wait_for_exit, terminal/kill, terminal/release
                                                  ◄── session/request_permission
                                                  ◄── x.ai/exit_plan_mode, x.ai/ask_user_question
```

The extension implements **every mandatory server→client handler**
(`fs/read_text_file`, `fs/write_text_file`, `terminal/{create,output,wait_for_exit,kill,release}`)
— miss one and the agent crashes mid-session.

## How a session starts

When the panel opens (or you click **+** for a new session):

1. Locate the `grok` binary: `grok.cliPath` setting → `~/.grok/bin/grok` → `PATH`.
2. Spawn `grok agent stdio` as a background child — visible in `ps` / Task
   Manager, never opening a terminal window.
3. If `grok.defaultEffort` is set, pass `--reasoning-effort <value>` **before**
   the `stdio` subcommand (it's an agent-level flag).
4. `initialize` → `session/new` (or `session/load` to resume) → `session/set_model`.
5. Stream `session/update` notifications (messages, thoughts, tool calls,
   permission requests, mode changes) back into the chat.

The composer unlocks as soon as the session is live. The extension's hidden
"primer" message (below) is **not** sent at startup — it rides along with your
first real prompt, so there's no startup round-trip to wait on.

## Plan Mode — the one part that isn't thin

Everything else mirrors the CLI. Plan Mode is enforced **client-side**, because
the CLI's `x.ai/exit_plan_mode` is unreliable: it reports "approved" to *any*
client reply — result or error — regardless of what the user actually chose. So
the extension can't trust the wire verdict. Two mechanisms cover the gap:

- **The gate** ([src/plan-gate.ts](../src/plan-gate.ts)). While Plan Mode is
  active, the two mandatory server→client choke points are policed: a
  `fs/write_text_file` resolving inside the workspace is blocked, and a
  `terminal/create` that isn't on a read-only allowlist is blocked. grok's own
  `~/.grok/sessions/<…>/plan.md` write lands *outside* the workspace, so it's
  allowed (and snooped to recover the plan text, since `exit_plan_mode` arrives
  with `planContent: null`). Entering plan mode *any* way — including the agent
  self-initiating it — raises the gate; only an explicit user action lowers it.

- **The primer** ([src/grok-primer.ts](../src/grok-primer.ts)). A hidden system
  message tells grok in plain English to ignore the bogus tool verdict and read
  the real decision from the **next** user message instead, as a bracketed
  marker: `[Plan approved]` / `[Plan rejected]` / `[Plan cancelled]` (optionally
  followed by a free-form comment). Approve → drop the gate + send "implement it
  now"; Keep planning → the gate stays up. The primer is sent **lazily** —
  prepended as its own hidden turn right before the first real prompt, on both
  new **and** restored sessions. It is *re-sent* on the first send after a
  restore: a primer buried in replayed history isn't reliably honored (a
  `/compact` can drop it from effective context), so the extension re-asserts it
  rather than trusting the replay. When grok replays an earlier primer as a user
  message on restore, the pure `isPrimerText()` helper detects it so the bubble
  is hidden and not counted toward plan positions — but that detection does
  **not** mark the session primed.

The full pedagogical write-up lives in
[research/understanding-plan-mode.md](../research/understanding-plan-mode.md).

## Module map

| File | Role |
|---|---|
| [src/extension.ts](../src/extension.ts) | Entry point — registers commands, keybindings, output channel |
| [src/sidebar.ts](../src/sidebar.ts) | Webview provider, message routing, fs handlers, diff preview, logout, generated-media serving (`postGeneratedMedia` → `asWebviewUri`, base64 fallback) |
| [src/acp.ts](../src/acp.ts) | ACP client — spawns CLI, manages session lifecycle, emits events |
| [src/acp-dispatch.ts](../src/acp-dispatch.ts) | Pure protocol helpers — line parsing, update routing, response + generated-media extraction (`isMediaGenToolCall`/`extractGeneratedMediaPaths`) |
| [src/cli-locator.ts](../src/cli-locator.ts) | Locate the `grok` binary; cross-platform |
| [src/terminal-manager.ts](../src/terminal-manager.ts) | Headless shells for the agent's `terminal/*` calls |
| [src/plan-gate.ts](../src/plan-gate.ts) | Plan-mode policy (pure) — workspace-write containment + read-only command allowlist |
| [src/plan-restore.ts](../src/plan-restore.ts) | Plan persist + restore decision (pure) |
| [src/grok-primer.ts](../src/grok-primer.ts) | The hidden primer text + replay-detection helper (pure) |
| [src/chips.ts](../src/chips.ts) | File-chip CRUD (pure) |
| [src/prompt-builder.ts](../src/prompt-builder.ts) | Chip → prompt-string with `@path` refs and fenced blocks (pure) |
| [src/slash-filter.ts](../src/slash-filter.ts) | Slash-command autocomplete filter (pure) |
| [src/sessions.ts](../src/sessions.ts) | Disk-driven session listing/delete + name overrides (pure) |
| [src/file-ref.ts](../src/file-ref.ts) | Open-file ref parsing + large-file inline-read guard (pure) |
| [src/plan-review.ts](../src/plan-review.ts) | Plan-snapshot Markdown filename generation (pure) |
| [src/voice.ts](../src/voice.ts) | Voice-input pure helpers — STT request/response, ffmpeg args, device parsing, key resolution |
| [src/voice-recorder.ts](../src/voice-recorder.ts) | Batch capture (`ffmpeg` → WAV) + STT REST upload |
| [src/voice-streamer.ts](../src/voice-streamer.ts) | Live capture (ffmpeg PCM → WebSocket STT) |
| [media/chat.{js,css}](../media/) | Webview UI |
| [media/webview-helpers.js](../media/webview-helpers.js) | Pure webview helpers (file-ref detection, relative-time, mic-button state machine, trailing send-phrase highlight, math extraction `splitMath`/`stripUnsupportedTex`, and the deferred subagent classifier `isSubagentToolCall`/`subagentLabel`) — shared between webview and tests |

## Design choices worth knowing

- **Pure modules split for testability.** Everything tagged "(pure)" above has no
  `vscode` import, no process spawn, no network — it runs under Vitest in a plain
  Node process. That's *why* the bulk of protocol behavior can be regression-
  tested without launching VS Code or the `grok` binary. See
  [TESTS.md](../TESTS.md).
- **YOLO is client-side only.** A single `autoApprove` flag — toggling Agent ↔
  YOLO doesn't restart the CLI or even send a message. When the CLI raises a
  permission request, the extension just answers "allow always" automatically.
- **Cross-platform without per-OS branches.** `terminal-manager.ts` uses
  `spawn(cmd, { shell: true })` so Node picks `cmd.exe` or `/bin/sh`;
  `cli-locator.ts` prefers `HOME`/`USERPROFILE` env over `os.homedir()` so tests
  can override paths.
- **Streaming is rAF-coalesced.** Message and thought chunks buffer into a raw
  string and re-render at most once per animation frame — long responses stay
  smooth under fast chunk rates.
- **`available_commands_update` drives slash autocomplete.** No hardcoded command
  list; the CLI tells the extension what's available, so plugin/skill installs
  surface immediately.
- **Generated media is path-based, not an ACP image block.** `/imagine` and
  `/imagine-video` write a file into the session dir and report its *path* as
  JSON-in-text on the completed tool result. The host parses the path, classifies
  image-vs-video by extension, and serves it to the webview via `asWebviewUri`
  (streamed from disk) so even a multi-MB video renders. See
  [research/image-generation.md](../research/image-generation.md).
- **Math renders via vendored KaTeX, extracted before HTML-escaping.** Grok
  answers with TeX (inline `\(…\)`, display `\[…\]`, `\begin{pmatrix}` matrices).
  The pure `splitMath` pulls math spans out *before* the markdown pass escapes
  HTML — so backslashes and braces survive into placeholders, mirroring the
  code-block/table extraction — and `renderMath` in `chat.js` renders each span
  with [KaTeX](https://katex.org) (`media/katex/`, woff2-only fonts, no network,
  `throwOnError:false`). `stripUnsupportedTex` drops `\label{…}` first (KaTeX has
  no `\ref`/`\eqref`, so it would paint a red error; `\label` is invisible in real
  LaTeX anyway). Single `$…$` is deliberately not a delimiter — it false-matches
  prose currency.
