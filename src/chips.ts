export interface FileChip {
  id: string;
  path: string;
  relPath: string;
  selectionStart?: number;
  selectionEnd?: number;
  hidden: boolean;
  /** 1-based index for pasted/uploaded images — matches grok's `[Image #N]` wire format. */
  imageIndex?: number;
  mimeType?: string;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function isImagePath(p: string): boolean {
  return IMAGE_EXT_RE.test(p);
}

export function isImageChip(chip: FileChip): boolean {
  return chip.imageIndex != null;
}

export function mimeFromPath(p: string): string {
  const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
  };
  return map[ext] ?? "image/png";
}

export function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
  };
  return map[mime.toLowerCase()] ?? ".png";
}

/** Next `[Image #N]` index given chips already in the composer. */
export function nextImageIndex(chips: FileChip[]): number {
  let max = 0;
  for (const c of chips) {
    if (c.imageIndex != null && c.imageIndex > max) max = c.imageIndex;
  }
  return max + 1;
}

export function makeImplicitChip(absPath: string, relPath: string): FileChip {
  return {
    id: `implicit:${absPath}`,
    path: absPath,
    relPath,
    hidden: false,
  };
}

let explicitChipCounter = 0;

export function makeExplicitChip(
  absPath: string,
  relPath: string,
  selectionStart?: number,
  selectionEnd?: number,
): FileChip {
  explicitChipCounter += 1;
  return {
    id: `explicit:${absPath}:${selectionStart ?? 0}-${selectionEnd ?? 0}:${explicitChipCounter}`,
    path: absPath,
    relPath,
    selectionStart,
    selectionEnd,
    hidden: false,
  };
}

export function makeImageChip(
  absPath: string,
  imageIndex: number,
  mimeType: string,
): FileChip {
  explicitChipCounter += 1;
  return {
    id: `image:${absPath}:${imageIndex}:${explicitChipCounter}`,
    path: absPath,
    relPath: `Image #${imageIndex}`,
    hidden: false,
    imageIndex,
    mimeType,
  };
}

export function removeChip(chips: FileChip[], id: string): FileChip[] {
  return chips.filter((c) => c.id !== id);
}

export function toggleChip(chips: FileChip[], id: string): FileChip[] {
  return chips.map((c) => (c.id === id ? { ...c, hidden: !c.hidden } : c));
}

export function clearImplicitChips(chips: FileChip[]): FileChip[] {
  return chips.filter((c) => !isImplicitChip(c));
}

/** An implicit chip is the active-editor file auto-added for ambient context
 *  (vs. a file the user explicitly attached). The id prefix is the source of
 *  truth — set by makeImplicitChip / makeExplicitChip. */
export function isImplicitChip(chip: FileChip): boolean {
  return chip.id.startsWith("implicit:");
}
