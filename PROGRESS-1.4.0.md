# v1.4.0 — progress / handoff notes

**Temporary file** — delete before the release-to-main commit. This is the working
log for the `v1.4.0` branch so the session can be teleported to local VS Code and
finished there.

Branch: `v1.4.0` · base: `1.3.2` working tree · `npm test` → **361 passing** (was 337,
+24) · `tsc -p . --noEmit` clean.

> **Update (post-login):** logged into a SuperGrok account in this container via
> `grok login --device-auth`, so the image + subagent wire formats are now
> **confirmed live against grok 0.2.33** — not guesses. The image extractor was
> rewritten to the real format (see below). Probes: `research/imagine-probe.cjs`;
> docs: `research/image-generation.md`, `research/subagents.md`.

## Goal

Implement features 1–3 from the CLI feature-gap exploration, in one version:

1. **Image generation rendering** (`/imagine`, image tool output)
2. **Subagent inspector** (parallel subagents → legible cards)
3. **Logout** (issue #13)

## "Can you install grok in the cloud env?" — yes

No environment barrier. `curl -fsSL https://x.ai/cli/install.sh | bash` worked here and
installed **grok 0.2.33** (`~/.grok/bin/grok`, runnable). x.ai is reachable from the
sandbox. The *only* gap is **auth**: this container has no Grok login, and `/imagine` is
**subscription-gated**, so I could confirm the ACP `initialize` handshake but could not
trigger a live image generation or a live subagent run. That's why features 1 & 2 ship as
spec-aligned + unit-tested cores that still need one **subscription-auth smoke test** locally.

Confirmed live against 0.2.33 (unauthenticated):
- `initialize` → `promptCapabilities: { image:false, audio:false, embeddedContext:true }`
  (this is the *input* flag — sending media to grok; unrelated to image **output**).
- `grok logout` subcommand exists: "Sign out and clear cached credentials".
- `grok --help` shows `--agents <JSON>` (inline subagent defs) and `--best-of-n` — subagents are real.

## What's done

### 1. Image rendering — ✅ CONFIRMED & fixed to the real format
The initial guess (ACP `image`/`resource_link` blocks) was **wrong** — the probe caught the
real shape and the extractor was rewritten. Real format (`research/image-generation.md`):
`/imagine` → tool **`image_gen`** → the completed `tool_call_update` carries the saved file
as a **JSON string inside a `text` content block**: `{"path":"…/images/1.jpg",…}`. Grok
writes the JPEG to the session dir itself (observed 1024×1024).
- `src/acp-dispatch.ts`: `isImageGenToolCall(payload)` (flags by title/`rawInput.variant`),
  `extractGeneratedImagePaths(payload)` (parses the JSON-in-text path, image-ext only).
  ACP-standard `extractImageContent`/`collectToolImages` kept as forward-compat fallback.
- `src/acp.ts`: `emitToolImages()` tracks `image_gen` tool-call ids (the *completed* update
  has a null title) and emits `imageContent` for the parsed path.
- `src/sidebar.ts`: `postGeneratedImage()` reads the session-dir file and inlines it as a
  `data:` URI (CSP can't load arbitrary disk paths). Verified the path is readable.
- `media/chat.js` `addGeneratedImage()` + `case "image"`; `media/chat.css` `.generated-image`.

  **Still worth a local UI smoke test:** install the vsix, `/imagine …`, confirm the image
  renders in the panel (the host-side path→data-URI was confirmed, but the end-to-end
  webview render wasn't exercised in a real VS Code instance). `/imagine-video` is unprobed —
  the path extractor is image-ext-only, so video would fall through; revisit if wanted.

### 2. Subagent card — ✅ tool name CONFIRMED (from CLI's bundled docs); inspector still TODO
Tool is **`spawn_subagent`** with a **`subagent_type`** param (`general-purpose`/`explore`/
`plan`/custom) — confirmed from `~/.grok/docs/user-guide/16-subagents.md`
(`research/subagents.md`). The existing classifier already matches it (by name and by
`rawInput.subagent_type`); tightened the comment + added a confirmed-shape test.
- `media/webview-helpers.js`: `isSubagentToolCall` / `subagentLabel` (label = the role).
- `media/chat.js` `addSubagentCard()`; `media/chat.css` `.subagent-card`.

  **Couldn't capture a live `spawn_subagent` payload** — a trivial prompt makes grok-build
  run `run_terminal_command`, not delegate; real delegation is non-deterministic and needs a
  genuinely delegation-worthy task or defined `.grok/agents`. **Remaining work:** (a) capture
  one real payload to confirm the relabeled title + full rawInput; (b) build the real nested
  inspector (child tool calls under the parent card) — needs to learn how child updates carry
  the parent id.

### 3. Logout — complete, ready to ship
- `src/sidebar.ts`: `logout()` — confirm modal → `grok logout` in a terminal → dispose
  session → onboarding `auth-required`.
- `src/extension.ts` + `package.json`: `grok.logout` command ("Grok: Log Out").
- `media/chat.js`: gear-menu **Account → Sign out**.

  This one has no probe dependency; smoke-test the click path and it's done.

## Suggested local verification order

1. `npm install && npm test` (expect 354) + `tsc -p . --noEmit`.
2. `npm run package`, install the vsix, open the sidebar.
3. **Logout:** gear → Sign out → confirm `grok logout` runs and onboarding returns. (#13 ✅)
4. **Image:** SuperGrok auth → `/imagine …` → confirm it renders. If not, grab the
   `session/update` JSON from the Grok output channel and adjust `extractImageContent`.
5. **Subagent:** trigger a delegation → confirm the card; tighten the matcher from the real
   payload; then decide whether to build the nested inspector now or defer.

## Notes / decisions

- Branch named after the version (`v1.4.0`) per request — not the usual direct-to-main.
- `package.json` bumped to `1.4.0`; CHANGELOG `1.4.0 — unreleased` added. **Tag/GitHub
  Release + Marketplace publish are deliberately NOT done** (that's the release-to-main step).
- All new tests are grok-free; the 337→354 floor moved up.
