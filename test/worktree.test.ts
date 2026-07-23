import { describe, it, expect } from "vitest";
import {
  WORKTREE_NAME_TAG,
  forkIntoWorktreeDisplayName,
  isGitRepo,
  isWorktreeCreatedStatus,
  isWorktreeFailedStatus,
  isWorktreeSessionCwd,
  normalizeRelPath,
  parseWorktreeApplyResult,
  parseWorktreeCreateResult,
  parseWorktreeListResult,
  previewWorktreeShip,
  sanitizeWorktreeLabel,
  shipWorktreeFiles,
  summarizeShipResults,
  uniqueCwds,
  unwrapWorktreePayload,
  worktreeDisplayName,
  worktreePathsForSource,
  worktreeRowLabel,
} from "../src/worktree";

describe("unwrapWorktreePayload", () => {
  it("peels a single nested result envelope", () => {
    expect(unwrapWorktreePayload({ result: { status: "creating", worktreePath: "/w" } })).toEqual({
      status: "creating",
      worktreePath: "/w",
    });
  });

  it("returns arrays from list envelopes", () => {
    expect(unwrapWorktreePayload({ result: [{ path: "/a" }] })).toEqual([{ path: "/a" }]);
  });

  it("passes through non-enveloped values", () => {
    expect(unwrapWorktreePayload({ status: "created" })).toEqual({ status: "created" });
    expect(unwrapWorktreePayload(null)).toBe(null);
  });
});

describe("parseWorktreeCreateResult", () => {
  it("accepts nested creating response", () => {
    const r = parseWorktreeCreateResult({
      result: {
        status: "creating",
        sessionId: "s1",
        worktreePath: "/Users/x/.grok/worktrees/repo/feat",
        sourceGitRoot: "/Users/x/repo/",
      },
    });
    expect(r).toEqual({
      status: "creating",
      sessionId: "s1",
      worktreePath: "/Users/x/.grok/worktrees/repo/feat",
      sourceGitRoot: "/Users/x/repo/",
    });
  });

  it("accepts already-created status", () => {
    const r = parseWorktreeCreateResult({
      result: { status: "created", sessionId: "s1", worktreePath: "/w" },
    });
    expect(r?.status).toBe("created");
  });

  it("rejects malformed", () => {
    expect(parseWorktreeCreateResult({})).toBeNull();
    expect(parseWorktreeCreateResult({ result: { status: "creating" } })).toBeNull();
    expect(parseWorktreeCreateResult({ result: { status: "nope", sessionId: "s", worktreePath: "/w" } })).toBeNull();
  });
});

