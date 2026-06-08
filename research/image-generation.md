# Image generation (`/imagine`) over ACP

Confirmed live against **grok 0.2.33** (device-auth login, subscription account),
`grok agent stdio`. Probe: `research/imagine-probe.cjs` equivalent (run ad hoc).

## Summary

`/imagine` is a **subscription-only** slash command. Sending `"/imagine <prompt>"`
as the prompt text triggers grok's built-in **`image_gen`** tool. The generated
image is **written to the session directory by grok itself** — it does **not**
come back as an ACP `image` / `resource` / `resource_link` content block. Instead
the file path is reported as a **JSON string inside a `text` content block** on the
completed tool update.

This is why a naive "render ACP image blocks" implementation renders nothing — the
real payload has to be parsed out of the tool result text.

## Wire sequence

For prompt `"/imagine a small red cube on white background"`:

1. `tool_call` — `title: "image_gen"`, `toolCallId: "call-…"`,
   `rawInput: { prompt: "a small red cube…", aspect_ratio: "1:1" }`
2. `tool_call_update` — relabeled `title: "imagine: a small red cube…"`,
   `rawInput: { variant: "ImageGen", prompt, aspect_ratio }`
3. `tool_call_update` — `status: "completed"`, `title: null`, and:

```json
"content": [
  { "type": "content",
    "content": {
      "type": "text",
      "text": "{\"path\":\"/root/.grok/sessions/%2Ftmp%2Fgrok-probe/<sid>/images/1.jpg\",\"filename\":\"1.jpg\",\"session_folder\":\"images\",\"message\":\"Image generated and saved to …. Do not read or re-display it, and do not describe how it appears to the user.\"}"
    }
  }
]
```

- The file is a real JPEG (observed **1024×1024**, ~148 KB, ~3–5 s to generate).
- The path is **absolute and real** even though the cwd segment is URL-encoded
  (`%2Ftmp%2Fgrok-probe`) — that's just grok's session-dir naming. It reads fine
  via `vscode.workspace.fs.readFile(Uri.file(path))`.
- The `message` field's "Do not read or re-display it" is an instruction to the
  **agent** (to save context), not to us — the client UI displaying the image is
  the whole point.

## How the extension handles it

- `isImageGenToolCall(payload)` — flags the tool by `title` (`image_gen` /
  `imagine:`) or `rawInput.variant === "ImageGen"`. The host remembers the
  `toolCallId` so the **completed** update (whose title is null) is still
  recognized. (`src/acp-dispatch.ts`)
- `extractGeneratedImagePaths(payload)` — parses each `text` content block as JSON
  and returns any `.path` with an image extension. (`src/acp-dispatch.ts`)
- `AcpClient.emitToolImages` — on every tool call/update, emits `imageContent`
  for ACP-standard image blocks (`collectToolImages`, kept as a forward-compatible
  fallback) plus the flagged image_gen path. (`src/acp.ts`)
- `GrokSidebar.postGeneratedImage` — reads the file and inlines it as a `data:`
  URI (the webview CSP can't load arbitrary disk paths), posts `{type:"image"}`.
  (`src/sidebar.ts`)
- `addGeneratedImage` renders `<img>`; clicking opens the source file.
  (`media/chat.js`, `media/chat.css`)

## Notes

- `/imagine-video` (subscription) was not probed; expect an analogous tool
  reporting a video file path. The path extractor only accepts image extensions,
  so video would currently fall through — revisit if/when we support it.
- `initialize` advertises `promptCapabilities.image:false` — that's the **input**
  flag (sending images *to* grok), unrelated to image-generation **output**.
