/**
 * Pure helpers for Grok git-worktree sessions (Worktree UI).
 *
 * Wire shapes (probe-confirmed on shipped CLI):
 *   `_x.ai/git/worktree/create`  { sessionId, sourcePath, label?, gitRef? }
 *     → nested `{ result: { status:"creating", worktreePath, sourceGitRoot, sessionId } }`
 *   `_x.ai/git/worktree/status`  notification → progress | created | failed
 *   `_x.ai/git/worktree/list`    { cwd? } → nested `{ result: WorktreeListRow[] }`
 *   `_x.ai/git/worktree/remove`  { sessionId, worktreePath }
 *   `_x.ai/git/worktree/apply`   { sessionId, worktreePath, mode?: "merge"|"overwrite" }
 *     → nested `{ result: { status, files[], gitRoot? } }` — see research/worktree.md:
 *     the RPC file list is not always a reliable on-disk merge into source, so
 *     the host also ships differing files via {@link shipWorktreeFiles}.
 *   `_x.ai/git/worktree/gc`     { sessionId?, sourcePath? }
 *
 * Creating a worktree does NOT rebind the creator session's agent cwd — file
 * ops still hit the source tree. A *new* `session/new` with cwd=worktreePath is
 * what makes the agent edit in the isolated tree (see research/worktree.md).
 */

import { existsSync as defaultExistsSync } from "node:fs";
import * as path from "node:path";

/** Leading tag on worktree-session history names (mirrors `(Fork)` for forks). */
export const WORKTREE_NAME_TAG = "(Worktree)";

export interface WorktreeCreateAccepted {
  status: "creating" | "created";
  sessionId: string;
  worktreePath: string;
  sourceGitRoot?: string;
}

export interface WorktreeStatusParams {
  status: string;
  sessionId?: string;
  worktreePath?: string;
  message?: string;
  commit?: string;
  sourceGitRoot?: string;
  error?: string;
}

export interface WorktreeListRow {
  id: string;
  path: string;
  source_repo?: string;
  repo_name?: string;
  kind?: string;
  git_ref?: string;
  head_commit?: string;
  session_id?: string;
  status?: string;
  metadata?: { label?: string; user_provided?: boolean };
}

/** Apply conflict strategy for `_x.ai/git/worktree/apply`. */
export type WorktreeApplyMode = "merge" | "overwrite";

export interface WorktreeApplyFile {
  path: string;
  type?: string;
  additions?: number;
  deletions?: number;
}

export interface WorktreeApplyResult {
  status: string;
  files: WorktreeApplyFile[];
  gitRoot?: string;
}

export interface ShipFileResult {
  path: string;
  action: "created" | "updated" | "identical" | "missing" | "error";
  error?: string;
}

/** Dry-run view of what {@link shipWorktreeFiles} would do for one path. */
export interface ShipPreviewItem {
  path: string;
  /** Files that would change the source tree (created/updated). */
  action: "created" | "updated" | "identical" | "missing" | "error";
  error?: string;
  /** True when the file should be pre-selected in an apply-preview UI. */
  willChange: boolean;
}

export interface ShipFs {
  existsSync(p: string): boolean;
  readFileSync(p: string): Buffer;
  writeFileSync(p: string, data: Buffer): void;
  mkdirSync(p: string, opts?: { recursive?: boolean }): void;
}

/** Peel the CLI's nested `{ result: T }` envelope (create/list/remove all wrap once). */
export function unwrapWorktreePayload<T = unknown>(raw: unknown): T {
  if (raw && typeof raw === "object" && raw !== null && "result" in raw) {
    const inner = (raw as { result: unknown }).result;
    // create/remove: { result: { status|removed, ... } }
    // list: { result: [...] }
    if (inner !== undefined) return inner as T;
  }
  return raw as T;
}

/** Parse the create RPC result into a structured accepted response, or null. */
export function parseWorktreeCreateResult(raw: unknown): WorktreeCreateAccepted | null {
  const body = unwrapWorktreePayload<Record<string, unknown>>(raw);
  if (!body || typeof body !== "object") return null;
  const worktreePath = typeof body.worktreePath === "string" ? body.worktreePath : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!worktreePath || !sessionId) return null;
  if (status !== "creating" && status !== "created") return null;
  return {
    status,
    sessionId,
    worktreePath,
    sourceGitRoot: typeof body.sourceGitRoot === "string" ? body.sourceGitRoot : undefined,
  };
}

