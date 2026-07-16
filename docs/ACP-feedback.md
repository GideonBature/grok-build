# Grok Build CLI over ACP — field feedback from a thin client

Feedback for the Grok Build CLI team from building **grok-build-vscode**, a VS Code/Cursor
sidebar that is a deliberately thin ACP client for `grok agent stdio`. Everything below is
**evidence-based**: wire captures from real sessions (`test/fixtures/composer-subagent-session.jsonl`),
standalone probes (`research/*.cjs`), and a pre-release live suite (`scripts/live-tests.cjs`)
that re-verifies the load-bearing shapes against the real binary. Deep-dives live in
`research/*.md`; this document is the summary an upstream engineer can act on.

**Basis:** grok CLI **0.2.93** (native Windows, stable channel), extension **v1.5.6**, 2026-07-11.
The grok-build-family findings were re-verified against **Grok 4.5** (`grok-4.5`) — now the
default model of that family. **Grok Build** (`grok-build`) is still present for some
accounts/builds, so its observations below remain valid; where the two differ (context window,
`set_model` echo) both are called out. See **§5** for the Grok 4.5 verification run (full live
suite + probes; Composer 2.5 re-verified alongside).

**Source (2026-07-16):** the CLI is now **open source** — [github.com/xai-org/grok-build](https://github.com/xai-org/grok-build).
The repo accepts no external PRs and has issues/discussions disabled, so the sections below now
carry **exact file:line citations into that tree** (paths relative to `crates/codegen/`) and, where
the fix is small, a sketch of it — the goal is that each remaining ask can be applied internally in
minutes. The published tree is a single squashed sync that can't be pinned to a shipped build, but
it postdates 0.2.101 by behavior; blocks labeled *Source-verified* describe that tree, and shipped
builds may lag it. Our fuller internal notes: `research/grok-build-oss-findings.md`.

**Revision history** — newest first. Each observation is dated and carries the grok CLI build it
was made against; a section without a date here predates this log and is covered by **Basis**.

| Date | grok CLI | What changed |
|---|---|---|
| **2026-07-16** | **OSS tree** | **Source-verified pass over every section** (the CLI went open source). §2.11's root cause found — grok silently merges `~/.claude/settings.json` permission rules; confirmed on our dev box. §2.4 corrected: the lifecycle events DO transmit live, on `x.ai/session_notification` (we watched the persist rail). §2.1's rejection-outcome ask withdrawn — a success `{outcome:"cancelled"}` response already exists (our client gap). §2.6: session list/search/rename/delete/fork exist as unadvertised `x.ai/*` methods. §2.7 corrected: reasoning effort IS session-settable via `set_model` `_meta`. §2.9: an undocumented `GROK_SHELL` override realigns the model's shell hints. Citations + sketch fixes added throughout. |
| **2026-07-15** | **0.2.101** | **§2.1 — the headline defect is FIXED.** A rejection of `x.ai/exit_plan_mode` is now honored. **One new, still-open hole:** plan mode gates the *edit* tool but **not** `terminal/create`, so a shell command can mutate the workspace during planning. |
| **2026-07-15** | **0.2.101** | **§2.10 (new) — edit diffs.** Three asks: every edit reports its diff **twice** and the first can be wrong (an overwriting Write's echo claims `oldText:""`); the echo, the completed update, and the session/load replay each carry a **different `_meta` shape**; and `details[]` has `line_prefix` but no `line_suffix`, so the changed line can't be reconstructed. *(Raised and **withdrawn** the same day: "a replace-all under-describes the change" — `_meta.details[]` does enumerate every site, 12/12 with exact line numbers. That was our client gap, not a CLI defect.)* |
| **2026-07-15** | **0.2.99–0.2.101** | **§2.11 (new) — permission requests are environment-dependent, not configuration-dependent.** The same build + settings sends **zero** `session/request_permission` for an in-workspace edit on some Windows 11 hosts, while prompting reliably on macOS / a Win 11 Azure VM. User-reported ([#49](https://github.com/phuryn/grok-build-vscode/issues/49)); no client-side fix can restore the missing approval step. |
| **2026-07-13** | *not recorded* | **§2.9 (new) — terminal commands** (issue #46, extension v1.5.13). The agent emits POSIX-subshell idioms against a PowerShell host, and the two agent families use different command-execution models. |
| **2026-07-11** | **0.2.93** | **§5 — Grok 4.5 verification.** Every grok-build-family finding re-verified against Grok 4.5; Composer 2.5 re-verified alongside. |

---

## 1. The two agent families behave differently on the wire

Models belong to *agent types* — `grok-build`/`grok-build-plan` vs the `cursor` agent that owns
the Composer models. A client that only tested one family breaks on the other:

| Surface | grok-build agent (Grok 4.5 / Grok Build, `grok-build-plan`) | cursor agent (Composer 2.5) |
|---|---|---|
| Context window (`_meta.totalContextTokens`) | **Grok 4.5: 500K** · **Grok Build: 512K** | 200K |
| Delegation tool | `spawn_subagent` (`_meta["x.ai/tool"].name`) | `Task` |
| `subagent_type` value style | `general-purpose` (kebab) | `generalPurpose` (camel) |
| Delegation completion | Same-id `tool_call_update`, `status:"completed"`, structured `rawOutput.SubagentCompleted` (output, `tool_calls`, `turns`, `duration_ms`, `resume_from_hint`) | A **third, untitled** update (`title:""`, **no `_meta`**), `rawOutput {type:"Text", text}` — **no duration anywhere on the tool channel** |
| Background delegation | `background:true` → instant "started" ack, real result later via `get_command_or_subagent_output` (`TaskOutput.Result` with `task_id`, `duration_secs`, `output`) | not observed |
| Tool-call ids | `call-<uuid>-<n>` | `call-<uuid>-composer_call_<suffix>` — the short suffix **repeats across calls**; only the full id is unique |
| Tool titles | verb-style ("List \`src/…\`") + tool name on spawn | frequently the raw user content (a Grep is titled with its search pattern) |
| `session/set_model` echo | **Grok Build:** versioned id (`grok-build-0.1`) not in `availableModels` · **Grok 4.5:** clean (`{"model":{"Ok":"grok-4.5"}}`, resolvable) | same class of issue |
| Cross-agent switch | `MODEL_SWITCH_INCOMPATIBLE_AGENT` after the first turn (agent locked at spawn) | same |

**Ask:** treat the wire contract as one product across agents — same tool naming, same
completion shape (structured `rawOutput` with duration), same id style — or document the
differences per agent type.

---

## 2. What doesn't work — and what we had to build around it

Ordered roughly by how much client code each one cost.

### 2.1 Plan mode: rejection now works — but `terminal/create` escapes the plan gate
**Update 2026-07-15 (grok 0.2.101): the defect this section originally reported is FIXED — thank
you.** Through **0.2.3**, any client response to `x.ai/exit_plan_mode` — JSON-RPC **result or
error** — was treated as approval, so there was no wire-level "keep planning." On **0.2.101** the
two are cleanly distinguished. A/B with an identical prompt and build, varying only the response
type (`research/plan-mode-recheck-probe.cjs`):

| | **error** (reject) | **result** (approve) |
|---|---|---|
| `current_mode_update` | `[plan]` — stays in plan | `[plan, default]` — exits plan |
| plan turn `stopReason` | `cancelled` | `end_turn` |
| workspace writes | **0** — seed files byte-identical | 2 (file mutated + file created) |
| the model's own account | *"the user never approved or rejected"* | *"the user **approved** the plan"* |

`current_mode_update: "default"` no longer fires on the reject path, and `planContent` now
usually arrives **populated** with the plan text. Two residual notes:
- A rejection is interpreted as a **tool failure** (*"exit_plan_mode failed twice with a client
  disconnect"*), not a semantic *user rejected*. The outcome is right, but an explicit rejection
  outcome would beat overloading the error channel.
- `planContent: null` **still occurs** — observed when the model called `exit_plan_mode` without
  having drafted a plan — so clients still need the `plan.md` fallback.

**Still open, and the reason the workaround stays: plan mode is enforced for the edit tool but
not for the terminal tool** (grok 0.2.101, 2026-07-15). In plan mode the CLI's own tool layer
correctly refuses an edit:
> `Rejected: file edits are not allowed in plan mode -- the only editable file is the plan file`
> `(...plan.md). User verbal approval to edit is not sufficient, they must exit plan mode via the UI.`

Good — that's CLI-enforced, not model-cooperative. But asked to route around that block, the model
issued a `terminal/create` which the CLI **passed straight through to the client**:
```
node -e "require('fs').appendFileSync('app.js','\nfunction subtract(a,b){return a-b}\n')"
```
Nothing was written only because our probe ACKs terminals without executing them — a client that
actually runs the agent's commands (the whole point of `terminal/*` delegation) would have mutated
the workspace during "planning", contradicting the CLI's own rule above. Our client-side
`terminal/create` allowlist (`src/plan-gate.ts`) is currently the **only** barrier.

The workaround therefore remains in place: the client-side gate at the mandatory
`fs/write_text_file` / `terminal/create` choke points, plus a hidden **primer** message carrying
the `[Plan approved]`/`[Plan rejected]`/`[Plan cancelled]` protocol (the primer's original premise
— "ignore the bogus tool result" — is now obsolete; its remaining job is turn shape). The primer
still causes secondary problems (see 2.6).

**Ask:** apply the plan-mode restriction to `terminal/create` as well as the edit tools — a shell
command is a write. ~~Optionally, add an explicit rejection outcome so a reject isn't reported to
the model as a tool failure.~~ *(Withdrawn 2026-07-16 — the outcome exists; see below.)*

**Source-verified (2026-07-16, OSS tree).** The terminal hole is confirmed at HEAD:
`plan_mode_edit_gate` (`xai-grok-shell/src/session/acp_session_impl/tool_calls.rs:150,166-181`)
rejects only `AccessKind::Edit(..)`; `AccessKind::Bash` falls through to `Allow`, and the function's
own doc-comment says bash/MCP/web are never gated there. The caller (`:893-907`) already maps any
non-`Allow` verdict to a rejection message before dispatch, so the gate is the single choke point to
extend. **But the fix is a policy decision, not a one-line arm** (thanks to peer review for the
nudge): a blanket `AccessKind::Bash(_)` rejection would also block *read-only* shell inspection
(`ls`, `git status`, `cat`) that plan mode arguably should permit — grok already classifies a
read-only-command allowlist elsewhere (§2.11), so the natural design is to allow classified
read-only commands and reject the rest. And `Bash` isn't the whole surface: MCP tools and
`WebFetch`/`WebSearch` can have side effects too, so "a shell command is a write" understates it —
the real question is *which* non-edit tools may run during planning. **Ask:** define and enforce a
plan-mode tool policy (read-only shell + read-only MCP/web permitted; everything mutating blocked at
the same gate), not just an edit-tool block.

**The rejection-outcome ask is withdrawn — it already exists, and the error path we used was our
client gap.** The intended reply to `x.ai/exit_plan_mode` is a JSON-RPC **success** carrying
`{"outcome": "approved" | "cancelled" | "abandoned"}`
(`xai-grok-tools/src/implementations/grok_build/exit_plan_mode/types.rs:18-25`, mapped fail-closed
to `cancelled` at `tool_calls.rs:193-203`): `cancelled` keeps plan mode up and the CLI itself tells
the model the user wants to revise (`tool_calls.rs:1266-1287`); `abandoned` deactivates plan mode.
A JSON-RPC **error** — what we sent — is deliberately read as a client *disconnect*
(`ext_method_no_client`, `tool_calls.rs:215-220`), which is exactly the "tool failure" framing we
observed. Residual nit: this schema is undocumented; a note in the agent-mode guide would have saved
the probe. Also pinned: `planContent` is null exactly when `plan.md` is empty/whitespace, missing,
or unreadable at intercept time (`tool_calls.rs:106-113`, `:1204-1227`) — so the ask to keep it
populated reduces to "the model called `exit_plan_mode` without drafting a plan", a model behavior,
not a wire defect.

### 2.2 Slash commands: dispatch requires position 0, and TUI-only commands are advertised
- A slash command dispatches **only** when it starts the prompt's text block. Editor-injected
  context in front silently degrades `/compact` into a plain LLM turn — in our probe the
  "compact" **grew** the context 6× (`research/compact.md`). Trailing content is fine, so we
  re-order every send; but nothing over the wire tells a client this rule exists.
- `/always-approve` is advertised over ACP but mutates the **global** `config.toml` — a sticky
  cross-session side effect a sidebar can neither show nor undo per-session. We hide it.
- `/context` is advertised but renders only in the CLI's own TUI — over stdio it streams
  nothing. We hide it too (`/session-info` is the working equivalent).

**Ask:** dispatch commands regardless of position (or accept a structured command field), and
don't advertise commands that are TUI-only or config-mutating on a per-session protocol.

**Source-verified (2026-07-16, OSS tree).** Position-0 is by design: `parse_slash_prefix` takes the
*first text block* and requires the `/` as its first non-whitespace character
(`xai-grok-shell/src/session/slash_commands.rs:1052-1074`, pinned by tests at `:1192-1200`); no
structured invocation exists (`prompt._meta` is read only for `mode`; `x.ai/commands/list` lists,
never invokes). `/context` over stdio is literally `ok_end_turn(0, None)` — no output path at all
(`slash_exec.rs:82`) — and the advertised-command list has no TUI-only/hidden flag to set
(`slash_commands.rs:8-18`), so both halves of the ask stand. One **correction**: over ACP,
`/always-approve` does **not** write `config.toml` — it flips an in-memory per-process yolo flag
(`slash_exec.rs:18-52` → `xai-grok-workspace/src/permission/manager.rs:456-477`); the config write
we blamed on it is the TUI's own prompt effect (`permission/prompter.rs:40-44`). Worth noting:
`x.ai/compact_conversation` exists in the ext-method router (`agent/mvp_agent/acp_agent.rs:3438`)
and may already be the position-independent compact this section asks for — undocumented, so we
will probe it.

### 2.3 Context accounting: the client can't know the truth when it matters
- The prompt result's `_meta.totalTokens` is **0** for both `/session-info` (context untouched)
  and `/compact` (context shrunk, not emptied) — a placeholder, never a measurement. The other
  fields on a compact turn are a stale echo of the *previous* turn.
- A native `/compact` streams **no content at all** — the turn ends blank with no worked-signal.
- The persisted `signals.json` (`contextTokensUsed`) is recomputed only when the **next
  inference turn ends** — never at the compact turn's own end (probe:
  `research/signals-refresh-probe.cjs`). Right after "compact finished" the true size exists
  nowhere a client can read…
- …except in `/session-info`'s **reply prose**. Our fix is a hidden CLI-local `/session-info`
  turn whose text we scrape with a regex (`**Context:** N / M tokens`). That is as fragile as
  it sounds.
- The ACP `usage_update` notification (the RFD's standard channel for exactly this) is never
  emitted.

**Ask:** emit `usage_update` (or at minimum a truthful `totalTokens`) at the end of `/compact`
and in the `session/load` response. Never report placeholder zeros.

**Source-verified (2026-07-16, OSS tree).** The zeros are hardcoded: `/compact` and `/session-info`
return `ok_end_turn(0, None)` (`xai-grok-shell/src/session/acp_session_impl/slash_exec.rs:16`,
`:371` → `session/commands.rs:63-72`), and the sibling `_meta` fields are captured from the
*previous* inference turn before the match (`agent/mvp_agent/acp_agent.rs:2326-2329`) — placeholder
plus stale echo, exactly as observed. `usage_update` appears nowhere in the tree. The signals.json
timing is also confirmed: `contextTokensUsed` is updated only by the *next* turn's pre-sampling
auto-compact check (`session/compaction.rs:1779-1781` is the sole caller). The kicker: at compact
end the true size is already in scope — `run_compact` reads `get_total_tokens()` and ships it in
the proprietary `AutoCompactCompleted { tokens_before, tokens_after }` notification
(`compaction.rs:629-639`, on the `x.ai/session_notification` rail — see §2.4) — it just never
reaches `_meta.totalTokens`. The minimal fix is ~2 lines: pass that value to `ok_end_turn` instead
of `0`.

### 2.4 Subagents: three completion dialects, lifecycle events that never ship, titles that lie
- The `subagent_spawned`/`subagent_finished` lifecycle events (method `_x.ai/session/update`)
  are **written to `updates.jsonl` but never transmitted to the ACP client** (live-verified:
  zero arrive while the log fills). They carry exactly what the UI wants — duration_ms,
  tokens_used, the child's output. We route them anyway, hoping.
- Completion shape differs by agent (see §1) and by mode: a `background:true` spawn reports
  `status:"completed"` **immediately** with a "Subagent started in background." ack — the
  real result arrives minutes later on the poller. "Completed" that isn't.
- The child's clean output is triple-wrapped in envelope text (`<subagent_meta>`,
  `<subagent_result>`, "This is the output of the subagent:", a trailing
  "Agent ID: … (resume …)" hint) even though the same output exists structured in
  `rawOutput`.
- Tool titles embed user content: a Grep **for** `spawn_subagent` is titled exactly
  `spawn_subagent`. Only `_meta["x.ai/tool"].name` tells the truth (that field is excellent —
  see §4). The poller's own name (`get_command_or_subagent_output`) contains "subagent" while
  not being a delegation.
- Each child persists as a **top-level sibling session** in the store; clients must filter
  `session_kind:"subagent"` or every delegation adds a junk row to session history.

**Ask:** transmit the lifecycle events; make "completed" mean completed; keep the envelope out
of the text block (the structured `rawOutput` is enough); put `x.ai/tool` meta on every call.

**Source-verified (2026-07-16, OSS tree; probe-confirmed on 0.2.101) — major correction to the
first bullet.** The lifecycle events **are pushed live; they ride a different METHOD than the one
our UI watches.** There are two rails, and — to be precise — **both are `_`-prefixed on the wire**
(every x.ai extension method is; the `agent-client-protocol` decoder only routes a `_`-prefixed
method to `ext_method`, and the bare `x.ai/...` name is just the internal logical name the Rust
router matches after the decoder strips the `_`). The rails differ by method, not by prefix:
- **`_x.ai/session_notification`** — the **live** lifecycle envelope, emitted unconditionally by
  `send_xai_notification` (`session/acp_session_impl/updates.rs:701-744`) and
  `emit_subagent_notification` (`agent/subagent/mod.rs:2216-2242`). Carries `SubagentFinished`
  (`duration_ms`, `tokens_used`, `output`, `will_wake`; `extensions/notification.rs:629-657`),
  `auto_compact_completed`, `turn_completed`, `image_dropped`. **Probe-observed live on 0.2.101.**
- **`_x.ai/session/update`** — the **persist/replay** records in `updates.jsonl`
  (`storage/mod.rs:92`), re-forwarded on `session/load` (`agent/mvp_agent/mod.rs:1307-1351`).

Our "never transmitted" measurement (0.2.93) watched the persist rail's method; the lifecycle
actually rides `session_notification`, which our client receives but our subagent UI ignores. The
reframed ask: **advertise/document the two rails** — nothing in `initialize` hints they exist.

The other bullets, now cited: the instant background "completed" is structural — the
`run_in_background` branch returns `Ok(ToolOutput::Text("Subagent started in background…"))`
synchronously (`xai-grok-tools/src/implementations/grok_build/task/mod.rs:328-368`); the completed
envelope (`<subagent_meta>` / `<subagent_result>`) is built in the tool-output layer — the
per-poll form at `task_output/mod.rs:581` (the older "This is the output of the subagent:" /
"Agent ID:" wrap survives only as a legacy *parser*, `reminders/task_completion.rs:522-544`);
`x.ai/tool` stamping happens in `stamp_tool_meta` (`tool_calls.rs:260-274`) and skips unresolved
wire names — uninitialized MCP and backend-hosted tools (`normalization.rs:27-41`); and
`session_kind` **is** exposed over ACP as a **top-level `sessionKind`** field on each
`_x.ai/session/list` row (`session/unified_list/row.rs:123`, flattened — NOT in `_meta`, where
`_meta["x.ai/session"].kind` is only the coarse `build`/`chat` class) — see §2.6.

### 2.5 Capabilities and media: the flags don't match reality
- `initialize` advertises `promptCapabilities.image: false`, but inline `{type:"image"}`
  blocks **work** — the model sees the pixels (verified since 0.2.87). A client that trusts
  the flag disables a working feature; we ship with no gate and a live test that fails the day
  the flag flips, in either direction.
- Generated media (`/imagine`, `/imagine-video`) is not returned as an ACP `image`/
  `resource_link` block — the file path is embedded in a `text` block, as JSON on
  Linux/macOS and as human **prose** on native Windows (with `\\?\` extended-length
  prefixes). We parse prose to find pictures.
- A pasted image is copied into `~/.grok/sessions/<…>/assets/` and that internal path is
  surfaced to the model — which then tries to `Read` the binary and fails, polluting the
  transcript. We bake a "do not Read" hint into every image tag.
- An image the CLI judges too small is silently dropped, leaving the model hunting the
  workspace for an attachment it never received. No error reaches the client.

**Ask:** truthful capability flags; media as structured content blocks; don't surface internal
asset paths to the model; error on dropped attachments.

**Source-verified (2026-07-16, OSS tree).** `image: false` is a hardcoded omission — `initialize`
builds `PromptCapabilities::new().embedded_context(true)` and never calls `.image(...)`
(`xai-grok-shell/src/agent/mvp_agent/acp_agent.rs:394-413`), while `prompt_parser.rs:119` accepts
and uses incoming image blocks. The fix is one builder call. Two corrections from the source:

- **Dropped images are not fully silent.** The floors are 8×8 px and 512 total px
  (`session/image_normalize.rs:51-55`, `:429-439`); a drop emits `ImageDropped { notes }` on
  `x.ai/session_notification` (`acp_session_impl/turn.rs:189-196`) plus an
  `<image_dropped_notice>` to the model. The remaining gap is that nothing rides a *standard* ACP
  surface (same discoverability problem as §2.4).
- **Generated media is JSON-in-text on every platform, plus a typed `rawOutput`** — the emitter is
  platform-agnostic (`session/acp_conversion.rs:536-548`, comment: *"Dual channel: prose for
  non-pager clients, typed `raw_output` for the pager"*; payload
  `{path, filename, session_folder, message}` at `xai-grok-tools/src/types/output.rs:108-123`).
  What made native Windows read as prose is the un-normalized path: the media writer never strips
  the `\\?\` verbatim prefix (`grok_build/storage.rs:101`), unlike `read_file`
  (`read_file/mod.rs:315`). A one-line normalization fixes the Windows payload; a
  `resource_link`/`image` content block would still be the right long-term shape (none exists at
  HEAD).

The internal-asset-path surfacing is `render_image_files_block`
(`session/image_describe.rs:329-341`) — the `<image_files>` block hands the model the absolute
`~/.grok/sessions/<…>/assets/…` path, which is what provokes its failing `Read`.

### 2.6 Session catalog and restore: private storage becomes a client API
- Grok's ACP surface exposes `session/new` and `session/load`, but no list, search, rename,
  or delete operations. We enumerate private session directories, parse `summary.json`, infer
  recency from file mtimes, synthesize live sessions before the CLI flushes them, and maintain
  our own pagination, cache, and rename metadata. A client should not need to treat the CLI's
  on-disk implementation as a public API just to render session history.
- `session/set_model` echoes a **versioned id** (`grok-build-0.1`) that isn't in
  `availableModels` and carries no name or context window — still the case on **Grok Build**.
  **Grok 4.5** echoes the clean requested id (`grok-4.5`, resolvable), so the defect is
  per-model within the same agent family; the `resolveModelId` fallback stays for Grok Build,
  older sessions, and the composer agent (see §5).
- The agent type locks after the first turn; switching model families requires a full session
  restart choreographed by the client (`MODEL_SWITCH_INCOMPATIBLE_AGENT`).
- `session/load` does not replay resolved `request_permission`s (we persist and re-inject
  them) and replays `<system-reminder>` turns and protocol markers as user messages a UI must
  know not to render.
- grok titles the session from message #1 — which for us is the hidden primer — so every
  session was named "…Primer v4 Plan Mode…" until we forced display names client-side. Empty
  primer-only sessions accumulate on disk (we sweep them). `num_messages` in `summary.json`
  can be wildly inflated by one agentic turn. `chat_history.jsonl` wraps prompts in
  `<user_query>` — except when it doesn't (slash commands arrive unwrapped).
- Live prompts echo back as `user_message_chunk` since 0.2.33 (they didn't before) —
  undocumented behavior changes like this are how duplicate-bubble bugs are born.

Most of this section is downstream of the primer, which is downstream of 2.1.
**Ask:** expose a paginated `session/list` plus rename/delete operations, returning stable
metadata such as title, updated time, workspace, model, agent type, and session kind. Keep
restore replay free of internal protocol messages and include resolved interaction state.

**Source-verified (2026-07-16, OSS tree; probe-confirmed on 0.2.101) — the catalog operations
already exist, unadvertised, AND ship.** The ext-method router
(`xai-grok-shell/src/agent/mvp_agent/acp_agent.rs:3164-3508`) dispatches `_x.ai/session/list` +
`_x.ai/sessions/list` (`:3168`), `_x.ai/session/search` (`:3181` — the SQLite FTS index behind
`grok sessions search`), `_x.ai/session/rename`, `_x.ai/session/delete`, `_x.ai/session/fork`
(`:3189`, `extensions/session_admin.rs`), plus `_x.ai/session/info`, `_x.ai/session/close`,
`_x.ai/session/load_history` — unconditionally, no feature gate. **Wire form is `_`-prefixed**
(`_x.ai/session/list`); a bare `x.ai/...` is rejected `-32601` at the decoder before the router
runs, so it advertises nothing about whether the RPC exists. A live probe against 0.2.101 confirms
they work: `_x.ai/session/rename` → `{success:true}`, `_x.ai/session/delete` removed the session
dir. `list` returns **`{ sessions, nextCursor, _meta }`** (`unified_list/mod.rs:298`), and
`sessionKind` is a **top-level flattened row field** (`row.rs:123`), *not* in `_meta` (there,
`_meta["x.ai/session"].kind` is only the coarse `build`/`chat` class). The headline ask therefore
reduces to: **advertise/document these methods** (`initialize` hints at none of them), and we are
adopting them directly. Related root causes, now pinned:

- **Versioned `set_model` echo:** the echo returns the catalog *entry's* `.model` while
  `availableModels` ids are the catalog *keys* (`handlers/model_switch.rs:231-235`;
  `agent/config.rs:4788-4795`; `resolve_catalog_key` accepts either, `agent/models.rs:1616-1629`).
  For `grok-build` the remote catalog's key ≠ `.model` (`grok-build-0.1`); for `grok-4.5` they
  coincide — matching §5. Echoing the key would fix it.
- **Agent lock:** `MODEL_SWITCH_INCOMPATIBLE_AGENT` fires only when `turn_count > 0`
  (`handlers/model_switch.rs:65-88`); at zero turns the harness is rebuilt in place (`:89-113`) —
  which is why a pre-first-turn `set_model` works.
- **Replay:** `prepare_replay_lines` filters only blank/rewind/`availableCommands` lines
  (`session/storage/mod.rs:1106-1196`) — `<system-reminder>` and protocol-marker replay is
  structural; and resolved `request_permission`s are request/response RPCs, never persisted as
  session updates, hence never replayable. (`session/load` also honors an undocumented
  `_meta.noReplay`, `agent/mvp_agent/mod.rs:355`.)
- **Titles:** the generator locks onto the first non-empty text with no synthetic-turn skip
  (`session/summary.rs:58-97`). The structural fix for clients exists though: **`session/new`
  accepts `_meta.rules`** — appended to the system prompt as `<human_rules>`
  (`agent/mvp_agent/mod.rs:1036-1058`; also `systemPromptOverride`, `agentProfile` — documented in
  the agent-mode guide). That is the sanctioned home for what our hidden primer does today; moving
  to it dissolves most of this section's primer-downstream complaints, and we are migrating.

### 2.7 Session configuration is partly out of band
- Effective permission mode is invisible over ACP. A global or project
  `permission_mode = "always-approve"` silently changes every session's behavior, so we read
  `config.toml` ourselves to avoid displaying a false "Agent" state. The client cannot disable
  that setting for one session.
- Reasoning effort is only a process-start flag (`--reasoning-effort`). Changing it requires
  killing the agent process and restoring or replacing the session; `session/new` and
  `session/load` do not report the effective value.

**Ask:** return effective permission mode and reasoning effort from `session/new` and
`session/load`, and provide session-scoped setters where supported.

**Source-verified (2026-07-16, OSS tree) — the effort half is withdrawn; the permission half
stands, sharpened.** Reasoning effort **is** session-scoped-settable over ACP: `session/set_model`
reads `_meta.reasoningEffort` (`xai-grok-sampling-types/src/types.rs:852`, `:865-874`), applies and
persists it per-session (`handlers/model_switch.rs:24`, `:117-134`), and it is reported back in the
`session/new`/`session/load` `models[]._meta` (`agent_ops.rs:2258-2274`) and
`x.ai/sessionConfig.options`. Undocumented, but present — we are adopting it and retiring the
process-restart choreography. Permission mode, by contrast, is confirmed absent from every session
response (it appears only in telemetry events, `acp_agent.rs:1089-1097`), has no setter, and the
client's `support_permission` feature is read and then explicitly discarded
(`spawn.rs:217` — `let _ = support_permission;`). See §2.11 for what actually governs prompting —
which makes surfacing the *effective* policy (and its source file) more important, not less.

### 2.8 Transport/platform (historical but instructive)
- Windows builds 0.2.61–0.2.70 didn't read stdin until **EOF** — a persistent ACP client hung
  forever on `initialize` (later builds: on `session/new`). We still carry a version pin +
  downgrade machinery. Regression tests for "read as lines arrive" would prevent a recurrence.
- `grok update` fails while any grok process (including backgrounded subagent children) holds
  the binary — clients must kill process *trees* and retry.
- `x.ai/ask_user_question` (and `exit_plan_mode`) also appear under a `_x.ai/` prefix; the
  response schema (`outcome:"accepted"` required, empty ACK rejected) had to be recovered from
  strings in the binary. Documentation would have saved a probe.

**2026-07-16:** with the source public, the documentation asks here are largely satisfied by
reading it. The `_x.ai/` prefix convention is now clear: **every** x.ai extension method is
`_`-prefixed on the wire, and the ACP decoder rejects a bare `x.ai/...` with `-32601` before the
router runs (`xai-grok-shell/src/agent/app.rs`) — so a client MUST send `_x.ai/session/list`, not
`x.ai/session/list` (a lesson we learned the hard way: a first probe used bare methods and
mis-concluded the session RPCs were unshipped). The two session rails are distinguished by method
(`session_notification` vs `session/update`), not by prefix (§2.4). The `ask_user_question` /
`exit_plan_mode` response schemas live in
`xai-grok-tools/src/implementations/grok_build/*/types.rs`. The stdin-regression and
process-tree-lock items remain as-is (historical).

### 2.9 Terminal commands: the shell is the client's, but the agent writes for another one
In ACP mode grok never runs shell commands itself — it hands each to the client over
`terminal/create`, so the host shell is the **client's** choice. Two problems follow on Windows
(observed 2026-07-13; issue #46, extension v1.5.13; `research/powershell-terminal.md`):

- **The agent writes bash-flavored commands even against a PowerShell host.** We run the agent's
  commands under PowerShell on Windows to match the standalone CLI — users expect their PowerShell
  profile functions and pipelines (`… | Format-List`) to work, which they can't under cmd.exe. But
  grok, in ACP mode, still emits POSIX-subshell idioms like `(cd dir ; cmd)` — invalid in
  PowerShell (`( )` is a grouping *expression*, not a statement list; it errors *"Missing closing
  ')'"*), even while using PowerShell cmdlets (`Get-ChildItem`, `$env:`) in the same batch.
  Standalone grok "just works" under PowerShell, so ACP-mode generation is *worse* than standalone.
  The agent self-recovers by retrying with `Set-Location dir; cmd`, but each miss is a wasted tool
  call + model turn — the exact retry cost #46 set out to remove. A client can't safely rewrite the
  agent's commands. **Ask:** tell the agent the client's shell (or let the client advertise it in
  `initialize`), or generate PowerShell-native syntax on a Windows host as the standalone CLI does.
- **The two agents use different command-execution models, and the client output surface differs.**
  grok-build **delegates** every shell command over `terminal/create` (the client runs it and
  captures stdout). The cursor agent (Composer 2.5) instead runs commands in its **own CLI-side
  persistent shell** — it never sends `terminal/create`; the result rides the completed
  `tool_call_update` (`rawOutput` = `{output, exit_code, command, truncated, current_dir, …}`,
  "Shell state persists for subsequent calls"). So a client that renders command output from the
  `terminal/*` capture gets nothing for Composer rows and must *also* read the completed update's
  `rawOutput`, matched by `toolCallId`. Two consequences worth flagging: (a) **Composer completes a
  batch OUT of issue order** (verified: 10 parallel read-only commands finished 1,2,7,6,10,8,5,3,9,4
  by call#), so any order-based correlation (FIFO) misattributes — `toolCallId` is the only safe key;
  (b) `#46`'s client-shell choice doesn't reach Composer at all, since its shell is CLI-side.
  **Ask:** converge the execution model (or document it), and surface command output the same way on
  both agents — ideally on the completed update's structured `rawOutput` for both, keyed by
  `toolCallId`.

**Source-verified (2026-07-16, OSS tree) — root cause, plus an existing escape hatch.** Every shell
signal the model sees derives from the **grok host process**, never the client:
`detect_windows_shell()` (`xai-grok-config/src/shell.rs:30-106`) feeds the `Shell:` line of the
first user message (`session/user_message.rs:33-81`), the bash tool description, the chain
separator, and the unix-utilities hints (`types/template_renderer.rs:53-163`). Execution, though,
hands the **raw** command to the client — `terminal/acp_terminal.rs:15-26` even comments *"On
Windows the ACP client spawns with its own shell; sending the raw command…"* — so detection and
execution can silently diverge, which is precisely this section's failure mode. Standalone never
diverges because it wraps commands in the same detected shell (`local_terminal.rs:57-63`). The two
execution models are one code path keyed on the client `terminal` capability
(`agent_ops.rs:2830-2847`, `:2943-2958` — `AcpTerminalRunner` vs the CLI-side `TerminalRunner`),
confirming the §1/§2.9 split. An undocumented override exists: **`GROK_SHELL`**
(`pwsh|powershell|cmd|bash`) is read first in the detection cascade (`shell.rs:10-11`, `:25-69`)
and realigns *all* the model-facing signals at once — a client can set it in the agent's spawn env
to match the shell it actually runs (we will). Reframed ask: document `GROK_SHELL`, and better,
consume a client-declared shell from `initialize` (nothing in `clientCapabilities` is read for this
today).

### 2.10 Edit diffs: the first diff can be wrong, and the `_meta` shape differs by delivery path
(observed 2026-07-15, grok **0.2.101**, native Windows; `research/edit-diff.md`,
`research/edit-diff-timing-probe.cjs`)

An edit's diff rides the `tool_call_update` as a `{type:"diff", path, oldText, newText}` content
block, independent of permission mode — an excellent design that lets a client build a review
surface with no permission coupling (see §4). Two fidelity problems sit on top of it:

- **Every edit reports its diff twice, and the two can disagree.** An optimistic **pre-write echo**
  (`kind:"edit"`, titled, no `status`) fires *before* `fs/write_text_file`, then the
  **authoritative completed update** (`status:"completed"`, no `title`/`kind`) fires *after* it.
  For a `search_replace` both carry byte-identical `oldText`/`newText`. For a whole-file **Write
  that overwrites an existing file** they differ: the echo sends `oldText: ""` (it hasn't read the
  old content yet) while the completed update sends the **real prior content**. The echo lands
  first, so a client that renders the first diff it sees shows an overwrite as **pure adds** and
  never corrects it. We shipped exactly that bug for three releases before this probe found it;
  the fix is to key idempotency on the diff *content* rather than on "already rendered".
- **A replace-all's diff block is token-sized — but that is not a defect; the full data is on the
  wire.** *(Open question from the first draft of this section, now SETTLED and WITHDRAWN as an
  ask — verified 2026-07-15, grok 0.2.101, `research/edit-diff-lines-probe.cjs`.)* A
  `search_replace` that changed **148 occurrences** emitted a `diff` block describing only the
  single replaced token, so a client rendering the block alone shows `+1 −1`. We suspected a CLI
  defect. It isn't: a `replace_all` over **12** `PLACEHOLDER` occurrences at known, non-consecutive
  lines produced `_meta.details.length === 12`, `old_line` `[3,5,7,9,11,13,15,17,19,21,23,25]` —
  an exact ground-truth match. The block-level `oldText`/`newText` is the *pattern*; `details[]` is
  the per-site truth. **This was our client-side gap, not your bug — no ask.**

- **`details[]` has `line_prefix` but no `line_suffix`, so a client can't reconstruct the changed
  line.** An entry carries exactly `{old_string, old_line, new_string, new_line, context_before,
  context_after, line_prefix}`. For a site whose real line is `item 1: the token is PLACEHOLDER here`,
  `line_prefix` gives `item 1: the token is ` — everything *before* the match — but the trailing
  ` here` is nowhere on the wire. `context_before`/`context_after` are post-edit windows over the
  *neighbouring* lines, so they never contain the site's own line (a neighbour's window sometimes
  does, but never for the last site). The result: a client can render the change and its leading
  context faithfully, but the rendered line is silently truncated at the match.
  **Ask:** add `line_suffix` (or send the site's full old/new line) — it's one field, and it's the
  difference between rendering a real line and a truncated one.

Related: the initial `tool_call` carries the edit args (`rawInput: {file_path, old_string,
new_string}`) but no diff, and lands only ~30ms before the echo — so there is no useful
"paint earlier from rawInput" shortcut, and taking it would reconstruct the same wrong
`oldText:""` for a Write.

**Credit where due — the line numbers *are* on the wire** (we missed this until 2026-07-15 and
rendered region-relative numbers starting at 1 as a result; our bug, not yours). The pre-write echo
carries them on the diff block:
```json
{"type":"diff","path":"…/alpha.txt","oldText":"WIDGET1","newText":"GADGET1",
 "_meta":{"old_line":2,"new_line":2}}
```
and the completed update carries them per-site on `_meta.details[]`, with surrounding context:
```json
{"old_string":"WIDGET2","old_line":2,"new_string":"GADGET2","new_line":2,
 "context_before":"line one of bravo.txt\n","context_after":"last line stays\n",
 "line_prefix":"the magic word is "}
```
`old_line`/`new_line` are real 1-based file lines, and for a multi-line region they're the region's
**first** line (verified: a 3-line block at lines 40–42 of a 60-line file reports `old_line: 40`).
This is everything a client needs to render a real gutter. Three notes:

- **The three delivery shapes carry different `_meta`, which is the actual friction.** The echo has
  block-level `old_line`/`new_line` but **no** `details[]`; the completed update and the
  **session/load replay** have `details[]` but **no** block-level `old_line`/`new_line`. So a
  client that reads the block `_meta` gets a number on the echo and loses it on both the completed
  repaint and every restored session. **Ask:** put the *same* `_meta` on all three — ideally
  block-level `old_line`/`new_line` **and** `details[]` everywhere — or document which shape owns
  what.
- **A whole-file Write's echo carries `_meta: {}`** — no line data at all — while its completed
  update carries `details[]` with `old_line:1`/`new_line:1`. Same inconsistency, sharper edge.
- **`old_line` is a post-edit coordinate, not a pre-edit one.** `details[]` is computed against the
  *final* file: in a replace-all whose replacement grows the line count (3 sites at pre-edit lines
  2/4/6, each token → 3 lines), every entry reported `old_line === new_line === [2,6,10]` — the
  post-edit lines, not the originals. `context_before`/`context_after` confirm it (site 1's
  `context_after` already shows site 2 replaced). It's self-consistent and fine for rendering, but
  the name `old_line` implies the pre-edit file. **Ask:** either make `old_line` the pre-edit line
  or document that both are post-edit.

**Ask:** send one authoritative diff, or mark the echo as provisional so a client can tell the two
apart.

**Source-verified (2026-07-16, OSS tree).** All three delivery shapes confirmed in code: the echo
computes block-level `{old_line,new_line}` from the *pre-edit* file (`tool_calls.rs:1558-1587`; the
whole-file Write arm emits `oldText:""` + `_meta:{}`, `:1774-1785`); the completed update builds
`_meta.details[]` (`acp_conversion.rs:218-233`); the replay re-emits the persisted completed shape
verbatim. The only signal distinguishing echo from authoritative is the echo's missing `status` —
no provisional marker exists. `old_line` is post-edit because sites are located in the rebuilt
`new_text` (`search_replace/helpers.rs:108-121` — `old_line == new_line` by construction; the
*echo's* block-level `old_line` is genuinely pre-edit, which is the `_meta` inconsistency in one
sentence). And the `line_suffix` ask turns out to be genuinely tiny: `build_edit_details`
(`helpers.rs:97-128`) computes `line_prefix` from `new_text`, and its call site
(`search_replace/mod.rs:717`) already has the full original content in scope — one threaded
parameter yields both full old/new lines.

### 2.11 Permission requests are environment-dependent, not configuration-dependent
(observed 2026-07-15 on grok 0.2.99–0.2.101; user report:
[grok-build-vscode#49](https://github.com/phuryn/grok-build-vscode/issues/49);
`research/edit-diff.md` § "The permission-card red herring")

**Whether `grok agent stdio` sends `session/request_permission` for an in-workspace edit varies by
machine, not by configuration.** On some Windows 11 hosts — including our primary dev box — it sends
**zero** permission requests for an in-workspace edit with `permission_mode = "ask"`, `yolo = false`,
`support_permission` either value, **and even a pristine default config** (probe reproduced with the
extension's exact `initialize` handshake). The *same extension build with the same settings* prompts
reliably on macOS and on a Windows 11 Azure VM for the same edit. It is unaffected by the client's
own Auto-accept state, and by every Grok setting we can find.

This reaches users as a trust problem, not a papercut. Verbatim from #49:

> *"Grok simply edits all my files without any confirmation. There is also no option for me to
> review what changed."*

A client cannot build an approval UX on a signal that may silently never arrive, and cannot explain
to the user why their machine disagrees with the documentation.

Our workaround **decouples review from permission entirely**: the `type:"diff"` block rides
`tool_call_update` regardless of permission mode (§2.10), so we render every edit's diff inline from
the wire and never depend on a card appearing. That solves *review* — it cannot restore *approval*.
If no request arrives, there is nothing for the user to approve, and no client-side code can
manufacture the choice.

**Ask:** make permission requests deterministic and configuration-driven across platforms, or
document exactly what governs them — and surface the effective state over ACP (§2.7). If some
host/build legitimately suppresses them, say so in `initialize` so a client can tell the user
instead of looking broken.

**Source-verified (2026-07-16, OSS tree) — ROOT CAUSE FOUND, and confirmed on our dev box.** The
by-machine variance is grok silently merging **Claude Code's settings** into its effective
permission policy. `resolve_permission_config_with_fallback`
(`xai-grok-workspace/src/permission/resolution.rs:493-498`) reads `~/.claude/settings.local.json`,
`~/.claude/settings.json`, and every project `.claude/settings*.json` up to the repo root
(`claude_settings.rs:374-430`). `permissions.defaultMode: "acceptEdits"` becomes a synthetic
**Allow Edit** rule (`resolution.rs:60-67`), `"bypassPermissions"` a catch-all Allow (`:52-59`),
and an edit-covering `permissions.allow` entry translates directly (`claude_settings.rs:50-72`; a
pattern-less rule matches every path, `policy.rs:227`). Any of these short-circuits the decision at
`manager.rs:1320-1336` **before the prompter**, so `session/request_permission` is never sent.

We then checked the dev box from this section's A/B — the machine that never prompts — and its
`~/.claude/settings.json` contains bare `"Edit"`, `"Write"`, and `"Bash"` entries in
`permissions.allow`, granted to *Claude Code* months earlier: allow rules a user gave one product
silently auto-approve another product's writes, with no indication anywhere. The macOS box and Azure
VM had no such file. **This is not the whole of #49, though — the symptom has multiple invisible
sources.** The `.claude` merge explains *our dev box*; the #49 reporter's own case was different —
they had auto-approval persisted for one workspace in grok's per-project
`~/.grok/sessions/<cwd>/permission.toml` (`manager.rs:935`), and a fresh folder prompted normally.
The honest framing: **several invisible policy sources produce the same "no approval card" symptom**
— the `.claude` fallback, per-project `permission.toml` grants, the `[claude_compat].imported`
cutoff that disables the whole `.claude` fallback (`claude_settings.rs:512-554`), and managed
`requirements.toml`/`managed-settings.json` layers — none surfaced over ACP. (`defaultMode:
"dontAsk"` produces the opposite failure — auto-deny, `manager.rs:1476-1484`.)

This resolves the mystery but sharpens the ask: **the merge is invisible.** Nothing over ACP — or
in grok's own output — tells a client or a user that a `.claude` file from another product is
auto-approving edits. Reframed ask: report the effective permission policy *and its source file*
over ACP (§2.7), and surface the `.claude` import visibly (the TUI's explicit Ctrl+I import is the
right consent model; the silent always-on fallback is not). A client can re-read the same files to
display an honest state — ours will — but a sidebar should not need to re-implement the CLI's
config resolution to explain the CLI's behavior.

---

## 3. What the extension silently hides from users today

A quick inventory of everything we suppress to keep the chat sane — each is a place the
protocol shows users something it shouldn't:

- `/context` and `/always-approve` (removed from autocomplete and dispatch)
- `totalTokens: 0` reports (stripped before the UI)
- The hidden primer turn and its "ok" ack — plus its replayed copy on every restore
- The hidden post-`/compact` `/session-info` turn (our own workaround, invisible by design)
- Grok's post-verdict "I'll wait for your verdict…" filler (cancelled + suppressed)
- Marker-only `[Plan approved/rejected/cancelled]` protocol messages on replay
- `<system-reminder>` turns replayed as user messages
- The subagent result envelope (`<subagent_meta>`, `<subagent_result>`, lead-ins, Agent ID hint)
- The background-spawn "started" ack pretending to be a result
- Subagent child sessions in the history list (`session_kind:"subagent"`)
- Empty primer-only sessions on disk (swept) and primer-derived session titles (renamed)

---

## 4. What works well (credit where due)

- **Streaming** `agent_message_chunk`/`agent_thought_chunk` — clean, separable reasoning.
- **`fs/*` + `terminal/*` delegation** — being mandatory made them a reliable client-side
  enforcement point (it's what makes our plan gate possible at all).
- **`session/request_permission`** — clear option kinds; `kind:"edit"` maps neatly to a diff preview.
- **`session/load` replay through the same update stream as live** — most features restored
  with zero extra code.
- **`_meta` turn accounting** and per-model `totalContextTokens` — rich and useful (modulo the zero).
- **`_meta["x.ai/tool"]`** — an authoritative, title-independent tool identity. This is the
  *right* design; it single-handedly fixed subagent misclassification. Put it on everything.
- **`session/cancel`** as an id-less notification that settles the turn `cancelled` and leaves
  the session usable — exactly what a Stop button needs.
- **Concurrent sessions** — multiple `stdio` processes on one workspace with no cross-talk.
- **Vision** actually works; **`ask_user_question`** is a good structured surface once its
  response shape is known; **`spawn_subagent` (0.2.93)** is well-structured on grok-build.

---

## 5. Grok 4.5 verification (grok 0.2.93, 2026-07-11)

Every grok-build-family fact above was re-verified against **Grok 4.5** — the current default
model of that family. **Grok Build (`grok-build`) still ships for some accounts/builds**, so the
Grok Build observations in §1–§4 stand; the differences below are per-model *within the same
`grok-build-plan` agent*, not a replacement. The full live suite (`npm run test:live` —
**12 passed · 0 skipped · 0 failed**) plus targeted probes ran against the real binary on native
Windows; Composer 2.5 was independently re-verified in the same run (`subagent-composer`).

**Model surface (`session/new` → `availableModels`):**
- `currentModelId: "grok-4.5"`, name **"Grok 4.5"**, `_meta.agentType: "grok-build-plan"`.
- `_meta.totalContextTokens: 500000` — **500K, where Grok Build reports 512K** (per-model, same
  agent). Corroborated by `/session-info` prose (`Context: N / 500000 tokens`).
- `_meta.supportsReasoningEffort: true` with `reasoningEfforts` [high (default) / medium / low]
  now advertised **in the model list itself** — previously reasoning effort was visible only as
  a process-start flag (§2.7). It is still not settable per-turn over ACP; changing it still
  restarts the process.
- Only two models advertised: `grok-4.5` and `grok-composer-2.5-fast` (Composer 2.5).

**`session/set_model` is clean on Grok 4.5.** `set_model("grok-4.5")` returns
`{"_meta":{"model":{"Ok":"grok-4.5"}}}` — the requested id verbatim, resolvable in
`availableModels`. The **versioned-id defect (§1, §2.6) still applies to Grok Build**
(`grok-build` → `grok-build-0.1`) but does **not** reproduce on Grok 4.5 — so `resolveModelId`
stays necessary for the Grok Build model.

**Delegation (`spawn_subagent`) confirmed on Grok 4.5.** A real delegation emitted genuine
`spawn_subagent` calls with kebab-case `subagent_type` values (`explore`, `general-purpose`),
the completion arriving as a **same-id `tool_call_update`, `status:"completed"`** — exactly the
§1 grok-build shape. The `get_command_or_subagent_output` poller was correctly **not** carded.
The `subagent_spawned`/`subagent_finished` lifecycle events are **still not transmitted over
ACP** (`finished=0` observed while `updates.jsonl` filled) — §2.4 holds unchanged.

**The rest of §1–§4 reproduces on Grok 4.5:**
- Tool-call ids are `call-<uuid>-<n>`; `_meta["x.ai/tool"]` carries
  `{name, kind, namespace:"grok_build", label, read_only}` — the authoritative, title-independent
  tool identity praised in §4.
- Cross-agent switch after the first turn errors `MODEL_SWITCH_INCOMPATIBLE_AGENT`
  (`activeAgentType:"grok-build-plan"` → `requiredAgentType:"cursor"`,
  `suggestion:"start_new_session"`) — the agent is locked at spawn (§2.6).
- `promptCapabilities.image:false` while inline `{type:"image"}` blocks work — the model
  correctly named a solid red PNG (§2.5).
- Plan mode: `exit_plan_mode` still can't be rejected; the client-side write/terminal gate
  contained a rejected plan (0 workspace mutations) and released an approved one (§2.1).
  — **Superseded 2026-07-15: fixed in 0.2.101, a rejection is now honored. See §2.1.**
- Live prompts echo back as `user_message_chunk` (§2.6); `session/cancel` (Stop), two concurrent
  sessions on one workspace, session restore, and structured edit-diff restore all behave as
  documented.

**Live suite (all against Grok 4.5 except the last):** handshake, capabilities, prompt-roundtrip,
cancel-mid-turn, parallel-sessions, vision-prompt, session-restore, edit-diff-restore, plan-mode,
image-gen, subagent, subagent-composer — **12/12 green.** Grok-free floor: **808/808.**
