# Test Design

Two layers:

1. **Grok-free automated tests** (Vitest) — pure-logic unit tests plus happy-dom DOM tests that drive the real `media/chat.js`, plus a fast TerminalManager suite that spawns real `/bin/sh` children. **363 tests, all passing in ~1.5s.** The per-file counts below predate several feature releases (voice, ask-question, plan-mode, v1.4.0 media/subagent/logout) and are indicative, not exact — `npm test` is the source of truth. **None of them spawn the `grok` binary**, so the whole suite runs in CI on a clean Ubuntu box (`.github/workflows/ci.yml` runs `npm ci && npm test && npm run package` and never installs grok).
2. **VS Code integration tests** (deferred to v0.2 with `@vscode/test-electron`) — covers command registration, view lifecycle, settings reads, and the diff editor. Deferred because they require a headed VS Code, are slow, and the modules already cover the bug-prone surface.

Separately, **grok-dependent probes** live as standalone scripts under `research/*.cjs`. They exercise the real CLI's ACP behavior (e.g. confirming `exit_plan_mode` treats any client reply as approval) and are run **manually** — Vitest's `include` glob is `test/**/*.test.ts`, so it never collects them. They're non-destructive (ACK writes without touching disk and run in a temp cwd) and require a `grok` binary on PATH; CI doesn't run them.

The goal of layer (1) is to make the protocol surface and UI logic regression-proof. Anything that goes wrong against the real CLI in v0.2 should fall into a documented gap (network, auth, model entitlement, terminal handlers) — not into our protocol or webview code.

---

## What we test

### `test/acp-dispatch.test.ts` — protocol primitives (48 tests)

Includes v1.4.0 generated-media extraction: `isMediaGenToolCall` / `extractGeneratedMediaPaths` (image_gen + image_to_video, image-vs-video classification, the collapsed-resume shape) and the ACP-standard `extractImageContent`/`collectToolImages` fallback.


The wire format is the highest-value test surface: ACP changes break everything else if we miss them.

- **`parseAcpLine`**
  - Returns `null` for empty / whitespace-only input
  - Flags non-JSON lines as `{kind:"non-json"}` so the host can log them
  - Recognizes responses by `id` + missing `method`
  - Carries `error` through on error responses
  - Recognizes `session/update` notifications by method name
  - Recognizes server→client requests with both `method` and `id`
- **`routeSessionUpdate`** — every documented update tag has an explicit route
  - `agent_message_chunk` → `{event:"messageChunk", text}`
  - `agent_thought_chunk` → `{event:"thoughtChunk", text}`
  - `tool_call` and `tool_call_update`
  - `current_mode_update` → carries `modeId` (drives the top-bar pill)
  - `available_commands_update` → carries `commands`
  - Unknown tags fall through to `{event:"update"}` (forward-compat)
  - Missing `content.text` defaults to empty string (defensive)
- **`extractPromptMeta`** — pulls token counts out of `_meta` for the donut and handles missing `_meta` gracefully
- **Response builders** — `makePermissionResponse`, `makeExitPlanResponse`, `makeAckResponse`, `makeRequest`. These encode the exact shapes the agent expects. Bugs here are silent.

### `test/chips.test.ts` — file-chip CRUD (6 tests)

