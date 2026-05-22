import { describe, it, expect } from "vitest";
import {
  extractPromptMeta,
  makeAckResponse,
  makeExitPlanResponse,
  makePermissionResponse,
  makeRequest,
  parseAcpLine,
  routeSessionUpdate,
} from "../src/acp-dispatch";

describe("parseAcpLine", () => {
  it("returns null for empty / whitespace", () => {
    expect(parseAcpLine("")).toBeNull();
    expect(parseAcpLine("   \n")).toBeNull();
  });

  it("flags non-JSON lines", () => {
    const r = parseAcpLine("not json {");
    expect(r?.kind).toBe("non-json");
  });

  it("recognizes a response (id + no method)", () => {
    const r = parseAcpLine(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
    );
    expect(r).toEqual({ kind: "response", id: 1, result: { ok: true }, error: undefined });
  });

  it("recognizes an error response", () => {
    const r = parseAcpLine(
      JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -32603, message: "oops" } }),
    );
    expect(r?.kind).toBe("response");
    if (r?.kind === "response") expect(r.error.code).toBe(-32603);
  });

  it("recognizes a session/update notification", () => {
    const r = parseAcpLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "hi" } } },
      }),
    );
    expect(r?.kind).toBe("session-update");
    if (r?.kind === "session-update") expect(r.update.sessionUpdate).toBe("agent_message_chunk");
  });

  it("recognizes a server->client request (method present)", () => {
    const r = parseAcpLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "fs/read_text_file",
        params: { path: "/a.ts" },
      }),
    );
    expect(r?.kind).toBe("server-request");
    if (r?.kind === "server-request") {
      expect(r.method).toBe("fs/read_text_file");
      expect(r.id).toBe(99);
    }
  });

  it("parses exit_plan_mode request and exposes planContent in params", () => {
    const r = parseAcpLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "_x.ai/exit_plan_mode",
        params: {
          sessionId: "abc",
          toolCallId: "call-1",
          planContent: "# My Plan\nStep 1",
        },
      }),
    );
    expect(r?.kind).toBe("server-request");
    if (r?.kind === "server-request") {
      expect(r.method).toBe("_x.ai/exit_plan_mode");
      expect(r.params.planContent).toBe("# My Plan\nStep 1");
    }
  });
});

describe("routeSessionUpdate", () => {
  it("routes message chunk", () => {
    const r = routeSessionUpdate({ sessionUpdate: "agent_message_chunk", content: { text: "x" } });
    expect(r).toEqual({ event: "messageChunk", text: "x" });
  });

  it("routes thought chunk", () => {
    const r = routeSessionUpdate({ sessionUpdate: "agent_thought_chunk", content: { text: "y" } });
    expect(r).toEqual({ event: "thoughtChunk", text: "y" });
  });

  // Replayed by `session/load` for historical turns — without this route the user
  // messages vanish from the UI and consecutive agent turns merge into one bubble.
  it("routes user_message_chunk", () => {
    const r = routeSessionUpdate({ sessionUpdate: "user_message_chunk", content: { text: "hi grok" } });
    expect(r).toEqual({ event: "userMessage", text: "hi grok" });
  });

  it("user_message_chunk tolerates missing content.text", () => {
    const r = routeSessionUpdate({ sessionUpdate: "user_message_chunk" });
    expect(r).toEqual({ event: "userMessage", text: "" });
  });

  it("routes tool_call and tool_call_update", () => {
    expect(routeSessionUpdate({ sessionUpdate: "tool_call", toolCallId: "t1" })?.event).toBe("toolCall");
    expect(routeSessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "t1" })?.event).toBe("toolCallUpdate");
  });

  it("routes current_mode_update with id", () => {
    const r = routeSessionUpdate({ sessionUpdate: "current_mode_update", currentModeId: "plan" });
    expect(r).toEqual({ event: "modeChanged", modeId: "plan" });
  });

  it("routes available_commands_update", () => {
    const r = routeSessionUpdate({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "compact" }],
    });
    expect(r?.event).toBe("commandsUpdate");
    if (r?.event === "commandsUpdate") expect(r.commands).toHaveLength(1);
  });

  it("routes plan update and passes full payload", () => {
    const payload = { sessionUpdate: "plan", planContent: "Step 1\nStep 2", planFilePath: "/tmp/plan.md" };
    const r = routeSessionUpdate(payload);
    expect(r?.event).toBe("plan");
    if (r?.event === "plan") expect(r.payload).toBe(payload);
  });

  it("falls through to generic update for unknown tags", () => {
    const r = routeSessionUpdate({ sessionUpdate: "something_new", payload: 1 });
    expect(r?.event).toBe("update");
  });

  it("handles missing content.text gracefully", () => {
    const r = routeSessionUpdate({ sessionUpdate: "agent_message_chunk" });
    expect(r).toEqual({ event: "messageChunk", text: "" });
  });
});

describe("extractPromptMeta", () => {
  it("pulls all fields out of _meta", () => {
    const m = extractPromptMeta({
      stopReason: "end_turn",
      _meta: {
        totalTokens: 100,
        inputTokens: 80,
        outputTokens: 20,
        cachedReadTokens: 5,
        reasoningTokens: 3,
        modelId: "grok-4.3",
      },
    });
    expect(m).toEqual({
      totalTokens: 100,
      inputTokens: 80,
      outputTokens: 20,
      cachedReadTokens: 5,
      reasoningTokens: 3,
      modelId: "grok-4.3",
    });
  });

  it("returns all-undefined when _meta is missing", () => {
    const m = extractPromptMeta({});
    expect(m.totalTokens).toBeUndefined();
    expect(m.modelId).toBeUndefined();
  });
});

describe("response builders", () => {
  it("makePermissionResponse uses ACP outcome shape", () => {
    const r = makePermissionResponse(7, "allow-once");
    expect(r).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { outcome: { outcome: "selected", optionId: "allow-once" } },
    });
  });

  it("makeExitPlanResponse: approved sends result, rejected/abandoned send error", () => {
    expect(makeExitPlanResponse(9, "approved").result).toEqual({ outcome: "approved" });
    expect(makeExitPlanResponse(9, "rejected").error?.code).toBe(-32000);
    expect(makeExitPlanResponse(9, "rejected").result).toBeUndefined();
    expect(makeExitPlanResponse(9, "abandoned").error?.code).toBe(-32000);
    expect(makeExitPlanResponse(9, "abandoned").result).toBeUndefined();
  });

  it("makeExitPlanResponse wraps in jsonrpc 2.0 envelope", () => {
    const r = makeExitPlanResponse(42, "approved");
    expect(r.jsonrpc).toBe("2.0");
    expect(r.id).toBe(42);
  });

  it("makeAckResponse defaults to empty result", () => {
    expect(makeAckResponse(3)).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });

  it("makeRequest wraps params with jsonrpc 2.0", () => {
    expect(makeRequest(1, "session/new", { cwd: "." })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: { cwd: "." },
    });
  });
});
