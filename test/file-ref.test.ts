import { describe, it, expect } from "vitest";
import { fileUriToPath, parseFileRef, shouldReadFileInline, MAX_INLINE_CHIP_BYTES } from "../src/file-ref";

describe("parseFileRef", () => {
  it("returns the bare path when there is no line suffix", () => {
    expect(parseFileRef("src/a.ts")).toEqual({ path: "src/a.ts" });
  });

  it("parses a single-line suffix", () => {
    expect(parseFileRef("src/a.ts#L10")).toEqual({ path: "src/a.ts", startLine: 10 });
  });

  it("parses a range suffix, with or without the second L", () => {
    expect(parseFileRef("src/a.ts#L10-L20")).toEqual({ path: "src/a.ts", startLine: 10, endLine: 20 });
    expect(parseFileRef("src/a.ts#L10-20")).toEqual({ path: "src/a.ts", startLine: 10, endLine: 20 });
  });

  // The bug: a `#` earlier in the path (C#/F# folders) must not break parsing.
  it("keeps a literal # in the path when there is no line suffix", () => {
    expect(parseFileRef("C#/foo.ts")).toEqual({ path: "C#/foo.ts" });
  });

  it("separates a literal # in the path from a trailing line suffix", () => {
    // Pre-fix this fell through to the whole string and opened `foo.ts#L10`.
    expect(parseFileRef("C#/foo.ts#L10")).toEqual({ path: "C#/foo.ts", startLine: 10 });
    expect(parseFileRef("F#/Program.fs#L5-L8")).toEqual({ path: "F#/Program.fs", startLine: 5, endLine: 8 });
  });

  it("handles Windows paths with a # folder", () => {
    expect(parseFileRef("C:\\proj\\C#\\a.cs#L3")).toEqual({ path: "C:\\proj\\C#\\a.cs", startLine: 3 });
  });

  // `:line` suffixes are what chat text actually contains (`src/a.ts:42`); they
  // used to fall through as part of the path, so the click opened nothing.
  it("parses a trailing :line suffix", () => {
    expect(parseFileRef("src/a.ts:42")).toEqual({ path: "src/a.ts", startLine: 42 });
  });

  it("parses a trailing :start-end range", () => {
    expect(parseFileRef("src/a.ts:10-20")).toEqual({ path: "src/a.ts", startLine: 10, endLine: 20 });
  });

  it("keeps the line and drops the column of a compiler-style :line:col ref", () => {
    expect(parseFileRef("src/a.ts:12:5")).toEqual({ path: "src/a.ts", startLine: 12 });
  });

  // The drive colon must never be mistaken for a line suffix — only a
  // digits-to-end suffix counts.
  it("splits the line suffix off an absolute Windows path, keeping the drive colon", () => {
    expect(parseFileRef("C:\\work\\file.ts:42")).toEqual({ path: "C:\\work\\file.ts", startLine: 42 });
    expect(parseFileRef("C:\\work\\file.ts")).toEqual({ path: "C:\\work\\file.ts" });
    expect(parseFileRef("C:/work/file.ts:7-9")).toEqual({ path: "C:/work/file.ts", startLine: 7, endLine: 9 });
  });

  it("does not treat mid-path digit groups as a line suffix", () => {
    expect(parseFileRef("a:1/b.ts")).toEqual({ path: "a:1/b.ts" });
  });
});

describe("fileUriToPath", () => {
  // The bug family: `new URL(uri).pathname` yields `/C:/x` (a leading slash fs
  // can't open on Windows) and drops UNC hosts entirely.
  it("strips the leading slash from a Windows drive-letter URI", () => {
    expect(fileUriToPath("file:///C:/Users/p/proj/a.ts")).toBe("C:/Users/p/proj/a.ts");
    expect(fileUriToPath("file:///c:/lower/drive.txt")).toBe("c:/lower/drive.txt");
  });

  it("decodes percent-escapes (spaces, unicode)", () => {
    expect(fileUriToPath("file:///C:/My%20Docs/na%C3%AFve.md")).toBe("C:/My Docs/naïve.md");
  });

  it("keeps a drive-root URI openable", () => {
    expect(fileUriToPath("file:///C:/")).toBe("C:/");
  });

  it("rebuilds a UNC path from the URI hostname", () => {
    expect(fileUriToPath("file://server/share/dir/x.mp4")).toBe("\\\\server\\share\\dir\\x.mp4");
  });

  it("treats localhost as no host (POSIX form)", () => {
    expect(fileUriToPath("file://localhost/home/u/a.txt")).toBe("/home/u/a.txt");
  });

  it("passes POSIX paths through unchanged", () => {
    expect(fileUriToPath("file:///home/u/.grok/sessions/s/out.png")).toBe("/home/u/.grok/sessions/s/out.png");
  });

  it("does not mangle a POSIX dir that merely looks drive-ish deeper in the path", () => {
    expect(fileUriToPath("file:///mnt/C:/odd")).toBe("/mnt/C:/odd");
  });

  it("survives a malformed percent-escape by keeping the raw pathname", () => {
    expect(fileUriToPath("file:///C:/bad%GGname.txt")).toBe("C:/bad%GGname.txt");
  });

  it("throws on a non-URI so callers can apply their own fallback", () => {
    expect(() => fileUriToPath("not a uri")).toThrow();
  });
});

describe("shouldReadFileInline", () => {
  it("allows files up to the threshold", () => {
    expect(shouldReadFileInline(0)).toBe(true);
    expect(shouldReadFileInline(MAX_INLINE_CHIP_BYTES)).toBe(true);
  });

  it("rejects files larger than the threshold", () => {
    expect(shouldReadFileInline(MAX_INLINE_CHIP_BYTES + 1)).toBe(false);
    expect(shouldReadFileInline(500 * 1024 * 1024)).toBe(false);
  });
});