- Implicit chips have stable ids (so the active-editor watcher can replace them)
- Explicit chips have unique ids even when created in the same millisecond (regression: original `Date.now()` impl collided)
- `removeChip` / `toggleChip` are pure (don't mutate inputs)
- `clearImplicitChips` leaves explicit chips intact

### `test/prompt-builder.test.ts` — final prompt assembly (7 tests)

- Bare text passes through
- File-only chip → `@relPath` reference
- Selection chip → fenced code block with the right language tag and line range
- Hidden chips are skipped
- Falls back to `@ref` when the file can't be read
- Multiple chips concatenate cleanly
- Files without extensions get an empty fence language

### `test/slash-filter.test.ts` — slash autocomplete (12 tests)

- `getSlashQuery` only activates after `/` at line-start or newline (no false positives on `path/foo/bar`)
- Empty query returns the full command list
- Prefix filter is case-insensitive
- `applySlashPick` replaces only the slash token, preserves trailing text, returns the new caret position

### `test/terminal-manager.test.ts` — terminal handler (10 tests)

These actually spawn real `/bin/sh` children — fast enough to keep in the unit suite.

- Captures stdout from a quick command + exit code
- Captures stderr and nonzero exit
- Honors `outputByteLimit` and sets the `truncated` flag
- Returns `exitStatus: null` while still running
- Injects env from ACP-style `[{name, value}]` pairs
- Honors `cwd`
- `waitForExit` resolves on repeated calls after exit
- Throws on unknown terminalId
- `kill` / `release` on missing id is a no-op
- `disposeAll` kills outstanding terminals

### `test/cli-locator.test.ts` — CLI discovery (4 tests)

- Configured path wins if it exists
- Returns `undefined` when configured path is missing
- Falls back to PATH lookup; `~/.grok/bin/grok` is also accepted when present
- Returns `undefined` when nothing is found

### `test/sessions.test.ts` — session listing & naming (15 tests)

- Lists sessions from grok's on-disk layout (`~/.grok/sessions/<urlencoded-cwd>/<id>/`) for the current cwd only
- Display name falls back to the first user message, then to the id, when no customName override exists
- customName overrides (stored in VS Code `globalState`) win over the disk-derived name
- Sorts by most-recently-updated; tolerates malformed/missing session files without throwing
- Delete removes the right entry and leaves others intact

### `test/plan-gate.test.ts` — plan-mode policy (32 tests)

The pure heart of client-side plan enforcement. No spawn, no fs — just the classification logic the two choke points call.

- **Workspace-write containment** — a write path that resolves *inside* the workspace cwd is blocked; grok's own `~/.grok/sessions/<…>/plan.md` (outside the workspace) is allowed; relative paths, `..` traversal, and sym_link-style escapes are normalized before the containment check
- **Read-only command allowlist** — `isReadOnlyCommand` passes only when *every* `|`-separated stage is on the read-only head list (`cat`, `ls`, `grep`, `head`, PowerShell `get-childitem`/`gci`/`get-content`/`select-object`/`test-path`/…); a single mutating stage fails the whole pipeline
- **Shell-metachar rejection** — redirection (`>`), chaining (`;`, `&&`, `||`), background (`&`), command substitution (`$(…)`, backticks), process substitution (`<(…)`), and script-block braces (`{}`) are rejected outright, so a read-only head can't smuggle a side effect
- **Permission / plan-file classification** — recognizes grok's plan-file write so it can be allowed-and-snooped rather than blocked

### `test/webview-helpers.test.ts` — pure webview helpers (45 tests)

Includes the v1.4.0 subagent classifier `isSubagentToolCall` / `subagentLabel` (the confirmed `spawn_subagent` + `subagent_type` shape, plus name/kind/rawInput fallbacks).


Shared between the shipped webview and the tests (`media/webview-helpers.js`).

- File-ref detection: recognizes `@path` mentions and bare path-looking tokens, ignores prose
- Relative-time formatting: "just now" / "Nm" / "Nh" / "Nd" buckets, singular/plural, far-future and far-past edges

### `test/plan-card.dom.test.ts` — plan card in a real DOM (10 tests)

happy-dom test (see [Webview DOM tests](#webview-dom-tests) below). Drives the shipped `media/chat.js`, dispatches the messages `sidebar.ts` posts, clicks the rendered buttons, asserts on the `postMessage` payload that goes back to the host.

- Renders the card with plan body, feedback textarea, and three buttons: **Approve & implement** / **Reject** / **Cancel**
- "Reject" with empty feedback → `verdict:"rejected"` and **no** `comment` key; with text → trimmed `comment` included
- "Approve & implement" → `verdict:"approved"`, never a comment (even with textarea text)
- "Cancel" → `verdict:"abandoned"`, never a comment (even with textarea text)
- A click resolves the card, highlights the chosen button (`.chosen`), shows the verdict label, and disables both buttons + the textarea (no double-submit)
- `planNotice` / `planBlocked` (command + write variants) render a `.plan-notice` with the right text
- Read-only plan-history card renders with the persisted verdict label

### `test/acp.test.ts` — ACP client helpers (3 tests)

- **Request timer lifecycle** — a resolved `request()` clears its timeout (no leaked timer).
- **Spawn argv** — `buildGrokAgentArgs()` returns `["agent", "stdio"]` with no effort, and `["agent", "--reasoning-effort", <value>, "stdio"]` (flag before the subcommand) for a valid effort.

### `test/acp-integration.test.ts` — ACP wire layer + plan-mode gate (11 tests)

Spawns the fake `grok agent stdio` from `test/fixtures/fake-grok-acp.cjs` (a ~150-line ACP server encoding only what the protocol requires, not grok version quirks), and drives `src/acp.ts` AcpClient against it over real JSON-RPC stdio. Cross-platform: `.cmd` wrapper on Windows, `.sh` wrapper elsewhere; subprocess startup adds ~50–100ms per test (same order as terminal-manager).

- **Lifecycle** — spawn → initialize → session/new succeeds; a basic prompt round-trips with `_meta.totalTokens`.
- **Startup effort forwarding** — with a valid `effort` configured, the fake CLI (which exits 2 on any unexpected argv) accepts `agent --reasoning-effort <value> stdio` and the session starts, proving the forwarded arg shape.
- **Plan-snoop** — grok's plan.md write (outside the workspace) is allowed AND emits `planFileContent` with the snooped text; the host's `exitPlanRequest` event fires with that content; the file actually lands on disk.
- **Workspace-write gate** — with `planActive=true`, `fs/write_text_file` for a path inside the workspace is refused with PLAN_BLOCKED, emits `mutationBlocked`, no file lands.
- **Workspace-write gate (off)** — with `planActive=false`, the same write succeeds end-to-end.
- **Terminal-create gate (mutating)** — with `planActive=true`, `terminal/create` for `rm -rf` is refused; the host's terminal handler is never called.
- **Terminal-create gate (read-only)** — with `planActive=true`, `terminal/create` for `ls -la` is allowed and reaches the terminal handler.

### `test/plan-restore.test.ts` — plan persist + restore decision (15 tests)

Pure helpers extracted into [src/plan-restore.ts](src/plan-restore.ts) specifically for unit testing: no `vscode`, no fs, no ACP client to mock.

- **`appendPlanEntry`** — chronological append; creates a new list from `undefined`; doesn't mutate input; preserves plan text verbatim (regression: `lastPlanText` was being wiped before persist, so saved entries showed `"(empty plan)"`); tolerates legacy entries with no `afterUserMessage`
- **`decideRestoreState`** — given the saved log, returns whether to raise the gate and what mode to set on the CLI. Last verdict `rejected` → restore Plan mode; `approved`/`abandoned` → Agent mode; no log / undefined → Agent mode (legacy session, safe default)
- **End-to-end scenarios** — user rejects then closes VS Code → restore in Plan mode; rejects then approves → Agent mode; rejects then cancels → Agent mode (the regression where Cancel kept restoring into Plan mode); legacy session → Agent mode with no surprise gate

### `test/plan-history-restore.dom.test.ts` — plan-history restore rendering (15 tests)

happy-dom test driving the shipped webview through a `planHistoryQueue` + `session/load` replay sequence. This is the visual side of the state machine — what actually renders, in what order, after the host sends saved plans plus a stream of replayed messages.

- Empty queue → no plan-history cards
- Positioned plan (`afterUserMessage: N`) → interleaved at the right user-message boundary, not dumped at the bottom
- Plan positioned after the last replayed user message → flushed at end of replay
- Legacy plans without `afterUserMessage` → always flushed at end (back-compat with sessions saved before per-plan persistence)
- Multiple plans at distinct positions → each lands at its boundary
- Multiple plans at the *same* position → drain together before the next user message
- Live user message after restore → still drains queued plans inline (no replay required)
- Fresh session edge case (queue arrives without `historyReplay` toggle) → drained on the first live message
- `clearMessages` → queue + counter reset
- All three verdict buttons (Approve / Reject / Cancel) → produce matching status labels + `.chosen` highlight
- `agentReset` removes the in-flight agent bubble
- Subsequent `messageChunk` after `agentReset` creates a fresh bubble (the false-approval text doesn't leak through)

### `test/webview-ui.dom.test.ts` — webview regressions in a real DOM (10 tests)

happy-dom test locking in the native-Windows regressions this build fixed, so they can't silently come back:

- **History popover** — opens on the history button (and requests the session list), toggles closed on re-click, closes on an outside click but stays open on a click inside it
- **Session rows** — whole row resumes (clicking the meta area, not just the label, posts `resumeSession`); the delete and rename action buttons `stopPropagation` so they don't *also* resume
- **Mode picker** — offers Agent / Plan / YOLO, posts `setMode` with the chosen id, closes on select, toggles closed on re-click
- **Reasoning trace** — a thought chunk renders a collapsed thinking block whose header click toggles the body open/closed (chevron ▶/▼)

---

## Webview DOM tests

`test/plan-card.dom.test.ts` and `test/webview-ui.dom.test.ts` run the **real shipped** `media/chat.js` inside a [happy-dom](https://github.com/capricorn86/happy-dom) `Window`, via the shared `test/webview-harness.ts`. The trick: happy-dom doesn't execute inline `<script>` text synchronously, but `window.eval(src)` runs in the window's realm and shares its globals — so the harness `eval`s `webview-helpers.js` then `chat.js`, stubs `acquireVsCodeApi` to capture `postMessage` payloads, and dispatches `MessageEvent`s exactly as the extension host would. This tests the webview **logic** (event wiring, payload shapes, and show/hide state) without VS Code; it does **not** replace real GUI click-through, CSS, or the live `acquireVsCodeApi` bridge — those wait for the `@vscode/test-electron` suite (roadmap item #1).

---

## What we deliberately don't unit-test

- **`AcpClient.spawn` and child process I/O.** This is exercised by the manual probes under `research/*.cjs` (hit the real `grok` binary) and is what the v0.2 `@vscode/test-electron` integration tests will cover.
- **`sidebar.ts`** end-to-end. It's mostly glue between VS Code APIs and the modules above; the modules carry the logic. A regression-prone area here is the diff editor invocation — that's better tested with `@vscode/test-electron` than with mocks.
- **Real VS Code rendering & CSS.** The happy-dom tests cover webview logic, but pixel/layout regression on the cards is better caught by manual smoke + the future integration suite.

---

## Running

```bash
npm test            # one shot
npm run test:watch  # TDD loop
```

Tests run in <2s with no network, no `grok` binary, and no fixtures, so they're suitable for pre-commit hooks and CI.

---

## v0.2 test plan (deferred)

1. **`@vscode/test-electron` suite** — open the test workspace, activate the extension, assert the Grok view is registered, send a fake `permissionRequest` through the webview message channel, verify a permission card renders.
2. **AcpClient integration test** — use a fixture script that pretends to be `grok agent stdio` (reads JSON-RPC, emits canned responses). Tests the spawn → initialize → newSession → setModel path against fixture, not the real CLI.
3. **Webview snapshot test** — Playwright loads the webview HTML in isolation, sends representative messages, snapshots the DOM. Catches CSS/layout regressions.
4. **Permission round-trip** — fake permission request from a fixture, click card button, assert correct `respondPermission` JSON written to fixture's stdin.
