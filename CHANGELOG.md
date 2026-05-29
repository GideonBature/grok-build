# Changelog

## 1.2.2 — TBD

### Plan mode

- **Plan-mode gate hardening.** Relative workspace write paths are now resolved against the workspace root before containment checks, and common mutating forms of otherwise read-only-looking commands (shell separators/newlines, command-executing heads like `env`/`awk`/`sed`, write/exec flags on `find`/`fd`/`sort`/`tree`, mutating Git forms, and `npm audit --fix`) are blocked before plan approval. Grok's own `.grok/sessions/.../plan.md` write stays allowed and snooped. (#5, #6, thanks @shugav)

## 1.2.1 — 2026-05-29

Robustness fixes from a static audit (cross-checked with Codex). The high-impact ones are in the child-process supervision layer; a few low-impact correctness/perf cleanups ride along. Findings judged overstated or cosmetic (e.g. the non-`file://` URI drop) were left as-is.

### Fixes

- **Responding to the CLI after it exits no longer crashes the extension host.** `respondPermission` / `respondExitPlan` / `cancel` / the internal request + response writers all did a bare `this.proc?.stdin.write(...)`. The `exit` handler never cleared `this.proc`, so after the CLI died the optional-chaining check still passed and the write hit a destroyed pipe — throwing `ERR_STREAM_DESTROYED` synchronously, or emitting an async `'error'` with no listener, either of which became an uncaught exception in the host. Real trigger: clicking Approve/Reject/Cancel (or a late `terminal/output` ack) after the CLI has crashed. All writes now route through a single `writeLine()` helper that checks `stdin.writable` and try/catches; `start()` registers a `stdin` `'error'` listener; the `exit` handler drops `this.proc` so later writes are skipped; `dispose()`'s `kill()` is wrapped (it can throw `EPERM` on Windows if the process already exited). ([src/acp.ts](src/acp.ts))
- **Killed terminal commands are no longer reported as a clean exit.** A process terminated by a signal reports `code === null`; the old `code ?? 0` masked that as exit code `0`, so the agent assumed an interrupted command had succeeded. Signal kills now map to the shell convention `128 + signum` (SIGTERM → 143) via a new pure `resolveExitCode()` helper. The same `exit` handler also no longer clobbers an exit code already set by the `spawn` `'error'` handler. ([src/terminal-manager.ts](src/terminal-manager.ts))
- **Windows: killing a terminal now kills the whole process tree.** With `shell: true`, `spawn` wraps the command in `cmd.exe`; `proc.kill("SIGTERM")` only terminated that wrapper, orphaning long-running descendants (`npm`, `node`, …) that held file locks and blocked subsequent grok runs. `kill()` now uses `taskkill /pid <pid> /T /F` (via `execFile`, no shell) on Windows through a new pure `buildKillPlan()` helper; POSIX keeps the direct signal. ([src/terminal-manager.ts](src/terminal-manager.ts))
- **Terminal output no longer corrupts multi-byte UTF-8 at a buffer boundary.** Output was decoded with `Buffer.toString()` per chunk, so a character split across the truncation point (or across two stream chunks) became a replacement char (`�`) — visible for any non-ASCII output (emoji, i18n text, localized Windows paths). Each terminal now decodes through a `StringDecoder` that buffers incomplete sequences across boundaries. ([src/terminal-manager.ts](src/terminal-manager.ts))
- **Per-request ACP timers are cleared on response.** Each `request()` armed a `setTimeout` (30 min for prompts) that was never cleared on success — the resolved request left a live timer and its closure pending until it fired and no-op'd. Timers are now tracked on the pending entry and cleared on response and on process exit. ([src/acp.ts](src/acp.ts))
- **`#` in file paths (C#/F# folders) now parses correctly.** The "open file" ref parser used `[^#]+`, so a path with a `#` followed by a real `#L<n>` line suffix failed the match and fell through to opening the literal (wrong) path. Parsing moved to a pure `parseFileRef()` that anchors the `#L…` fragment to the end of the string. ([src/file-ref.ts](src/file-ref.ts))
- **Dropping a huge file with Shift no longer freezes the window.** Shift-drop read the entire file synchronously just to count lines; a multi-MB log stalled the host (and a 500 MB file could OOM it). Files over 10 MB now skip the line count and fall back to a no-selection chip. ([src/file-ref.ts](src/file-ref.ts), [src/sidebar.ts](src/sidebar.ts))

### UI / session fixes (live-testing pass)

Surfaced while smoke-testing the rebuilt extension:

- **"No session" error when sending before the session finished loading.** The composer was interactive during the whole `start()` + `session/new` window; sending then hit `prompt()`'s `sessionId` guard and surfaced a "no session" bubble. The composer is now **locked (spinner, disabled) for the entire session-start window** — not just the priming step — and cleared on every start outcome (ready, missing-CLI, error). ([src/sidebar.ts](src/sidebar.ts))
- **Plan-verdict protocol markers no longer leak into restored conversations.** The host prepends `[Plan approved|rejected|cancelled]` to the wire-level prompt for grok's benefit; live hid it, but on resume grok replayed the raw text and the marker showed in the user bubble. Replayed verdict messages now strip the marker; a **marker-only verdict** (no comment) renders no user bubble at all (matching live), while grok's reply to it still shows. ([media/chat.js](media/chat.js))
- **Restored plan cards land in the right place.** A marker-only verdict was counted as a user message on replay but never counted live, desyncing the saved `afterUserMessage` positions so cards drifted to the bottom. Marker-only verdicts are no longer counted on replay, re-aligning positions with what the host persisted. ([media/chat.js](media/chat.js))
- **Live plan card now matches the (nicer) restored look.** After picking a verdict, the live card drops its buttons + comment box and shows a single colored verdict label (`Approved`/`Rejected`/`Cancelled`), instead of leaving greyed-out buttons and an uncolored label. ([media/chat.js](media/chat.js))
- **Can't delete the active session from history.** Deleting the live session didn't stick (the CLI re-persists it); the delete button is now hidden for the active row (rename still available). ([media/chat.js](media/chat.js))

### Testing — 204 tests

- New regression tests cover each fix, written to fail before the fix landed (TDD). Process layer: `writeLine` swallows a throwing/destroyed stdin and skips a non-writable pipe ([test/acp-integration.test.ts](test/acp-integration.test.ts)); `resolveExitCode` maps signals to `128 + signum` and passes real codes (incl. 0) through; a killed process surfaces a non-zero exit; `buildKillPlan` issues `taskkill /T /F` on Windows and `SIGTERM` on POSIX; truncating mid-character emits no `�` ([test/terminal-manager.test.ts](test/terminal-manager.test.ts)); a resolved `request()` leaves no armed timer ([test/acp.test.ts](test/acp.test.ts)). Pure path helpers: `parseFileRef` / `shouldReadFileInline` ([test/file-ref.test.ts](test/file-ref.test.ts)). Webview: marker stripping + marker-only suppression + position alignment on replay, the collapsed live verdict card, and delete hidden for the active session ([test/plan-history-restore.dom.test.ts](test/plan-history-restore.dom.test.ts), [test/plan-card.dom.test.ts](test/plan-card.dom.test.ts), [test/webview-ui.dom.test.ts](test/webview-ui.dom.test.ts)).
- **Flaky CI fix.** `test/acp-integration.test.ts` shared one `stderr` array binding across tests, so a prior test's late stderr could bleed into the next (reliably failed `gate blocks fs/write` on Linux). Each test now captures into its own array, listeners are removed in `afterEach`, and the stderr assertion waits for its line (stderr lags the stdout response across pipes). Reproduced on Ubuntu via Docker before fixing.
## 1.2.0 — 2026-05-28

### Plan mode is now enabled

The headline of this release reverses 1.1.0's "Plan mode stays disabled." The `x.ai/exit_plan_mode` ACP path is still broken in `grok` 0.2.3 — it treats *any* client response (result **or** error) as approval, so a plan can't be rejected at the protocol layer. Rather than wait on the CLI, this build **enforces plan mode client-side**, mirroring how YOLO mode is implemented.

- **Client-side plan gate ([src/plan-gate.ts](src/plan-gate.ts), pure + unit-tested).** While a plan is active, the extension blocks the two *mandatory* server→client choke points the agent cannot avoid:
  - `fs/write_text_file` — refused when the path resolves **inside the workspace** (grok's own `~/.grok/sessions/<cwd>/<id>/plan.md` lands *outside* the workspace, so it's allowed — and snooped to recover the plan text, since `exit_plan_mode` arrives with `planContent: null`).
  - `terminal/create` — refused unless the command is on a conservative **read-only allowlist**. The classifier is pipe-aware: a pipeline passes only if *every* `|`-separated stage is independently read-only, and shell metacharacters that chain, redirect, or smuggle code (`>`, `;`, `&&`, `` ` ``, `$(`, `{ }`) block it outright. The allowlist covers **read-only PowerShell pipelines** (`Get-ChildItem | Select-Object …`, `Get-Content`, `Test-Path`, etc.) for native Windows, while excluding anything that writes or executes (`Out-File`, `Set-Content`, `Invoke-Expression`/`iex`, `ForEach-Object`, `Where-Object`).
- **Asymmetric mode sync.** Entering plan mode *any* way (including an agent-initiated `current_mode_update: plan`) raises the gate; it's lowered only by explicit user action, never by the CLI's mode flapping (the false-approve emits `current_mode_update: default`, which is deliberately ignored).
- **Mode picker copy updated.** Plan mode is no longer marked disabled; its description now reads "Grok explores and proposes a plan; file writes and commands are blocked until you approve it." Matched in the README modes table and command list.

### Three-verdict plan review (Approve / Reject / Cancel)

The plan-review card now offers three distinct outcomes, each mapped to a different ACP verdict and different downstream behavior. (Earlier in the iteration this was a two-button Approve / Keep planning UI; user testing surfaced that "I want to stop planning but not implement" had no clean exit, so we split it.)

- **Approve & implement** → verdict `approved`. Drops the gate, returns the CLI to act mode, sends "Implement it now" as the next prompt.
- **Reject** (with optional comment) → verdict `rejected`. Keeps the gate up — you're still in Plan mode. If you wrote a comment, it's sent to Grok as a plain user message (not "revise the plan"); Grok decides whether to re-plan or answer. The chosen button highlights, a **Rejected** label appears.
- **Cancel** → verdict `abandoned`. Drops the gate, switches the CLI back to act mode, sends nothing. Use this to back out of planning entirely. **Cancelled** label appears.

### Suppressing the CLI's false-approval response

Because grok 0.2.3 treats any `exit_plan_mode` response as approval, rejecting a plan would otherwise let the agent keep streaming "OK, the plan is approved, here's what I'll do…" before our follow-up prompt landed. On Reject / Cancel we now:

1. Send the verdict to the CLI (it still mis-interprets it, but that's fine — the gate is authoritative).
2. Immediately send `session/cancel` to interrupt the in-flight prompt.
3. Set a content-only suppression flag (`suppressPlanReject`) that drops `messageChunk` / `thoughtChunk` / `toolCall` events for the rest of the turn — but **not** `promptComplete` / `agentEnd`, so the webview's `busy` state still clears and the send button re-enables when the cancelled turn ends.
4. Post `agentReset` to the webview, which removes the in-flight agent bubble from the DOM so the false-approval text never reaches the screen.

A `finally` in `handleSend` clears the suppression as a safety net so it can't get stuck.

### Plan markdown rendering

Plan bodies render through the same Markdown pipeline as agent messages now (headings, lists, code fences) instead of monospace `<pre>` blocks. Applies to both the live review card and the restored history cards. A bug along the way: the `.code-block` `position: relative` rule was scoped under `.msg.agent .body`, so when plan cards contained fenced code their absolutely-positioned copy buttons escaped to the viewport and overlapped the Session-history / New-session header buttons. The scoping was loosened so any `.code-block` is its own positioning context.

### Per-session plan history (restored inline, not at the bottom)

grok overwrites `~/.grok/sessions/<…>/plan.md` every time the agent proposes a new plan, so older plans in a session are physically gone from disk. We now persist each resolved plan to VS Code's `globalState` keyed by session id (`SessionMetaOverride.plans`), capturing **text + verdict + `afterUserMessage`** (the count of user messages already sent at the moment of resolution).

On session resume:

- The host posts a `planHistoryQueue` to the webview *before* `session/load` starts.
- The webview drains the queue inline as the replay streams: each plan card lands at its saved user-message boundary (right where the plan actually happened), not in a clump at the bottom. Legacy entries without a saved position fall back to the end of replay.
- The plan-gate state is restored from the *last* verdict via a pure helper ([src/plan-restore.ts](src/plan-restore.ts)): `rejected` → re-raise the gate (you were mid-planning); `approved` / `abandoned` / no log → leave the gate down (Cancel-then-restore no longer comes back stuck in Plan mode). Without this, the CLI's replayed `current_mode_update` events would raise the gate even when the user had cancelled.
- A separate `pendingPlanText` field holds the displayed plan from render → verdict-click, since `lastPlanText` is cleared the moment the card renders. (Regression: without this, restored plans showed `"(empty plan)"` despite content being persisted.)

### Native-Windows webview fixes (carried forward + locked in)

The history-popover, whole-row-click, and reasoning-trace-expand fixes from 1.1.0 are now covered by DOM tests so they can't silently regress again (see Testing).

### Testing — 178 tests, all grok-free

- **Two clearly separated tiers.** `npm test` (and CI) runs **only grok-free tests** — pure-logic unit tests plus DOM tests that drive the real `media/chat.js` in a headless `happy-dom` window. The **grok-dependent probes** live in `research/*.cjs`, require the `grok` binary, are run manually, and are never collected by Vitest or CI.
- **New pure module + tests** for the persist / restore decision: [src/plan-restore.ts](src/plan-restore.ts) extracts `appendPlanEntry` and `decideRestoreState`. 15 tests cover chronological append, immutability, text preservation (the wiped-`lastPlanText` regression), and the verdict-driven restore decision for every verdict including the "rejects then cancels → Agent mode" case that previously came back in Plan mode.
- **New DOM tests** in `test/plan-history-restore.dom.test.ts` (12 tests) lock in the restore-flow rendering: positioned plans interleave at the right boundary, legacy plans flush at end of replay, multiple plans at the same position drain together, live user message drains queued plans, `clearMessages` resets queue + counter, all three verdict buttons produce matching status labels, `agentReset` removes the in-flight agent bubble and a subsequent `messageChunk` creates a fresh one.
- **New ACP integration tests** in `test/acp-integration.test.ts` (6 tests) drive the real `AcpClient` over JSON-RPC stdio against a ~150-line fake `grok agent stdio` fixture (`test/fixtures/fake-grok-acp.cjs`). Covers the wire layer + plan-mode gate end-to-end: plan-snoop, workspace-write gate (on and off), terminal-create gate for mutating vs read-only commands. Encodes only what ACP requires, not grok's version-specific quirks, so it stays stable across CLI bumps.
- **178 tests, ~1.4s**, no network, no spawned `grok`. The whole suite runs on a clean Ubuntu CI runner via `.github/workflows/ci.yml`.

### Bug fixes (this iteration)

- **Effort-picker dots are now visually balanced.** The "filled / empty" dots used the `●` / `○` Unicode glyphs, which render at different sizes in most fonts (the empty one is visibly larger). Replaced with CSS-shaped spans so active and inactive states are the same diameter.
- **Spawning `.cmd` / `.bat` CLI paths now works on Windows.** Node 18+ refuses to spawn those without `shell: true` (CVE-2024-27980). `AcpClient.start()` now detects them and sets `shell: true` automatically, so installs that resolve grok to a `.cmd` shim (or the test fake-CLI) start correctly.

## 1.1.0 — 2026-05-27

### Windows support

- **Native Windows is now first-class.** xAI shipped a native Windows build of the `grok` CLI (`irm https://x.ai/cli/install.ps1 | iex`), so the extension no longer needs WSL. This reverses the 1.0.3 "Windows isn't supported" onboarding panel.
  - **Onboarding** now detects Windows and shows the PowerShell install command (`irm https://x.ai/cli/install.ps1 | iex`) with copy-to-clipboard and "Open terminal & run" — the same flow macOS/Linux already had, just with the right command per platform.
  - **"Open terminal & run"** sends the PowerShell installer on Windows and the `curl | bash` installer elsewhere. The CLI locator (`grok.cmd`/`grok.exe`) and headless terminal manager (`shell:true`) already worked cross-platform.
- **README + CLAUDE.md** updated: platforms now read "macOS, Linux, and Windows"; install steps show both the bash and PowerShell one-liners; build-from-source and uninstall lines note the `scripts\*.ps1` equivalents.

### Webview UI

Surfaced by the first native-Windows smoke test (against `grok` 0.2.3):

- **Session-history popover now hides.** `.history-popover` set `display:flex`, which beat the UA `[hidden]{display:none}` rule (author styles win), so the dropdown rendered as an empty box on startup and `hidden = true` could never dismiss it. A `.toolbar-popover[hidden] { display:none }` rule restores correct hide behavior — the popover now closes on select, click-outside, and new-session.
- **Whole history row is clickable.** Resume was wired only to the name label even though the row showed a pointer cursor; the handler moved to the row, so clicking anywhere on it (name, meta line, or padding) resumes. Rename/delete buttons keep their own `stopPropagation`.
- **Reasoning traces are expandable again.** The "Thinking…/Thought for *N*s" line is once more a collapsible header — click it to reveal the full trace (collapsed by default, rAF-coalesced while streaming). This reverses the 1.0.2 change that discarded the trace at the render layer.
- **Decluttered welcome screen.** Removed the static tips list (Enter to send / slash commands / file chips) from the empty-session screen.
- **Restored user prompts when loading a session.** `session/load` replays history as session updates, but `user_message_chunk` had no route, so replayed user prompts fell through to the ignored generic-update branch and vanished — loaded sessions showed only the agent's half of the conversation. The chunk is now routed and rendered into a user bubble, with the in-flight agent turn committed at each user boundary. Replayed reasoning headers read "Thought" (no elapsed time, since the original timing isn't in the replay stream); live turns keep "Thought for *N*s".
- **Inline diffs render as diffs.** Fenced ` ```diff ` blocks now color added lines green and removed lines red using VS Code's own `diffEditor` *line* backgrounds (so they match the editor's diff view), dim hunk/metadata lines, and wrap long lines instead of forcing horizontal scroll. Copy still yields plain diff text (the handler reads `innerText`, since each row is now a block-level span).
- **Copy-code button no longer fights the text.** It fades to 0.95 opacity on code-block hover and full opacity on button hover, so its background stays solid instead of blending into the first line of code.

### Mode picker

- **Agent-mode description corrected.** As of `grok` 0.2.3, Agent mode acts directly and only prompts for changes it judges sensitive; the picker no longer claims it "asks for approval before making each change." Matched in the README modes table.
- **Plan-mode note de-emphasized.** The "Reject / Abandon not yet supported" note under disabled Plan mode is now muted gray (`descriptionForeground`) instead of warning yellow — it's an explanation, not an alert.

### Verified (no change)

- **Plan mode stays disabled.** Re-tested the `x.ai/exit_plan_mode` rejection path live against `grok` 0.2.3 over ACP: rejecting a plan with a JSON-RPC error still let the agent exit plan mode and execute the whole plan (it created the target file anyway). The CLI bug from the 0.1.x baseline is unchanged, so the Plan UI remains off.

## 1.0.3 — 2026-05-19

### Tool calls

- **In-progress group header** now shows only the current action in present-progressive form with three animated dots — *Reading CLAUDE.md*, *Listing root folder*, *Running command*, *Searching web*, *Editing chat.js*. Previous behavior accumulated `"X, Y +N"` as new calls streamed in.
- **Completed multi-call summaries** are now categorical instead of listing the first two calls: *Explored N items, searched web, ran N commands*. Reads and directory listings roll into "explored"; web search/fetch into "searched web" (no number); everything else into "ran N commands".
- **Chevron moved to the right** of the label and only appears on hover; rotates 90° when expanded.
- **Friendlier detail labels** — `web_search` → *Web search*, `List .` → *List root folder*.

### Markdown rendering

- **Tighter heading and list spacing.** Headings and lists no longer get a phantom `<br><br>` stacked on top of their own CSS margin when preceded by a blank line. Block elements rely on their margins; only paragraph-to-paragraph transitions emit a `<br><br>`.

### Message layout

- **User bubble min-width 40%.** Short prompts no longer collapse to a text-width sliver against the right edge.
- **Show more / Show less hover** flips to a full-contrast inverted pair (`foreground` on `editor-background`) instead of the semi-transparent secondary-button hover. Reads as a solid pill.

### Performance

- **Streaming rAF-coalesced.** `agent_message_chunk` and `agent_thought_chunk` no longer trigger a full markdown re-render per chunk. Updates batch into one paint per animation frame, with a synchronous flush on `promptComplete` so the final chunks always land. Long responses no longer jank.

### Cleanup

- **Removed dead `grok.defaultPermissionMode` setting** that was declared in `package.json` but never read by any code.
- **`activationEvents` dropped** — modern VS Code auto-generates activation from the view contribution, so the explicit entry is redundant (linter-flagged).

### Docs

- **README restructured** for a dev-reading audience. New top-level sections: *Why an extension, not the CLI?*, *Key concepts* (where state lives, modes, chips, permission cards), *Architecture* (diagram + session lifecycle + module map + design choices), *Development*. Slash-command tables moved to `docs/SLASH-COMMANDS.md`. Marketplace install promoted; stale 1.0.1 VSIX path removed.
- **package.json `description`** rewritten to lead with the "thin ACP client" framing instead of a feature laundry list. Added keywords: `agent-client-protocol`, `acp-client`, `xai-grok`.

### Fixes

- **Shell-set `XAI_API_KEY` now works.** Previously the alias to `GROK_CODE_XAI_API_KEY` (which the CLI actually reads) only fired for keys loaded from a workspace `.env`. Keys in the user's shell environment are now mapped too, matching what the README documents.
- **Broader auth-error detection.** The auth-required onboarding panel now triggers on 401/403/`forbidden`/`api_key`/`credential` errors as well as anything containing `auth`. Reduces the chance of users seeing a generic "Failed to start Grok" toast when the real cause is missing or invalid credentials.

### Onboarding

- **Windows shows an honest "not supported" panel.** Native Windows users no longer get the macOS/Linux `curl | bash` install command (which can't run in cmd/PowerShell). They get a clear note pointing to the README's WSL workaround.
- **"SuperGrok Heavy" labeling.** The auth panel now names the *Heavy* tier explicitly (which is what carries the Grok Build entitlement) instead of the ambiguous "SuperGrok subscription".

### Distribution

- **Removed precompiled `.vsix` files** from `releases/`. They were drifting from `main` and the README's quick-install line pointed at the stale 1.0.1 build (which lacked the new onboarding UI). The marketplace listing is the canonical install path; build-from-source remains supported for development.

---

## 1.0.2 — 2026-05-19

### Markdown rendering

- **Header hierarchy** — H1 / H2 / H3 now scale visibly above body text (1.4em / 1.25em / 1.1em). Previously every heading rendered at body size, just bold.
- **Body rhythm** — agent message bodies use `line-height: 1.55` for easier scanning; first-child headings drop their top margin to avoid awkward leading gaps.
- **Nested bullet markers** — disc → circle → square at three depths (was disc → circle only).
- **GFM tables** — pipe tables with `|---|---|` separator rows now render as bordered tables with bold tinted header rows and per-column alignment (`:---`, `:---:`, `---:`). Wrapped in an `overflow-x: auto` container so wide tables get a horizontal scrollbar instead of breaking layout.

### Code blocks

- **Copy code button** — fenced code blocks now show a hover-revealed "Copy code" button in the top-right corner. Click writes the code (raw text, no formatting) to the clipboard and flashes a checkmark for 1.5 s.

### Message layout

- **User messages as bubbles** — right-aligned, capped at 80 % width, no border, lighter `editorWidget-background` tint. Inline `YOU` / `GROK` role labels removed; position alone signals sender.
- **Per-message actions** — every user and agent message shows a hover-revealed action row at the bottom: timestamp (`6:47 AM`) and a copy-message button that copies the raw markdown.
- **Show more / Show less** — restyled to match the secondary-button family (proper padding, button background). Hover-reveal behavior unchanged.

### Thinking traces

- **Reasoning hidden by design** — the "Thinking..." indicator stays as a single line at standard text size; on completion it flips to "Thought for *N*s". The actual trace text is discarded at the webview rendering layer (never enters the DOM) instead of being collapsed behind a chevron — there's no expansion affordance.

### Onboarding

- **In-sidebar onboarding** — the missing-CLI and authentication-required errors no longer pop modal VS Code dialogs. The welcome panel itself swaps to an onboarding state:
  - **Missing CLI** — shows the install command (`curl -fsSL https://x.ai/cli/install.sh | bash`) with copy-to-clipboard and an "Open terminal & run" button, plus a "Re-check connection" button.
  - **Auth required** — explains the two paths: SuperGrok subscription (run `grok /login` in a terminal) or API key from [console.x.ai](https://console.x.ai) with `XAI_API_KEY` in a workspace `.env`. Same "Re-check connection" hand-off.
  - All onboarding is deterministic — no AI calls happen before the CLI is reachable.
- **Welcome on every new session** — clicking the new-session button now restores the welcome panel (logo, byline, version, tips) instead of leaving an empty pane. Previously the welcome only appeared on first activation.

### Docs

- README now points to [console.x.ai](https://console.x.ai) as the place to obtain an API key, alongside the existing `grok /login` flow.

---

## 1.0.0 — 2026-05-18

### UI / UX

- **Mode labels** — mode button now shows "Agent mode" / "Plan mode" (YOLO unchanged) in both the button and the picker. The button collapses to icon-only when the sidebar is narrow.
- **Context donut** — label changed from a percentage to `usedK/maxK` format (e.g. `20K/200K`) so the scale adapts to the model's context window. Tooltip shows exact token counts.
- **Settings gear — Model and Effort** — added "Model and Effort" section header above the model+effort row; removed the sparkle icon from the model name button; model name font now matches the rest of the popover (13 px); fixed double-border between the model row and the Session section.
- **Effort dots** — increased dot size (10 px → 14 px); each dot now shows a descriptive tooltip ("Low — fast, lightweight reasoning", etc.).
- **Summarize & Restart** — when changing reasoning effort with an active conversation, a VS Code dialog offers *Summarize & Restart* or *Just Restart*. The summarize path sends a silent summary request to the current session, starts a fresh session with the new effort level, injects the summary as context (suppressed from the chat UI), and shows a "Context from previous session applied" banner. The original Grok summary response is hidden — only the banner appears.

### Fixes

- Resolved race condition where changing effort (or clicking New Session) showed "Grok exited (code 143)" errors from the previous session's process being disposed. Each session now carries a generation counter; `exit` events and errors from replaced sessions are suppressed.
- `--reasoning-effort` flag was never actually passed to the spawned process. Fixed — the flag is now read from `grok.defaultEffort` and forwarded on every session start.

---

## 0.9.0 — 2026-05-18

### UI / UX

- **Bottom toolbar** — removed the top bar entirely; model, mode, gear, and new-session controls now live in a responsive row at the bottom of the composer, next to the send button. The row shrinks gracefully to icon-only when the sidebar is narrow (labels disappear, icons stay).
- **Mode selector redesign** — each mode now has a distinct icon and a one-line description (Claude Code-style popover). Agent uses a shield icon, Plan uses a list-tree icon, YOLO uses a lightning bolt.
- **Collapsible user messages** — messages taller than ~3 lines collapse automatically with a gradient fade. "Show more" appears on hover; "Show less" collapses back.
- **Tool call display** — single tool calls render as a flat row with a human-readable label ("Read sidebar.ts", "Edit package.json", "Run npm test"). Multiple calls from one agent step collapse into a grouped header ("Read, Edit +2") that expands on click.
- **Welcome screen** — xAI Grok mark logo (white), "Grok Build" title, "by Pawel Huryn (The Product Compass)" byline.

### Features

- **Reasoning effort** — configurable from the gear popover (CLI default | Low | Medium | High | XHigh | Max). Changing effort restarts the session so the new flag takes effect. Also exposed as `grok.defaultEffort` VS Code setting.
- **YOLO mode** — auto-approves all permission requests in the extension without any CLI restart. Session and memory are fully preserved; switching back to Agent or Plan mode re-enables approval cards immediately.
- **Gear / settings popover** — single gear icon opens a panel with three sections:
  - *Session*: Reasoning Effort picker, Compact conversation shortcut
  - *Config*: Open global config (`~/.grok/config.toml`), Open project config (`.grok/config.toml`), List MCP servers in a terminal
  - *Debug*: Show extension logs
- **MCP server support** — the extension passes `mcpServers: []` in `session/new` (the CLI rejects the call without this field), and the CLI loads its own MCP configuration from `~/.grok/config.toml` / `.grok/config.toml` alongside that empty list. Configure servers via `grok mcp add` or by editing the config files directly.

### Fixes

- Removed `--reasoning-effort high` default that was causing 403 errors on free/SuperGrok accounts (the flag is unsupported in stdio mode on some subscription tiers).
- Removed stale `hint` element references that caused silent JS errors in the webview.
- Popovers now position themselves above their trigger button (correct for a bottom toolbar) and clamp to stay within the panel width.

---

## 0.1.0 — unreleased

Initial preview. ACP client for `grok agent stdio`.

### Implemented

- Sidebar chat webview driven by `grok agent stdio` over ACP
- Streaming agent messages + separate thinking trace (collapsible, shows elapsed time)
- Permission-request cards with diff-editor preview (allow always / allow once / reject)
- Plan-mode toggle (`session/set_mode`) + plan-approval cards (`x.ai/exit_plan_mode`)
- Model picker (live `session/set_model`)
- Slash-command autocomplete sourced from `available_commands_update`
- Context-usage donut from prompt result `_meta.totalTokens`
- File chips with hide-toggle, Explorer drag-and-drop (Shift = embed inline)
- Right-click "Grok: Send File / Selection" in Explorer + editor
- `Ctrl+;` opens sidebar; `Alt+G` inserts @-mention for active file
- Required server→client handlers: `fs/read_text_file`, `fs/write_text_file`, `terminal/{create,output,wait_for_exit,kill,release}`
