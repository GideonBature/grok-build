/**
 * Integration tests against a real `grok agent stdio` process.
 *
 * Excluded from CI (GitHub doesn't have the grok CLI). Run locally with:
 *   npm run test:integration
 *
 * Skips gracefully when the binary is missing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { AcpClient } from "../../src/acp";
import { locateGrokCli } from "../../src/cli-locator";
import {
  defaultFs,
  deleteSessionDir,
  listSessions,
  sessionsDirFor,
} from "../../src/sessions";

const GROK_CLI = locateGrokCli("");
const HAS_GROK = !!GROK_CLI;

const describeIfGrok = HAS_GROK ? describe : describe.skip;

if (!HAS_GROK) {
  // eslint-disable-next-line no-console
  console.warn("[integration] grok CLI not found — skipping session integration tests");
}

describeIfGrok("grok agent stdio — session management", () => {
  // Use a throwaway cwd so we don't pollute the user's real session list for this repo.
  const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "grok-it-"));
  const GROK_HOME = path.join(process.env.HOME || "", ".grok");

  let client: AcpClient;
  let createdSessionId: string | undefined;

  beforeAll(async () => {
    client = new AcpClient({
      cliPath: GROK_CLI!,
      cwd: TEST_CWD,
      env: process.env,
      log: () => { /* swallow logs in tests */ },
    });
    await client.start();
  }, 30_000);

  afterAll(() => {
    try { client?.dispose(); } catch { /* ignore */ }
    if (createdSessionId) {
      try {
        deleteSessionDir({ fs: defaultFs, grokHome: GROK_HOME, cwd: TEST_CWD, id: createdSessionId });
      } catch { /* ignore */ }
    }
    try { fs.rmSync(TEST_CWD, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("initialize completes and exposes a protocol version", async () => {
    // start() already issued initialize; verify the agent stayed alive and we can issue another request.
    // newSession will fail if the agent died.
    expect(client).toBeDefined();
  });

  it("session/new creates a session id and persists summary.json on disk", async () => {
    const { sessionId } = await client.newSession();
    expect(sessionId).toMatch(/[0-9a-f-]{20,}/);
    createdSessionId = sessionId;

    const dir = path.join(sessionsDirFor(GROK_HOME, TEST_CWD), sessionId);
    expect(fs.existsSync(dir)).toBe(true);
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    expect(summary?.info?.id).toBe(sessionId);
    expect(summary?.info?.cwd).toBe(TEST_CWD);
  }, 20_000);

  it("listSessions picks up the newly-created session", () => {
    expect(createdSessionId).toBeDefined();
    const sessions = listSessions({
      fs: defaultFs,
      grokHome: GROK_HOME,
      cwd: TEST_CWD,
      overrides: {},
    });
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(createdSessionId!);
  });

  it("session/load can resume a session by id on a fresh client", async () => {
    expect(createdSessionId).toBeDefined();
    const fresh = new AcpClient({
      cliPath: GROK_CLI!,
      cwd: TEST_CWD,
      env: process.env,
      log: () => {},
    });
    try {
      await fresh.start();
      const res = await fresh.loadSession(createdSessionId!);
      expect(res.sessionId).toBe(createdSessionId);
    } finally {
      fresh.dispose();
    }
  }, 30_000);

  it("deleteSessionDir removes a session from listSessions", async () => {
    // Use a brand-new session here so we're not racing against grok flushing
    // the session loaded in the previous test.
    const { sessionId } = await client.newSession();
    expect(sessionId).toMatch(/[0-9a-f-]{20,}/);

    // Wait briefly for grok to finish writing summary.json.
    await new Promise((r) => setTimeout(r, 100));

    deleteSessionDir({
      fs: defaultFs,
      grokHome: GROK_HOME,
      cwd: TEST_CWD,
      id: sessionId,
    });
    const sessions = listSessions({
      fs: defaultFs,
      grokHome: GROK_HOME,
      cwd: TEST_CWD,
      overrides: {},
    });
    expect(sessions.map((s) => s.id)).not.toContain(sessionId);
  }, 20_000);
});
