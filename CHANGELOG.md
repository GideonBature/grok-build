# Changelog

## 1.7.4 — 2026-07-19

Eleven long-standing bugs found by running this extension through a multi-model bug-finding benchmark, then re-verified and fixed against the live tree — most of them Windows path handling. 42 new regression tests.

### Fixed

- **Windows path family:** drag-and-drop into the chat works on Windows (the dropped `file:///C:/…` URI was mis-stripped to `/C:/…` and silently failed); absolute Windows paths like `C:\work\file.ts` (with or without `:42`) now linkify in chat — and clicking any `path:line` ref now actually opens at that line; agent-sent `file://` media refs convert via a proper URI→path helper (drive letters + UNC hosts); session history now reads the same `~/.grok` the CLI writes (`GROK_HOME` override honored, USERPROFILE-first on Windows — a set `HOME`, e.g. git-bash, used to split them). ([media/chat.js](media/chat.js), [media/webview-helpers.js](media/webview-helpers.js), [src/file-ref.ts](src/file-ref.ts), [src/acp-dispatch.ts](src/acp-dispatch.ts), [src/sessions.ts](src/sessions.ts), [src/sidebar.ts](src/sidebar.ts))
- **Crash recovery:** after the CLI process dies, the next send respawns and resumes the same session instead of writing into the dead client (which errored, or hung at "Grokking…", until you manually started a new session); a `taskkill` that runs-but-fails (Access Denied) no longer leaves the agent's `wait_for_exit` pending forever — a direct signal fallback fires; an error or exit during the startup lock can no longer strand the composer's locked state. ([src/sidebar.ts](src/sidebar.ts), [src/terminal-manager.ts](src/terminal-manager.ts), [media/chat.js](media/chat.js))
- **Smaller correctness fixes:** full-line selections no longer attach one phantom line past the selection (VS Code selection ends are exclusive at column 0); Command Palette *New Session* clears the previous transcript like the toolbar button; the per-session webview reset clears the question/restored-card maps (a new session's tool updates could mutate the previous session's cards); generated media in a `..`-prefixed dir under grok home serves from disk instead of falling back to base64; the STT keyterm list enforces its documented 100-term cap. ([src/chips.ts](src/chips.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js), [src/sessions.ts](src/sessions.ts), [src/voice.ts](src/voice.ts))

## 1.7.3 — 2026-07-18

### Fixed

- **A missing Grok Build subscription/entitlement no longer traps you on the sign-in screen.** The backend's 403 *"requires a Grok subscription"* (which sign-in can't fix — the CLI even ignores your `XAI_API_KEY` while a cached OAuth session exists) now shows a clear in-chat "Not a sign-in issue" notice carrying the CLI's own advice, instead of the auth overlay. Only a genuine credential failure (ACP `-32000`, or unambiguous credential wording) opens the sign-in screen. ([#58](https://github.com/phuryn/grok-build-vscode/issues/58); [src/acp-dispatch.ts](src/acp-dispatch.ts), [src/sidebar.ts](src/sidebar.ts))
- **The "Grokking" indicator no longer sticks forever when auth recovery ends on the sign-in screen** — the failed turn now closes properly (error state, busy cleared), and a stale sign-in overlay can't resurrect when switching back to the session. ([media/chat.js](media/chat.js), [src/sidebar.ts](src/sidebar.ts))
- The sign-in screen now warns that a cached sign-in shadows `XAI_API_KEY` (`grok logout` to use the key). ([media/chat.js](media/chat.js))

## 1.7.2 — 2026-07-18

### Fixed

