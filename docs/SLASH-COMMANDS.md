# Slash commands

Slash commands are sourced live from the running CLI via the ACP `available_commands_update` notification — the autocomplete list reflects exactly what your installed `grok` version and auth method expose. Type `/` in the composer to open it.

This page is a snapshot for reference; the autocomplete list is the source of truth. Skills installed under `~/.grok/skills/` or `~/.grok/bundled/skills/` also appear in autocomplete as `/<skill-name>` but are not documented here — they vary per install and are owned by their respective `SKILL.md` files.

Snapshot taken against `grok` v0.1.212.

## Built-in

| Command | Effect |
|---|---|
| `/compact` | Compress conversation history to save context (optional hint about what to preserve) |
| `/context` | Show context window usage and session stats |
| `/session-info` | Show session details (model, turns, context usage) |
| `/flush` | Flush conversation memory to disk now |
| `/memory` | Browse, view, and manage your memories |
| `/dream` | Memory consolidation — merge session logs into organised topics |
| `/always-approve` | Toggle always-approve mode (`on` / `off`) |
| `/plugins` | Manage plugins — `list` / `reload` / `trust <path>` / `add <path>` / `remove <path>` |
| `/reload-plugins` | Reload plugins from disk (alias for `/plugins reload`) |
| `/feedback` | Send feedback about the current session |
| `/loop` | Run a prompt on a recurring interval |

## Subscription only

Present in subscription mode, not on API-key auth.

| Command | Effect |
|---|---|
| `/imagine` | Generate an image from a text description |
| `/imagine-video` | Generate a video from a text description |

Since v1.4.0 the extension **renders the result inline** — `/imagine` output shows as an image (click to open the source file), `/imagine-video` as a playable `<video>`. Grok writes the file into its session directory and the extension reads + inlines it; see [research/image-generation.md](../research/image-generation.md) for the wire format.

## Not slash commands

A few things look like slash commands but are surfaced through the extension UI, not the CLI:

- **New session** — sidebar `+` button (`Grok: New Session` from the command palette)
- **Plan mode** — mode picker in the bottom toolbar (currently disabled — see Known limits in `CLAUDE.md`)
- **YOLO mode** — mode picker; toggles auto-approval on the client side
