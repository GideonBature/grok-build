import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import * as path from "node:path";

const IS_WIN = process.platform === "win32";

function candidateNames(): string[] {
  return IS_WIN ? ["grok.cmd", "grok.exe", "grok.bat", "grok"] : ["grok"];
}

function effectiveHome(): string {
  // Respect env overrides first so tests + users can redirect the home lookup.
  const fromEnv = IS_WIN ? process.env.USERPROFILE : process.env.HOME;
  return fromEnv || homedir();
}

export function locateGrokCli(configuredPath: string): string | undefined {
  if (configuredPath) {
    return existsSync(configuredPath) ? configuredPath : undefined;
  }
  const homeBin = path.join(effectiveHome(), ".grok", "bin");
  for (const name of candidateNames()) {
    const candidate = path.join(homeBin, name);
    if (existsSync(candidate)) return candidate;
  }
  try {
    const cmd = IS_WIN ? "where grok" : "command -v grok";
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    if (first && existsSync(first)) return first;
  } catch {
    // ignore — not on PATH
  }
  return undefined;
}

/**
 * Decide whether to silently auto-update the grok CLI because *our extension* was
 * upgraded since the last run. True only when a prior version was recorded (so a
 * fresh install never triggers an update — that's the "not-first-run" rule) and it
 * differs from the current extension version. Pure so it's unit-testable.
 */
export function extensionWasUpgraded(lastSeen: string | undefined, current: string): boolean {
  return !!lastSeen && !!current && lastSeen !== current;
}

/**
 * Last grok CLI version known to work with the extension's `agent stdio` ACP
 * transport on Windows. We pin the CLI to this when it's on a broken build (see
 * `isStdioBrokenGrokVersion`).
 */
export const GROK_STDIO_DOWNGRADE_TARGET = "0.2.60";

/**
 * Parse a grok `--version` banner ("grok 0.2.64 (9a9ac25b10) [stable]") into a
 * `[major, minor, patch]` tuple, or undefined when no `X.Y.Z` is present. Pure.
 */
export function parseGrokVersion(versionOutput: string): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(versionOutput ?? "");
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * grok CLI 0.2.61+ ships a Windows-only `agent stdio` regression: the agent doesn't
 * read stdin lines until stdin hits EOF (which never comes for a live client), so an
 * ACP startup request times out and the process is torn down ("exited with code
 * null"). It *mutated* across builds: on **0.2.61–0.2.64** even `initialize` hangs;
 * on **0.2.67** `initialize` is answered but the *next* request (`session/new`)
 * hangs — so a session still can't start. 0.2.65–0.2.66 were never tested (treated as
 * broken). Confirmed via controlled spawns (closing stdin → the read unblocks;
 * keeping it open as any real client must → hang). The last fully-working build is
 * 0.2.60. See issue #22 and `research/stdio-eof-regression.md`.
 *
 * Detect the confirmed-broken range 0.2.61–0.2.67 (Windows only) so the host can pin
 * the CLI back to 0.2.60 before spawning. The upper bound tracks the highest build
 * confirmed broken; a *future* build above it is caught reactively
 * (`shouldReactivelyDowngrade`) on the observed failure. Only once a build is
 * confirmed fixed — **re-verified with the session/new probe, not just initialize** —
 * raise `GROK_STDIO_DOWNGRADE_TARGET` to it and shrink this range. Pure.
 */
export function isStdioBrokenGrokVersion(versionOutput: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  const v = parseGrokVersion(versionOutput);
  if (!v) return false;
  const [maj, min, pat] = v;
  return maj === 0 && min === 2 && pat >= 61 && pat <= 67;
}

/** Compare two `[major, minor, patch]` tuples: <0, 0, or >0. Pure. */
export function compareVersionTuple(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Decision for the "Update Grok Build CLI" action (manual menu *and* the silent
 * on-upgrade update), given the installed version + platform.
 *
 * The Windows `agent stdio` regression (see `isStdioBrokenGrokVersion`) makes any
 * build above `GROK_STDIO_DOWNGRADE_TARGET` (0.2.60) unusable by the extension, so
 * on Windows we must **never move the CLI onto an unsupported build**:
 *   - at/above the 0.2.60 ceiling → **block** the update (a note explains why);
 *   - below the ceiling → **allow**, but pin the update to 0.2.60, never `latest`.
 * Other platforms are unaffected (latest works) → always allow, no pin.
 * An unparseable version is treated as "allow, no pin" so we never wedge a user
 * who's on a build we can't reason about.
 */
export interface GrokUpdatePolicy {
  /** May the update run at all? */
  allow: boolean;
  /** When allowed, pin to this exact version instead of `latest` (undefined ⇒ latest). */
  target?: string;
  /** When blocked, the reason to surface in the menu / log. */
  note?: string;
}

export function grokUpdatePolicy(versionOutput: string, platform: NodeJS.Platform): GrokUpdatePolicy {
  if (platform !== "win32") return { allow: true };
  const v = parseGrokVersion(versionOutput);
  if (!v) return { allow: true };
  const ceiling = parseGrokVersion(GROK_STDIO_DOWNGRADE_TARGET)!;
  if (compareVersionTuple(v, ceiling) < 0) {
    // Behind the supported ceiling — updating helps, but only as far as 0.2.60.
    return { allow: true, target: GROK_STDIO_DOWNGRADE_TARGET };
  }
  // At/above the ceiling: any update would land on (or stay on) a broken build.
  return {
    allow: false,
    note:
      `Grok CLI updates are paused — 0.2.61+ has a bug that breaks the extension (#22). ` +
      `Supported version: ${GROK_STDIO_DOWNGRADE_TARGET}.`,
  };
}

/**
 * Should the host REACTIVELY downgrade the CLI after an *observed* `agent stdio`
 * init failure (handshake timeout / "exited code null")?
 *
 * The proactive `isStdioBrokenGrokVersion` only knows the closed, already-confirmed
 * broken range (0.2.61–0.2.67) — so a *future* still-broken build (0.2.68+) would
 * slip past it and hang with no recovery. This check is the evidence-driven safety
 * net: it fires on the real failure (whether the hang is at `initialize` or
 * `session/new`), not a version guess, so it self-heals on any build *above* the
 * supported target without having to widen a hardcoded range.
 *
 * Windows-only (the regression is). A build at/below 0.2.60 is never downgraded —
 * that's the loop guard: once the pin lands the version is exactly the target, so a
 * subsequent failure (some other cause) can't trigger another downgrade. A later
 * *manual* re-upgrade pushes the version back above the target, so a fresh failure
 * re-triggers the downgrade — exactly the "they upgraded anyway, fix it again"
 * case. Unparseable version ⇒ leave alone. Pure.
 */
export function shouldReactivelyDowngrade(versionOutput: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  const v = parseGrokVersion(versionOutput);
  if (!v) return false;
  const target = parseGrokVersion(GROK_STDIO_DOWNGRADE_TARGET)!;
  return compareVersionTuple(v, target) > 0;
}