- **Hitting your usage/weekly limit no longer looks like a sign-in problem.** A rate-limited turn (ACP error `-32003`, or the CLI's limit phrasings) now shows a clear "Usage limit reached — not a sign-in issue" notice carrying the CLI's own message. Before, the limit's billing-flavored wording tripped the expired-token recovery, whose retry ended on the login screen. No reset date is shown because the CLI/backend never provides one. ([#57](https://github.com/phuryn/grok-build-vscode/issues/57); [src/acp-dispatch.ts](src/acp-dispatch.ts), [src/sidebar.ts](src/sidebar.ts))

## 1.7.1 — 2026-07-18

### Changed

- **README reworked as a landing page.** Features now sit directly under *Why use this?*, descriptions are trimmed to the point (deep technical detail stays in the dedicated docs), and the duplicate *Cost control* / *Context & cost* sections are merged into one. Fresh screenshots for **Context & cost**, **Fork conversation**, and **Queue or steer**, plus a new **Subagents** feature entry; the *Agent Dashboard* section folded into *Session history*, which now hosts the status-dot legend.
- **Smaller vsix** (~4 MB less): four unused screenshots removed and the `/imagine` hero image converted to WebP (2.9 MB → 240 KB).

## 1.7.0 — 2026-07-17

Three requested features, all built on ACP surfaces the Grok Build CLI already ships but never advertises — probe-confirmed against grok 0.2.101 first ([research/grok-build-oss-findings.md](research/grok-build-oss-findings.md) § 3a) and pinned by new real-grok gates.

### Added

- **Steer — redirect Grok mid-turn without interrupting it.** A message sent while Grok works still queues by default; now the pending message carries a **Steer** button that sends it straight into the running turn, so Grok changes course mid-answer. It is not a Stop: the turn keeps its in-flight tool work and finishes normally. **Steer by default** (gear → *Config & debug*, off by default) makes send-while-busy skip the queue entirely; steered text is plain text only (no chips, editor context, or `/commands`), and a CLI that can't steer falls back to queueing rather than losing the message. ([#52](https://github.com/phuryn/grok-build-vscode/issues/52); [src/acp.ts](src/acp.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js))
- **Fork conversation** (gear → *Fork conversation*) — branch the conversation into a new session named `(Fork) <original>`, leaving the original byte-for-byte unchanged in your history. It branches the conversation, **not your code**: files on disk are untouched. ([#48](https://github.com/phuryn/grok-build-vscode/issues/48); [src/acp.ts](src/acp.ts), [src/sessions.ts](src/sessions.ts), [src/sidebar.ts](src/sidebar.ts))
- **Token usage in the context popover.** Click the donut for a **Session total** of what the conversation has billed (input / cache read / output), tracked across every turn, plus a collapsible **Last turn** with the same split and its **model calls** — the number that explains why a turn bills far more than the context it holds. Cache *read* is shown; no cache-*creation* figure exists anywhere in the CLI, so it is omitted rather than faked as zero. ([#53](https://github.com/phuryn/grok-build-vscode/issues/53); [src/acp-dispatch.ts](src/acp-dispatch.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js))

### Changed

- **Compact conversation moved from the gear menu to the context popover** — it is a context action, so it now sits next to the number that tells you when you need it (disabled at 0 tokens). The gear's Session section holds *Fork conversation*. ([media/chat.js](media/chat.js))
- **Usage telemetry adds three feature flags** (`showThinking` / `expandToolDetails` / `steerByDefault`) **and the host app** (VS Code / Cursor / …), so we can see whether our defaults are the ones people keep and which VS Code forks are worth supporting. Still anonymous, one event per session, no content — every field is listed in [docs/privacy.md](docs/privacy.md). ([src/telemetry.ts](src/telemetry.ts))

### Fixed

- **The buttons on a pending message no longer miss while Grok is streaming.** Steer / Edit / Remove act on press instead of click: the pending block sits at the end of the chat, which re-scrolls on every streamed chunk, so the button moved out from under the cursor mid-click. ([media/chat.js](media/chat.js))

---

Older releases (before 1.7.0): see [docs/CHANGELOG-ARCHIVE.md](docs/CHANGELOG-ARCHIVE.md).
