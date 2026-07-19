/**
 * Pure helpers for the webview → host "open file" / "drop file" flows. Split out
 * so the path-ref parsing and the large-file guard can be unit-tested without a
 * `vscode` or `fs` dependency.
 */

export interface FileRef {
  path: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Split a `path[#L<start>[-[L]<end>]]` or `path:<start>[-<end>|:<col>]`
 * reference into its parts. Both suffix shapes are anchored to the *end* of the
 * string, so a literal `#` earlier in the path (C#/F# project folders) or the
 * drive colon in `C:\work\file.ts` stays part of the path instead of breaking
 * the match. A `:line:col` compiler-style ref keeps the line and drops the
 * column. Line numbers are returned 1-based, exactly as written.
 */
export function parseFileRef(raw: string): FileRef {
  const frag = raw.match(/^(.*?)#L(\d+)(?:-L?(\d+))?$/i);
  if (frag) {
    const startLine = Number(frag[2]);
    const endLine = frag[3] ? Number(frag[3]) : undefined;
    return endLine == null ? { path: frag[1], startLine } : { path: frag[1], startLine, endLine };
  }
  const colon = raw.match(/^(.+?):(\d+)(?:-(\d+)|:\d+)?$/);
  if (colon) {
    const startLine = Number(colon[2]);
    const endLine = colon[3] ? Number(colon[3]) : undefined;
    return endLine == null ? { path: colon[1], startLine } : { path: colon[1], startLine, endLine };
  }
  return { path: raw };
}

/**
 * Convert a `file://` URI to a filesystem path. `new URL(uri).pathname` alone
 * yields `/C:/path` for Windows URIs (a leading slash `fs` can't open) and
 * silently drops the hostname of UNC URIs (`file://server/share/x`) — this
 * handles both: drive-letter paths lose the leading slash, UNC hosts become a
 * `\\server\share` prefix. POSIX URIs pass through unchanged. Throws on a
 * malformed URI (callers decide their own fallback).
 */
export function fileUriToPath(uri: string): string {
  const u = new URL(uri);
  let p: string;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    p = u.pathname; // malformed %-escape — keep the raw pathname
  }
  if (u.hostname && u.hostname !== "localhost") {
    return `\\\\${u.hostname}${p.replace(/\//g, "\\")}`;
  }
  if (/^\/[A-Za-z]:(\/|$)/.test(p)) return p.slice(1);
  return p;
}

/** Files at or below this size may be read synchronously to count lines. */
export const MAX_INLINE_CHIP_BYTES = 10 * 1024 * 1024;

/**
 * Whether a dropped file is small enough to `readFileSync` on the extension-host
 * thread (to count lines for an inline chip). Larger files would freeze the UI —
 * the caller should fall back to a no-selection chip.
 */
export function shouldReadFileInline(sizeBytes: number, maxBytes = MAX_INLINE_CHIP_BYTES): boolean {
  return sizeBytes <= maxBytes;
}
