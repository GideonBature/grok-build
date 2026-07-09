import { describe, it, expect } from "vitest";
// @ts-expect-error — plain JS module, no types
import { looksLikeFileRef, formatRelativeTime, FILE_EXTS, modelDisplayName, nextMicState, trailingSendPhrase, buildQuestionAnswers, isSubagentToolCall, subagentLabel, shouldStickToBottom, splitMath, stripUnsupportedTex, parseAttachmentContext, parseSelectionBlocks, parseImageTags } from "../media/webview-helpers.js";
import { buildPrompt, buildPromptWithImages } from "../src/prompt-builder";
import { makeExplicitChip, makeImplicitChip, makeImageChip } from "../src/chips";

describe("looksLikeFileRef", () => {
  it("accepts a bare filename with a known extension", () => {
    expect(looksLikeFileRef("package.json")).toBe(true);
    expect(looksLikeFileRef("CLAUDE.md")).toBe(true);
    expect(looksLikeFileRef("AGENTS.md")).toBe(true);
    expect(looksLikeFileRef("tsconfig.json")).toBe(true);
  });

  it("accepts a path with separators", () => {
    expect(looksLikeFileRef("src/sidebar.ts")).toBe(true);
    expect(looksLikeFileRef("media/chat.js")).toBe(true);
    expect(looksLikeFileRef("test\\sessions.test.ts")).toBe(true);
  });

  it("accepts a path with a :line suffix and strips it before checking", () => {
    expect(looksLikeFileRef("src/sidebar.ts:42")).toBe(true);
    expect(looksLikeFileRef("media/chat.js:1-100")).toBe(true);
  });

  it("accepts a path with a #Lstart-Lend anchor", () => {
    expect(looksLikeFileRef("src/sidebar.ts#L10-L20")).toBe(true);
  });

  it("is case-insensitive on the extension", () => {
    expect(looksLikeFileRef("Foo.TS")).toBe(true);
    expect(looksLikeFileRef("Bar.Json")).toBe(true);
  });

  it("rejects plain identifiers without an extension", () => {
    expect(looksLikeFileRef("undefined")).toBe(false);
    expect(looksLikeFileRef("null")).toBe(false);
    expect(looksLikeFileRef("foo")).toBe(false);
    expect(looksLikeFileRef("myVariable")).toBe(false);
  });

  it("rejects unknown extensions", () => {
    expect(looksLikeFileRef("foo.unknownextname")).toBe(false);
    expect(looksLikeFileRef("foo.xyz")).toBe(false);
  });

  it("rejects strings with whitespace or shell metacharacters", () => {
    expect(looksLikeFileRef("foo bar.ts")).toBe(false);
    expect(looksLikeFileRef("rm -rf foo.ts")).toBe(false);
    expect(looksLikeFileRef('"foo.ts"')).toBe(false);
    expect(looksLikeFileRef("a;b.ts")).toBe(false);
    expect(looksLikeFileRef("a|b.ts")).toBe(false);
    expect(looksLikeFileRef("a&b.ts")).toBe(false);
  });

  it("rejects empty, null-ish, or absurdly long strings", () => {
    expect(looksLikeFileRef("")).toBe(false);
    expect(looksLikeFileRef(null as unknown as string)).toBe(false);
    expect(looksLikeFileRef(undefined as unknown as string)).toBe(false);
    expect(looksLikeFileRef("a".repeat(201) + ".ts")).toBe(false);
  });

  it("rejects code-looking spans with a trailing dot only", () => {
    expect(looksLikeFileRef("obj.")).toBe(false);
    expect(looksLikeFileRef(".")).toBe(false);
  });

  it("FILE_EXTS exposes the configured set", () => {
    expect(FILE_EXTS.has("ts")).toBe(true);
    expect(FILE_EXTS.has("json")).toBe(true);
    expect(FILE_EXTS.has("lock")).toBe(true);
    expect(FILE_EXTS.has("env")).toBe(true);
    expect(FILE_EXTS.has("gitignore")).toBe(true);
    expect(FILE_EXTS.has("zzz")).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 4, 22, 12, 0, 0);

  it("returns '' for falsy timestamps", () => {
    expect(formatRelativeTime(0, now)).toBe("");
    expect(formatRelativeTime(undefined, now)).toBe("");
    expect(formatRelativeTime(null, now)).toBe("");
  });

  it("formats seconds when under a minute", () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe("5s ago");
    expect(formatRelativeTime(now - 30_000, now)).toBe("30s ago");
  });

  it("formats minutes when under an hour", () => {
    expect(formatRelativeTime(now - 2 * 60_000, now)).toBe("2m ago");
    expect(formatRelativeTime(now - 45 * 60_000, now)).toBe("45m ago");
  });

  it("formats hours when under a day", () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 23 * 3_600_000, now)).toBe("23h ago");
  });

  it("formats days when under a week", () => {
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(formatRelativeTime(now - 6 * 86_400_000, now)).toBe("6d ago");
  });

  it("falls back to localeDateString for timestamps older than a week", () => {
    const ts = now - 30 * 86_400_000;
    const out = formatRelativeTime(ts, now);
    expect(out).not.toMatch(/ago$/);
    expect(out.length).toBeGreaterThan(0);
  });

  it("uses Date.now() when no second arg is provided", () => {
    const out = formatRelativeTime(Date.now() - 2_000);
    expect(out).toMatch(/s ago$/);
  });
});

