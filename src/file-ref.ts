export interface ParsedFileRef {
  path: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Parse a file reference of the form `path`, `path#L42`, or `path#L10-L20`.
 *
 * Accepts both `#L20` and `#L10-20` as the end form (the trailing `L` is optional)
 * to match what `looksLikeFileRef` lets through on the webview side.
 */
export function parseFileRef(input: string): ParsedFileRef {
  const m = input.match(/^([^#]+?)(?:#L(\d+)(?:-L?(\d+))?)?$/i);
  if (!m) return { path: input };
  const path = m[1];
  const startStr = m[2];
  const endStr = m[3];
  if (!startStr) return { path };
  const startLine = Math.max(1, Number(startStr));
  const endLine = endStr ? Math.max(startLine, Number(endStr)) : startLine;
  return { path, startLine, endLine };
}
