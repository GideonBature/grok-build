import { describe, it, expect } from "vitest";
import { parseFileRef } from "../src/file-ref";

describe("parseFileRef", () => {
  it("returns just the path when no anchor is present", () => {
    expect(parseFileRef("src/sidebar.ts")).toEqual({ path: "src/sidebar.ts" });
  });

  it("parses a single-line anchor", () => {
    expect(parseFileRef("src/sidebar.ts#L42")).toEqual({
      path: "src/sidebar.ts",
      startLine: 42,
      endLine: 42,
    });
  });

  it("parses a range with the trailing L", () => {
    expect(parseFileRef("media/chat.js#L10-L20")).toEqual({
      path: "media/chat.js",
      startLine: 10,
      endLine: 20,
    });
  });

  it("parses a range without the trailing L", () => {
    expect(parseFileRef("media/chat.js#L10-20")).toEqual({
      path: "media/chat.js",
      startLine: 10,
      endLine: 20,
    });
  });

  it("clamps an end-line that comes before the start back up to the start", () => {
    expect(parseFileRef("foo.ts#L20-L5")).toEqual({
      path: "foo.ts",
      startLine: 20,
      endLine: 20,
    });
  });

  it("clamps startLine to a minimum of 1", () => {
    expect(parseFileRef("foo.ts#L0")).toEqual({
      path: "foo.ts",
      startLine: 1,
      endLine: 1,
    });
  });

  it("preserves absolute paths", () => {
    expect(parseFileRef("/abs/path/file.ts#L5")).toEqual({
      path: "/abs/path/file.ts",
      startLine: 5,
      endLine: 5,
    });
  });

  it("accepts an uppercase #L prefix (regex is case-insensitive)", () => {
    expect(parseFileRef("foo.ts#l3-l4")).toEqual({
      path: "foo.ts",
      startLine: 3,
      endLine: 4,
    });
  });
});