describe("modelDisplayName", () => {
  const models = [
    { modelId: "grok-build", name: "Grok Build" },
    { modelId: "grok-composer-2.5-fast", name: "Composer 2.5 Fast" },
  ];

  it("resolves a model ID to its user-facing name", () => {
    expect(modelDisplayName("grok-build", models)).toBe("Grok Build");
    expect(modelDisplayName("grok-composer-2.5-fast", models)).toBe("Composer 2.5 Fast");
  });

  it("falls back to the ID when the model is unknown or unnamed", () => {
    expect(modelDisplayName("grok-mystery", models)).toBe("grok-mystery");
    expect(modelDisplayName("grok-build", [{ modelId: "grok-build" }])).toBe("grok-build");
    expect(modelDisplayName("grok-build", [])).toBe("grok-build");
    expect(modelDisplayName("grok-build", undefined)).toBe("grok-build");
  });

  it("returns '' for a falsy model ID", () => {
    expect(modelDisplayName("", models)).toBe("");
    expect(modelDisplayName(undefined, models)).toBe("");
  });
});

describe("parseAttachmentContext", () => {
  const deps = { readFile: () => "", extName: (p: string) => (p.includes(".") ? p.slice(p.lastIndexOf(".")) : "") };

  it("returns the input as body with no files when there's no envelope", () => {
    expect(parseAttachmentContext("just a message")).toEqual({ files: [], body: "just a message" });
  });

  it("round-trips a single attached file from buildPrompt", () => {
    const prompt = buildPrompt("fix it", [makeExplicitChip("/x/CLAUDE.md", "CLAUDE.md")], deps);
    expect(parseAttachmentContext(prompt)).toEqual({ files: ["CLAUDE.md"], body: "fix it" });
  });

  it("round-trips multiple attached files + an open-editor file", () => {
    const prompt = buildPrompt(
      "compare these",
      [
        makeExplicitChip("/x/CLAUDE.md", "CLAUDE.md"),
        makeExplicitChip("/d/pic.png", "c:\\Users\\Dell\\Downloads\\pic.png"),
        makeImplicitChip("/x/src/foo.ts", "src/foo.ts"),
      ],
      deps,
    );
    expect(parseAttachmentContext(prompt)).toEqual({
      files: ["CLAUDE.md", "c:\\Users\\Dell\\Downloads\\pic.png", "src/foo.ts"],
      body: "compare these",
    });
  });

  it("leaves a fenced selection block in the body (parseSelectionBlocks owns it)", () => {
    const prompt = buildPrompt("what is this", [makeExplicitChip("/x/a.ts", "a.ts", 1, 1)], {
      readFile: () => "const x = 1;",
      extName: () => ".ts",
    });
    const { files, body } = parseAttachmentContext(prompt);
    expect(files).toEqual([]);
    expect(body).toContain("`a.ts` (lines 1-1):");
    expect(body).toContain("what is this");
  });
});

