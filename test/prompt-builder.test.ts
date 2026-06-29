import { describe, it, expect } from "vitest";
import { buildPrompt } from "../src/prompt-builder";
import { makeImplicitChip, makeExplicitChip } from "../src/chips";

const deps = {
  readFile: (p: string) => {
    if (p === "/a.ts") return "line1\nline2\nline3\nline4\nline5";
    if (p === "/b.ts") return "X\nY";
    throw new Error("ENOENT " + p);
  },
  extName: (p: string) => {
    const i = p.lastIndexOf(".");
    return i >= 0 ? p.slice(i) : "";
  },
};

describe("buildPrompt", () => {
  it("returns just the text when no chips", () => {
    expect(buildPrompt("hello", [], deps)).toBe("hello");
  });

  it("renders a file-only chip as a plain attached path (no @, no forced read)", () => {
    const out = buildPrompt("explain this", [makeImplicitChip("/a.ts", "src/a.ts")], deps);
    expect(out).toBe("Attached file: src/a.ts\n\nexplain this");
  });

  it("lists multiple file-only chips under 'Attached files:'", () => {
    const a = makeImplicitChip("/a.ts", "src/a.ts");
    const b = makeImplicitChip("/pic.png", "/Users/me/Downloads/pic.png");
    const out = buildPrompt("animate it", [a, b], deps);
    expect(out).toBe("Attached files:\n- src/a.ts\n- /Users/me/Downloads/pic.png\n\nanimate it");
  });

  it("renders a selection chip as fenced code", () => {
    const chip = makeExplicitChip("/a.ts", "src/a.ts", 2, 4);
    const out = buildPrompt("what is this", [chip], deps);
    expect(out).toBe(
      "`src/a.ts` (lines 2-4):\n```ts\nline2\nline3\nline4\n```\n\nwhat is this",
    );
  });

  it("skips hidden chips", () => {
    const visible = makeImplicitChip("/a.ts", "a.ts");
    const hidden = { ...makeImplicitChip("/b.ts", "b.ts"), hidden: true };
    expect(buildPrompt("q", [visible, hidden], deps)).toBe("Attached file: a.ts\n\nq");
  });

  it("falls back to a plain attached path when readFile throws", () => {
    const chip = makeExplicitChip("/missing.ts", "missing.ts", 1, 5);
    expect(buildPrompt("q", [chip], deps)).toBe("Attached file: missing.ts\n\nq");
  });

  it("combines a file attachment with a selection snippet", () => {
    const a = makeImplicitChip("/a.ts", "a.ts");
    const b = makeExplicitChip("/b.ts", "b.ts", 1, 2);
    const out = buildPrompt("compare", [a, b], deps);
    expect(out).toBe(
      "Attached file: a.ts\n\n`b.ts` (lines 1-2):\n```ts\nX\nY\n```\n\ncompare",
    );
  });

  it("uses empty fence language when no extension", () => {
    const chip = makeExplicitChip("/Makefile", "Makefile", 1, 1);
    const out = buildPrompt("", [chip], {
      readFile: () => "all:\n\techo",
      extName: () => "",
    });
    expect(out).toContain("```\nall:");
  });
});
