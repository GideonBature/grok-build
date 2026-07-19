// DOM regressions for the 2026-07 benchmark-found bugs: the Windows drag-drop
// wire shape, busyLocked recovery after agentError/exit, and the per-session
// reset leaking the question/restored-card maps across sessions. Drives the
// REAL media/chat.js via the shared happy-dom harness.
import { describe, it, expect } from "vitest";
import { bootWebview, dispatch, click } from "./webview-harness";

describe("drag-drop posts the raw file:// URI (#2 — Windows drops died silently)", () => {
  it("forwards the untouched URI so the host can fileUriToPath it", () => {
    const { window, posted, doc } = bootWebview();
    // The old handler posted decodeURIComponent of the URI minus `file://` —
    // `/C:/x`, which existsSync rejects on Windows, a silent no-op. The host
    // now owns the conversion, so the webview must pass the URI through raw.
    const ev = new (window as any).Event("drop", { bubbles: true, cancelable: true });
    (ev as any).dataTransfer = {
      getData: (t: string) =>
        t === "text/uri-list" ? "file:///C:/Users/p/My%20Docs/notes.txt\r\nhttps://x.ai/skip.txt" : "",
    };
    (ev as any).shiftKey = false;
    doc.dispatchEvent(ev);

    const drops = posted.filter((m) => m.type === "dropFile");
    expect(drops).toEqual([
      { type: "dropFile", path: "file:///C:/Users/p/My%20Docs/notes.txt", shift: false },
    ]);
  });
});

describe("busyLocked recovery (#11 — error during the locked startup window)", () => {
  it("agentError during the startup lock frees the composer for a working resend", () => {
    // ready:false = the real startup state: busy + busyLocked (spinner).
    const { window, posted, doc } = bootWebview({ ready: false });
    dispatch(window, { type: "agentError", text: "spawn failed" });

    const input = doc.getElementById("input") as HTMLTextAreaElement;
    const sendBtn = doc.getElementById("send-btn") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);

    // The next send must behave like a normal live send — before the fix the
    // stale busyLocked flipped the button into a disabled "Initializing…"
    // spinner with no way to cancel.
    input.value = "retry after crash";
    click(window, sendBtn);
    expect(posted.some((m) => m.type === "send")).toBe(true);
    expect(sendBtn.title).toBe("Stop");
    expect(sendBtn.disabled).toBe(false);
  });

  it("a CLI exit during the startup lock frees the composer the same way", () => {
    const { window, posted, doc } = bootWebview({ ready: false });
    dispatch(window, { type: "exit", code: 1 });

    const input = doc.getElementById("input") as HTMLTextAreaElement;
    const sendBtn = doc.getElementById("send-btn") as HTMLButtonElement;
    input.value = "recover";
    click(window, sendBtn);
    expect(posted.some((m) => m.type === "send")).toBe(true);
    expect(sendBtn.title).toBe("Stop");
    expect(sendBtn.disabled).toBe(false);
  });
});

describe("session reset clears the question/restored-card maps (#9)", () => {
  it("a stale toolCallId from the previous session cannot mutate its detached card", () => {
    const { window, doc } = bootWebview();

    // Session A: replay a restored (unanswered) question card keyed by q1.
    dispatch(window, { type: "historyReplay", active: true });
    dispatch(window, {
      type: "toolCall",
      call: {
        toolCallId: "q1",
        title: "Ask: Pick one",
        status: "in_progress",
        rawInput: { questions: [{ question: "Pick one", options: [{ label: "A" }, { label: "B" }] }] },
      },
    });
    dispatch(window, { type: "historyReplay", active: false });

    const staleCard = doc.querySelector(".card.question") as HTMLElement;
    expect(staleCard).toBeTruthy();
    expect(staleCard.querySelector(".question-answer")).toBeNull();

    // Session swap: the reset must forget q1 (it used to leak both maps).
    dispatch(window, { type: "clearMessages" });

    // Session B delivers an update reusing the same toolCallId. Before the fix
    // this looked up the DETACHED session-A card and wrote the answer into it.
    dispatch(window, {
      type: "toolCallUpdate",
      call: {
        toolCallId: "q1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "User answered your questions: Pick one: A" } }],
      },
    });

    expect(staleCard.querySelector(".question-answer")).toBeNull();
    expect((staleCard as any)._answered).toBeUndefined();
  });
});