describe("parseSelectionBlocks", () => {
  const deps = {
    readFile: () => "line1\nline2\nline3\nline4\nline5",
    extName: () => ".ts",
  };

  it("passes plain text through untouched", () => {
    expect(parseSelectionBlocks("just a message")).toEqual({ body: "just a message", selections: [] });
  });

  it("round-trips a buildPrompt selection snippet back into path + range", () => {
    const prompt = buildPrompt("what is this", [makeExplicitChip("/x/a.ts", "src/a.ts", 2, 4)], deps);
    const { body } = parseAttachmentContext(prompt);
    expect(parseSelectionBlocks(body)).toEqual({
      body: "what is this",
      selections: [{ path: "src/a.ts", start: 2, end: 4 }],
    });
  });

  it("round-trips multiple leading snippets, including a single-line one", () => {
    const prompt = buildPrompt(
      "compare",
      [makeExplicitChip("/x/a.ts", "src/a.ts", 2, 4), makeImplicitChip("/x/b.ts", "src/b.ts", 5, 5)],
      deps,
    );
    expect(parseSelectionBlocks(prompt)).toEqual({
      body: "compare",
      selections: [
        { path: "src/a.ts", start: 2, end: 4 },
        { path: "src/b.ts", start: 5, end: 5 },
      ],
    });
  });

  it("survives an envelope + snippet + text prompt end to end", () => {
    const prompt = buildPrompt(
      "explain",
      [makeExplicitChip("/x/CLAUDE.md", "CLAUDE.md"), makeExplicitChip("/x/a.ts", "src/a.ts", 2, 4)],
      deps,
    );
    const env = parseAttachmentContext(prompt);
    expect(env.files).toEqual(["CLAUDE.md"]);
    expect(parseSelectionBlocks(env.body)).toEqual({
      body: "explain",
      selections: [{ path: "src/a.ts", start: 2, end: 4 }],
    });
  });

  it("leaves a half-streamed block alone until the closing fence arrives", () => {
    const partial = "`src/a.ts` (lines 2-4):\n```ts\nline2\nline3";
    expect(parseSelectionBlocks(partial)).toEqual({ body: partial, selections: [] });
  });

  it("does not strip a selection-shaped block in the middle of the user's own words", () => {
    const body =
      "please explain this\n\n`src/a.ts` (lines 2-4):\n```ts\nline2\n```";
    expect(parseSelectionBlocks(body)).toEqual({ body, selections: [] });
  });

  it("stops at the first standalone closing fence when the snippet contains ``` itself", () => {
    // buildPrompt does no fence escaping, so a selection containing a bare ```
    // line produces an ambiguous wire — match short, exactly like markdown would.
    const body = "`a.md` (lines 1-3):\n```md\nsome\n```\n\nrest of message";
    expect(parseSelectionBlocks(body)).toEqual({
      body: "rest of message",
      selections: [{ path: "a.md", start: 1, end: 3 }],
    });
  });

  it("chains with the envelope and image parsers over a full buildPromptWithImages wire", () => {
    // envelope → selection snippet → user text → trailing [Image #N] tag: each
    // parser peels exactly its own layer of the real combined wire.
    const { text } = buildPromptWithImages(
      "explain",
      [makeExplicitChip("/x/CLAUDE.md", "CLAUDE.md"), makeExplicitChip("/x/a.ts", "src/a.ts", 2, 4)],
      [{ index: 1, mimeType: "image/png", data: "AA" }],
      deps,
    );
    const env = parseAttachmentContext(text);
    expect(env.files).toEqual(["CLAUDE.md"]);
    const sel = parseSelectionBlocks(env.body);
    expect(sel.selections).toEqual([{ path: "src/a.ts", start: 2, end: 4 }]);
    expect(parseImageTags(sel.body)).toEqual({
      body: "explain",
      images: [{ index: 1, path: undefined }],
    });
  });
});

