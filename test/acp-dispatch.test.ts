import { describe, it, expect } from "vitest";
import {
  collectToolImages,
  extractGeneratedImagePaths,
  extractImageContent,
  extractPromptMeta,
  isImageGenToolCall,
  isIncompatibleAgentError,
  makeAckResponse,
  makeExitPlanResponse,
  makePermissionResponse,
  makeQuestionCancelledResponse,
  makeQuestionResponse,
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

  it("routes user message chunk (replayed on session/load)", () => {
    const r = routeSessionUpdate({ sessionUpdate: "user_message_chunk", content: { text: "hello" } });
    expect(r).toEqual({ event: "userMessageChunk", text: "hello" });
  });

  it("routes thought chunk", () => {
    const r = routeSessionUpdate({ sessionUpdate: "agent_thought_chunk", content: { text: "y" } });
    expect(r).toEqual({ event: "thoughtChunk", text: "y" });
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

  it("makeQuestionResponse carries the accepted outcome tag grok's deserializer needs (#12)", () => {
    // The old catch-all replied with {} → "missing field outcome". The accepted
    // variant is internally tagged on `outcome` and carries answers/annotations.
    const r = makeQuestionResponse(5, { "Pick one?": "Option A" });
    expect(r).toEqual({
      jsonrpc: "2.0",
      id: 5,
      result: { outcome: "accepted", answers: { "Pick one?": "Option A" }, annotations: {} },
    });
  });

  it("makeQuestionResponse passes annotations through when provided", () => {
    const r = makeQuestionResponse(6, { Q: "A" }, { Q: { notes: "n" } });
    expect(r.result.annotations).toEqual({ Q: { notes: "n" } });
  });

  it("makeQuestionCancelledResponse sends the cancelled outcome", () => {
    expect(makeQuestionCancelledResponse(8)).toEqual({
      jsonrpc: "2.0",
      id: 8,
      result: { outcome: "cancelled" },
    });
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

describe("isIncompatibleAgentError", () => {
  // Verbatim error captured from grok 0.2.3 when switching to a composer model
  // mid-session (research/*.cjs probe). The model belongs to the `cursor` agent
  // but the session is bound to `grok-build-plan`.
  const real = {
    code: -32600,
    message:
      "Cannot switch to model 'grok-composer-2.5-fast': it requires agent 'cursor' but the active agent is 'grok-build-plan'. Start a new session to use this model.",
    data: {
      code: "MODEL_SWITCH_INCOMPATIBLE_AGENT",
      activeAgentType: "grok-build-plan",
      requiredAgentType: "cursor",
      modelId: "grok-composer-2.5-fast",
      suggestion: "start_new_session",
    },
  };

  it("detects the structured MODEL_SWITCH_INCOMPATIBLE_AGENT code", () => {
    expect(isIncompatibleAgentError(real)).toBe(true);
  });

  it("falls back to the message when the structured code is absent", () => {
    expect(isIncompatibleAgentError({ message: real.message })).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isIncompatibleAgentError({ code: -32000, message: "Grok process exited (code 1)" })).toBe(false);
    expect(isIncompatibleAgentError({ data: { code: "SOMETHING_ELSE" } })).toBe(false);
    expect(isIncompatibleAgentError(undefined)).toBe(false);
    expect(isIncompatibleAgentError(new Error("network timeout"))).toBe(false);
  });
});

describe("extractImageContent", () => {
  it("pulls an inline base64 image block", () => {
    expect(extractImageContent({ type: "image", data: "AAAA", mimeType: "image/jpeg" }))
      .toEqual({ kind: "data", mimeType: "image/jpeg", data: "AAAA" });
  });

  it("defaults the mime when an image block omits it", () => {
    expect(extractImageContent({ type: "image", data: "AAAA" }))
      .toEqual({ kind: "data", mimeType: "image/png", data: "AAAA" });
  });

  it("pulls an embedded resource blob", () => {
    expect(extractImageContent({
      type: "resource",
      resource: { uri: "file:///x/out.png", mimeType: "image/png", blob: "ZZZZ" },
    })).toEqual({ kind: "data", mimeType: "image/png", data: "ZZZZ" });
  });

  it("maps a file:// resource_link to a path", () => {
    expect(extractImageContent({
      type: "resource_link",
      uri: "file:///home/u/.grok/sessions/s/out.png",
    })).toEqual({ kind: "path", path: "/home/u/.grok/sessions/s/out.png", mimeType: undefined });
  });

  it("maps a bare absolute path resource_link to a path", () => {
    expect(extractImageContent({ type: "resource_link", uri: "/tmp/out.webp" }))
      .toEqual({ kind: "path", path: "/tmp/out.webp", mimeType: undefined });
  });

  it("maps a remote https image to a uri", () => {
    expect(extractImageContent({ type: "resource_link", uri: "https://x.ai/a.jpg" }))
      .toEqual({ kind: "uri", uri: "https://x.ai/a.jpg", mimeType: undefined });
  });

  it("ignores text and non-image content", () => {
    expect(extractImageContent({ type: "text", text: "hi" })).toBeNull();
    expect(extractImageContent({ type: "resource_link", uri: "file:///x/notes.md" })).toBeNull();
    expect(extractImageContent(null)).toBeNull();
  });
});

describe("collectToolImages", () => {
  it("collects images from wrapped and bare content items", () => {
    const imgs = collectToolImages({
      content: [
        { type: "content", content: { type: "image", data: "AA", mimeType: "image/png" } },
        { type: "text", text: "done" },
        { type: "resource_link", uri: "/tmp/a.gif" },
      ],
    });
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toEqual({ kind: "data", mimeType: "image/png", data: "AA" });
    expect(imgs[1]).toEqual({ kind: "path", path: "/tmp/a.gif", mimeType: undefined });
  });

  it("returns [] when there is no content array", () => {
    expect(collectToolImages({})).toEqual([]);
    expect(collectToolImages({ content: "nope" })).toEqual([]);
  });
});

describe("routeSessionUpdate image chunks", () => {
  it("routes an agent_message_chunk image block to imageContent", () => {
    const r = routeSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "image", data: "AA", mimeType: "image/png" },
    });
    expect(r).toEqual({ event: "imageContent", image: { kind: "data", mimeType: "image/png", data: "AA" } });
  });

  it("still routes text chunks as messageChunk", () => {
    const r = routeSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello" },
    });
    expect(r).toEqual({ event: "messageChunk", text: "hello" });
  });
});

