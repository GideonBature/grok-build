import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  locateGrokCli,
  extensionWasUpgraded,
  parseGrokVersion,
  isStdioBrokenGrokVersion,
  compareVersionTuple,
  grokUpdatePolicy,
  shouldReactivelyDowngrade,
  GROK_STDIO_DOWNGRADE_TARGET,
} from "../src/cli-locator";

const IS_WIN = process.platform === "win32";
const PATH_SEP = IS_WIN ? ";" : ":";
const FAKE_BIN_NAME = IS_WIN ? "grok.cmd" : "grok";

describe("locateGrokCli", () => {
  let tmpDir: string;
  let fakeBin: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-locate-"));
    fakeBin = path.join(tmpDir, FAKE_BIN_NAME);
    if (IS_WIN) {
      fs.writeFileSync(fakeBin, "@echo mock\r\n");
    } else {
      fs.writeFileSync(fakeBin, "#!/bin/sh\necho mock\n");
      fs.chmodSync(fakeBin, 0o755);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the configured path when it exists", () => {
    expect(locateGrokCli(fakeBin)).toBe(fakeBin);
  });

  it("returns undefined when configured path is missing", () => {
    expect(locateGrokCli(path.join(tmpDir, "missing"))).toBeUndefined();
  });

  it("falls back to PATH when no config and no ~/.grok/bin/grok", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = tmpDir + PATH_SEP + (originalPath ?? "");
    try {
      const result = locateGrokCli("");
      // Either ~/.grok/bin/grok wins (if installed) or PATH lookup finds the fake.
      const found = result?.toLowerCase();
      expect(found === fakeBin.toLowerCase() || !!found?.includes("grok")).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("returns undefined when nothing found", () => {
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.PATH = "";
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    try {
      expect(locateGrokCli("")).toBeUndefined();
    } finally {
      process.env.PATH = originalPath;
      if (originalHome) process.env.HOME = originalHome;
      if (originalUserProfile) process.env.USERPROFILE = originalUserProfile;
    }
  });
});

describe("extensionWasUpgraded", () => {
  it("is false on a fresh install (no prior version recorded)", () => {
    expect(extensionWasUpgraded(undefined, "1.4.0")).toBe(false);
    expect(extensionWasUpgraded("", "1.4.0")).toBe(false);
  });

  it("is false when the version is unchanged (plain restart)", () => {
    expect(extensionWasUpgraded("1.4.0", "1.4.0")).toBe(false);
  });

  it("is true when the extension version changed (an upgrade)", () => {
    expect(extensionWasUpgraded("1.3.2", "1.4.0")).toBe(true);
  });

  it("is true even on a downgrade (any version mismatch re-syncs the CLI)", () => {
    expect(extensionWasUpgraded("1.4.0", "1.3.2")).toBe(true);
  });

  it("is false defensively when the current version is empty", () => {
    expect(extensionWasUpgraded("1.4.0", "")).toBe(false);
  });
});

describe("parseGrokVersion", () => {
  it("parses the real --version banner", () => {
    expect(parseGrokVersion("grok 0.2.64 (9a9ac25b10) [stable]")).toEqual([0, 2, 64]);
  });

  it("parses a bare version string", () => {
    expect(parseGrokVersion("0.2.60")).toEqual([0, 2, 60]);
  });

  it("parses double-digit and larger components", () => {
    expect(parseGrokVersion("grok 1.10.205 (abc) [alpha]")).toEqual([1, 10, 205]);
  });

  it("returns undefined when no X.Y.Z is present", () => {
    expect(parseGrokVersion("grok (dev build)")).toBeUndefined();
    expect(parseGrokVersion("")).toBeUndefined();
    expect(parseGrokVersion(undefined as unknown as string)).toBeUndefined();
  });
});

describe("isStdioBrokenGrokVersion (issue #22)", () => {
  it("flags the broken 0.2.61–0.2.67 range on Windows", () => {
    // 0.2.61–0.2.64 confirmed broken (initialize hangs); 0.2.67 confirmed broken
    // (session/new hangs); 0.2.65–0.2.66 untested → treated as broken. All pinned
    // back to the last fully-working 0.2.60.
    for (const p of ["0.2.61", "0.2.62", "0.2.63", "0.2.64", "0.2.65", "0.2.66", "0.2.67"]) {
      expect(isStdioBrokenGrokVersion(`grok ${p} (x) [stable]`, "win32")).toBe(true);
    }
  });

  it("does not flag the last working version 0.2.60 on Windows", () => {
    expect(isStdioBrokenGrokVersion("grok 0.2.60 (x) [stable]", "win32")).toBe(false);
    expect(GROK_STDIO_DOWNGRADE_TARGET).toBe("0.2.60");
  });

  it("does not flag versions outside the broken range on Windows", () => {
    expect(isStdioBrokenGrokVersion("grok 0.2.59 (x) [stable]", "win32")).toBe(false);
    expect(isStdioBrokenGrokVersion("grok 0.2.68 (x) [stable]", "win32")).toBe(false);
    expect(isStdioBrokenGrokVersion("grok 0.3.0 (x) [stable]", "win32")).toBe(false);
    expect(isStdioBrokenGrokVersion("grok 0.1.211 (x) [stable]", "win32")).toBe(false);
  });

  it("never flags non-Windows platforms (the bug is Windows-only)", () => {
    expect(isStdioBrokenGrokVersion("grok 0.2.64 (x) [stable]", "linux")).toBe(false);
    expect(isStdioBrokenGrokVersion("grok 0.2.64 (x) [stable]", "darwin")).toBe(false);
  });

  it("is false defensively when the version is unparseable", () => {
    expect(isStdioBrokenGrokVersion("grok (dev)", "win32")).toBe(false);
    expect(isStdioBrokenGrokVersion("", "win32")).toBe(false);
  });
});

describe("compareVersionTuple", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersionTuple([0, 2, 60], [0, 2, 61])).toBeLessThan(0);
    expect(compareVersionTuple([0, 2, 64], [0, 2, 60])).toBeGreaterThan(0);
    expect(compareVersionTuple([0, 2, 60], [0, 2, 60])).toBe(0);
    expect(compareVersionTuple([1, 0, 0], [0, 9, 9])).toBeGreaterThan(0);
    expect(compareVersionTuple([0, 3, 0], [0, 2, 99])).toBeGreaterThan(0);
  });
});

