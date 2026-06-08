# Subagents over ACP

Confirmed against **grok 0.2.33** — primarily from the CLI's own bundled docs at
`~/.grok/docs/user-guide/16-subagents.md` (grok reads these itself when asked to
delegate), cross-checked with `grok --help` (`--agents <JSON>`, `--best-of-n`).

## Summary

Subagents are **independent child sessions that run in parallel**, each with its
own context window; the parent delegates work and gets a summary back. They're
**enabled by default**. The main agent delegates by calling the **`spawn_subagent`**
tool, which takes a **`subagent_type`** parameter selecting the child's role.

Over ACP a delegation therefore arrives as an ordinary `tool_call` named
`spawn_subagent` — there's no dedicated subagent ACP surface. Without a distinct
card it disappears into the generic "ran N commands" tool group.

## `spawn_subagent`

| Field | Notes |
|---|---|
| tool name | `spawn_subagent` |
| `subagent_type` | child role — built-ins below; project/user agents can add or shadow types |
| (other rawInput) | the task prompt for the child |

### Built-in `subagent_type` values

| Type | Description |
|---|---|
| `general-purpose` | Default. Full-capability agent for any task. |
| `explore` | Research agent — searches/reads/greps/runs shell, **no file edits**. |
| `plan` | Planning agent — explores and produces a structured plan, **no edits**. |

### Agents vs Personas (context, not needed for the card)

- **Agents** configure a whole session (model, tools, prompt, skills). Defined as
  `.md` files in `.grok/agents/` or `~/.grok/agents/`, or via `--agents <JSON>`.
- **Personas** are behavioral overlays applied to a subagent during resolution
  (tone/format/focus). Defined in `config.toml` `[subagents.personas]` or
  `.grok/personas/*.toml`. A persona can declare `default_isolation = "worktree"`
  — this is where grok's **git-worktree** isolation ties in.

Disable subagents with `GROK_SUBAGENTS=0` or `[subagents] enabled = false`.

## How the extension handles it

- `isSubagentToolCall(call)` / `subagentLabel(call)` (pure, in
  `media/webview-helpers.js`) — match `spawn_subagent` (by name and by
  `rawInput.subagent_type`), with broad fallbacks for relabeled titles / renames;
  degrades gracefully (no match → existing tool-group behavior). The label is the
  `subagent_type` (e.g. "general-purpose").
- `media/chat.js` renders a distinct **Subagent: \<type\>** card
  (`addSubagentCard`); `media/chat.css` `.subagent-card`.

## Still open (couldn't capture live)

A trivial prompt did **not** make grok-build spawn a subagent — it just ran
`run_terminal_command`. Triggering a real `spawn_subagent` is non-deterministic
and needs a genuinely delegation-worthy task (or defined `.grok/agents`). So we
have the **tool name + params confirmed from docs**, but not a captured live
`spawn_subagent` tool_call payload. Two follow-ups for when one is captured:

1. Confirm the exact relabeled update title and the full `rawInput` shape.
2. Build the real **nested inspector**: correlate each child's tool calls under
   its parent card (needs to learn how child updates carry the parent id — likely
   a nested session id or a `_meta` field). Today's card is a flat labeled marker.