/** Parse list RPC result into rows (empty on malformed input). */
export function parseWorktreeListResult(raw: unknown): WorktreeListRow[] {
  const body = unwrapWorktreePayload<unknown>(raw);
  if (!Array.isArray(body)) return [];
  const out: WorktreeListRow[] = [];
  for (const row of body) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.path !== "string" || !r.path) continue;
    out.push({
      id: typeof r.id === "string" ? r.id : r.path,
      path: r.path,
      source_repo: typeof r.source_repo === "string" ? r.source_repo : undefined,
      repo_name: typeof r.repo_name === "string" ? r.repo_name : undefined,
      kind: typeof r.kind === "string" ? r.kind : undefined,
      git_ref: typeof r.git_ref === "string" ? r.git_ref : undefined,
      head_commit: typeof r.head_commit === "string" ? r.head_commit : undefined,
      session_id: typeof r.session_id === "string" ? r.session_id : undefined,
      status: typeof r.status === "string" ? r.status : undefined,
      metadata:
        r.metadata && typeof r.metadata === "object"
          ? {
              label: typeof (r.metadata as any).label === "string" ? (r.metadata as any).label : undefined,
              user_provided: !!(r.metadata as any).user_provided,
            }
          : undefined,
    });
  }
  return out;
}

/**
 * Sanitize a user-entered worktree label for the `label` field.
 * Empty/whitespace → undefined (CLI auto-names). Rejects path separators and
 * `..` so a label can't escape the grok worktrees dir.
 */
export function sanitizeWorktreeLabel(raw: string | undefined | null): string | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  if (s.includes("..") || s.includes("/") || s.includes("\\") || s.includes("\0")) return undefined;
  // Keep it filesystem-friendly; CLI also rewrites, but we refuse junk early.
  if (!/^[A-Za-z0-9._@+=,-][A-Za-z0-9._@+=, -]{0,63}$/.test(s)) return undefined;
  return s;
}

/** True when `dir` looks like a git working tree (`.git` file or directory). */
export function isGitRepo(dir: string, existsSync: (p: string) => boolean = defaultExistsSync): boolean {
  if (!dir) return false;
  return existsSync(path.join(dir, ".git"));
}

/**
 * History display name for a worktree session.
 * Leading `(Worktree)` tag (same reason as fork: history rows ellipsize at the edge).
 * Idempotent — won't stack tags.
 */
export function worktreeDisplayName(label: string | undefined): string {
  const base = (label ?? "").trim();
  if (!base) return WORKTREE_NAME_TAG;
  if (base.toLowerCase().startsWith(WORKTREE_NAME_TAG.toLowerCase())) return base;
  return `${WORKTREE_NAME_TAG} ${base}`;
}

