# Privacy

**Privacy by design.** The extension sends **no** background data about you or your code — the only thing it reports on its own is an anonymous usage count, with no content and no identity, and you can turn even that off. The one time data leaves your machine at your request is **voice input** (you send audio to xAI to transcribe it) — disclosed in full below, separate from telemetry.

## Telemetry — what is sent

A single, anonymous **`session_start`** event ([Aptabase](https://aptabase.com)), fired on the **first real message** of a session — never the hidden plan-mode primer, and never empty or abandoned sessions. Its only purpose is to gauge how many people use the extension and which models/modes are popular.

The event carries:

| Field | Example | Why |
|---|---|---|
| Anonymous **install id** | a random GUID generated once on your machine | count distinct installs — **not** your account, email, or grok login |
| **mode / model / effort** | `agent` / `grok-build` / `high` | which features are used |
| **OS** + extension **version** | `Windows` / `1.6.1` | platform/version split |
| **Country** | derived by Aptabase from your IP | rough geography |

Country is the only thing derived from your IP, and the **IP itself is discarded — never stored**.

## What telemetry never contains

- **No message content** — nothing you type, and nothing grok replies.
- **No code** — not a single line, ever.
- **No file names or paths**, no workspace name, no repo/branch.
- **No personal identity** — no account, email, grok login, machine name, or any way to tie the install id back to you.

There is no SDK and no third-party tracker — just one small, dependency-free HTTPS POST that is fire-and-forget (it can never slow down, surface to, or break a turn).

## How telemetry is gated

Telemetry sends **only when both** of these are on:

1. VS Code's global telemetry setting — `telemetry.telemetryLevel` (anything other than `off`), and
2. the extension's own `grok.telemetry.enabled` (default `true`).

Either one set to off stops **all** sending.

> **Note on Aptabase build modes.** Events from a published/installed build report as **Release**; events from a development host (running the extension from source) report as **Debug**. In the Aptabase dashboard these are two separate streams toggled by the Bug/Rocket icon — Release data won't appear while the dashboard is in Debug view, and vice-versa.

## How to opt out

Do **either** of the following:

- Set `grok.telemetry.enabled` to `false` in VS Code settings, **or**
- Disable VS Code's global telemetry: set `telemetry.telemetryLevel` to `off`.

Either change takes effect immediately — no reload needed.

## Voice input (Speech-to-Text)

Separate from telemetry: **voice input** sends data to xAI, but only when you use it. It is **opt-in per use** — nothing is captured until you click the microphone button. While you dictate, two things go to **xAI's Speech-to-Text endpoint** (`api.x.ai/v1/stt`) to produce the transcript:

- your **audio** (the recording, streamed live or as a clip), and
- an **STT credential** — the dedicated key you configured (`grok.voiceApiKey` / `GROK_VOICE_API_KEY` / `XAI_API_KEY`) if set, otherwise the token from your `grok login` (`~/.grok/auth.json`), reused so voice works without a separate key.

This is core functionality you trigger deliberately, and it goes to xAI (the same provider behind the CLI) — never to us or any third party. If you never use voice, none of this happens. To avoid sending your login token specifically, set a dedicated `grok.voiceApiKey`. Setup + details: [docs/voice-setup.md](voice-setup.md).
