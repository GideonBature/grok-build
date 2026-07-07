import { isImageChip, isImplicitChip, type FileChip } from "./chips";

export interface PromptBuilderDeps {
  readFile: (path: string) => string;
  readFileBinary?: (path: string) => Buffer;
  extName: (path: string) => string;
}

export interface PromptImage {
  index: number;
  mimeType: string;
  data: string;
}

export interface BuildPromptWithImagesResult {
  text: string;
  images: PromptImage[];
}

// The file-path context (attached files + the open-editor file) is wrapped in a
// unique, machine-readable tag so it can be parsed back deterministically on
// session restore (to re-render filename-only chips instead of the raw prompt
// text) — see `parseAttachmentContext` in media/webview-helpers.js. The inner
// wording is deliberately the same natural prose grok already reads well; the tag
// is just an unambiguous envelope. The `note` tells grok it's editor-injected.
export const CONTEXT_TAG_OPEN =
  '<vscode-context note="added by the editor, not typed by the user">';
export const CONTEXT_TAG_CLOSE = "</vscode-context>";

/**
 * Build the final prompt text from a typed message + active chips.
 *
 * - Hidden chips are skipped.
 * - A chip with a selection range becomes a fenced code block of those lines.
 * - A chip without a range becomes a bare path — NOT an `@`-reference. `@` is grok's
 *   "read this whole file" convention, which slurps a large file into context (a big
 *   CSV/log) and fails outright on binaries (an image/video → *"Cannot read binary
 *   file"*; grok has no vision). Handing grok the plain path lets it choose how to
 *   consume each: grep/range-read big text, pass an image/video path to its media
 *   tools, read a small file in full. No per-type classification — grok infers from
 *   the extension.
 * - Whole-file chips are split by origin: a file the user explicitly attached is the
 *   strong "act on this" signal ("Attached file(s)"), while the active-editor file
 *   auto-included for ambient context is the weaker "this is what I'm looking at"
 *   signal ("Currently open in the editor (for context)"). Keeping them apart stops
 *   grok treating a file you happen to have open as one you asked it to work on.
 * - The user's text follows after a blank line.
 */
export function buildPrompt(
  text: string,
  chips: FileChip[],
  deps: PromptBuilderDeps,
): string {
  const attached: string[] = []; // explicitly attached whole files → bare paths, grok decides how to read
  const openInEditor: string[] = []; // implicit active-editor file → ambient context only
  const blocks: string[] = []; // explicit selections → fenced snippet of exactly those lines
  for (const chip of chips) {
    if (chip.hidden) continue;
    if (chip.selectionStart && chip.selectionEnd) {
      let content: string;
      try {
        content = deps.readFile(chip.path);
      } catch {
        attached.push(chip.relPath); // couldn't read the range — fall back to a plain path
        continue;
      }
      const lines = content
        .split("\n")
        .slice(chip.selectionStart - 1, chip.selectionEnd);
      const ext = deps.extName(chip.path).replace(/^\./, "");
      blocks.push(
        `\`${chip.relPath}\` (lines ${chip.selectionStart}-${chip.selectionEnd}):\n\`\`\`${ext}\n${lines.join("\n")}\n\`\`\``,
      );
    } else if (isImplicitChip(chip)) {
      openInEditor.push(chip.relPath);
    } else {
      attached.push(chip.relPath);
    }
  }

  const contextSections: string[] = [];
  if (attached.length === 1) {
    contextSections.push(`Attached file: ${attached[0]}`);
  } else if (attached.length > 1) {
    contextSections.push("Attached files:\n" + attached.map((f) => `- ${f}`).join("\n"));
  }
  if (openInEditor.length === 1) {
    contextSections.push(`Currently open in the editor (for context): ${openInEditor[0]}`);
  } else if (openInEditor.length > 1) {
    contextSections.push(
      "Currently open in the editor (for context):\n" +
        openInEditor.map((f) => `- ${f}`).join("\n"),
    );
  }

  const parts: string[] = [];
  if (contextSections.length) {
    parts.push(`${CONTEXT_TAG_OPEN}\n${contextSections.join("\n\n")}\n${CONTEXT_TAG_CLOSE}`);
  }
  parts.push(...blocks);
  if (text) parts.push(text);
  return parts.join("\n\n");
}

/**
 * Build the ACP prompt payload for a user turn: a text block (file context +
 * `[Image #N]` tags + typed message) plus zero or more inline image blocks.
 *
 * Image chips are **not** handed to grok as bare paths — that would make it call
 * `fs/read_text_file` and fail on binaries. Instead we mirror the grok TUI:
 * `[Image #1]` in the text and a separate `{type:"image", data:<base64>}` block.
 */
export function buildPromptWithImages(
  text: string,
  chips: FileChip[],
  deps: PromptBuilderDeps,
): BuildPromptWithImagesResult {
  const imageChips = chips
    .filter((c) => !c.hidden && isImageChip(c))
    .sort((a, b) => (a.imageIndex ?? 0) - (b.imageIndex ?? 0));
  const fileChips = chips.filter((c) => !c.hidden && !isImageChip(c));

  const filePrompt = buildPrompt("", fileChips, deps);
  const imageTags = imageChips.map((c) => `[Image #${c.imageIndex}]`);

  let userPart = "";
  if (imageTags.length === 1 && text) {
    userPart = `${imageTags[0]} ${text}`;
  } else if (imageTags.length) {
    userPart = imageTags.join("\n");
    if (text) userPart += `\n\n${text}`;
  } else {
    userPart = text;
  }

  const parts: string[] = [];
  if (filePrompt) parts.push(filePrompt);
  if (userPart) parts.push(userPart);
  const promptText = parts.join("\n\n");

  const readBinary = deps.readFileBinary ?? (() => Buffer.alloc(0));
  const images: PromptImage[] = [];
  for (const chip of imageChips) {
    try {
      const data = readBinary(chip.path).toString("base64");
      images.push({
        index: chip.imageIndex!,
        mimeType: chip.mimeType ?? "image/png",
        data,
      });
    } catch {
      /* skip unreadable image — text tag still goes through */
    }
  }

  return { text: promptText, images };
}