/** Unique, non-empty cwd list preserving first-seen order. */
export function uniqueCwds(...lists: Array<Iterable<string | undefined | null>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const c of list) {
      if (!c || seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Paths of alive worktrees whose `source_repo` matches the workspace (normalized).
 * Used to discover session dirs that live under worktree cwds.
 */
export function worktreePathsForSource(
  rows: WorktreeListRow[],
  sourceRepo: string,
): string[] {
  const norm = (p: string) => path.resolve(p).replace(/[/\\]+$/, "");
  const src = norm(sourceRepo);
  const out: string[] = [];
  for (const r of rows) {
    if (!r.path) continue;
    if (r.status && r.status !== "alive") continue;
    if (r.source_repo && norm(r.source_repo) !== src) continue;
    out.push(r.path);
  }
  return out;
}

/** True when a worktree status notification means creation finished successfully. */
export function isWorktreeCreatedStatus(p: WorktreeStatusParams | null | undefined, worktreePath?: string): boolean {
  if (!p || p.status !== "created") return false;
  if (worktreePath && p.worktreePath && path.resolve(p.worktreePath) !== path.resolve(worktreePath)) {
    return false;
  }
  return true;
}

/** True when a worktree status notification means creation failed. */
export function isWorktreeFailedStatus(p: WorktreeStatusParams | null | undefined, worktreePath?: string): boolean {
  if (!p) return false;
  if (p.status !== "failed" && p.status !== "error") return false;
  if (worktreePath && p.worktreePath && path.resolve(p.worktreePath) !== path.resolve(worktreePath)) {
    return false;
  }
  return true;
}

/** Parse apply RPC result. */
export function parseWorktreeApplyResult(raw: unknown): WorktreeApplyResult | null {
  const body = unwrapWorktreePayload<Record<string, unknown>>(raw);
  if (!body || typeof body !== "object") return null;
  const status = typeof body.status === "string" ? body.status : "";
  if (!status) return null;
  const files: WorktreeApplyFile[] = [];
  if (Array.isArray(body.files)) {
    for (const f of body.files) {
      if (!f || typeof f !== "object") continue;
      const row = f as Record<string, unknown>;
      if (typeof row.path !== "string" || !row.path) continue;
      files.push({
        path: row.path,
        type: typeof row.type === "string" ? row.type : undefined,
        additions: typeof row.additions === "number" ? row.additions : undefined,
        deletions: typeof row.deletions === "number" ? row.deletions : undefined,
      });
    }
  }
  return {
    status,
    files,
    gitRoot: typeof body.gitRoot === "string" ? body.gitRoot : undefined,
  };
}

/**
 * Dry-run: classify each relative path without writing.
 * Used for the apply-preview multi-select before {@link shipWorktreeFiles}.
 */
export function previewWorktreeShip(deps: {
  worktreePath: string;
  sourcePath: string;
  relativePaths: string[];
  fs: Pick<ShipFs, "existsSync" | "readFileSync">;
}): ShipPreviewItem[] {
  const { worktreePath, sourcePath, relativePaths, fs } = deps;
  const wtRoot = path.resolve(worktreePath);
  const srcRoot = path.resolve(sourcePath);
  const out: ShipPreviewItem[] = [];
  const seen = new Set<string>();

  for (const rawRel of relativePaths) {
    const rel = normalizeRelPath(rawRel);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    if (rel === ".git" || rel.startsWith(".git/")) {
      out.push({ path: rel, action: "missing", error: "refusing .git path", willChange: false });
      continue;
    }
    const from = path.resolve(wtRoot, rel);
    const to = path.resolve(srcRoot, rel);
    if (!isPathUnder(wtRoot, from) || !isPathUnder(srcRoot, to)) {
      out.push({ path: rel, action: "error", error: "path escapes worktree/source root", willChange: false });
      continue;
    }
    if (!fs.existsSync(from)) {
      out.push({ path: rel, action: "missing", willChange: false });
      continue;
    }
    try {
      const data = fs.readFileSync(from);
      if (fs.existsSync(to)) {
        const existing = fs.readFileSync(to);
        if (existing.equals(data)) {
          out.push({ path: rel, action: "identical", willChange: false });
        } else {
          out.push({ path: rel, action: "updated", willChange: true });
        }
      } else {
        out.push({ path: rel, action: "created", willChange: true });
      }
    } catch (e) {
      out.push({ path: rel, action: "error", error: (e as Error).message, willChange: false });
    }
  }
  return out;
}

/**
 * Copy worktree files that differ from the source tree into the source.
 * Skips `.git` and refuses paths that escape either root (segment-safe).
 * Pure w.r.t. policy; all I/O goes through `fs`.
 */
export function shipWorktreeFiles(deps: {
  worktreePath: string;
  sourcePath: string;
  relativePaths: string[];
  fs: ShipFs;
}): ShipFileResult[] {
  const { worktreePath, sourcePath, relativePaths, fs } = deps;
  const wtRoot = path.resolve(worktreePath);
  const srcRoot = path.resolve(sourcePath);
  const out: ShipFileResult[] = [];
  const seen = new Set<string>();

  for (const rawRel of relativePaths) {
    const rel = normalizeRelPath(rawRel);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    if (rel === ".git" || rel.startsWith(".git/")) {
      out.push({ path: rel, action: "missing", error: "refusing .git path" });
      continue;
    }

    const from = path.resolve(wtRoot, rel);
    const to = path.resolve(srcRoot, rel);
    if (!isPathUnder(wtRoot, from) || !isPathUnder(srcRoot, to)) {
      out.push({ path: rel, action: "error", error: "path escapes worktree/source root" });
      continue;
    }
    if (!fs.existsSync(from)) {
      out.push({ path: rel, action: "missing" });
      continue;
    }

    try {
      const data = fs.readFileSync(from);
      if (fs.existsSync(to)) {
        const existing = fs.readFileSync(to);
        if (existing.equals(data)) {
          out.push({ path: rel, action: "identical" });
          continue;
        }
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, data);
        out.push({ path: rel, action: "updated" });
      } else {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, data);
        out.push({ path: rel, action: "created" });
      }
    } catch (e) {
      out.push({ path: rel, action: "error", error: (e as Error).message });
    }
  }
  return out;
}

