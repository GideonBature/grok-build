# Grok Build for VS Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com) [![Grok Build](https://img.shields.io/badge/xAI-Grok%20Build-000000)](https://x.ai) [![The Product Compass](https://img.shields.io/badge/The%20Product%20Compass-productcompass.pm-FF6B35)](https://www.productcompass.pm)

A thin VS Code sidebar client for xAI's Grok Build CLI. It spawns `grok agent stdio` as a headless child and drives it over the [Agent Client Protocol (ACP)](https://agentclientprotocol.com) — session state, MCP servers, memory, and tool execution all stay inside that CLI process. **Not a terminal launcher and not a re-implementation.** Install the `grok` CLI first; the extension is a UI shell over it.

Works with a SuperGrok subscription or an xAI API key. **Not affiliated with xAI.**

**Install free from the [VS Code Marketplace →](https://marketplace.visualstudio.com/items?itemName=PawelHuryn.grok-vscode-phuryn)**

![Grok Build in the VS Code sidebar](docs/screenshots/v1.2.0.png)

![Generated image rendered inline from /imagine](docs/screenshots/imagine.png)

**[More screenshots →](docs/screenshots/)**

---

## Why an extension, not the CLI?

You get the things a terminal can't give you: VS Code's **native diff editor** on a proposed edit before you approve it, **permission cards** with *Allow always / once / Reject* instead of `[y/N]` prompts, your **active editor and selection as first-class `@file` context**, **session history** you can resume/rename/delete, **inline images and video** from `/imagine`, **voice dictation**, and **side-by-side** placement next to other AI tools. It's a UI shell — the trade-off is that it's useless without the `grok` CLI installed.

A short tour of how the extension is wired (and the one place it's deliberately *not* thin — Plan Mode) lives in [docs/architecture.md](docs/architecture.md).

---

## Requirements

- **VS Code** 1.90+ (or a compatible editor — Cursor, Windsurf, VSCodium).
- **The Grok Build CLI** (`grok`) on macOS, Linux, or Windows. The CLI ships a native Windows build, so the extension runs natively on all three — no WSL required (WSL2 + Remote-WSL still works if you prefer it).
- **A login:** either a SuperGrok subscription (`grok /login`) or an xAI API key. With a subscription you get **Grok Build**; with an API key you also get the **grok-4.x** models and **grok-imagine**.
- **For voice input only** (optional): [`ffmpeg`](https://ffmpeg.org) on `PATH`, and a *separate* xAI API key for Speech-to-Text (pay-as-you-go, ~$0.10/hr — your CLI login does **not** cover it). See **Voice input** under [Features & capabilities](#features--capabilities).

---

## Install

**1. Install the CLI and sign in.**

macOS / Linux / WSL:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok /login
```

Windows (PowerShell):

```powershell
irm https://x.ai/cli/install.ps1 | iex
grok /login
```

`grok /login` opens a browser and completes OAuth in one step. Prefer an API key? Get one at [console.x.ai](https://console.x.ai) and set `XAI_API_KEY` in your shell or a workspace `.env` (the extension auto-loads it).

**2. Install the extension.**

From the Marketplace — search **Grok Build** by *PawelHuryn*, or:

```bash
code --install-extension PawelHuryn.grok-vscode-phuryn
```

Or build from source:

```bash
git clone https://github.com/phuryn/grok-build-vscode.git
cd grok-build-vscode
npm install
./scripts/install.sh        # Windows: pwsh scripts\install.ps1
```

Reload VS Code (**Ctrl+Shift+P → Developer: Reload Window**) and click the Grok icon in the activity bar.

> **Tip:** Right-click the Grok icon → **Move To → Secondary Side Bar** to park Grok on the right, next to other AI tools.
>
> ![Right-click the Grok icon → Move To → Secondary Side Bar](docs/screenshots/side.png)

**Uninstall:** `./scripts/uninstall.sh` (Windows: `pwsh scripts\uninstall.ps1`) or `code --uninstall-extension PawelHuryn.grok-vscode-phuryn`.

---

## Quick start

1. **Open** the Grok sidebar (activity bar icon, or `Ctrl/Cmd+;`).
2. **Type a prompt** and press **Enter**. Grok streams its answer; a *Thinking…* line resolves to *Thought for Ns* — click it to expand the reasoning.
3. **Approve actions.** When Grok wants to write a file or run a command it may raise a permission card — preview an edit in the native **diff editor**, then *Allow once / always / Reject*.
4. **Pick your mode** (Agent / Plan / YOLO), **model**, and **reasoning effort** from the bottom toolbar and gear menu.
5. **Resume anytime** — the clock icon lists past sessions for this project.

---

## Features & capabilities

_Click any feature to expand._

<details>
<summary><strong>Permission cards with diff preview</strong> — see every edit in VS Code's native diff before you approve</summary>

For `kind:"edit"` tool calls the card shows a `path — N → M lines` summary and an **open diff →** button that opens VS Code's native diff editor against the proposed content. Approve with *Allow once / always*, or *Reject*. The actual write only happens *after* you approve, via `fs/write_text_file` — no surprise changes to your files.

</details>

<details>
<summary><strong>Modes — Agent, Plan & YOLO</strong></summary>

| Mode | Behaviour |
|---|---|
| **Agent** (default) | Grok acts directly and **may** ask permission for a write or shell action it judges sensitive — a card appears in chat. |
| **Plan** | Grok drafts a plan first and **cannot** write to the workspace or run anything outside a read-only allowlist until you approve. Approve / Reject / Cancel from the card, each with an optional comment. Plan Mode is enforced by the extension — see [How it works](#how-it-works). |
| **YOLO** | The extension auto-approves every permission request. The CLI session is untouched — no restart, just a flag flip. |

</details>

<details>
<summary><strong>Image & video generation</strong> — <code>/imagine</code> renders right in the chat</summary>

Type `/imagine <prompt>` (or `/imagine-video <prompt>`) and the result renders **inline** — images as a compact thumbnail (capped at 320px; click to open the source file), videos with native playback controls. Hover either for **Copy path** / **Open in VS Code** icons. Both are **subscription-only** Grok features, both survive a session resume, and the file is streamed from disk so even a multi-MB video plays. (Editing a reference photo with `/imagine` works too, via Grok's `image_edit` tool.) Wire-format details: [research/image-generation.md](research/image-generation.md).

</details>

<details>
<summary><strong>Voice input</strong> — hands-free dictation with live transcription</summary>

The **microphone button** in the composer dictates speech, transcribed by [xAI's Speech-to-Text API](https://docs.x.ai/developers/model-capabilities/audio/voice). Click it, wait for the blue listening waves, and speak — words appear live as you talk. Say **"grok send"** to submit hands-free and keep listening for the next message (dictate while Grok responds; those messages queue and flush when it finishes). Click the mic to stop and keep any in-progress text.

The two-word send phrase is deliberate (it won't fire on a message that merely ends in "send") and is configurable via `grok.voiceSendPhrase`. Streaming is the default; set `grok.voiceStreaming: false` for one-shot batch mode.

> **Cost:** Speech-to-Text is a *separate*, pay-as-you-go xAI product — **$0.10/hr** batch, **$0.20/hr** streaming, billed by audio duration. In practice ~500 words ≈ ½–1¢; a heavy 10,000-word day ≈ 10¢. It needs its own [console.x.ai](https://console.x.ai) key (`grok.voiceApiKey` / `GROK_VOICE_API_KEY` / `XAI_API_KEY`) — a SuperGrok subscription grants no API credit. Why it bypasses the CLI, and how the cost was measured end-to-end: [research/voice-input.md](research/voice-input.md).

</details>

<details>
<summary><strong>File chips</strong> — your editor and selection as <code>@file</code> context</summary>

The active editor is added as an **implicit** chip automatically (toggle with `grok.includeActiveFileByDefault`). Drag from the Explorer, right-click → **Grok: Send File**, press **Alt+G**, or use the **+** toolbar button to add **explicit** chips. Chips are sent as `@/path/to/file` references — the CLI resolves them, so content stays current and doesn't bloat chat history. Hold **Shift** while dragging to embed the file's contents inline as a fenced code block instead.

</details>

<details>
<summary><strong>Session history</strong> — resume, rename, or delete any past session</summary>

The clock icon lists every session the CLI saved for this project (`~/.grok/sessions/<urlencoded-cwd>/`). Click a row to resume — the extension calls `session/load` and Grok replays the conversation, with inline images, plans, and reasoning intact. Hover to rename (pencil) or delete (trash); names default to the first message. Renames live in VS Code's `globalState` and never touch Grok's own files.

</details>

<details>
<summary><strong>Tool calls</strong> — every read, edit & command, inline</summary>

Every action Grok takes appears in chat — a single flat row ("Read sidebar.ts lines 1–120", "Edit package.json", "Run npm test"), or a collapsed group ("Read, Edit +2") that expands on click.

</details>

<details>
<summary><strong>Math &amp; LaTeX rendering</strong> — equations render as math, not raw TeX</summary>

When Grok answers with LaTeX — inline `\(…\)`, display `\[…\]`, and environments like `\begin{pmatrix}` matrices, `cases`, integrals, sums, and Greek — the chat renders it as real typeset math via [KaTeX](https://katex.org), vendored into the extension so it works **offline with no network**. Display equations get their own block with horizontal scroll so a wide matrix doesn't overflow the narrow sidebar; a malformed expression shows a small inline error instead of blanking the message, and `\label{…}` (which KaTeX can't cross-reference) is stripped so it never paints a red error into an otherwise-fine equation. Bare `$…$` is intentionally **not** a delimiter — it would mangle prose like "it costs $5 and then $10".

</details>

<details>
<summary><strong>Model picker</strong> — switch models live, no restart</summary>

Click the model name in the gear popover. The list comes from the CLI's `session/new` response; switching is live (`session/set_model`) with no restart when the target model belongs to the same agent.

</details>

<details>
<summary><strong>Reasoning effort</strong> — trade tokens for depth</summary>

Gear icon → effort dots pick a level (`none` → `xhigh`), forwarded to the CLI as `--reasoning-effort`. Changing it restarts the session, with an optional *Summarize & Restart* to carry context forward. (Some subscription tiers may reject effort at the backend.)

</details>

<details>
<summary><strong>Cost control</strong> — token donut, <code>/compact</code> & effort</summary>

Stay on top of spend without leaving the sidebar: the bottom-toolbar **context donut** shows `usedK/maxK` tokens after each prompt; **`/compact`** (gear → Compact) compresses the conversation when it fills, or **+** starts fresh. **Reasoning effort** trades tokens for depth, and voice STT cost is called out above.

</details>

<details>
<summary><strong>MCP servers</strong> — whatever the CLI loads</summary>

MCP servers are configured in the CLI (`~/.grok/config.toml` global, `.grok/config.toml` project) — the extension picks up whatever the CLI loads:

```bash
grok mcp add playwright --command npx --args @playwright/mcp@latest
```

Or edit the config via gear → *Open global / project config*, then click **+** to reload.

</details>

---

## Configuration

<details>
<summary><strong>All <code>grok.*</code> settings</strong> (VS Code Settings → search "grok")</summary>

| Setting | Default | Notes |
|---|---|---|
| `grok.cliPath` | `""` | Path to the `grok` binary. Empty = auto-discover (`~/.grok/bin/grok` → PATH). |
| `grok.defaultModel` | `""` | Model ID for new sessions. Empty = CLI default. |
| `grok.defaultEffort` | `""` | Reasoning effort forwarded as `--reasoning-effort` (`none` / `minimal` / `low` / `medium` / `high` / `xhigh`). Empty = CLI default. Changing it restarts the session. |
| `grok.includeActiveFileByDefault` | `true` | Auto-add the active editor as a context chip. |
| `grok.useCtrlEnterToSend` | `false` | When true, Enter inserts a newline and Ctrl/Cmd+Enter sends. |
| `grok.voiceApiKey` | `""` | xAI API key for voice Speech-to-Text — a separate [console.x.ai](https://console.x.ai) developer key, not the CLI login. Empty = fall back to `GROK_VOICE_API_KEY` / `XAI_API_KEY` in the workspace `.env`. |
| `grok.ffmpegPath` | `""` | Path to `ffmpeg` for microphone recording. Empty = use `ffmpeg` from `PATH`. |
| `grok.voiceInputDevice` | `""` | Microphone device override. Empty = system default (Windows auto-detects the first DirectShow audio device). |
| `grok.voiceSendPhrase` | `"grok send"` | Spoken phrase that auto-submits when it ends a transcription. Empty = disable hands-free sending. |
| `grok.voiceStreaming` | `true` | Stream transcription live as you speak. `false` = one-shot batch mode. Streaming costs $0.20/hr vs $0.10/hr batch. |

</details>

---

## Commands & keybindings

<details>
<summary><strong>VS Code commands & keys</strong> (Ctrl/Cmd+Shift+P → "Grok")</summary>

VS Code commands (not Grok slash commands):

| Command | What it does |
|---|---|
| `Grok: Open` | Open the Grok sidebar |
| `Grok: New Session` | Start a fresh session |
| `Grok: Pick Model` | Open the model picker |
| `Grok: Toggle Plan / Agent Mode` | Open the mode picker (Agent / Plan / YOLO) |
| `Grok: Send File` | Add the selected file to context |
| `Grok: Send Selection` | Send the current text selection to Grok |
| `Grok: Insert @-Mention` | Insert an `@`-mention for the active file into the composer |
| `Grok: Show Logs` | Open the Grok output channel (ACP messages, errors) |
| `Grok: Log Out` | Sign out of the Grok CLI (`grok logout`) and return to the sign-in screen |

| Key | Action |
|---|---|
| `Ctrl+;` / `Cmd+;` | Open Grok sidebar |
| `Alt+G` | Insert `@`-mention for the active file (when the editor is focused) |

Grok's own **slash commands** (`/imagine`, `/compact`, …) autocomplete in the composer when you type `/`, sourced live from your installed CLI version. Reference snapshot: [docs/SLASH-COMMANDS.md](docs/SLASH-COMMANDS.md).

</details>

---

## How it works

The extension is intentionally **thin**: it speaks JSON-RPC over `grok agent stdio` and renders the results. Grok owns sessions, memory, MCP, models, and tool execution; the extension mediates file reads/writes, terminal requests, diff previews, the webview UI — and **Plan Mode**.

Plan Mode is the one place the extension is *not* thin. The CLI's `exit_plan_mode` is unreliable (it reports "approved" to any reply), so the extension enforces planning itself: a **gate** blocks workspace writes and non-read-only commands until you approve, and a hidden **primer** message teaches Grok to read your real verdict (`[Plan approved]` / `[Plan rejected]` / `[Plan cancelled]`) from your next message.

Full diagram, message flow, module map, and design notes: **[docs/architecture.md](docs/architecture.md)**.

---

## Development

<details>
<summary><strong>Build, test & repo conventions</strong></summary>

```bash
npm install
npm test         # grok-free unit/DOM/integration suite — exactly what CI runs
npm run package  # → grok-vscode-phuryn-<version>.vsix
```

`npm test` is grok-free, so **local ≡ CI** — it never spawns the real binary. A separate, on-demand `npm run test:live` drives the actual `grok` end-to-end (handshake, restore, plan-mode, image/video gen) and is run **before a release**, not on every commit. Full test taxonomy and what's deferred to a future `@vscode/test-electron` suite: **[TESTS.md](TESTS.md)**. Architecture and module map: **[docs/architecture.md](docs/architecture.md)**.

**Repo conventions:** direct-to-`main`, no feature branches; commits explain the *why*; no speculative abstractions; the grok-free suite is the floor — every change keeps it green.

</details>

---

## Known limits

- **Diff preview semantics.** The diff editor compares the proposed old vs. new text against each other, not against the file on disk at preview time. The write happens via `fs/write_text_file` after approval. This is an ACP constraint — `tool_call_update` carries the diff before the file is touched.
- **No worktree UI.** `Grok: New Worktree Session` is planned but not yet implemented.
- **View placement.** The view defaults to the left activity bar; drag it to the secondary side bar manually if you want it on the right.

---

## License

MIT
