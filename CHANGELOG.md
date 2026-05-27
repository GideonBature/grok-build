# Changelog

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