describe("parseWorktreeListResult", () => {
  it("parses nested list rows", () => {
    const rows = parseWorktreeListResult({
      result: [
        {
          id: "1",
          path: "/wt/a",
          source_repo: "/repo",
          status: "alive",
          metadata: { label: "a", user_provided: true },
        },
        { path: "" }, // skipped
        null,
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/wt/a");
    expect(rows[0].metadata?.label).toBe("a");
  });

  it("returns [] for garbage", () => {
    expect(parseWorktreeListResult(null)).toEqual([]);
    expect(parseWorktreeListResult({ result: "nope" })).toEqual([]);
  });
});

describe("sanitizeWorktreeLabel", () => {
  it("trims and accepts simple labels", () => {
    expect(sanitizeWorktreeLabel("  feat-login  ")).toBe("feat-login");
    expect(sanitizeWorktreeLabel("my_feat.1")).toBe("my_feat.1");
  });

  it("returns undefined for empty or path-like input", () => {
    expect(sanitizeWorktreeLabel("")).toBeUndefined();
    expect(sanitizeWorktreeLabel("   ")).toBeUndefined();
    expect(sanitizeWorktreeLabel("../escape")).toBeUndefined();
    expect(sanitizeWorktreeLabel("a/b")).toBeUndefined();
    expect(sanitizeWorktreeLabel("a\\b")).toBeUndefined();
  });
});

describe("worktreeDisplayName", () => {
  it("prefixes with a leading tag", () => {
    expect(worktreeDisplayName("feat")).toBe(`${WORKTREE_NAME_TAG} feat`);
  });

  it("is idempotent", () => {
    const once = worktreeDisplayName("feat");
    expect(worktreeDisplayName(once)).toBe(once);
  });

  it("handles blank", () => {
    expect(worktreeDisplayName("")).toBe(WORKTREE_NAME_TAG);
    expect(worktreeDisplayName(undefined)).toBe(WORKTREE_NAME_TAG);
  });
});

describe("isGitRepo", () => {
  it("checks for .git via the injected existsSync", () => {
    const exists = (p: string) => p.endsWith("/.git") || p.endsWith("\\.git");
    expect(isGitRepo("/repo", exists)).toBe(true);
    expect(isGitRepo("/not-a-repo", () => false)).toBe(false);
    expect(isGitRepo("", () => true)).toBe(false);
  });
});

describe("worktree status helpers", () => {
  it("matches created for the expected path", () => {
    expect(isWorktreeCreatedStatus({ status: "created", worktreePath: "/w" }, "/w")).toBe(true);
    expect(isWorktreeCreatedStatus({ status: "created", worktreePath: "/other" }, "/w")).toBe(false);
    expect(isWorktreeCreatedStatus({ status: "progress" }, "/w")).toBe(false);
  });

  it("matches failed/error", () => {
    expect(isWorktreeFailedStatus({ status: "failed", worktreePath: "/w" }, "/w")).toBe(true);
    expect(isWorktreeFailedStatus({ status: "error" })).toBe(true);
    expect(isWorktreeFailedStatus({ status: "created" })).toBe(false);
  });
});

describe("uniqueCwds / worktreePathsForSource", () => {
  it("dedupes and drops empties", () => {
    expect(uniqueCwds(["/a", "", "/b"], ["/a", "/c", undefined])).toEqual(["/a", "/b", "/c"]);
  });

  it("filters list rows by source repo and alive status", () => {
    const paths = worktreePathsForSource(
      [
        { id: "1", path: "/wt/a", source_repo: "/repo", status: "alive" },
        { id: "2", path: "/wt/b", source_repo: "/other", status: "alive" },
        { id: "3", path: "/wt/c", source_repo: "/repo/", status: "dead" },
        { id: "4", path: "/wt/d", source_repo: "/repo", status: "alive" },
      ],
      "/repo",
    );
    expect(paths).toEqual(["/wt/a", "/wt/d"]);
  });
});

describe("parseWorktreeApplyResult", () => {
  it("parses nested apply success", () => {
    const r = parseWorktreeApplyResult({
      result: {
        status: "success",
        gitRoot: "/wt",
        files: [{ path: "a.ts", type: "edit", additions: 1, deletions: 0 }],
      },
    });
    expect(r).toEqual({
      status: "success",
      gitRoot: "/wt",
      files: [{ path: "a.ts", type: "edit", additions: 1, deletions: 0 }],
    });
  });

  it("rejects missing status", () => {
    expect(parseWorktreeApplyResult({ result: { files: [] } })).toBeNull();
  });
});

describe("normalizeRelPath / shipWorktreeFiles", () => {
  it("rejects absolute and parent paths", () => {
    expect(normalizeRelPath("/abs")).toBeNull();
    expect(normalizeRelPath("../x")).toBeNull();
    expect(normalizeRelPath("./src/a.ts")).toBe("src/a.ts");
  });

  it("creates, updates, and skips identical files", () => {
    const files = new Map<string, Buffer>([
      ["/wt/src/a.ts", Buffer.from("new")],
      ["/wt/src/b.ts", Buffer.from("same")],
      ["/src/src/b.ts", Buffer.from("same")],
      ["/src/src/c.ts", Buffer.from("old")],
      ["/wt/src/c.ts", Buffer.from("fresh")],
    ]);
    const fs = {
      existsSync: (p: string) => files.has(p),
      readFileSync: (p: string) => {
        const b = files.get(p);
        if (!b) throw new Error("missing " + p);
        return b;
      },
      writeFileSync: (p: string, data: Buffer) => {
        files.set(p, data);
      },
      mkdirSync: () => {},
    };
    const results = shipWorktreeFiles({
      worktreePath: "/wt",
      sourcePath: "/src",
      relativePaths: ["src/a.ts", "src/b.ts", "src/c.ts", "../escape", ".git/config"],
      fs,
    });
    expect(results.find((r) => r.path === "src/a.ts")?.action).toBe("created");
    expect(results.find((r) => r.path === "src/b.ts")?.action).toBe("identical");
    expect(results.find((r) => r.path === "src/c.ts")?.action).toBe("updated");
    expect(results.find((r) => r.path === ".git/config")?.action).toBe("missing");
    expect(files.get("/src/src/a.ts")?.toString()).toBe("new");
    expect(files.get("/src/src/c.ts")?.toString()).toBe("fresh");
    expect(summarizeShipResults(results)).toMatch(/created/);
  });
});

describe("worktreeRowLabel / isWorktreeSessionCwd", () => {
  it("formats a list row", () => {
    expect(
      worktreeRowLabel({
        id: "1",
        path: "/wt/feat",
        git_ref: "main",
        status: "alive",
        metadata: { label: "feat" },
      }),
    ).toBe("feat @ main");
  });

  it("detects non-workspace cwds", () => {
    expect(isWorktreeSessionCwd("/repo", "/repo")).toBe(false);
    expect(isWorktreeSessionCwd("/repo/../repo", "/repo")).toBe(false);
    expect(isWorktreeSessionCwd("/wt/feat", "/repo")).toBe(true);
    expect(isWorktreeSessionCwd(undefined, "/repo")).toBe(false);
  });
});

describe("previewWorktreeShip", () => {
  it("marks only differing files as willChange", () => {
    const files = new Map<string, Buffer>([
      ["/wt/a.ts", Buffer.from("new")],
      ["/wt/b.ts", Buffer.from("same")],
      ["/src/b.ts", Buffer.from("same")],
    ]);
    const fs = {
      existsSync: (p: string) => files.has(p),
      readFileSync: (p: string) => files.get(p)!,
    };
    const preview = previewWorktreeShip({
      worktreePath: "/wt",
      sourcePath: "/src",
      relativePaths: ["a.ts", "b.ts", "missing.ts"],
      fs,
    });
    expect(preview.find((p) => p.path === "a.ts")).toMatchObject({ action: "created", willChange: true });
    expect(preview.find((p) => p.path === "b.ts")).toMatchObject({ action: "identical", willChange: false });
    expect(preview.find((p) => p.path === "missing.ts")).toMatchObject({ action: "missing", willChange: false });
  });
});

describe("forkIntoWorktreeDisplayName", () => {
  it("tags fork + worktree without double-stacking", () => {
    expect(forkIntoWorktreeDisplayName("Login fix", "feat")).toBe(
      `${WORKTREE_NAME_TAG} (Fork) Login fix · feat`,
    );
    expect(forkIntoWorktreeDisplayName("(Fork) Login fix", "feat")).toBe(
      `${WORKTREE_NAME_TAG} (Fork) Login fix · feat`,
    );
    // Already worktree-tagged parent keeps a single worktree tag.
    const once = forkIntoWorktreeDisplayName("X", "y");
    expect(forkIntoWorktreeDisplayName(once, "y").startsWith(WORKTREE_NAME_TAG)).toBe(true);
    expect(forkIntoWorktreeDisplayName(once, "y").match(/\(Worktree\)/gi)?.length).toBe(1);
  });
});