describe("parseImageTags", () => {
  const deps = { readFile: () => "", extName: (p: string) => (p.includes(".") ? p.slice(p.lastIndexOf(".")) : "") };

  it("passes plain text through untouched", () => {
    expect(parseImageTags("just a message")).toEqual({ body: "just a message", images: [] });
  });

  it("round-trips the current wire shape (text first, trailing tag lines)", () => {
    const img = makeImageChip("/staging/a.png", 1, "image/png");
    const { text } = buildPromptWithImages(
      "what is this?",
      [img],
      [{ index: 1, mimeType: "image/png", data: "AA" }],
      deps,
    );
    expect(parseImageTags(text)).toEqual({
      body: "what is this?",
      images: [{ index: 1, path: undefined }],
    });
  });

  it("recovers the origin path from a disk-import tag", () => {
    const out = parseImageTags("compress this\n\n[Image #2] (assets/hero.png)");
    expect(out.body).toBe("compress this");
    expect(out.images).toEqual([{ index: 2, path: "assets/hero.png" }]);
  });

  it("strips the do-not-Read hint from a pasted-image tag (current wire)", () => {
    const out = parseImageTags(
      "what is this?\n\n[Image #1] (attached inline — already visible to you; do not read it from disk)",
    );
    expect(out).toEqual({ body: "what is this?", images: [{ index: 1, path: undefined }] });
  });

  it("strips the do-not-Read hint but keeps the path on a disk-import tag (current wire)", () => {
    const out = parseImageTags(
      "compress this\n\n[Image #2] (assets/hero.png — attached inline; act on the path if needed, but do not Read it)",
    );
    expect(out).toEqual({ body: "compress this", images: [{ index: 2, path: "assets/hero.png" }] });
  });

  it("round-trips a disk-import tag whose filename contains parentheses", () => {
    // Browser-download dedup names — `screenshot (1).png` — put a `)` inside
    // the path; the tag's close paren must resolve to the LAST one on the line.
    const origin = "shots/screenshot (1).png";
    const img = makeImageChip("/staging/s.png", 1, "image/png", origin);
    const { text } = buildPromptWithImages(
      "describe it",
      [img],
      [{ index: 1, mimeType: "image/png", data: "AA", relPath: origin }],
      deps,
    );
    expect(parseImageTags(text)).toEqual({
      body: "describe it",
      images: [{ index: 1, path: origin }],
    });
  });

  it("leaves a literal empty-parens tag shape in the body", () => {
    // buildPromptWithImages never emits `()` — that's the user's own text.
    const body = "describe\n\n[Image #1] ()";
    expect(parseImageTags(body)).toEqual({ body, images: [] });
  });

  it("collects multiple trailing tag lines in order", () => {
    const out = parseImageTags("compare\n\n[Image #1]\n[Image #3] (a b/c.png)");
    expect(out.body).toBe("compare");
    expect(out.images).toEqual([
      { index: 1, path: undefined },
      { index: 3, path: "a b/c.png" },
    ]);
  });

  it("strips the legacy leading tag lines (first-build wire)", () => {
    const out = parseImageTags("[Image #1]\n[Image #2]\n\ndescribe both");
    expect(out.body).toBe("describe both");
    expect(out.images.map((i: { index: number }) => i.index)).toEqual([1, 2]);
  });

  it("strips the legacy single-image inline prefix", () => {
    const out = parseImageTags("[Image #1] what is this?");
    expect(out.body).toBe("what is this?");
    expect(out.images).toEqual([{ index: 1, path: undefined }]);
  });

  it("leaves a tag-looking string in the MIDDLE of the body alone", () => {
    const body = "the TUI shows [Image #1] before the text\n\nsee?";
    expect(parseImageTags(body)).toEqual({ body, images: [] });
  });

  it("leaves a tag inside a fenced code block alone", () => {
    const body = "explain:\n```\n[Image #1]\n```\ntrailing words";
    expect(parseImageTags(body)).toEqual({ body, images: [] });
  });

  it("handles a tags-only body (image sent with no text)", () => {
    expect(parseImageTags("[Image #1]")).toEqual({
      body: "",
      images: [{ index: 1, path: undefined }],
    });
  });
});

describe("nextMicState", () => {
  it("start enters 'connecting' (the listening waves come from the host, not the reducer)", () => {
    expect(nextMicState("idle", "start")).toBe("connecting");
    expect(nextMicState("listening", "stop")).toBe("transcribing");
    expect(nextMicState("transcribing", "transcript")).toBe("idle");
  });

  it("is stoppable while connecting (cancel before the stream is ready)", () => {
    expect(nextMicState("connecting", "stop")).toBe("transcribing");
  });

  it("resets to idle on error or reset from any state", () => {
    expect(nextMicState("connecting", "error")).toBe("idle");
    expect(nextMicState("listening", "error")).toBe("idle");
    expect(nextMicState("transcribing", "error")).toBe("idle");
    expect(nextMicState("listening", "reset")).toBe("idle");
  });

  it("does not start a new recording while transcribing or already active", () => {
    expect(nextMicState("transcribing", "start")).toBe("transcribing");
    expect(nextMicState("listening", "start")).toBe("listening");
  });

  it("ignores stop from idle or transcribing", () => {
    expect(nextMicState("idle", "stop")).toBe("idle");
    expect(nextMicState("transcribing", "stop")).toBe("transcribing");
  });

  it("ignores unknown events", () => {
    expect(nextMicState("listening", "wat")).toBe("listening");
  });
});

