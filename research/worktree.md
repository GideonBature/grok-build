# Worktree UI — wire format + extension model

Probe-confirmed against shipped `grok agent stdio` (2026-07-23).

## RPC surface (live rail uses `_x.ai/` prefix)

| Method | Params | Result |
|---|---|---|
| `_x.ai/git/worktree/create` | `{ sessionId, sourcePath, label?, gitRef? }` | nested `{ result: { status:"creating", sessionId, worktreePath, sourceGitRoot } }` |
| `_x.ai/git/worktree/list` | `{ cwd? }` or `{ sessionId? }` | nested `{ result: WorktreeRow[] }` |
| `_x.ai/git/worktree/remove` | `{ sessionId, worktreePath }` | nested `{ result: { removed, resolvedPath } }` |
| `_x.ai/git/worktree/status` (notification) | `{ status, sessionId, worktreePath?, message?, commit?, … }` | — |

`x.ai/…` (no underscore) returns `-32601` on this build. Create without `sessionId` or `sourcePath` is `-32602`.

### Status notifications

1. `progress` — `"Creating worktree with fast CoW copy…"`
2. `created` — includes `worktreePath`, `commit`, `copiedChanges`
3. (failure) `failed` / `error` if something goes wrong

### List row (excerpt)

```jsonc
{
  "id": "…",
  "path": "/Users/…/.grok/worktrees/benelabs-grok-build/my-feat",
  "source_repo": "/Users/…/benelabs/grok-build",
  "git_ref": "main",
  "session_id": "<creator session>",
  "status": "alive",
  "metadata": { "label": "my-feat", "user_provided": false }
}
```

Worktrees live under `~/.grok/worktrees/<repo-slug>/<label>/` (not always registered in `git worktree list`).

## Critical: create does NOT rebind agent cwd

After `create` + `status:created` on session S, a prompt that writes a file still targets **sourcePath**, not the worktree. Verified with a marker file.

What *does* isolate file ops:

```
session/new { cwd: worktreePath }   // same process or a fresh spawn
→ agent writes under worktreePath
→ session storage: ~/.grok/sessions/<urlencoded-worktreePath>/<id>/
```

So the extension MVP is:

1. Ensure a live session on the workspace (for `sessionId` on create).
2. `_x.ai/git/worktree/create` + wait for `status:created`.
3. Park focus, spawn a **new** pool session with `AcpClient.opts.cwd = worktreePath` and `session/new` there.
4. Persist `SessionMetaOverride.cwd` so history open/delete resolve the right sessions dir.

## Related CLI

- `grok --worktree[=name] --worktree-ref <ref>` (TUI / headless)
- `grok worktree list|show|rm|gc`
- `/fork --worktree` pairs conversation fork with a worktree (extension fork today is conversation-only)
- `_x.ai/session/resolve_local_for_worktree_resume` `{ sessionId, cwd }` — resume helper (not used in MVP)

## Apply semantics (Phase 2)

```
_x.ai/git/worktree/apply
{ sessionId, worktreePath, mode?: "merge" | "overwrite" }
→ { result: { status: "success"|"conflicts", files: [{path,type,additions,deletions}], gitRoot? } }
```

Probe note (2026-07-23): on CoW standalone worktrees under `~/.grok/worktrees/…`,
`apply` often returns `status:"success"` with a file list whose `additions`/`deletions`
are 0, and **does not reliably write into the source workspace**. `gitRoot` in the
response is frequently the worktree path itself.

The extension therefore:

1. Calls ACP apply (merge/overwrite) for CLI-side bookkeeping / conflict signal.
2. Ships differing files **host-side** via `shipWorktreeFiles` using the apply file
   list, or `git status --porcelain` in the worktree when the list is empty.

`gc`: `_x.ai/git/worktree/gc` → `{ dead_removed, expired_removed, … }`.

## Fork into worktree (Phase 3)

```
1. _x.ai/git/worktree/create { sessionId, sourcePath, label?, gitRef? }
2. wait status:created → worktreePath
3. _x.ai/session/fork {
     sourceSessionId, sourceCwd, newCwd: worktreePath
   }
   → { newSessionId, newCwd, chatMessagesCopied, … }
```

Probe-confirmed: the forked session is stored under
`~/.grok/sessions/<urlencoded-worktreePath>/` and **must** be `session/load`ed
with `cwd = worktreePath` (load with main cwd → FS_NOT_FOUND).

Plain fork keeps `newCwd === sourceCwd` (conversation only).

## Extension modules

- `src/worktree.ts` — pure parse/sanitize/display + `shipWorktreeFiles` /
  `previewWorktreeShip` / `forkIntoWorktreeDisplayName`
- `src/acp.ts` — create/list/remove/apply/gc + `forkSession(sourceCwd, newCwd?)`
- `src/session.ts` — per-session `cwd`
- `src/sidebar.ts` — New / Manage / Fork into worktree / Apply this worktree;
  apply multi-select preview before ship
- Commands: New Worktree Session, Manage Worktrees, Fork Conversation into
  Worktree, Apply This Worktree to Workspace (+ gear Session section)