describe("grokUpdatePolicy (issue #22 — never upgrade onto an unsupported build)", () => {
  it("blocks updates on Windows at the supported ceiling (0.2.60)", () => {
    const p = grokUpdatePolicy("grok 0.2.60 (x) [stable]", "win32");
    expect(p.allow).toBe(false);
    expect(p.target).toBeUndefined();
    expect(p.note).toMatch(/#22/);
  });

  it("blocks updates on Windows when already on a broken build (0.2.61–0.2.64)", () => {
    for (const v of ["0.2.61", "0.2.64"]) {
      expect(grokUpdatePolicy(`grok ${v} (x) [stable]`, "win32").allow).toBe(false);
    }
  });

  it("allows updates on Windows below the ceiling, but pins to 0.2.60 (never latest)", () => {
    const p = grokUpdatePolicy("grok 0.2.59 (x) [stable]", "win32");
    expect(p.allow).toBe(true);
    expect(p.target).toBe(GROK_STDIO_DOWNGRADE_TARGET);
    expect(p.target).toBe("0.2.60");
    expect(grokUpdatePolicy("grok 0.1.211 (x) [stable]", "win32").target).toBe("0.2.60");
  });

  it("never restricts non-Windows platforms (update freely to latest)", () => {
    for (const plat of ["linux", "darwin"] as const) {
      const p = grokUpdatePolicy("grok 0.2.64 (x) [stable]", plat);
      expect(p.allow).toBe(true);
      expect(p.target).toBeUndefined();
    }
  });

  it("allows (no pin) when the version is unparseable, so a user is never wedged", () => {
    const p = grokUpdatePolicy("grok (dev build)", "win32");
    expect(p.allow).toBe(true);
    expect(p.target).toBeUndefined();
  });
});

describe("shouldReactivelyDowngrade (issue #22 — evidence-driven recovery after an init failure)", () => {
  it("downgrades any Windows build ABOVE the supported target, incl. the known-broken range", () => {
    for (const v of ["0.2.61", "0.2.64", "0.2.67", "0.2.68", "0.3.0", "1.0.0"]) {
      expect(shouldReactivelyDowngrade(`grok ${v} (x) [stable]`, "win32")).toBe(true);
    }
  });

  it("catches a FUTURE still-broken build (0.2.68+) the proactive range can't see", () => {
    // The whole point: isStdioBrokenGrokVersion is a closed range (0.2.61–0.2.67) and
    // would miss a future 0.2.68, but a real startup failure on it still recovers
    // because this fires on evidence, not a version guess.
    expect(isStdioBrokenGrokVersion("grok 0.2.68 (x) [stable]", "win32")).toBe(false);
    expect(shouldReactivelyDowngrade("grok 0.2.68 (x) [stable]", "win32")).toBe(true);
  });

  it("never downgrades at/below the target — the loop guard once the pin lands", () => {
    for (const v of ["0.2.60", "0.2.59", "0.1.211"]) {
      expect(shouldReactivelyDowngrade(`grok ${v} (x) [stable]`, "win32")).toBe(false);
    }
  });

  it("is Windows-only", () => {
    for (const plat of ["linux", "darwin"] as const) {
      expect(shouldReactivelyDowngrade("grok 0.2.65 (x) [stable]", plat)).toBe(false);
    }
  });

  it("leaves an unparseable version alone (no spurious downgrade)", () => {
    expect(shouldReactivelyDowngrade("grok (dev build)", "win32")).toBe(false);
    expect(shouldReactivelyDowngrade("", "win32")).toBe(false);
  });
});