describe("trailingSendPhrase", () => {
  it("locates a trailing 'grok send' (returns its range)", () => {
    expect(trailingSendPhrase("fix the bug grok send", "grok send")).toEqual({ index: 12, length: 9 });
  });

  it("is case-insensitive and highlights only the phrase, not trailing punctuation", () => {
    const r = trailingSendPhrase("Refactor this Grok Send!", "grok send");
    expect(r).not.toBeNull();
    // The "!" stays part of the message, so it is NOT inside the highlighted span.
    expect("Refactor this Grok Send!".slice(r!.index, r!.index + r!.length)).toBe("Grok Send");
  });

  it("does NOT match a non-trailing or partial occurrence", () => {
    expect(trailingSendPhrase("explain grok send to me", "grok send")).toBeNull();
    expect(trailingSendPhrase("press send", "grok send")).toBeNull();
  });

  it("also highlights the 'grok sent' STT variant", () => {
    const r = trailingSendPhrase("add a button grok sent", "grok send");
    expect(r).not.toBeNull();
    expect("add a button grok sent".slice(r!.index, r!.index + r!.length)).toBe("grok sent");
  });

  it("does NOT match a bare 'sent' without 'grok' before it", () => {
    expect(trailingSendPhrase("the file was sent", "grok send")).toBeNull();
    expect(trailingSendPhrase("make sure it gets sent", "grok send")).toBeNull();
  });

  it("returns null for empty text or empty phrase", () => {
    expect(trailingSendPhrase("", "grok send")).toBeNull();
    expect(trailingSendPhrase("grok send", "")).toBeNull();
    expect(trailingSendPhrase(null as unknown as string, "grok send")).toBeNull();
  });

  it("supports a custom phrase", () => {
    expect(trailingSendPhrase("do it now go", "go")).toEqual({ index: 10, length: 2 });
  });
});

describe("buildQuestionAnswers", () => {
  it("keys the answer map by question text → chosen label", () => {
    const questions = [{ question: "Pick a color?", options: [{ label: "Red" }, { label: "Blue" }] }];
    const { answers, allAnswered } = buildQuestionAnswers(questions, [["Blue"]]);
    expect(answers).toEqual({ "Pick a color?": "Blue" });
    expect(allAnswered).toBe(true);
  });

  it("joins multi-select labels with ', '", () => {
    const questions = [{ question: "Which?", options: [], multiSelect: true }];
    const { answers } = buildQuestionAnswers(questions, [["A", "C"]]);
    expect(answers).toEqual({ "Which?": "A, C" });
  });

  it("flags allAnswered=false while any question is unanswered", () => {
    const questions = [{ question: "Q1" }, { question: "Q2" }];
    const r = buildQuestionAnswers(questions, [["A"], []]);
    expect(r.allAnswered).toBe(false);
    expect(r.answers).toEqual({ Q1: "A", Q2: "" });
  });

  it("handles empty / missing inputs", () => {
    expect(buildQuestionAnswers([], [])).toEqual({ answers: {}, allAnswered: true });
    expect(buildQuestionAnswers(undefined, undefined)).toEqual({ answers: {}, allAnswered: true });
  });
});

