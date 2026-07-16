# Changelog

## 1.6.1 — 2026-07-16

Groundwork: Grok Build CLI went **open source** ([xai-org/grok-build](https://github.com/xai-org/grok-build)). We source-verified every item in our upstream feedback and probed the shipped **grok 0.2.101** binary to confirm which newly-visible ACP surfaces actually ship (`research/oss-surfaces-probe.cjs`, `research/grok-build-oss-findings.md`).

### Added

- **Voice input now works without a separate API key.** If you're signed in with `grok login`, the extension reuses that stored token (`~/.grok/auth.json`) for Speech-to-Text — no need to obtain and paste a dedicated console.x.ai key. A dedicated key (`grok.voiceApiKey` / `GROK_VOICE_API_KEY` / `XAI_API_KEY`) still takes precedence; only xAI-issued, non-expired tokens are used, and streaming auth failures now give re-login/key guidance instead of a raw error. The transmission (audio + credential to xAI's STT endpoint) is disclosed in [docs/privacy.md](docs/privacy.md), and setup/costs moved to [docs/voice-setup.md](docs/voice-setup.md). ([#51](https://github.com/PawelHuryn/grok-vscode/issues/51); [src/voice.ts](src/voice.ts), [src/voice-streamer.ts](src/voice-streamer.ts), [src/sidebar.ts](src/sidebar.ts))
- **Subagent rows now show real duration and output.** A subagent's completion (`duration_ms`, `tokens_used`, the child's output) rides a live notification the CLI already sends (`_x.ai/session_notification` → `subagent_finished`); we now consume it, so a delegation card fills in its timing and result even for the Composer agent, whose tool-channel completion carries no duration. A failed or cancelled subagent now shows its status and error (flagged red on the row) instead of a silent, empty "success," and the card carries a distinct bot icon. ([src/acp-dispatch.ts](src/acp-dispatch.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js), [media/chat.css](media/chat.css))
- **Automatic (context-full) compaction now shows a one-line notice in chat** — "Auto-compacting context (N% full)…" (and "Compaction failed." on failure) — where it used to happen silently. A manual `/compact` keeps its "Compacted." confirmation. ([src/acp-dispatch.ts](src/acp-dispatch.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js))

### Changed

- **The context donut refreshes instantly after `/compact` — and now after automatic (context-full) compaction too.** The fresh post-compact token count rides a live notification the CLI already sends (`_x.ai/session_notification` → `auto_compact_completed.tokens_after`), confirmed on grok 0.2.101; the donut reads that directly. Older CLIs that predate the notification (e.g. the Windows recovery build) fall back to the previous hidden `/session-info` probe, so nothing regresses. Automatic compaction, which never refreshed the donut before, now does. ([src/acp-dispatch.ts](src/acp-dispatch.ts), [src/sidebar.ts](src/sidebar.ts), [src/session.ts](src/session.ts))
- **Changing reasoning effort no longer restarts the session.** On a CLI that supports per-session effort (grok 0.2.101+ advertises it), the effort change applies live to the running session via `session/set_model` — no more Summarize-or-Restart prompt and no lost context. Older CLIs, and switching effort back to the model default, still restart as before. ([src/acp.ts](src/acp.ts), [src/sidebar.ts](src/sidebar.ts))
- **On Windows, the agent is now told which shell dialect to write for.** The extension runs the agent's commands under PowerShell (or cmd, per your setting), but the agent used to guess the dialect from its own host detection and could emit POSIX-shell idioms that fail. It now sets `GROK_SHELL` in the agent's environment to match the shell we actually run, so the generated commands match the host. ([src/terminal-manager.ts](src/terminal-manager.ts), [src/sidebar.ts](src/sidebar.ts))

### Fixed

- **An expired login token no longer forces a sign-out.** A long-lived sidebar session could wedge on an expired OAuth token (the pool shares `~/.grok/auth.json` with the CLI, and a token refresh can lose a rotation race), surfacing as a misleading "you need to pay" error even with an unused SuperGrok limit — while the standalone CLI kept working. The extension now recognizes an auth/entitlement error, transparently restarts that session's process (a fresh one re-reads the current token from disk — what a re-login does, minus the sign-out) and re-sends your message automatically. If the fresh process still can't authenticate, it falls back to the re-login prompt. ([src/acp-dispatch.ts](src/acp-dispatch.ts), [src/sidebar.ts](src/sidebar.ts), [src/session.ts](src/session.ts))
- **A failed shell command now shows an error on its row and group, not just inside its output.** A non-zero exit code was only surfaced as `[Error] exit N` in the expandable OUT block; the tool row and its collapsed group looked successful. A failed command now flags the row and group the same way a failed tool does. ([media/chat.js](media/chat.js))
- **Command labels handle the `(cd dir; cmd)` subshell.** grok wraps commands in a POSIX subshell even on Windows; a row that read "Run (cd" now names the command that actually runs (e.g. "Run node") by stripping the `( )` and skipping the `cd` prelude, and no longer drags a script's path into the label. ([media/webview-helpers.js](media/webview-helpers.js))
- **A restored BACKGROUND subagent now shows its result + duration on reload**, instead of a stuck card plus a redundant `[subagent:general-purpose] …` poller row. On `session/load` grok flattens the delegation's poller output to a text blob (not the live structured shape); the extension now parses that back, folds it into the card, and drops the poller row. A failed subagent flagged via the tool channel (the common ordering) now renders red too, and a cancelled one reads muted rather than as a failure. ([media/webview-helpers.js](media/webview-helpers.js), [media/chat.js](media/chat.js), [media/chat.css](media/chat.css))

## 1.5.15 — 2026-07-15

### Added

- **Inline edit diffs now show real file line numbers.** The gutter reads each region's actual position from the wire instead of restarting at 1 for every edit — a one-line change at line 147 now reads `147`, not `1`. The line-number column widens automatically past 999. ([media/chat.js](media/chat.js), [media/chat.css](media/chat.css))
- **A replace-all now shows every replaced site.** Renaming a token across 148 lines renders 148 hunks at their real line numbers and reports **+148 −148**, instead of one meaningless `+1 −1` — the per-site detail was always on the wire, we just weren't reading it. ([media/chat.js](media/chat.js))

### Changed

- **An edit's `+N −M` appears as each edit lands**, not when the whole tool batch finishes — the counts are on the wire 2–3s before the turn ends. ([media/chat.js](media/chat.js))

### Fixed

- **A whole-file rewrite of an existing file no longer renders as pure additions.** Grok reports each edit's diff twice, and the optimistic first report claims the file was empty; the authoritative correction was being discarded, so an overwrite showed `+7 −0` instead of the real `+4 −3`. ([media/chat.js](media/chat.js))
- **Expanding a running tool group no longer snaps shut when the batch finishes.** A manual expand (or collapse) now survives; Expand/Collapse All still overrides it. ([media/chat.js](media/chat.js))

## 1.5.14 — 2026-07-14

### Fixed

- **Inline-diff line numbers no longer wrap mid-digit.** In an edit's inline diff, line numbers ≥100 could break onto a second row (`147` → `14` / `7`); the gutter is now wide enough and the number never wraps. Thanks to [@jiezaichan](https://github.com/jiezaichan) (#47). ([media/chat.css](media/chat.css))

## 1.5.13 — 2026-07-13

### Fixed

- **On Windows, the agent's shell commands now run under PowerShell instead of cmd (#46)** — `pwsh.exe` when installed, else Windows PowerShell 5.1 (`powershell.exe`), else cmd.exe. The extension runs every command Grok requests (Grok delegates them over ACP), so the shell was ours to pick; matching the standalone Grok CLI means PowerShell profile functions and pipelines (`… | Format-List`) just work, instead of failing under cmd and forcing the agent into costly retry/re-wrap loops. Linux/macOS are unchanged (`/bin/sh`). ([src/terminal-manager.ts](src/terminal-manager.ts))
  - **Install PowerShell 7 (`pwsh`) for the best experience** — the Windows PowerShell 5.1 fallback rejects `&&` command chains and reports every failing command's exit code as `1`; pwsh 7 does neither.
  - New **`grok.terminalShell`** setting (`auto` | `cmd`) — an escape hatch back to `cmd.exe` on Windows if the PowerShell host ever causes trouble. ([package.json](package.json), [src/sidebar.ts](src/sidebar.ts))
- **Command output now shows in the tool row for the Composer agent too.** Composer runs shell commands in its own CLI-side shell (it doesn't delegate over ACP like Grok Build), so its command rows showed the command (IN) but no output (OUT). The captured output is now read from the completed tool-call update and attached by tool-call id — reliable even though Composer runs commands in parallel and finishes them out of order. ([media/chat.js](media/chat.js), [media/webview-helpers.js](media/webview-helpers.js))
- **A command row's one-line label no longer drags in a quoted argument.** `Write-Output '=== banner ==='` now reads "Run Write-Output", not a truncated "Run Write-Output === 1. git statu…" — a quoted arg is data, not a subcommand. ([media/webview-helpers.js](media/webview-helpers.js))

## 1.5.12 — 2026-07-13

### Added

- **Edit diffs are reviewable inline in chat, even under Auto accept (#45).** Every edit row shows an always-visible `+N −M` change count (rolled up onto collapsed "Edited N files" group headers, path-deduped) plus an expandable **inline diff** — a Codex-style line-number gutter, colored left-border stripe, subtle tint, and a `+/−` glyph for color-blind readability. It rides the same expand controls as command IN/OUT, works live and on session restore, and — because the diff data is always on the ACP wire regardless of permission mode — needs no permission card. The native `open diff →` link stays for the full side-by-side. ([media/chat.js](media/chat.js), [media/webview-helpers.js](media/webview-helpers.js), [media/chat.css](media/chat.css))

### Changed

- **The gear toggle "Expand command outputs" is now "Expand tool details"** — it governs command IN/OUT blocks **and** edit diffs, matching the *Expand All Tool Details* commands (the `grok.expandCommandOutputs` setting key is unchanged). ` ```diff ` blocks in Grok's messages now share the same Codex diff palette + left-border styling. ([media/chat.js](media/chat.js), [media/chat.css](media/chat.css), [package.json](package.json))

### Fixed

- **A shell command that exits 0 with no output** now shows a muted `✓ done · no output` marker instead of an empty `(no output)` line. ([media/chat.js](media/chat.js))

## 1.5.11 — 2026-07-13

### Added

- **Caret lands in the composer after you add context (#43).** Send Selection, Send File, @-mention, the **+** file picker, and image paste all reveal the panel *taking* focus, so you can type your prompt immediately — no click into the input first. ([src/sidebar.ts](src/sidebar.ts), [src/protocol.ts](src/protocol.ts), [media/chat.js](media/chat.js))

### Changed

- **"Grok: Send Selection" is now "Add Selection to Grok",** and a command-sent selection attaches in the **top** attachments row (removable, with its line range) like any other file — only the ambient active-editor chip stays in the bottom toolbar. ([package.json](package.json), [media/chat.js](media/chat.js))
- **"Grok: Send File" no longer silently no-ops** from the Command Palette when no file is open — it opens a file picker instead of doing nothing and dropping focus. ([src/sidebar.ts](src/sidebar.ts), [src/extension.ts](src/extension.ts))
- The internal debug command (`grok._debugDummyPlan`) is hidden from the Command Palette. ([package.json](package.json))

## 1.5.10 — 2026-07-12

### Added

- **Expand / collapse all tool details.** Two Command Palette commands — *Grok: Expand All Tool Details (This Session)* / *…Collapse All…* — open or close every tool group and command IN/OUT box, **including a batch that's still running**, and keep applying to tool calls that stream in afterward. It's a per-session latch (last action wins vs the gear setting; flipping the setting clears it) that survives Agent Dashboard focus-swaps and resets on a cold reopen — never persisted to disk. Bind them to a key if you like. ([src/extension.ts](src/extension.ts), [media/chat.js](media/chat.js), [src/sidebar.ts](src/sidebar.ts))

### Changed

- **`grok.expandCommandOutputs` now also opens command-bearing tool *groups*,** not just each command's IN/OUT detail — an Auto-accept "Ran N commands" batch is audit-visible with zero extra clicks; explore/edit-only groups stay collapsed. ([media/chat.js](media/chat.js))
- **Command rows read as "Run \<program\>"** — the executable plus a non-flag subcommand (`Run git status`, `Run npm test`, `Run node`, `Run Get-Date`), not a truncated slab of shell. The full command still lives in the row's IN/OUT detail. ([media/webview-helpers.js](media/webview-helpers.js))
- Refreshed the README — new mode-picker and image-paste screenshots, and a leaner **Install** section (the extension's onboarding installs the CLI and signs you in) with build-from-source / per-IDE scripts moved to [docs/INSTALL.md](docs/INSTALL.md). ([README.md](README.md))

### Fixed

- **Failed non-shell tools now show their real error inline** instead of a generic "Tool call failed." — the reason is mined from variant-keyed `rawOutput` blobs (e.g. `list_dir` → `NotFound`, `read_file` → `FileReadError`) when there's no `message`/`content` to read. ([media/webview-helpers.js](media/webview-helpers.js))

## 1.5.9 — 2026-07-12

### Changed

- Documentation-only patch: the README hero screenshot now shows the current UI running **Grok 4.5** ([docs/screenshots/grok_4.5.png](docs/screenshots/grok_4.5.png), replacing the v1.4.20 shot). No code changes.

## 1.5.8 — 2026-07-12

### Fixed

- **RTL text (Arabic, Hebrew, Farsi) now renders correctly** (user report). Every paragraph and block takes its direction from its own first strong character — right-aligned with punctuation on the correct side — across chat bubbles, thinking traces, plan cards, subagent results, tables, lists (markers and indent flip too), and the queued block; the composer follows as you type. Code blocks and inline code stay pinned LTR (the same rule the Codex extension uses), and the chat chrome doesn't move — only text direction changes, per block. ([media/chat.js](media/chat.js), [media/chat.css](media/chat.css), [src/sidebar.ts](src/sidebar.ts))

## 1.5.7 — 2026-07-12

### Added

- **Command details (#41).** Every shell-command row expands (trailing `›` ↔ `v`) into a Claude-Code-style **IN/OUT block**: the full command text immediately — a lone running command is expandable mid-run — and the complete captured output when it finishes (the extension executes the commands itself, so the output is byte-for-byte what grok received). Exit 0 stays silent; failures render an `[Error] exit N` marker with error-tinted output; kills render a muted `[Cancelled]`. `grok.expandCommandOutputs` (also gear → Config & debug) pre-opens every detail — the audit view for Auto-accept sessions. Live-session only: the CLI doesn't replay terminals on restore. ([src/acp.ts](src/acp.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js))

### Changed

- **Tool rows read as one scannable line** — labels trim at 40 chars (full text one click away), long content ellipsizes at the row edge instead of wrapping, and the corner-radius scale is unified (bubbles 12 → code/IN-OUT blocks 8 → inline chips 6). ([media/chat.js](media/chat.js), [media/chat.css](media/chat.css))
- Refreshed the Marketplace description and README (new screenshots: cost control, effort picker, file chips). ([README.md](README.md), [package.json](package.json))
- Every outbound `session/cancel` is logged with its trigger (Stop click / plan verdict) in the Grok output channel, so any future spurious-cancel report (#37) is attributable at a glance. ([src/acp.ts](src/acp.ts))

### Fixed

- Private working docs no longer ship inside the public `.vsix` (they were bundled because `.vscodeignore` — not `.gitignore` — decides the package contents). ([.vscodeignore](.vscodeignore))

## 1.5.6 — 2026-07-11

### Added

- **Subagent rows, fully live.** A delegation renders as a purple *Subagent · \<task\>* row with running dots, then a duration stamp and a click-to-expand result under "Output of the subagent:" — the CLI envelope (plumbing tags, boilerplate lead-ins, one wrapping `<response>` pair, the Agent ID hint) is stripped when present, never failing. Covers grok-build's `spawn_subagent` — including `background: true` spawns, whose started-ack no longer masquerades as the result (the card completes from the output poller's `TaskOutput`, matched by task id) — and the Composer agent's `Task`. The `subagent_spawned`/`subagent_finished` lifecycle events are routed for the day the CLI transmits them (0.2.93 logs them but doesn't send them over ACP — live-verified). Real captured sessions are replayed end-to-end in the test suite. ([media/chat.js](media/chat.js), [media/webview-helpers.js](media/webview-helpers.js), [src/acp.ts](src/acp.ts), [test/fixtures/composer-subagent-session.jsonl](test/fixtures/composer-subagent-session.jsonl))

- **[docs/ACP-feedback.md](docs/ACP-feedback.md)** — an upstream-facing summary of grok-CLI/ACP friction: the grok-build vs Composer wire differences, everything the extension works around or hides (with suggested fixes), what works well, and a Grok 4.5 verification checklist. Built from the wire captures and probes in `research/`.

### Changed

- **One copy/timestamp footer per turn, shown when the turn ends.** The copy action and time sit only under the turn's final agent message (the conclusion) and appear once the turn completes — no more copy icons flickering mid-conversation while grok works; the timestamp reads as the turn's end time. Code blocks keep their own copy buttons. ([media/chat.js](media/chat.js))
- **The composer grows with your text.** 2 lines at rest (Cursor-style), expanding to 5 as you type, then scrolling; scales with `grok.chatFontScale`. ([media/chat.js](media/chat.js), [src/sidebar.ts](src/sidebar.ts))

### Fixed

- **No more fake Subagent cards while working on subagent code.** grok titles Grep/Read calls with their query/filename (a search for `spawn_subagent` is titled exactly that), so title matching false-carded ordinary tools; the classifier now treats the wire's `_meta["x.ai/tool"].name` as authoritative both ways and matches exact tool names otherwise. ([media/webview-helpers.js](media/webview-helpers.js))
- **Subagent child sessions no longer clutter history.** Every delegation persists its child as a top-level session (`session_kind: "subagent"`); the history list hides them, and pagination advances by consumed index slots (`nextOffset`) so hidden rows can't stall or duplicate load-more. ([src/sessions.ts](src/sessions.ts), [src/sidebar.ts](src/sidebar.ts))
- **Restored plan/permission cards no longer drift to the end of the conversation.** The host counted replayed `<system-reminder>` turns and marker-only verdicts toward plan positions while the webview (correctly) renders no bubble for them — so every verdict given after a session restore persisted an unreachable position and its card landed at the bottom on the next restore. The host now counts exactly what the webview bubbles (`countsAsUserBubble`). Positions persisted by older builds stay as recorded. ([src/plan-restore.ts](src/plan-restore.ts), [src/sidebar.ts](src/sidebar.ts))

## 1.5.5 — 2026-07-11

### Changed

- **Codex-inspired chat restyle.** User bubbles use a theme-independent foreground tint (fixes bubbles that vanished on Cursor dark themes), inline and fenced code share one chip surface + editor-contrast text, one 28px ghost icon-button style across header/composer/message/code actions, file refs and "open diff →" render as real links (hover-only underline), plan/permission card text matches the chat font, and the composer types in the UI font instead of the editor's monospace. ([media/chat.css](media/chat.css), [media/chat.js](media/chat.js))
- The permanent plan-cancel notice no longer says "Grok is processing the cancellation…" — the transient dots indicator carries that state. ([src/sidebar.ts](src/sidebar.ts))
- **Resolved plan cards drop the inline plan text.** Once a plan is approved/rejected/cancelled (live or restored), the card shows just the plan-file link + verdict — the file opens as an editor tab; the Show/Hide toggle remains only when no plan file exists. ([media/chat.js](media/chat.js))
- **Toolbar icons equalized.** The mode button, context donut, and mode-picker icons now use the same 16px glyph and 28px highlight height as the settings/history buttons. ([media/chat.css](media/chat.css))

### Added

- **Context popover on the donut.** Click the context donut for the exact token count (`used / window`, %). (#39) ([media/chat.js](media/chat.js))

### Fixed

- **Resolved plan cards stay resolved on re-focus.** Re-opening a live session no longer resurrects an already-answered plan review with active Approve/Reject/Cancel buttons; resolved cards replay collapsed behind Show/Hide plan with their verdict (`planResolved`, the plan twin of `permissionResolved`). ([src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js), [src/protocol.ts](src/protocol.ts))
- **`/session-info` no longer zeroes the context donut.** A turn's `totalTokens: 0` report is never a real measurement (`/compact` shrinks context, it doesn't empty it) and is now always ignored; `/context` (a CLI-TUI no-op over ACP) is hidden from autocomplete — use `/session-info`. (#39) ([src/acp-dispatch.ts](src/acp-dispatch.ts), [src/slash-filter.ts](src/slash-filter.ts))
- **The context donut is real on restore and right after `/compact`.** A restored session seeds the donut from grok's persisted `signals.json` instead of showing 0 until the first turn; and `/compact` is followed by a hidden, CLI-local `/session-info` turn (~25ms, no model call, not persisted to history) whose reply carries the exact post-compact count — parsed and pushed to the donut moments after "Compacted." (the compact turn's own meta reports 0 and the CLI recomputes `signals.json` only at the next turn's end, so this was otherwise unknowable — probe-verified). ([src/sessions.ts](src/sessions.ts), [src/acp-dispatch.ts](src/acp-dispatch.ts), [src/sidebar.ts](src/sidebar.ts), [research/signals-refresh-probe.cjs](research/signals-refresh-probe.cjs))
- **Approving a plan no longer leaks grok's post-verdict filler** ("I'll wait for your verdict…") into the chat: the planning turn the CLI unblocks on our response is cancelled and content-suppressed on Approve exactly as Reject/Cancel already did — that text never survived a session restore, so it doesn't paint live either. ([src/sidebar.ts](src/sidebar.ts))
- **The welcome logo/byline actually hides once the chat has content** (a CSS `display` rule was overriding the `hidden` attribute), and a primer-only restore keeps the welcome screen instead of showing an empty chat. ([media/chat.css](media/chat.css), [media/chat.js](media/chat.js))
- **No more forever-spinning dots after cancelling a plan.** Turn end now always clears the waiting indicator (grok's `[Plan cancelled]` ack can be contentless, which orphaned it), and a plain Cancel is silent by design: the "Plan abandoned" notice is the whole UX — the verdict still reaches grok on a hidden turn, but its ack reply no longer paints. ([media/chat.js](media/chat.js), [src/sidebar.ts](src/sidebar.ts))
- **White flash on webview load fixed** (VS Code only): an inline critical style paints the theme background immediately and holds the welcome invisible until the stylesheet loads. ([src/sidebar.ts](src/sidebar.ts), [media/chat.css](media/chat.css))

## 1.5.4 — 2026-07-11

### Changed

- **One pending message instead of a queue.** Composing more text while a message is already queued now **appends** to the single pending block (blank-line separated — exactly how it sends), rather than stacking separate queue entries. Edit pulls the whole pending text back into the composer, Remove drops it, Stop still hands it back — no more edited messages landing at the end of a queue that was going to collapse into one message anyway. (#37 follow-up) ([media/chat.js](media/chat.js), [src/sidebar.ts](src/sidebar.ts))

## 1.5.3 — 2026-07-11

### Fixed

- **Typing while Grok works no longer cancels its tools.** Enter (and the send button) doubled as a hidden Stop while a turn was running, so a mid-turn "continue" silently resolved in-flight tools as *"cancelled by the user"* — amplified by busy-state leaking across dashboard session switches. Typed text now **never cancels**: messages compose into a per-session queue shown as pending blocks at the end of the chat (italic, clock tag, per-message Edit/Remove), survive session switches, and auto-send as one combined message when that session's turn ends — even while backgrounded. Stop (square button, empty composer only) hands queued text back to the composer instead of firing it. Thanks @githubuser1256! (#37) ([media/chat.js](media/chat.js), [src/sidebar.ts](src/sidebar.ts), [src/session.ts](src/session.ts), [src/protocol.ts](src/protocol.ts))
- **Enter during CJK IME composition no longer sends mid-composition.** The composer now respects `isComposing`/`keyCode 229`, so Enter confirms the IME candidate (Claude-Code-style: first Enter picks the character, second sends). Thanks @yyu0310! (#38) ([media/chat.js](media/chat.js))

### Added

- **Live-suite coverage for the Stop contract and concurrent sessions.** `cancel-mid-turn` pins that an id-less `session/cancel` settles the turn as cancelled and leaves the session usable; `parallel-sessions` pins that two CLI processes on one workspace answer overlapping prompts independently. ([scripts/live-tests.cjs](scripts/live-tests.cjs))

## 1.5.2 — 2026-07-10

### Added

- **One-click "Move view" in the gear menu.** Gear → **Config & debug → Move view** relocates the chat to the Secondary Side Bar, Primary Side Bar, or Panel instantly — direct moves into per-location view containers, no picker — each with a matching panel icon. Especially handy in Cursor, whose side-bar context menu hides the built-in "Move To" entry. ([src/view-move.ts](src/view-move.ts), [media/chat.js](media/chat.js))
- **Install scripts detect Cursor and can target every IDE at once.** `cursor` joins the auto-detect chain, and `--all` (Windows: `-All`) builds once and installs into every detected IDE. ([scripts/](scripts/))

### Changed

- **The view now opens in the Secondary Side Bar by default** (`viewsContainers.secondarySidebar`), next to your other AI tools. This raises the minimum VS Code to **1.106** — older hosts (e.g. Antigravity, currently on base 1.104) keep the last compatible version. A placement you set yourself still wins; use the gear mover or *Reset Location* to adopt the new default.

## 1.5.1 — 2026-07-09

### Fixed

- **The mode button tells the truth when `always-approve` is set in `config.toml`.** grok's global `permission_mode = "always-approve"` (set via Shift+Tab or `/always-approve` in the TUI) auto-approves every session server-side and is invisible over ACP, so the extension used to show a misleading "Agent mode" with no permission cards. It now detects the setting (project `.grok/config.toml` overriding global `~/.grok/config.toml`) and shows **Auto accept**, plus a one-time notice that it's a global config setting. (#31) ([src/grok-config.ts](src/grok-config.ts), [src/sidebar.ts](src/sidebar.ts))

### Changed

- **Hidden the `/always-approve` slash command.** It only mutates grok's global `config.toml` — a sticky, surprising side effect — and is a no-op over ACP, so it no longer appears in autocomplete or dispatches. (#31) ([src/slash-filter.ts](src/slash-filter.ts), [src/acp.ts](src/acp.ts))
- **Typed the host↔webview message contract.** The host→webview direction was `any`; it's now a discriminated union in `src/protocol.ts` (single source of truth), with the webview keeping a synced mirror and a test asserting both sides agree — so "post one shape, handle another" drift (restore/pagination/media) is a build error. Caught two latent mismatches on the way in. ([src/protocol.ts](src/protocol.ts), [media/webview-helpers.js](media/webview-helpers.js))
- **Strengthened the test & release gates.** The `release.*` scripts now run `test:live` by default (`-SkipLive`/`--skip-live` to opt out); the real-grok plan-mode test now models the true approve/reject flows with a disk-snapshot containment canary (the old single-turn test invented an impossible state); the live suite gained a capability-drift probe and a fast `--smoke` lane; and a required `@vscode/test-electron` activation smoke now runs in CI (`npm run test:integration`, validated against a real Extension Host).
- **Documentation consistency pass:** corrected the minimum VS Code version in the README, documented the `Grok: Compact Conversation` command, added the telemetry/mode-prefs/grok-config modules to the architecture map, and trimmed change-history narrative out of `CLAUDE.md` (it points at the changelog and `research/*` instead).

## 1.5.0 — 2026-07-09

### Added

- **Paste or attach images — Grok now sees the pixels.** Ctrl+V a screenshot, drag-drop, or attach a png/jpg/gif/webp and it rides the prompt as an inline vision block (validated at send, 20 MiB cap, session-scoped `[Image #N]` tags that restore as chips; SVG stays a path chip so Grok can edit the source). Thanks @cpulxb! (#32) ([src/chips.ts](src/chips.ts), [src/prompt-builder.ts](src/prompt-builder.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js))
- **The active-editor context chip tracks your live selection** (`file.ts:8-15`), and selection snippets restore as ranged chips when a session is reopened. Thanks @cpulxb! (#32) ([src/sidebar.ts](src/sidebar.ts), [media/webview-helpers.js](media/webview-helpers.js))

### Fixed

- **`/compact` actually compacts again — and says so.** A leading context envelope silently degraded it into an ordinary LLM turn that *grew* context ~6x; confirmed slash commands now lead the text block, the context donut accepts the post-compact reset, the hidden plan-mode primer is re-sent afterwards (thanks @cpulxb! #32), and the turn now ends with a visible **"Compacted."** confirmation. ([src/prompt-builder.ts](src/prompt-builder.ts), [src/slash-filter.ts](src/slash-filter.ts), [src/sidebar.ts](src/sidebar.ts))
- **Plan mode no longer blocks safe chained commands.** `cd repo && git status` was rejected outright, which crashed grok-4.5's planning phase; chains (`&&`, `||`, `;`) now pass when **every** segment is read-only — one mutating segment still blocks the whole command. (#36) ([src/plan-gate.ts](src/plan-gate.ts))

### Changed

- **Composer polish:** one focusable card, VS Code-style webview scrollbars, and the caret lands in the input on panel open, window refocus, new session, and session switches (thanks @cpulxb! #32); pasted images that can't be read block the send instead of silently dropping, and inline images carry a do-not-read-from-disk hint so Grok stops noisily `Read`-attempting its own copy. ([media/chat.js](media/chat.js), [media/chat.css](media/chat.css))

---

Older releases (before 1.5.0): see [docs/CHANGELOG-ARCHIVE.md](docs/CHANGELOG-ARCHIVE.md).
