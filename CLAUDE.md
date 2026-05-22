# CLAUDE.md — grok-build-vscode

VS Code sidebar extension for **xAI's Grok Build CLI**, driven by `grok agent stdio` over the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). Thin client — all session state, MCP servers, subagents, memory, and plan-mode bookkeeping live in the CLI.

## Status

v1.0.3 (published on the VS Code Marketplace). 115 unit tests + 5 grok-CLI integration tests passing. Smoke-tested end-to-end against `grok` v0.1.211 on Linux and Windows-via-WSL.

## Module map

| File | Role |
|---|---|
| `src/extension.ts` | Entry point — registers commands, keybindings, output channel |
| `src/sidebar.ts` | Webview provider, message routing, fs handlers, diff editor preview |
| `src/acp.ts` | ACP client — spawns CLI, manages session lifecycle, emits events |
| `src/acp-dispatch.ts` | Pure protocol helpers — line parsing, update routing, response builders |
| `src/cli-locator.ts` | Locate `grok` binary (configured path → `~/.grok/bin/grok` → PATH); cross-platform |
| `src/terminal-manager.ts` | Headless shell children for the agent's `terminal/*` ACP calls; cross-platform via `shell:true` |
| `src/chips.ts` | File-chip CRUD (pure) |
| `src/prompt-builder.ts` | Chip → prompt-string with `@path` refs and fenced code blocks |
| `src/slash-filter.ts` | Slash-command autocomplete filter |
| `src/sessions.ts` | Disk-driven session listing/delete + customName overrides + auto-title (pure) |
| `src/file-ref.ts` | Parse `path#L10-L20` style file references (pure) |
| `media/chat.{js,css}` | Webview UI |
| `media/webview-helpers.js` | Pure webview helpers (file-ref detection, relative-time format); shared between webview and tests |
| `scripts/install.{ps1,sh}` | Auto-detect VS Code CLI, build .vsix, install |
| `scripts/uninstall.{ps1,sh}` | Uninstall `PawelHuryn.grok-vscode-phuryn` |

Pure modules (`acp-dispatch`, `chips`, `prompt-builder`, `slash-filter`, `cli-locator`, `sessions`, `file-ref`, `webview-helpers`) were split out specifically so protocol behavior can be unit-tested without spawning processes.

## Build + test

```bash
npm install
npm test                # 115 unit tests, <2s, vitest (CI-safe)
npm run test:integration # 5 grok-CLI tests; requires a real `grok` binary locally
npm run package         # → grok-vscode-phuryn-1.0.4.vsix
```

Integration tests in `test/integration/` spawn `grok agent stdio` and are excluded from the default `npm test` (which is what CI runs). They skip gracefully when `grok` is not on PATH.

## Install

- **macOS / Linux / WSL Ubuntu:** `./scripts/install.sh`
- **Windows (UI only, no working chat — grok CLI is Linux/macOS):** `pwsh scripts\install.ps1`
- **Windows for real:** WSL2 Ubuntu + Remote-WSL → install in the WSL-side VS Code server

See `README.md § Install` for the full per-platform matrix.

## ACP surfaces implemented

- `initialize` → `session/new` / `session/load` → `session/set_model` → `session/prompt` lifecycle
- Streaming `agent_message_chunk` + `agent_thought_chunk`
- Sessions: list/resume via `session/load` (grok stores them at `~/.grok/sessions/<urlencoded-cwd>/<id>/`); rename/delete metadata in `context.globalState["grok.sessionMeta"]`. We never edit grok's own session files.
- Handlers (mandatory or the agent crashes): `fs/read_text_file`, `fs/write_text_file`, `terminal/{create,output,wait_for_exit,kill,release}`
- `session/request_permission` → chat card with `allow-always` / `allow-once` / `reject-once`, diff editor preview for `kind:"edit"`
- `session/set_mode` wired but Plan is UI-disabled (the CLI's `x.ai/exit_plan_mode` treats any client response as approval — see Known limits). The mode picker exposes Agent and YOLO only.
- `--reasoning-effort` flag at agent spawn (`low | medium | high | xhigh | max`)
- `available_commands_update` → slash autocomplete
- `current_mode_update` → bottom-toolbar mode button (the top bar was removed in 0.9.0)
- `_meta.totalTokens` → context donut

## Known limits

- Subagent messages render inline as tool cards — no dedicated inspector
- No worktree UI
- Diff editor is preview-only; the write happens via `fs/write_text_file` after approval
- View defaults to left activity bar; user must drag to secondary side bar manually if desired

## Cross-platform notes

- `terminal-manager.ts` uses `spawn(cmd, { shell: true })` so Node picks `cmd.exe` on Windows, `/bin/sh` elsewhere. Don't hardcode shell paths.
- `cli-locator.ts` reads `HOME` / `USERPROFILE` env vars first (testability), falls back to `os.homedir()`. Uses `where` on Windows, `command -v` elsewhere. Checks `.cmd`/`.exe`/`.bat` extensions on Windows.
- Tests use `node -e "..."` everywhere so commands are deterministic across platforms — don't add `pwd`, `awk`, `sleep`, `true`, etc.

## What's next (priority order)

1. `@vscode/test-electron` integration suite (scoped in `TESTS.md § v0.2`)
2. Status-bar indicator (current model + effort + token usage)
3. Subagent inspector (collapsible side panel)
4. Worktree UI (`Grok: New Worktree Session`)
5. Optional: auto-move view to secondary side bar on first activation (`workbench.action.moveView`)

## Publishing

Per-release: bump version in `package.json`, `npm test`, `npm run publish`. The `PawelHuryn` publisher is already registered and authenticated locally.

## Repo conventions

- Direct-to-`main`, no feature branches
- Commits explain the *why*, not the *what*
- Don't introduce abstractions speculatively
- Don't add comments that explain what well-named code already says
- 115 unit tests is the floor — every PR should keep that green
- **Version bumps are user-initiated.** Iterate at the current version (rebuild the same vsix and reinstall locally) until the user says to bump and publish. Don't bump `package.json` on your own.