describe("isSubagentToolCall", () => {
  it("matches grok's confirmed spawn_subagent shape", () => {
    // Real shape from grok 0.2.33 (research/subagents.md): tool `spawn_subagent`
    // with a `subagent_type` parameter.
    expect(isSubagentToolCall({
      title: "spawn_subagent",
      rawInput: { subagent_type: "general-purpose", prompt: "investigate" },
    })).toBe(true);
  });

  it("matches by tool name", () => {
    expect(isSubagentToolCall({ tool: "task" })).toBe(true);
    expect(isSubagentToolCall({ name: "spawn_agent" })).toBe(true);
    expect(isSubagentToolCall({ name: "run_subagent" })).toBe(true);
    expect(isSubagentToolCall({ title: "Delegate" })).toBe(true);
  });

  it("matches by kind", () => {
    expect(isSubagentToolCall({ kind: "subagent" })).toBe(true);
    expect(isSubagentToolCall({ kind: "agent" })).toBe(true);
  });

  it("matches by rawInput shape", () => {
    expect(isSubagentToolCall({ tool: "x", rawInput: { subagent_type: "tester" } })).toBe(true);
    expect(isSubagentToolCall({ tool: "x", input: { agentType: "reviewer" } })).toBe(true);
  });

  it("does not match ordinary tools", () => {
    expect(isSubagentToolCall({ tool: "read_file", kind: "read" })).toBe(false);
    expect(isSubagentToolCall({ tool: "bash", kind: "execute" })).toBe(false);
    expect(isSubagentToolCall(null)).toBe(false);
    expect(isSubagentToolCall({})).toBe(false);
  });

  it("does NOT match grok's get_command_or_subagent_output poller", () => {
    // Native-Windows grok 0.2.x delegates via a background run_terminal_command
    // and reads its output with `get_command_or_subagent_output` (variant
    // "TaskOutput", task_id). That output reader's NAME contains "subagent" but
    // it is not a delegation — it must never get a Subagent card. Verbatim wire
    // shape from research/subagents.md.
    expect(isSubagentToolCall({ title: "get_command_or_subagent_output", rawInput: { task_id: "t1" } })).toBe(false);
    expect(isSubagentToolCall({ title: "Get task output: t1", rawInput: { variant: "TaskOutput", task_id: "t1", block: true } })).toBe(false);
  });

  it("matches grok 0.2.x's background-task delegation (its real subagent mechanism)", () => {
    // No spawn_subagent on the native build — a delegation is a backgrounded
    // run_terminal_command (research/subagents.md § Ground truth). Card it so it
    // doesn't disappear into the generic tool group.
    expect(isSubagentToolCall({ title: "run_terminal_command", rawInput: { variant: "Bash", command: "Spawn background subagent to investigate", is_background: true } })).toBe(true);
    expect(isSubagentToolCall({ title: "[bg] Background task t1 started", rawInput: { variant: "Bash" } })).toBe(true);
  });

  it("does NOT match a foreground run_terminal_command", () => {
    // A normal command (is_background false or absent) stays in the tool group —
    // this is the shape grok used in the real session that prompted the fix.
    expect(isSubagentToolCall({ title: "run_terminal_command", rawInput: { variant: "Bash", command: "git status", is_background: false } })).toBe(false);
    expect(isSubagentToolCall({ title: "run_terminal_command", rawInput: { variant: "Bash", command: "git status" } })).toBe(false);
  });
});

describe("subagentLabel", () => {
  it("prefers the named agent type", () => {
    expect(subagentLabel({ title: "spawn_subagent", rawInput: { subagent_type: "general-purpose" } })).toBe("general-purpose");
    expect(subagentLabel({ tool: "task", rawInput: { subagent_type: "tester" } })).toBe("tester");
    expect(subagentLabel({ tool: "task", input: { agentType: "Explore" } })).toBe("Explore");
    expect(subagentLabel({ tool: "task", rawInput: { description: "Fix the build" } })).toBe("Fix the build");
  });

  it("derives a label from the backgrounded command, truncating if long", () => {
    expect(subagentLabel({ title: "run_terminal_command", rawInput: { command: "investigate the parser", is_background: true } })).toBe("investigate the parser");
    const long = subagentLabel({ rawInput: { command: "x".repeat(80), is_background: true } });
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(48);
  });

  it("falls back to a generic label", () => {
    expect(subagentLabel({ tool: "task" })).toBe("Subagent");
    expect(subagentLabel({ rawInput: { is_background: true } })).toBe("background task");
    expect(subagentLabel(null)).toBe("Subagent");
  });
});

