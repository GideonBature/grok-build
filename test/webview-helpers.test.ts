import { describe, it, expect } from "vitest";
// @ts-expect-error — plain JS module, no types
import { looksLikeFileRef, formatRelativeTime, FILE_EXTS, modelDisplayName, nextMicState, trailingSendPhrase, buildQuestionAnswers } from "../media/webview-helpers.js";

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