describe("image_gen (grok's real /imagine wire shape)", () => {
  // Confirmed against grok 0.2.33 (research/image-generation.md): the tool is
  // `image_gen`, relabeled `imagine: <prompt>` with rawInput.variant "ImageGen",
  // and the completed update reports the file as JSON inside a text block.
  const completed = {
    sessionUpdate: "tool_call_update",
    toolCallId: "call-x",
    status: "completed",
    content: [{
      type: "content",
      content: {
        type: "text",
        text: JSON.stringify({
          path: "/root/.grok/sessions/%2Ftmp/s/images/1.jpg",
          filename: "1.jpg",
          session_folder: "images",
          message: "Image generated and saved to …",
        }),
      },
    }],
  };

  it("recognizes the image_gen tool call by title", () => {
    expect(isImageGenToolCall({ title: "image_gen", rawInput: { prompt: "a cube", aspect_ratio: "1:1" } })).toBe(true);
    expect(isImageGenToolCall({ title: "imagine: a small red cube" })).toBe(true);
  });

  it("recognizes the relabeled update by rawInput.variant", () => {
    expect(isImageGenToolCall({ title: "imagine: x", rawInput: { variant: "ImageGen", prompt: "x" } })).toBe(true);
  });

  it("does not flag ordinary tools as image gen", () => {
    expect(isImageGenToolCall({ title: "run_terminal_command", rawInput: { variant: "Bash" } })).toBe(false);
    expect(isImageGenToolCall(null)).toBe(false);
  });

  it("extracts the saved image path from the completed JSON-in-text result", () => {
    expect(extractGeneratedImagePaths(completed)).toEqual([
      { kind: "path", path: "/root/.grok/sessions/%2Ftmp/s/images/1.jpg" },
    ]);
  });

  it("ignores tool-result JSON whose path is not an image", () => {
    const r = extractGeneratedImagePaths({
      content: [{ type: "content", content: { type: "text", text: JSON.stringify({ path: "/tmp/out.txt" }) } }],
    });
    expect(r).toEqual([]);
  });

  it("ignores non-JSON and pathless text results", () => {
    expect(extractGeneratedImagePaths({ content: [{ type: "content", content: { type: "text", text: "done" } }] })).toEqual([]);
    expect(extractGeneratedImagePaths({ content: [{ type: "content", content: { type: "text", text: '{"ok":true}' } }] })).toEqual([]);
  });
});