describe("shouldStickToBottom", () => {
  it("is pinned when scrolled exactly to the bottom", () => {
    // scrollTop + clientHeight === scrollHeight
    expect(shouldStickToBottom(900, 1000, 100)).toBe(true);
  });

  it("is pinned when within the default threshold of the bottom", () => {
    // 30px from the bottom (default threshold 40)
    expect(shouldStickToBottom(870, 1000, 100)).toBe(true);
  });

  it("is NOT pinned once scrolled up past the threshold", () => {
    // 200px from the bottom — the user is reading history (#16)
    expect(shouldStickToBottom(700, 1000, 100)).toBe(false);
  });

  it("is pinned when content fits without scrolling", () => {
    // scrollHeight <= clientHeight, scrollTop 0 → distance is negative
    expect(shouldStickToBottom(0, 80, 100)).toBe(true);
  });

  it("honors a custom threshold", () => {
    // 150px from bottom: pinned only with a generous threshold
    expect(shouldStickToBottom(750, 1000, 100, 200)).toBe(true);
    expect(shouldStickToBottom(750, 1000, 100, 50)).toBe(false);
  });
});

describe("splitMath", () => {
  it("returns the whole string as one text segment when there is no math", () => {
    expect(splitMath("just plain prose with no tex")).toEqual([
      { type: "text", value: "just plain prose with no tex" },
    ]);
  });

  it("extracts inline \\(...\\) math with display:false", () => {
    expect(splitMath("the value \\(x^2\\) here")).toEqual([
      { type: "text", value: "the value " },
      { type: "math", value: "x^2", display: false },
      { type: "text", value: " here" },
    ]);
  });

  it("extracts display \\[...\\] math with display:true", () => {
    expect(splitMath("before\n\\[E = mc^2\\]\nafter")).toEqual([
      { type: "text", value: "before\n" },
      { type: "math", value: "E = mc^2", display: true },
      { type: "text", value: "\nafter" },
    ]);
  });

  it("treats $$...$$ as display math", () => {
    expect(splitMath("$$a+b$$")).toEqual([
      { type: "math", value: "a+b", display: true },
    ]);
  });

  it("handles multiple math spans in one string", () => {
    const segs = splitMath("\\(a\\) and \\(b\\) then \\[c\\]");
    expect(segs.map((s) => s.type)).toEqual(["math", "text", "math", "text", "math"]);
    expect(segs.filter((s) => s.type === "math").map((s) => s.display)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("supports multi-line display math (e.g. matrices)", () => {
    const src = "\\[\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\\]";
    const segs = splitMath(src);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("math");
    expect(segs[0].display).toBe(true);
    expect(segs[0].value).toContain("\\begin{pmatrix}");
  });

  it("does NOT treat bare dollar amounts as math", () => {
    expect(splitMath("it costs $5 and then $10 total")).toEqual([
      { type: "text", value: "it costs $5 and then $10 total" },
    ]);
  });

  it("leaves empty delimiters as literal text", () => {
    expect(splitMath("a \\(\\) b")).toEqual([
      { type: "text", value: "a \\(\\) b" },
    ]);
  });

  it("coerces null/undefined to an empty result", () => {
    expect(splitMath(null)).toEqual([]);
    expect(splitMath(undefined)).toEqual([]);
  });
});

describe("stripUnsupportedTex", () => {
  it("removes \\label{...} (KaTeX can't render it — shows a red error otherwise)", () => {
    expect(stripUnsupportedTex("f(x) = x^2 \\label{eq:quadratic} + 1")).toBe(
      "f(x) = x^2  + 1",
    );
  });

  it("strips every \\label in an align block, leaving the equations intact", () => {
    const src =
      "\\begin{align} a &= b \\label{one} \\\\ c &= d \\label{two} \\end{align}";
    const out = stripUnsupportedTex(src);
    expect(out).not.toContain("\\label");
    expect(out).toContain("\\begin{align}");
    expect(out).toContain("a &= b");
    expect(out).toContain("c &= d");
  });

  it("tolerates whitespace before the brace", () => {
    expect(stripUnsupportedTex("x \\label {foo} y")).toBe("x  y");
  });

  it("leaves math without \\label unchanged", () => {
    const src = "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}";
    expect(stripUnsupportedTex(src)).toBe(src);
  });

  it("coerces null/undefined to an empty string", () => {
    expect(stripUnsupportedTex(null)).toBe("");
    expect(stripUnsupportedTex(undefined)).toBe("");
  });
});
