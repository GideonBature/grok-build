# `grok agent stdio` Windows regression — stdin not read until EOF (issue #22)

**Status: STILL BROKEN through Grok CLI 0.2.67** (re-checked 2026-06-26, see § 0.2.67
does NOT fix it). The bug *mutated but persists*: on **0.2.61–0.2.64** even `initialize`
hangs; on **0.2.67** `initialize` is answered but the *next* request (`session/new`)
hangs — so a live session still can't start. Last fully-working build **0.2.60**;
0.2.65–0.2.66 never tested (treated as broken). **Windows-only** — macOS ran the broken
builds fine (see § macOS is not affected). The extension pins Windows back to **0.2.60**
(`GROK_STDIO_DOWNGRADE_TARGET`): proactive range now **0.2.61–0.2.67**, and the reactive
net fires on an `initialize` *or* `session/new` startup hang for any future build above
0.2.60. Tracked in extension issue [#22](https://github.com/phuryn/grok-build-vscode/issues/22).

## 0.2.67 does NOT fix it — the hang moved to `session/new` (2026-06-26)

A first pass looked like a fix: the stdin-open `initialize` probe
([stdio-eof-mac-probe.cjs](stdio-eof-mac-probe.cjs)) answered in ~200–600ms, 5/5 runs on
0.2.67, where 0.2.61–0.2.64 hung. **But that probe only tests `initialize`.** A real
client sends `session/new` next — and the live suite + a controlled probe show 0.2.67
hangs there instead:

```
✅ initialize answered @283ms (stdin open)
→ sending session/new (stdin stays OPEN)…
… session/new still unanswered @8010ms → CLOSING stdin (EOF) to test the bug
   …notification _x.ai/settings/update @8400ms          ← only flushed AFTER EOF
❌ exited code=0 @10590ms  (session/new never answered)
```

The instant stdin is closed (EOF), grok flushes its queued notifications and exits —
classic EOF-gated read, identical to the original bug, just **one message later**. So
0.2.67 reads the *first* stdin line (`initialize`) immediately but still blocks every
*subsequent* line on EOF. `npm run test:live` against 0.2.67 confirms it: `handshake`
PASS, then `prompt-roundtrip` / `session-restore` / `plan-mode` / `image-gen` /
`subagent` all FAIL with `timeout … session/new`.

**Lesson:** verify a claimed fix with the **`session/new` probe**
([stdio-eof-sessionnew-probe.cjs](stdio-eof-sessionnew-probe.cjs) — sends `initialize`
*then* `session/new` with stdin held open), not just `initialize` — otherwise the moved
bug reads as fixed.

Extension change (v1.4.15): keep pinning Windows to **0.2.60**
(`GROK_STDIO_DOWNGRADE_TARGET`, unchanged); `isStdioBrokenGrokVersion` extends to
**0.2.61–0.2.67**; the reactive trigger broadens from `initialize` only to
`initialize` / `session/new` / `session/load`, so a future still-broken build
self-heals regardless of which startup request hangs.

### Note: `grok update --version` needs an unlocked binary

Downgrading from a broken build fails if any grok process holds `grok.exe` open:
`Auto-update failed: cannot rename locked executable … Access is denied (os error 5)`.
Close all running grok sessions (the VS Code extension tears its pool down before
updating for exactly this reason) and retry.

## Symptom

On Grok CLI **0.2.61–0.2.64** on **Windows**, the extension can't start a session:

```
spawning C:\Users\<user>\.grok\bin\grok.exe agent --reasoning-effort xhigh stdio (cwd=…)
grok exited with code null
Failed to start Grok: ACP request timed out: initialize
```

Downgrading to **0.2.60** (`grok update --version 0.2.60`) fixes it immediately.

## Root cause

`grok agent stdio` **does not read its first line of stdin until stdin reaches
EOF.** A live ACP client must keep stdin open (the protocol is bidirectional
JSON-RPC over stdin/stdout — exactly as the grok README's own stdio examples show,
with `stdin.write(...)` + `drain()` and the pipe held open). So the `initialize`
request is never read, the handshake times out after 120s, and the host tears the
process down — which surfaces as `exit code null` (SIGTERM), matching the report.

This contradicts grok's own documented stdio transport contract (README §
"stdio Transport"), where the agent is expected to process newline-delimited
JSON-RPC messages as they arrive.

## Reproduction (Windows, Node)

Spawn `grok agent stdio` the way any ACP client does — pipes for stdin/stdout,
stdin held open — then send `initialize`:

| Variant | stdin after writing `initialize` | Result |
|---|---|---|
| A | left **open** (real client behavior) | no response; `initialize` never read; on teardown `exit code=null sig=SIGTERM` |
| B | **closed** (`stdin.end()`) right after the write | full `initialize` response, clean `exit code=0` |
| C | left open, then 16 KB of padding written | no response (rules out fixed-size read buffering) |
| D | `shell:true`, extra newlines, a 2nd request | no response |

Only **EOF** unblocks the read. Padding to 16 KB does not, so it's not a
fixed-buffer-fill issue — the read is gated on stream close.

### Decisive evidence — grok's own `--debug-file`

With stdin **open** (failing), grok's debug log boots fully but stops at:

```
… Relay sync: DISABLED (not in TUI mode)
```

…and never reads the request. With stdin **closed** (working), the same log
continues *past* that point:

```
… Relay sync: DISABLED (not in TUI mode)
… plugins::discovery: plugin discovered …
… mvp_agent: code-nav capability initialized from initialize request …   ← the request was finally read
… session::storage::search: session search bootstrap complete …
… timing name="startup.stdio_agent_total" …
```

So the agent is fully initialized and merely **blocked on the stdin read** until
the stream closes.

## Ruled out

- **Arguments** — `grok agent --reasoning-effort xhigh stdio` parses fine on 0.2.64
  (`--help` confirms the flag and the `stdio` subcommand are unchanged).
- **Leader process** (new in this line) — debug log shows
  `leader mode resolved use_leader=false`; no `agent.exe` child is spawned.
- **Working directory** (C: vs the reporter's D: drive) — fails identically from C:.
- **Shell wrapping** (`shell:true`) — no change.

The reason a quick `printf '…' | grok agent stdio` *looks* fine from a shell is that
the pipe closes after the line (EOF), which is the one thing that unblocks the read.
Any persistent client hangs.

## Extension mitigation (shipped)

The extension can't make grok read stdin, so it **pins Windows back to the last
fully-working 0.2.60**: before spawning it reads `grok --version`, and if the build is in
the confirmed-broken range 0.2.61–0.2.67 (`isStdioBrokenGrokVersion`,
[src/cli-locator.ts](../src/cli-locator.ts)) it runs `grok update --version 0.2.60`
([src/sidebar.ts](../src/sidebar.ts) `maybePinBrokenCli`). `grokUpdatePolicy` blocks
Windows updates onto unsupported builds (pinning to 0.2.60, never `latest`), and the
reactive net (`shouldReactivelyDowngrade`) recovers a *future* still-broken build
(0.2.68+) on an observed startup failure at **`initialize` *or* `session/new`** —
v1.4.15 broadened that trigger after 0.2.67 hung at `session/new` rather than
`initialize`. When a build is genuinely fixed (re-verify with the **session/new** probe,
not just `initialize`), bump `GROK_STDIO_DOWNGRADE_TARGET` and shrink the broken range.

> **History:** v1.4.12 introduced the 0.2.60 pin with the range closed at 0.2.64;
> v1.4.13 added the reactive net; v1.4.15 extended the range to 0.2.67 and broadened the
> reactive trigger to `session/new` after confirming 0.2.67 only *moved* the bug.

---

## Report for xAI (copy-paste)

> **Title:** `grok agent stdio` on Windows hangs — first stdin line not read until EOF (regression in 0.2.61, worked in 0.2.60)
>
> **Summary:** On Windows, `grok agent stdio` does not read its first stdin line
> until stdin is closed (EOF). A persistent ACP/JSON-RPC client (which must keep
> stdin open) therefore never gets an `initialize` response; the handshake hangs
> indefinitely. Closing stdin immediately after writing `initialize` returns a
> correct response, proving the agent boots fine and only the stdin read is
> blocked. Padding the write to 16 KB does not unblock it, so it is not
> fixed-buffer-fill — the read is gated on stream EOF.
>
> **Environment:** Windows 11; native build `grok 0.2.64 (stable)` (also 0.2.61–0.2.63). Last working: `0.2.60`.
>
> **Repro:**
> 1. Spawn `grok agent stdio` with pipes for stdin/stdout (not a TTY).
> 2. Write one line: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true}}}\n`
> 3. **Keep stdin open** → no response (hang). **Close stdin** → correct `initialize` response.
>
> **Evidence:** With `--debug-file`, the failing (stdin-open) run stops at
> `Relay sync: DISABLED (not in TUI mode)` and never logs reading the request;
> the working (stdin-closed) run continues to
> `code-nav capability initialized from initialize request` and
> `startup.stdio_agent_total`.
>
> **Impact:** Breaks every persistent stdio/ACP integration on Windows
> (e.g. editor extensions). `printf … | grok agent stdio` masks it because the
> pipe closes (EOF).
>
> **Likely area:** Windows async stdin read in the `agent stdio` path between
> 0.2.60 and 0.2.61 (per-line read appears to wait for stream close).

## macOS is not affected (verified 2026-06-25)

Ran the identical stdin-open `initialize` probe on **macOS (Apple Silicon)** against
the broken build to check whether the regression is platform-specific:

- **grok 0.2.64** (the same build that hangs on Windows): `initialize` answered in
  **~450 ms with stdin held open**, **4/4 runs**.
- **grok 0.1.216**: answered in ~520 ms with stdin open.

The EOF-gated-first-read hang **does not reproduce on macOS** — the bug is
**Windows-only**. This confirms the workaround's `win32` gate is correct:
`isStdioBrokenGrokVersion` / `grokUpdatePolicy` (`src/cli-locator.ts`) early-return to
a no-op on every non-win32 platform, so the auto-pin and update-block never fire off
Windows regardless of installed version. No code change needed; widen/remove the gate
only if the regression is later observed on another platform.

Probe: `research/stdio-eof-mac-probe.cjs` (keeps stdin open, asserts an `initialize`
response — the exact condition that hangs on Windows).

**Follow-up sent to xAI (2026-06-25):** submitted via the Grok CLI `/feedback` command,
noting that the regression first reported on Windows is confirmed Windows-only and that
macOS (0.2.64 and 0.1.216) answers the ACP handshake normally. Grok acked
("Thanks for the feedback! The Grok Build team is on it.").
