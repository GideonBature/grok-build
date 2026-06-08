# CLAUDE.md — grok-build-vscode

VS Code sidebar extension for **xAI's Grok Build CLI**, driven by `grok agent stdio` over the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). Thin client — all session state, MCP servers, subagents, memory, and plan-mode bookkeeping live in the CLI.

## Status

v1.4.0 (unreleased feature branch `v1.4.0`; 1.2.3 is the current published Marketplace release). 363 tests passing, all grok-free (CI never spawns the binary; grok-dependent probes live separately in `research/*.cjs`). **v1.4.0** adds three CLI surfaces, all wire-confirmed live against `grok` 0.2.33: **image + video generation** render inline (`/imagine` → `image_gen`, `/imagine-video` → `image_to_video`; grok writes the file to the session dir and reports its path as JSON-in-text on the completed tool result — *not* an ACP image block — so the host parses the path, classifies image-vs-video by extension, and inlines it as a `data:` URI; see `research/image-generation.md`), a **subagent card** (grok's `spawn_subagent`/`subagent_type` delegations get a distinct *Subagent: \<type\>* card instead of vanishing into the tool group; `research/subagents.md`), and a **Sign out** action (`grok logout`, command + gear menu, issue #13). Smoke-tested end-to-end against `grok` v0.1.211 on Linux and Windows-via-WSL, and against the **native Windows build** `grok` 0.2.3 (`irm https://x.ai/cli/install.ps1 | iex`) — `cli-locator` resolves `grok.cmd`/`grok.exe` and `terminal-manager` uses `shell:true`. The native-Windows smoke test surfaced a handful of webview regressions (history popover that never closed, session rows only clickable on the label, reasoning traces no longer expandable, a cluttered welcome screen), all fixed in earlier builds. Plan mode is **enabled** and enforced client-side (see `research/plan-mode.md` § Resolution). **Voice input** (v1.3.0) adds a composer mic button that records via an `ffmpeg` child process in the extension host and transcribes through xAI's *separate* Speech-to-Text API — deliberately outside ACP, because the CLI advertises `promptCapabilities.audio:false` and webviews can't reach the mic (see `research/voice-input.md`). Transcription is **live/streaming by default** (PCM → `wss://api.x.ai/v1/stt`, partial events accumulated by `start`; `grok.voiceStreaming:false` falls back to the batch REST endpoint). Listening is **continuous + hands-free**: saying **"grok send"** submits and restarts a fresh stream so the mic keeps listening (each message = one clean utterance), and messages dictated while Grok is responding are queued and flushed on `agentEnd`. The phrase is sent as a `keyterm` bias so STT spells it right, and the trailing phrase is highlighted in the composer via a backdrop overlay (pure `trailingSendPhrase` in `webview-helpers.js`). This adds the extension's first runtime dep, `ws` (bundled into the vsix — `package`/`publish` no longer pass `--no-dependencies`, and `.vscodeignore` un-ignores `node_modules/ws`).

## Module map

| File | Role |
|---|---|
| `src/extension.ts` | Entry point — registers commands, keybindings, output channel |
| `src/sidebar.ts` | Webview provider, message routing, fs handlers, diff editor preview, `logout`, generated-media inlining (`postGeneratedMedia`) |
| `src/acp.ts` | ACP client — spawns CLI, manages session lifecycle, emits events (incl. `mediaContent` from `emitToolMedia`) |
| `src/acp-dispatch.ts` | Pure protocol helpers — line parsing, update routing, response builders, generated-media extraction (`isMediaGenToolCall`/`extractGeneratedMediaPaths`) |
| `src/cli-locator.ts` | Locate `grok` binary (configured path → `~/.grok/bin/grok` → PATH); cross-platform |
| `src/terminal-manager.ts` | Headless shell children for the agent's `terminal/*` ACP calls; cross-platform via `shell:true` |
| `src/chips.ts` | File-chip CRUD (pure) |
| `src/prompt-builder.ts` | Chip → prompt-string with `@path` refs and fenced code blocks |
| `src/slash-filter.ts` | Slash-command autocomplete filter |
| `src/plan-gate.ts` | Plan-mode policy (pure) — workspace-write containment, read-only command allowlist, permission/plan-file classification |
| `src/plan-restore.ts` | Plan persist + restore decision (pure) — appendPlanEntry + decideRestoreState |
| `src/sessions.ts` | Disk-driven session listing/delete + customName overrides (pure) |
| `src/file-ref.ts` | Open-file `path#L<n>` ref parsing + large-file inline-read guard (pure) |
| `src/plan-review.ts` | Plan-snapshot Markdown filename generation for the "open plan as editor tab" action (pure) |
| `src/voice.ts` | Voice-input pure helpers — STT request/response/error, per-platform ffmpeg args, DirectShow device parsing, API-key resolution |
| `src/voice-recorder.ts` | Batch capture: `VoiceRecorder` (spawns `ffmpeg` → WAV, graceful `q`-stop) + `transcribeAudio` (POST to `api.x.ai/v1/stt`) + `resolveWindowsAudioDevice` |
| `src/voice-streamer.ts` | Live capture: `VoiceStreamer` (ffmpeg PCM → `ws` → `wss://api.x.ai/v1/stt`, emits partial/final transcript events) |
| `media/chat.{js,css}` | Webview UI |
| `media/webview-helpers.js` | Pure webview helpers (file-ref detection, relative-time format, mic-button state machine, trailing send-phrase highlight, subagent classifier `isSubagentToolCall`/`subagentLabel`); shared between webview and tests |
| `scripts/install.{ps1,sh}` | Auto-detect VS Code CLI, build .vsix, install |
| `scripts/uninstall.{ps1,sh}` | Uninstall `PawelHuryn.grok-vscode-phuryn` |

Pure modules (`acp-dispatch`, `chips`, `prompt-builder`, `slash-filter`, `cli-locator`, `sessions`, `plan-gate`, `plan-restore`, `file-ref`, `plan-review`, `voice`, `webview-helpers`) were split out specifically so protocol behavior can be unit-tested without spawning processes. The impure `voice-recorder`/`voice-streamer` (ffmpeg spawn + STT fetch/WebSocket) are smoke-tested manually via the `research/voice-*.cjs` probes (`voice-stt-probe`, `voice-e2e-verify`, `voice-stream-probe`, `voice-stream-verify`, `voice-cost-probe`).

## Build + test

```bash
npm install
npm test         # 363 tests, ~1.5s, vitest — all grok-free (incl. happy-dom DOM tests + fake-CLI ACP integration tests)
npm run package  # → grok-vscode-phuryn-1.4.0.vsix
```

## Install

- **macOS / Linux / WSL Ubuntu:** `./scripts/install.sh`
- **Windows (native):** `pwsh scripts\install.ps1` — runs the native Windows `grok` CLI directly
- **WSL Ubuntu (alternative):** Remote-WSL → install in the WSL-side VS Code server

See `README.md § Install` for the full per-platform matrix.

## ACP surfaces implemented

- `initialize` → `session/new` / `session/load` → `session/set_model` → `session/prompt` lifecycle
- **Model switching is agent-aware.** Models belong to *agent types* — `grok-build`/`grok-build-plan` vs the `cursor` agent that owns the Composer models. The CLI binds the agent at spawn and locks it after the first turn (incl. our primer), so a live `session/set_model` only works within the same agent; a cross-agent switch errors `MODEL_SWITCH_INCOMPATIBLE_AGENT` ("Start a new session"). `switchModel` in `sidebar.ts` tries the live switch, and on that error (detected by the pure `isIncompatibleAgentError` in `acp-dispatch.ts`) persists the pick to `grok.defaultModel` and restarts — `newSession` re-applies the model *before* the primer runs, while the agent is still rebindable. No history → transparent restart; with history → the same Summarize/Just-Restart prompt as an effort change (shared `pickRestartMode`/`restartSession` helpers). The toolbar model label resolves IDs to user-facing names via the pure `modelDisplayName` helper.
- Streaming `agent_message_chunk` + `agent_thought_chunk`
- Sessions: list/resume via `session/load` (grok stores them at `~/.grok/sessions/<urlencoded-cwd>/<id>/`); rename/delete metadata in `context.globalState["grok.sessionMeta"]`. We never edit grok's own session files.
- Handlers (mandatory or the agent crashes): `fs/read_text_file`, `fs/write_text_file`, `terminal/{create,output,wait_for_exit,kill,release}`
- `session/request_permission` → chat card with `allow-always` / `allow-once` / `reject-once`, diff editor preview for `kind:"edit"`
- `x.ai/ask_user_question` → inline question card (the tool was fully broken before — #12). The catch-all ACK'd unknown server requests with `{}`, which grok's deserializer rejects with "missing field `outcome`". Now handled: the card renders each question's options (single question + single-select resolves on one click; otherwise pick-then-Submit; Skip → cancel) and replies `{ outcome: "accepted", answers, annotations }` (or `cancelled`). `answers` is keyed by question text → chosen label. On answer the card collapses to the question + a green `✓ <choice>` (so it's clear grok received it). On session resume the question replays as a `tool_call` (questions in `rawInput`) + completed `tool_call_update` (answer text); chat.js suppresses the generic tool chip for `ask_user_question` and rebuilds a read-only "You answered" card from that replay — no separate persistence. The full binary-derived wire format is in `research/ask-user-question.md`. Response builders are pure (`makeQuestionResponse` in `acp-dispatch.ts`); the answer map is built by the pure `buildQuestionAnswers` in `webview-helpers.js`.
- `session/set_mode` wired; the picker exposes **Agent**, **Plan**, and **YOLO**. The CLI's non-plan mode id is `"default"` (not `"agent"`), captured as `ACT_MODE_ID` in `sidebar.ts`.
- **Plan mode is enforced client-side** (mirror of YOLO). The CLI's `x.ai/exit_plan_mode` still treats any client response — result *or* error — as approval (re-verified broken in 0.2.3), so we don't rely on it. Instead `src/plan-gate.ts` gates the two *mandatory* server→client choke points: `fs/write_text_file` (block writes resolving inside the workspace cwd) and `terminal/create` (block anything not on the read-only allowlist). grok's own `~/.grok/sessions/<…>/plan.md` write lands *outside* the workspace and is allowed (and snooped to recover the plan text — `exit_plan_mode` arrives with `planContent: null`). Approve → drop the gate + send an "implement it now" follow-up prompt; Keep planning → gate stays up. Entering plan mode *any* way (incl. agent-initiated `current_mode_update: plan`) raises the gate; it's lowered only by explicit user action, never auto-lowered by CLI mode flapping. For the full pedagogical course with diagrams and hands-on guidance, see `research/understanding-plan-mode.md`.
- `grok.defaultEffort` → forwarded as `--reasoning-effort <value>` **before** the `stdio` subcommand (it's an agent-level flag; after `stdio` the CLI errors "unexpected argument"). Offered values mirror grok's accepted set (`none|minimal|low|medium|high|xhigh`); the bogus `max` we used to expose made grok exit code 2 (#3/#4). Args are built by the pure `buildGrokAgentArgs()`; changing effort restarts the session (`setEffort` in `sidebar.ts`).
- `available_commands_update` → slash autocomplete
- `current_mode_update` → bottom-toolbar mode button (the top bar was removed in 0.9.0)
- `_meta.totalTokens` → context donut
- **Generated media (v1.4.0).** `/imagine` (`image_gen`) and `/imagine-video` (`image_to_video`) are subscription-only and do **not** return ACP image blocks — grok writes the file into its session dir (`images/*.jpg`, `videos/*.mp4`) and reports the path as a JSON string in the completed tool result's `text` content. The pure `isMediaGenToolCall`/`extractGeneratedMediaPaths` (in `acp-dispatch.ts`) detect the tool and parse the path (image-vs-video by extension); `acp.ts` tracks the tool-call id (the *completed* update has a null title) and emits `mediaContent`; `sidebar.ts` `postGeneratedMedia` reads the file and inlines it as a `data:` URI (`media-src data:` added to the CSP for video). On resume grok replays it as a single collapsed `tool_call` carrying title + path together, so the same path fires. Wire format + probes in `research/image-generation.md` (`research/imagine-probe.cjs`, `research/video-probe.cjs`).
- **Subagent card (v1.4.0).** grok's parallel subagents arrive as `spawn_subagent` tool calls with a `subagent_type` (`general-purpose`/`explore`/`plan`/custom). The pure `isSubagentToolCall`/`subagentLabel` (in `webview-helpers.js`) give them a distinct *Subagent: \<type\>* card. Confirmed from the CLI's bundled `~/.grok/docs/user-guide/16-subagents.md`; see `research/subagents.md`. (A live `spawn_subagent` payload + the nested-inspector pass are still TODO.)
- **Logout (v1.4.0, #13).** `grok.logout` command + gear-menu *Sign out* → `sidebar.logout()` runs `grok logout`, disposes the session, shows the auth-required onboarding.

## Known limits

- Subagent delegations get a labeled card, but their child tool calls aren't nested under it (no full inspector yet)
- Generated media is inlined as base64 (`data:` URI); a large video is a few MB of base64 — could later use `asWebviewUri`
- No worktree UI
- Diff editor is preview-only; the write happens via `fs/write_text_file` after approval
- View defaults to left activity bar; user must drag to secondary side bar manually if desired

## Cross-platform notes

- `terminal-manager.ts` uses `spawn(cmd, { shell: true })` so Node picks `cmd.exe` on Windows, `/bin/sh` elsewhere. Don't hardcode shell paths.
- `cli-locator.ts` reads `HOME` / `USERPROFILE` env vars first (testability), falls back to `os.homedir()`. Uses `where` on Windows, `command -v` elsewhere. Checks `.cmd`/`.exe`/`.bat` extensions on Windows.
- Tests use `node -e "..."` everywhere, so commands are deterministic across platforms — don't add `pwd`, `awk`, `sleep`, `true`, etc.

## What's next (priority order)

1. `@vscode/test-electron` integration suite (scoped in `TESTS.md § v0.2`)
2. Status-bar indicator (current model + effort + token usage)
3. Subagent **nested inspector** — the v1.4.0 card labels delegations; the next step nests each subagent's child tool calls under it (needs a captured live `spawn_subagent` payload)
4. Worktree UI (`Grok: New Worktree Session`)
5. Optional: auto-move view to secondary side bar on first activation (`workbench.action.moveView`)

## Publishing

**Release procedure — ALWAYS tag + create a GitHub Release on a release push to `main`** (standing convention; mirrors the `v1.0.0…` tag history + GitHub Releases):

1. Bump `version` in `package.json` (user-initiated) and add the dated section to `changelog.md`.
2. `npm test` (363-test floor, all green) + `tsc -p . --noEmit` clean.
3. Commit + push to `main` (direct-to-main, no feature branches).
4. **Annotated git tag** `vX.Y.Z` at the release commit → `git tag -a vX.Y.Z -m "Release vX.Y.Z"` → `git push origin vX.Y.Z`.
5. **GitHub Release** for that tag → `gh release create vX.Y.Z --title "Release vX.Y.Z" --notes-file <notes>` (notes = the new changelog section(s); include any earlier version that was bumped but never released).
6. **Marketplace publish is separate and explicit** — only `npm run publish` (vsce) when the user asks. The `PawelHuryn` publisher is registered + authenticated locally; publishing ≠ tagging.

Don't skip the tag/release on a release push. (A pure mid-dev version bump that isn't a release — e.g. the unreleased v1.3.0 voice iteration — is the only exception.)

## Repo conventions

- Direct-to-`main`, no feature branches
- Commits explain the *why*, not the *what*
- Don't introduce abstractions speculatively
- Don't add comments that explain what well-named code already says
- 363 tests is the floor — every PR should keep that green. All tests are grok-free (no binary spawn); grok-dependent probes live in `research/*.cjs` and are run manually, never by `npm test` or CI
- **Version bumps are user-initiated.** Iterate at the current version (rebuild the same vsix and reinstall locally) until the user says to bump and publish. Don't bump `package.json` on your own.
