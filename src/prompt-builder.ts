import type { FileChip } from "./chips";

export interface PromptBuilderDeps {
  readFile: (path: string) => string;
  extName: (path: string) => string;
}

/**
 * Build the final prompt text from a typed message + active chips.
 *
 * - Hidden chips are skipped.
 * - A chip with a selection range becomes a fenced code block of those lines.
 * - A chip without a range becomes a bare path under "Attached file(s):" — NOT an
 *   `@`-reference. `@` is grok's "read this whole file" convention, which slurps a
 *   large file into context (a big CSV/log) and fails outright on binaries (an
 *   image/video → *"Cannot read binary file"*; grok has no vision). Handing grok the
 *   plain path lets it choose how to consume each: grep/range-read big text, pass an
 *   image/video path to its media tools, read a small file in full. No per-type
 *   classification — grok infers from the extension.
 * - The user's text follows after a blank line.
 */
export function buildPrompt(
  text: string,
  chips: FileChip[],
  deps: PromptBuilderDeps,
): string {
  const files: string[] = []; // whole-file attachments → bare paths, grok decides how to read
  const blocks: string[] = []; // explicit selections → fenced snippet of exactly those lines
  for (const chip of chips) {
    if (chip.hidden) continue;
    if (chip.selectionStart && chip.selectionEnd) {
      let content: string;
      try {
        content = deps.readFile(chip.path);
      } catch {
        files.push(chip.relPath); // couldn't read the range — fall back to a plain path
        continue;
      }
      const lines = content
        .split("\n")
        .slice(chip.selectionStart - 1, chip.selectionEnd);
      const ext = deps.extName(chip.path).replace(/^\./, "");
      blocks.push(
        `\`${chip.relPath}\` (lines ${chip.selectionStart}-${chip.selectionEnd}):\n\`\`\`${ext}\n${lines.join("\n")}\n\`\`\``,
      );
    } else {
      files.push(chip.relPath);
    }
  }

  const parts: string[] = [];
  if (files.length === 1) {
    parts.push(`Attached file: ${files[0]}`);
  } else if (files.length > 1) {
    parts.push("Attached files:\n" + files.map((f) => `- ${f}`).join("\n"));
  }
  parts.push(...blocks);
  if (text) parts.push(text);
  return parts.join("\n\n");
}