/**
 * Name for a conversation forked into a worktree.
 * Leading `(Worktree)` so history ellipsis keeps the isolation marker; keeps
 * an existing `(Fork)` tag without double-stacking either tag.
 */
export function forkIntoWorktreeDisplayName(
  parentName: string | undefined,
  worktreeLabel: string | undefined,
): string {
  // Strip a leading worktree tag (and optional " · label" tail we may have
  // stamped earlier) so re-forking a worktree session doesn't stack tags.
  let base = (parentName ?? "").trim();
  if (base.toLowerCase().startsWith(WORKTREE_NAME_TAG.toLowerCase())) {
    base = base.slice(WORKTREE_NAME_TAG.length).trim();
  }
  // Drop a trailing " · <label>" we added for a previous worktree fork.
  base = base.replace(/\s·\s[^\s·]+$/u, "").trim();

  const forked = (() => {
    if (!base) return "(Fork)";
    if (base.toLowerCase().startsWith("(fork)")) return base;
    return `(Fork) ${base}`;
  })();
  const label = (worktreeLabel ?? "").trim();
  const withLabel = label ? `${forked} · ${label}` : forked;
  return worktreeDisplayName(withLabel);
}

/** Normalize a relative path: strip leading ./ and reject empty/absolute. */
export function normalizeRelPath(raw: string): string | null {
  let s = (raw || "").replace(/\\/g, "/").trim();
  if (!s || s.startsWith("/") || /^[A-Za-z]:\//.test(s)) return null;
  while (s.startsWith("./")) s = s.slice(2);
  if (!s || s === "." || s.includes("..")) return null;
  return s;
}

function isPathUnder(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(candidate);
  if (c === r) return true;
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  return c.startsWith(prefix);
}

/** Display label for a worktree list row. */
export function worktreeRowLabel(row: WorktreeListRow): string {
  const name = row.metadata?.label || path.basename(row.path);
  const ref = row.git_ref ? ` @ ${row.git_ref}` : "";
  const st = row.status && row.status !== "alive" ? ` (${row.status})` : "";
  return `${name}${ref}${st}`;
}

/** Summarize ship results for a toast/notice. */
export function summarizeShipResults(results: ShipFileResult[]): string {
  let created = 0, updated = 0, identical = 0, missing = 0, errors = 0;
  for (const r of results) {
    if (r.action === "created") created++;
    else if (r.action === "updated") updated++;
    else if (r.action === "identical") identical++;
    else if (r.action === "missing") missing++;
    else errors++;
  }
  const parts: string[] = [];
  if (created) parts.push(`${created} created`);
  if (updated) parts.push(`${updated} updated`);
  if (identical) parts.push(`${identical} unchanged`);
  if (missing) parts.push(`${missing} missing`);
  if (errors) parts.push(`${errors} errors`);
  return parts.length ? parts.join(", ") : "nothing to ship";
}

/**
 * True when a session cwd is a worktree path for this workspace (not the
 * workspace root itself). Used to badge history rows.
 */
export function isWorktreeSessionCwd(sessionCwd: string | undefined, workspaceCwd: string): boolean {
  if (!sessionCwd) return false;
  try {
    return path.resolve(sessionCwd) !== path.resolve(workspaceCwd);
  } catch {
    return sessionCwd !== workspaceCwd;
  }
}
