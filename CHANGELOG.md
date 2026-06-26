# Changelog

## 1.4.16 — 2026-06-26

> Clearer listing and docs; lighter changelog.

### Changed

- **README rewritten** to lead with what the extension does for you — diff-preview approvals, `@file` context, inline image/video, voice — instead of internals, with a trimmed feature list.
- **Listing clarified** as an **unofficial community extension** (display name + description).
- **Changelog slimmed:** releases before 1.4.0 moved to [docs/CHANGELOG-ARCHIVE.md](docs/CHANGELOG-ARCHIVE.md); entries stay terse going forward.

## 1.4.15 — 2026-06-26

> Cover the #22 Windows session-start bug on newer Grok CLI builds (through 0.2.67) and when the hang moves to session start.

### Fixes

- **The Windows session-start workaround now covers Grok CLI 0.2.65–0.2.67 and a `session/new`-stage hang (#22).** Grok CLI 0.2.67 *looked* fixed — the ACP `initialize` handshake answers again — but the stdin-until-EOF regression only **moved**: the next request, `session/new`, now hangs instead (with stdin held open, as any live client must), so a real session still can't start. v1.4.14 only knew the 0.2.61–0.2.64 range and only recognized an `initialize`-stage hang, so anyone landing on 0.2.65–0.2.67 was left stuck. Now: the proactive pin covers the full confirmed-broken range **0.2.61–0.2.67** and pins the CLI back to the last fully-working **0.2.60** before starting; and the evidence-driven reactive recovery also fires on a **`session/new` / `session/load`** timeout, not just `initialize` — so a future still-broken build self-heals on the observed failure regardless of which startup request hangs. Verified with a controlled stdin-open probe (`initialize` then `session/new`) against real 0.2.67. ([src/cli-locator.ts](src/cli-locator.ts), [src/sidebar.ts](src/sidebar.ts))

### Docs

- Recorded that **0.2.67 does not fix #22** — the hang moved from `initialize` to `session/new` — with the reproduction probe in [research/stdio-eof-regression.md](research/stdio-eof-regression.md). Rewrote CLAUDE.md's status into a concise current-state project map (per-version history lives here in the changelog, not there).

## 1.4.14 — 2026-06-25

> Smoother diff review on permission cards.

### Features

- **Diff previews don't nag you to save, auto-open, and clean up after themselves (#21).** Closing a diff preview **no longer prompts you to save**: every diff the extension opens — whether from the *open diff preview →* link on an edit card or auto-opened on a permission card — is now backed by read-only virtual documents instead of scratch buffers, so there's nothing to save (and you also get proper syntax highlighting now). On a permission card the diff also **opens automatically** (the *open diff →* button stays, to re-open it) and **closes itself** when you click **Allow / Reject**. The preview reuses a single tab across Grok's many small sequential edits and keeps focus on the chat, so reviewing a stream of edits is just: glance, decide, repeat. ([src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js))

## 1.4.13 — 2026-06-25

> Self-healing recovery if a *future* Grok CLI build ships the same Windows bug. _(Not released on its own — rolled into the 1.4.14 release.)_

### Fixes

- **Auto-recovers from a still-broken future CLI build, not just the known ones (#22).** v1.4.12 pins the CLI back to 0.2.60 when it detects one of the *known* broken builds (0.2.61–0.2.64) before starting. But if xAI ships a **new** build (0.2.65+) that still has the bug, that closed range wouldn't catch it and the session would hang with no automatic fix. The extension now also recovers **reactively**: if a session fails to start on Windows with the regression's signature (the `initialize` handshake timing out / *"exited (code null)"*) and the CLI is on any build newer than the supported 0.2.60, it automatically downgrades to 0.2.60 and **retries the start once** — triggered by the actual failure rather than a hardcoded version list, so it self-heals on builds that don't exist yet. If you later update the CLI by hand onto another broken build, the same recovery runs again on the next failure. Every automatic downgrade (proactive or reactive) shows a notification explaining what happened. If the downgrade can't run, you still get the manual-workaround message as before. ([src/cli-locator.ts](src/cli-locator.ts), [src/sidebar.ts](src/sidebar.ts))

### Internal

- Verified on macOS (Apple Silicon) that the regression is **Windows-only** — grok 0.2.64, the build that hangs on Windows, completes the stdin-open ACP `initialize` handshake in ~450ms (4/4 runs) — so the whole workaround stays correctly gated to Windows. Recorded in [research/stdio-eof-regression.md](research/stdio-eof-regression.md) with a reproduction probe. ([research/stdio-eof-mac-probe.cjs](research/stdio-eof-mac-probe.cjs))

## 1.4.12 — 2026-06-25

> Works around a Grok CLI 0.2.61+ bug that stopped sessions from starting.

### Fixes

- **Sessions start again on Grok CLI 0.2.61–0.2.64 (#22).** A regression in the Grok CLI broke `grok agent stdio`: the agent no longer reads its first line of input until the input stream is closed, which never happens for a live connection — so the extension's startup handshake hung forever and you saw *"Grok exited (code null)"* / *"ACP request timed out: initialize"*. The last working build is **0.2.60**. Since the extension can't make the CLI read its input, it now **detects a broken CLI version on startup and automatically pins it back to 0.2.60** before connecting, with a one-time notice — no manual downgrade needed. Once the CLI is healthy again nothing is changed. If the automatic downgrade can't run, the start-failure message now tells you exactly how to fix it by hand (`grok update --version 0.2.60`). The version range is bounded to the known-broken builds so a future fixed release won't be needlessly downgraded. (The regression has so far only been reported on Windows, so the automatic pin and the update guard below currently apply there.) ([src/cli-locator.ts](src/cli-locator.ts), [src/sidebar.ts](src/sidebar.ts))
- **"Update Grok Build CLI" won't move you onto a broken build.** Because Grok CLI 0.2.61+ is unusable by the extension (above), the gear → **About** update action is now **disabled with a note** when you're on the latest supported version (0.2.60) or newer — so a one-click update can't reinstall a broken build. It stays enabled only when you're on something *older* than 0.2.60, and in that case it updates **to 0.2.60** (never to an unsupported `latest`). The silent on-upgrade CLI update follows the same rule. ([src/cli-locator.ts](src/cli-locator.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js))

### Docs

- Documented the root cause, the controlled reproduction, and a copy-paste bug report for xAI in [research/stdio-eof-regression.md](research/stdio-eof-regression.md).

## 1.4.11 — 2026-06-20

> Nested code blocks render correctly.

### Fixes

- **Nested code blocks no longer eat the outer fence (#20).** Asking the chat for a code block fenced by 4 or 5 backticks (so it can contain an inner ```` ``` ```` block) used to strip the first three backticks of the outer fence and close the block early at the inner fence — splitting one block into several and mangling the output. The Markdown renderer now matches a fence of three-or-more backticks and requires the closing fence to be the same length, so a longer outer fence correctly wraps shorter inner ones (per the CommonMark spec). This makes clean, copy-pasteable nested examples (e.g. for an `AGENTS.md`) render the same as on grok.com and in the Grok CLI. ([media/chat.js](media/chat.js))

## 1.4.10 — 2026-06-18

> Session history that stays fast with thousands of sessions.

### Features

- **Session history loads in pages and stays fast at scale.** The history dropdown used to read and parse *every* saved session on each open, which got slow once a project had hundreds or thousands of them. It now loads the **most recent 100** (newest first by last activity) and pulls in older ones as you **scroll to the bottom**. The **search box** filters by name across your **entire** history — not just the loaded page — so you can still find an old session instantly. Behind the scenes it orders sessions with one cheap directory `stat` each (no file reads), reads only the page you're looking at, and caches by file modification time so re-opening the dropdown costs effectively no disk reads. ([src/sessions.ts](src/sessions.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js), [media/chat.css](media/chat.css))
- **Switching model or reasoning effort on a fresh session no longer clutters history.** Some model and effort changes need the session to restart. If you flip them a few times right after opening a session — before you've actually said anything — each restart used to leave behind an empty, identical session in your history. Now an empty session (one where only the hidden setup has run) restarts cleanly with no "Summarize & Restart vs. Just Restart" prompt, and the throwaway session is removed instead of piling up. If you had renamed that session, the name carries over to the restarted one. ([src/sidebar.ts](src/sidebar.ts), [src/sessions.ts](src/sessions.ts))

### Fixes

- **History dropdown no longer opens clipped off the right edge.** Opening the session-history popover quickly (before its rows had finished loading) could position it too far right, so it spilled past the panel edge and only looked right after closing and reopening. The popover is now right-aligned to the panel (respecting the edge padding) and grows leftward, so it stays fully on-screen no matter how its contents resize as sessions load in. In a narrow panel it also caps its width to fit, so a long session name truncates with an ellipsis instead of pushing the popover off the left edge. Resizing the panel while the dropdown is open now re-fits it live (no need to close and reopen), and switching to another panel tab or extension closes it so it can't reappear mis-sized when you come back. ([media/chat.js](media/chat.js))

### Internal

- **Opt-in performance simulation for the history popover.** A new `npm run test:perf` suite (kept out of `npm test` and CI) builds a 5000-session in-memory store and asserts the access-count improvement: first open drops file reads from 5000 to 100 (~98%), a repeat open does zero reads (modification-time cache), and search warms the catalog once then stays read-free — with a modeled-latency projection and a real in-memory parse-cost wall-clock. ([test/sessions.perf.ts](test/sessions.perf.ts), [vitest.perf.config.ts](vitest.perf.config.ts), [package.json](package.json))

### Docs

- Documented the pagination design in [docs/architecture.md](docs/architecture.md) (§ History at scale) and [CLAUDE.md](CLAUDE.md) (§ History pagination), and updated the *Session history* feature note in the [README](README.md).

## 1.4.9 — 2026-06-16

> Make the chat bigger — just the chat.

### Features

- **Adjustable chat font size (#14).** A new `grok.chatFontScale` setting zooms the Grok chat panel only — text, icons, and spacing together — as a percent (e.g. `150`, `200`, or smaller like `70`). Unlike VS Code's global `Ctrl/Cmd+Shift+=`, it leaves the rest of the editor at its normal size, so you can enlarge (or shrink) just the chat for readability. It applies live with no reload, the composer stays pinned to the bottom of the panel at any scale, and it works at both User (global) and Workspace (local) scope. ([package.json](package.json), [src/sidebar.ts](src/sidebar.ts), [media/chat.css](media/chat.css), [media/chat.js](media/chat.js))

### Docs

- **README polish.** Added screenshots for *Voice input* and the *Agent Dashboard*, and moved a few wire-level implementation details out of the feature blurbs into [docs/architecture.md](docs/architecture.md) so the feature list reads less like internals. ([README.md](README.md), [docs/architecture.md](docs/architecture.md))

## 1.4.8 — 2026-06-15

> Run several Grok sessions at once — switch between them instantly, and see at a glance which one needs you.

### Features

- **Multi-session Agent Dashboard.** The sidebar now keeps several sessions *alive* at once instead of one at a time. Switching between them from the history dropdown is **instant and lossless** — the conversation you switch away from keeps running in the background (mid-turn, mid-approval, anything), and switching back replays its exact state with no reload. Picking a session that isn't live anymore loads it from history as before. ([src/sidebar.ts](src/sidebar.ts), [src/session.ts](src/session.ts))
- **Status dots in the history dropdown.** Every session shows a dot so you can see what each one is doing without opening it. It's **gray** at rest, and only lights up when there's something to know: **blue** = working, **yellow** = needs you (a permission, question, or plan to review), **green** = finished with output you haven't opened yet, **red** = finished with an error you haven't opened. The green/red marker is an *unread* badge — it clears the moment you open the session, and it's **persisted**, so it survives the idle cleanup below and even a VS Code restart. Walk away, come back, and the green sessions are exactly the ones with results waiting. ([media/chat.js](media/chat.js), [media/chat.css](media/chat.css), [src/session-pool.ts](src/session-pool.ts))
- **Idle sessions are cleaned up automatically.** To keep a pile of background sessions from each holding a live process, a session left untouched for an hour — or beyond a cap of ~8 live — is quietly shut down (never one that's working or waiting on you). It reappears in history and reloads on click, so nothing is lost. ([src/session-pool.ts](src/session-pool.ts))
- **Updating the Grok Build CLI warns about sessions in progress.** With multiple sessions now able to run at once, the *Update Grok Build CLI* action confirms before it restarts when any session is mid-turn or waiting on you — so an update doesn't silently interrupt work in a background session. ([src/sidebar.ts](src/sidebar.ts))
- **No more long pause before Grok starts.** Sending your first message used to sit silent for 15–40 seconds before anything appeared. Behind the scenes the extension primes each session with a hidden plan-mode instruction, and that primer was running *in front of* your first message and — because Grok Build is an agentic CLI — was wandering off to read files and search the workspace before your real prompt even ran. The primer now fires **the moment a session goes live**, silently in the background, so it's almost always finished before you hit send; if you're quick, your message shows immediately and is released the instant the primer settles. The primer text itself was also trimmed to just the protocol it needs to teach (the product blurb and repo link that were tempting Grok to go exploring are gone), so it completes in a beat instead of dozens of seconds. ([src/sidebar.ts](src/sidebar.ts), [src/grok-primer.ts](src/grok-primer.ts), [src/session.ts](src/session.ts))
- **A "Grokking…" indicator while you wait.** Every turn now shows an animated *Grokking…* placeholder the instant you send, so there's immediate feedback that Grok received your message — it's replaced in place the moment the first thought, reply, or tool action arrives. ([media/chat.js](media/chat.js), [media/chat.css](media/chat.css))

## 1.4.7 — 2026-06-15

> Sharper math, and one-click export for equations and diagrams.

### Features

- **Math now renders with [MathJax](https://www.mathjax.org) (replacing KaTeX).** MathJax produces self-contained SVG that's closer to "real LaTeX," renders `\label`/`\ref`-style environments without painting red errors, and — crucially — gives every equation an exportable vector. Inline `\(…\)` sits on the text baseline in your editor's text color; display `\[…\]` gets its own centered, horizontally-scrollable block. The swap also fixed a double-rendering bug where Chromium drew MathJax's hidden accessibility MathML as a *second*, visible copy of each equation (`enableAssistiveMml: false`). ([media/chat.js](media/chat.js), [src/sidebar.ts](src/sidebar.ts), [media/mathjax/](media/mathjax/))
- **Copy / Download / Open actions on display math + Mermaid diagrams.** Hover any display equation or rendered diagram for a top-right overlay (mirrors the generated-image actions): **Copy** the LaTeX/Mermaid source, **Download** as an image, or **Open** it in VS Code's image preview. Download offers a quick-pick — **PNG** (rasterized with your VS Code theme background, i.e. what you see), or a **transparent SVG** tuned **for a dark** or **for a light** background. Math recolors its ink for each; Mermaid is re-rendered in its matching light/dark theme so a "for light background" diagram actually uses the light palette. ([media/chat.js](media/chat.js), [src/sidebar.ts](src/sidebar.ts))

### Internal

- **`video-gen` is excluded from the default live-test gate** (opt-in via `--only=video-gen`). In the headless test harness grok 0.2.x spins on `/imagine-video` instead of producing a clip, so it never completes — the feature works interactively, so a default-on test only produced noise. ([scripts/live-tests.cjs](scripts/live-tests.cjs))

## 1.4.6 — 2026-06-15

> Grok's Mermaid diagrams now render as diagrams.

### Features

- **Mermaid diagram rendering.** Grok answers with ` ```mermaid ` fenced blocks — flowcharts, sequence/state diagrams, git graphs, class diagrams, ER, pie, and more — which the chat previously showed as raw diagram source. These now render as real diagrams via the vendored **[Mermaid](https://mermaid.js.org)** library (bundled into the extension, no network — works offline and in the packaged build). The diagram is themed to match VS Code (dark/light) and gets horizontal scroll so a wide flowchart doesn't blow out the narrow sidebar. Rendering is asynchronous and DOM-based (Mermaid measures text to lay out nodes), so unlike the LaTeX path it runs as a post-render pass over the inserted message; an SVG cache keyed by the diagram source keeps the streaming bubble flicker-free (the agent message re-renders every animation frame) and stops the same diagram being laid out dozens of times before the first render resolves. A half-streamed block stays as plain text until its closing ` ``` ` arrives, and if Mermaid can't load or the diagram is malformed the readable source is shown instead of an error. ([media/chat.js](media/chat.js), [src/sidebar.ts](src/sidebar.ts), [media/mermaid/](media/mermaid/))

## 1.4.5 — 2026-06-15

> Grok's math now renders as math.

### Features

- **LaTeX / math rendering.** Grok increasingly answers with TeX — inline `\(…\)` and display `\[…\]` (including `\begin{pmatrix}` matrices, fractions, sums, Greek) — which the chat previously showed as raw backslash-soup. Math is now rendered with **[KaTeX](https://katex.org)**, vendored into the extension (no network, works offline and in the packaged build). The renderer pulls LaTeX out *before* HTML-escaping so the backslashes and braces survive intact; inline math flows with the text, display math gets its own block with horizontal scroll so a wide matrix doesn't blow out the narrow sidebar. A malformed expression renders as an inline red error (KaTeX `throwOnError:false`) instead of blanking the message; if KaTeX somehow can't load, the raw TeX is shown rather than swallowed. `\label{…}` (which Grok emits inside `align`/`equation` blocks for cross-referencing) is stripped before rendering — KaTeX has no `\ref`/`\eqref` system so it would otherwise paint the label as a red error, and `\label` produces no visible output in real LaTeX anyway. Single `$…$` is deliberately **not** a delimiter — too many false positives with prose currency ("$5 and $10"). ([media/chat.js](media/chat.js), [media/webview-helpers.js](media/webview-helpers.js), [src/sidebar.ts](src/sidebar.ts), [media/katex/](media/katex/))

## 1.4.4 — 2026-06-15

> You can read history again while Grok is thinking.

### Fixes

- **Scrolling up no longer gets yanked back down while Grok is thinking** ([#16](https://github.com/phuryn/grok-build-vscode/issues/16)). The chat snapped to the bottom on *every* streaming update, so any attempt to scroll up and re-read earlier messages (or Grok's own earlier reasoning) was undone on the very next thought chunk. The view now follows streaming output only while you're already pinned to the bottom; the moment you scroll up to read history, auto-scroll pauses and leaves you there. Genuinely interactive activity you need to see — **permission cards**, **ask-user-question cards**, and **your own sent message** — still pulls the view back down and re-pins. This also restores the ability to keep an eye on reasoning while permission cards stack up ([#15](https://github.com/phuryn/grok-build-vscode/issues/15)). ([media/chat.js](media/chat.js), [media/webview-helpers.js](media/webview-helpers.js))

## 1.4.3 — 2026-06-09

> Docs catch-up and a faster, leaner session start.

### Docs

- **README rewrite.** Restructured around three audiences: users get a clean **Requirements → Install → Quick start** path, then a **Features & capabilities** section where each feature is its own collapsible — ordered by what actually sells the extension (diff-preview approval, modes, `/imagine` images+videos, voice…) rather than by implementation. **Configuration**, **Commands & keybindings**, and **Development** each collapse into a single `<details>` so the page scans in seconds while staying self-contained for the Marketplace listing. The deep dive — diagram, message flow, module map, design notes, and the Plan-Mode "the one part that isn't thin" explainer — moved to a new [docs/architecture.md](docs/architecture.md), linked from a short *How it works* teaser.
- **Removed stale claims.** Dropped the **Subagents** feature section (still research-only — it rarely fires in practice, so it shouldn't read as shipped) and the "generated media is inlined as base64" known-limit (1.4.2 switched media to `asWebviewUri` streaming). Trimmed the opening screenshots to the sidebar + an inline `/imagine` result, with a *More screenshots* link to the folder; removed a decorative image that carried no information.
- **Canonical `README.md` / `CHANGELOG.md` casing.** The working-tree files were lowercase on disk (a Windows case-insensitivity slip) while git already tracked them uppercase; the disk now matches. (`vsce` still normalizes the *packaged* copies to lowercase inside the `.vsix` — that's its own convention, which the Marketplace renders fine.) `scripts/release.*` now reference `CHANGELOG.md` so the release-notes extraction works on case-sensitive filesystems too.

### Changed

- **The hidden plan-mode primer no longer costs a startup round-trip.** The extension sends Grok a hidden "primer" that teaches it the Plan-Mode verdict protocol. It used to fire at **every** session start — new *and* every restore — locking the composer until Grok acknowledged and burning a turn even on a session you only opened to glance at. It's now sent **lazily**, as its own hidden turn before your **first real prompt** — on a new *or* restored session — so it rides along with work you already triggered. The composer is ready the instant the session connects, and opening/abandoning a session (or restoring just to read history) costs nothing. Re-asserting the primer on the first post-restore send (rather than trusting a copy buried in replayed history, which a `/compact` can drop) keeps Plan Mode reliable across resumes. Best-effort and unchanged in protocol — the plan-gate remains the real enforcement. ([src/grok-primer.ts](src/grok-primer.ts), [src/sidebar.ts](src/sidebar.ts))

## 1.4.2 — 2026-06-09

> Generated video renders now, and inline media is a tighter thumbnail.

### Fixes

- **Generated videos (`/imagine-video`) finally render.** Detection, path extraction, MIME, and CSP were all already correct — the failure was the delivery: a multi-MB clip base64-inlined into a single `postMessage` `data:` URI was silently dropped, so the `<video>` got an empty source. Generated files are now served via `webview.asWebviewUri` (the grok home is a `localResourceRoots` entry), so the webview **streams the file straight from disk** instead of carrying it as a giant string — videos play, and large images load lazily. Files written outside the served roots still fall back to a base64 `data:` URI, so nothing regresses. ([src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js))

### Polish

- **The Copy path / Open in VS Code hover icons now sit on the image.** They were anchored to the chat column's right edge, so on a thumbnail they floated in empty space well to the right of the picture. The media block is now sized to the rendered image, so the icons pin to the image's own top-right corner — for videos too. ([media/chat.css](media/chat.css))
- **Inline media is capped at 320px wide** (was 640px), so a generation reads as a compact thumbnail in the narrow sidebar instead of dominating the chat. The file is untouched — click an image (or **Open in VS Code**) for full resolution. ([media/chat.css](media/chat.css))

## 1.4.1 — 2026-06-09

> A two-part fix for generated images that stopped rendering in 1.4.0.

### Fixes

- **Generated images are visible again.** 1.4.0 capped inline media at 640px by wrapping it in a `width: fit-content` container. That made the `<img>`'s `max-width: 100%` resolve against an *indefinite* width, which collapses a replaced element to zero in Chromium — so every generation (including plain `/imagine`) rendered as an invisible, zero-width image. The container is now a normal block (definite width), so the percentage resolves correctly while the **640px cap stays**. ([media/chat.css](media/chat.css))
- **Reference-edited images (`image_edit`) now render too.** Editing a real photo with `/imagine` runs Grok's **`image_edit`** tool (title `imagine-edit: …`, variant `ImageEdit`) — a surface 1.4.0's detector didn't know about, so the saved file was never inlined. Confirmed live against grok 0.2.x: the completed result reports the path as the same machine-readable JSON `{path}` the other media tools use (an extended-length `\\?\C:\…` Windows path, stripped to canonical form). `isMediaGenToolCall` now recognizes it. ([src/acp-dispatch.ts](src/acp-dispatch.ts))

## 1.4.0 — 2026-06-08

> Two new CLI surfaces — generated image/video rendering and a Sign-Out action. The media wire format was confirmed live against grok 0.2.33 (see [research/image-generation.md](research/image-generation.md)). Available on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=PawelHuryn.grok-vscode-phuryn).

### Fixes

- **Every message you send no longer renders twice (grok 0.2.33 regression).** grok **≥0.2.33 echoes the live prompt back** as a `user_message_chunk` mid-turn — 0.2.3 did not (the code's own comment read "the agent never echoes them back"). The webview already renders the bubble optimistically from `send()`, so the echo produced a **second, duplicate bubble** (and double-counted `userMessageCount`, skewing plan positioning). The host now forwards `user_message_chunk` **only during a session/load replay** (a new `replaying` flag), and the webview's `appendUserChunk` guards the same — so a live echo can never double the bubble. ([src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js))

### Image & video generation

- **Generated images and videos render inline.** When Grok generates an image (the subscription-only `/imagine`) or a video (`/imagine-video`), it now shows up as an actual image or a playable `<video>` in the chat instead of a dead tool chip. The real wire format (confirmed live, [research/image-generation.md](research/image-generation.md)) is **not** an ACP image block — Grok's **`image_gen`** / **`image_to_video`** tools write the file into the session directory (`images/*.jpg`, `videos/*.mp4`) and report the path as a JSON string inside the completed tool result's text. The host recognizes the media-gen call, parses the path out and classifies image-vs-video by extension (`isMediaGenToolCall`/`extractGeneratedMediaPaths`), reads the file and inlines it as a `data:` URI (webviews can't load arbitrary disk paths under the CSP — `media-src data:` was added for video), and the webview renders it. Hovering an image or video reveals two top-right icons (styled like the code-block copy button): **Copy path** and **Open in VS Code** — the latter is the only way to open a *video's* file, since its click drives playback controls (clicking an image still opens its source too). Inline media is capped at **640px** on the longer edge so full-resolution generations stay legible in the chat (the file is untouched). ACP-standard image/`resource_link` blocks are also handled as a forward-compatible fallback. Both render identically on **session resume** (Grok replays the generation as a single collapsed `tool_call`). ([src/acp-dispatch.ts](src/acp-dispatch.ts), [src/acp.ts](src/acp.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js), [media/chat.css](media/chat.css))

### Account

- **Sign out from the extension (#13).** New `Grok: Log Out` command (palette) and a **Sign out** item in the gear menu run `grok logout` to clear the CLI's cached credentials, tear down the live session, and drop back to the auth-required onboarding screen — no more switching to a terminal to change xAI accounts. ([src/sidebar.ts](src/sidebar.ts), [src/extension.ts](src/extension.ts), [package.json](package.json), [media/chat.js](media/chat.js))

### Keeping the CLI current

- **The Grok Build CLI is updated silently when the extension upgrades.** Grok doesn't auto-update, so a user who installs a new extension version could be left on an older CLI whose wire format the new extension no longer matches. Now, the first time a session starts after the extension's own version changes, the host runs `grok update` once before spawning the CLI — so the next handshake reports the freshly-updated version. It fires **only on an actual upgrade**, never on a fresh install (the "not-first-run" rule — a clean install just records its baseline version), at most once per activation, via `execFile` while no grok process is alive (sidesteps the Windows binary lock), and is best-effort (a failed update logs and continues on the current binary). The gate is the pure, unit-tested `extensionWasUpgraded`. ([src/cli-locator.ts](src/cli-locator.ts), [src/sidebar.ts](src/sidebar.ts), [media/chat.js](media/chat.js))
- **The welcome status line tracks real readiness.** It now follows the true session-start lifecycle — `Updating Grok Build CLI…` (during a silent update) → `Starting…` (through the hidden primer turn, while the composer spinner is up) → `Connected · v<version>`. Previously it flipped to "connected" at the ACP handshake, *before* the primer had been sent and processed, so it claimed readiness while grok was still being primed; it now stays "Starting…" until the spinner actually clears. ([media/chat.js](media/chat.js))

### Gear menu & status polish

- **The gear menu gets an "Other" group with About, Config & debug, and Log out.** The flat Config / Account / Debug sections collapse into two sub-views (mirroring the Model picker): **About** shows the *This extension* + *Grok Build CLI* versions, checks for a newer CLI (`grok update --check`), and offers an **Update Grok Build CLI** action; **Config & debug** holds the config links + extension logs. The on-demand update tears the session down, runs `grok update`, then **resumes the same session** on the fresh binary (preserving the conversation), showing the `Updating… → Starting… → Connected · v<new>` lifecycle. ([media/chat.js](media/chat.js), [media/chat.css](media/chat.css), [src/sidebar.ts](src/sidebar.ts))
- **About shows the real CLI version, even on builds the handshake doesn't tag.** The native-Windows build doesn't report a version in the ACP `initialize` response, so About used to read a bare "—" right next to a confident "CLI is up to date". It now adopts the version the update check returns (`grok update --check`'s `currentVersion`), and the action collapses to a grayed "CLI is up to date" (no button) when there's nothing to do. ([media/chat.js](media/chat.js))
- **The Config & debug → MCP servers link works on Windows.** It used to type a quoted `"C:\…\grok.exe" mcp list` into the terminal, which PowerShell (the default Windows shell) parses as a string literal and rejects with "Unexpected token". It now launches grok directly as the terminal's own process (`shellPath`/`shellArgs` → `grok mcp list`), sidestepping shell quoting entirely. ([src/sidebar.ts](src/sidebar.ts))
- **Transient status text animates and is capitalized.** "Starting", "Updating Grok Build CLI", "Thinking", and "Summarizing" now show an animated trailing ellipsis (a CSS `::after` so the layout doesn't shift), and the welcome line reads "Starting…" / "Connected · v…" (capitalized). ([media/chat.css](media/chat.css), [media/chat.js](media/chat.js))

### Tests

- New grok-free tests for v1.4.0: the `image_gen`/`image_to_video` path-in-JSON result extraction (`isMediaGenToolCall`/`extractGeneratedMediaPaths`, classifying image vs video and covering the collapsed-resume shape) and ACP-standard image fallbacks (`extractImageContent`/`collectToolImages` across inline base64, resource blob, file/remote `resource_link`) plus image-vs-text chunk routing, and happy-dom DOM tests driving the real `media/chat.js` render paths — `addGeneratedMedia` (clickable inline `<img>`, `<video controls>`, remote-link fallback, and the hover **Copy path** / **Open in VS Code** actions for both image and video). Plus the silent-update gate (`extensionWasUpgraded` — fresh-install vs upgrade vs unchanged vs downgrade) and a happy-dom suite pinning the welcome version-line lifecycle (`Updating Grok Build CLI…` → `Starting…` at the handshake → `Connected · v<version>` only when the priming spinner clears, and no reversion on later busy toggles). And the 0.2.33 regression fixes: a fake-CLI scenario that echoes a live `user_message_chunk` + a DOM test asserting a single bubble (no duplicate), and a gear-menu suite (the Other group, the About panel's versions + `grokUpdateStatus`-driven update button incl. the version-from-update-check fallback, the Config & debug links). **401 grok-free tests total.**

---

Older releases (before 1.4.0): see [docs/CHANGELOG-ARCHIVE.md](docs/CHANGELOG-ARCHIVE.md).
