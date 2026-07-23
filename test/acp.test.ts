import { describe, it, expect, vi } from "vitest";
import { AcpClient, buildGrokAgentArgs } from "../src/acp";

// Unit tests for AcpClient internals that don't need a real subprocess. We
// stand up the client with a fake writable proc and drive `request`/`onLine`
// directly.
function clientWithFakeProc(): { client: AcpClient; written: string[] } {
  const client = new AcpClient({ cliPath: "x", cwd: "/", log: () => {} });
  const written: string[] = [];
  (client as any).proc = {
    killed: false,
    stdin: { writable: true, write: (s: string) => written.push(s) },
  };
  return { client, written };
}

describe("AcpClient.request timer lifecycle", () => {
  it("clears the per-request timeout when the response arrives (no leaked timer)", async () => {
    vi.useFakeTimers();
    try {
      const { client } = clientWithFakeProc();
      const before = vi.getTimerCount();

      const p = (client as any).request("session/set_mode", { modeId: "plan" }); // id = 1
      expect(vi.getTimerCount()).toBe(before + 1); // timeout armed

      (client as any).onLine(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
      await p;

      expect(vi.getTimerCount()).toBe(before); // timeout cleared on response
    } finally {
      vi.useRealTimers();
    }
  });
});

// #3/#4 (thanks @shugav for the crash report): the startup crash was the bogus
// `max` value, not reasoningEffort itself — grok accepts none|minimal|low|medium|
// high|xhigh, and the flag must precede the `stdio` subcommand.
describe("AcpClient.createWorktree", () => {
  it("waits for worktreeStatus created and resolves the path", async () => {
    const { client } = clientWithFakeProc();
    (client as any).sessionId = "s1";

    const p = client.createWorktree({ sourcePath: "/repo", label: "feat", timeoutMs: 5000 });
    // First response: create accepted (nested result envelope from CLI)
    (client as any).onLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          result: {
            status: "creating",
            sessionId: "s1",
            worktreePath: "/wt/feat",
            sourceGitRoot: "/repo/",
          },
        },
      }),
    );
    // Then the async status notification
    await Promise.resolve();
    (client as any).onLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "_x.ai/git/worktree/status",
        params: { status: "created", sessionId: "s1", worktreePath: "/wt/feat" },
      }),
    );

    await expect(p).resolves.toMatchObject({
      status: "created",
      worktreePath: "/wt/feat",
      sessionId: "s1",
    });
  });

  it("returns unsupported on -32601", async () => {
    const { client } = clientWithFakeProc();
    (client as any).sessionId = "s1";
    const p = client.createWorktree({ sourcePath: "/repo" });
    (client as any).onLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Method not found" },
      }),
    );
    await expect(p).resolves.toBe("unsupported");
  });
});

describe("buildGrokAgentArgs", () => {
  it("starts ACP sessions with the stdio subcommand when no effort is set", () => {
    expect(buildGrokAgentArgs()).toEqual(["agent", "stdio"]);
  });

  it("forwards a valid effort as --reasoning-effort before the stdio subcommand", () => {
    expect(buildGrokAgentArgs("high")).toEqual(["agent", "--reasoning-effort", "high", "stdio"]);
    expect(buildGrokAgentArgs("none")).toEqual(["agent", "--reasoning-effort", "none", "stdio"]);
    expect(buildGrokAgentArgs("xhigh")).toEqual(["agent", "--reasoning-effort", "xhigh", "stdio"]);
  });
});
