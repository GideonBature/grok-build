# v1.4.0 — progress / handoff notes

**Temporary file** — delete before the release-to-main commit. This is the working
log for the `v1.4.0` branch so the session can be teleported to local VS Code and
finished there.

Branch: `v1.4.0` · base: `1.3.2` working tree · `npm test` → **354 passing** (was 337,
+17) · `tsc -p . --noEmit` clean.

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

### 1. Image rendering — core complete, wire shape UNVERIFIED
- `src/acp-dispatch.ts`: `ImageRef` type, `extractImageContent(block)` (handles `image`
  base64 / `resource` blob+uri / `resource_link`), `collectToolImages(payload)`, and
  `routeSessionUpdate` now routes an `agent_message_chunk` whose content is an image to a
  new `imageContent` event (text chunks unchanged).
- `src/acp.ts`: emits `imageContent` for message-chunk images **and** for images found in
  `tool_call`/`tool_call_update` content arrays.
- `src/sidebar.ts`: `postGeneratedImage()` — `data` blocks pass through; **file paths are
  read and inlined as `data:` URIs** (webview CSP can't load arbitrary disk paths); remote
  URLs pass through as a link. CSP already allows `img-src ... data:`.
- `media/chat.js`: `addGeneratedImage()` + `case "image"`; click an inlined image → opens
  its source file.
- `media/chat.css`: `.generated-image`.

  **⚠️ VERIFY LOCALLY (needs SuperGrok auth):** run `/imagine a red cube` and capture the
  raw `session/update` JSON — confirm whether the image arrives as an `agent_message_chunk`
  image block, a tool-result `content` item, or a `resource_link` to the session-dir file.
  The extractor is permissive across all three, but the real shape should be pinned and a
  `research/image-generation.md` written (mirroring `research/ask-user-question.md`).

### 2. Subagent card — scaffold, tool-name UNVERIFIED
- `media/webview-helpers.js`: pure `isSubagentToolCall(call)` + `subagentLabel(call)`
  (match by tool name `task`/`subagent`/`delegate`/…, by `kind`, or by `rawInput`
  agent-type fields). Degrades gracefully — no match → existing tool-group behavior.
- `media/chat.js`: `toolCall` handler renders a distinct `addSubagentCard()` when matched.
- `media/chat.css`: `.subagent-card` (purple accent).

  **⚠️ VERIFY LOCALLY:** spawn a real subagent (e.g. a prompt that delegates, or `--agents`)
  and capture the `tool_call` payload — confirm the actual tool name / rawInput keys and
  tighten the regex in `isSubagentToolCall`. **Remaining work:** nest each subagent's child
  tool calls *under* its card (a real inspector) — currently it's a flat labeled marker.
  Needs the wire data to know how child calls are correlated to a parent subagent.

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
