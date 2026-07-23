// DOM-level test of the permission card's diff-preview UX (issue #21) — drives
// the REAL shipped media/chat.js in a happy-dom window. It seeds the edit diff
// (via the toolCallUpdate the host posts), renders the permission card, and
// asserts the webview now:
//   - shows a Codex-style inline green/red diff on the card itself,
//   - auto-opens the native side-by-side editor (posts `openDiff`) when the card appears,
//   - carries the `requestId` on both `openDiff` and `permissionAnswer` so the
//     host can pair the auto-opened tab with the answer and close it,
//   - still offers a manual "open full diff →" button to re-open it.
import { describe, it, expect } from "vitest";
import { bootWebview, dispatch, click } from "./webview-harness";

const DIFF = { type: "diff", path: "src/foo.ts", oldText: "a\nb", newText: "a\nB\nc" };

function seedDiffAndCard(window: any, requestId: number | string = 7) {
  // The host posts the edit content as a toolCallUpdate; chat.js stashes it in
  // pendingDiffByToolCallId keyed by toolCallId.
  dispatch(window, { type: "toolCallUpdate", call: { toolCallId: "tc1", content: [DIFF] } });
  dispatch(window, {
    type: "permissionRequest",
    req: {
      id: requestId,
      toolCall: { toolCallId: "tc1", kind: "edit", title: "Edit src/foo.ts" },
      options: [
        { optionId: "allow", name: "Allow once", kind: "allow_once" },
        { optionId: "rej", name: "Reject", kind: "reject_once" },
      ],
    },
  });
}

describe("permission card diff preview (real chat.js in a DOM)", () => {
  it("auto-opens the native diff and shows an inline Codex-style preview on the card", () => {
    const { window, posted, doc } = bootWebview();
    seedDiffAndCard(window, 7);

    const card = doc.querySelector(".card.permission");
    expect(card).not.toBeNull();
    expect(card!.querySelector(".card-subtitle")!.textContent).toContain("src/foo.ts");
    // +2 −1 from "a\\nb" → "a\\nB\\nc" (same as the tool-row #45 surface).
    expect(card!.querySelector(".diff-stat-add")!.textContent).toBe("+2");
    expect(card!.querySelector(".diff-stat-del")!.textContent).toBe("−1");

    const region = card!.querySelector(".tool-diff-region.perm-diff-region") as HTMLElement;
    expect(region).not.toBeNull();
    const adds = [...region.querySelectorAll(".tdl-add .tdl-code")].map((s) => s.textContent);
    const dels = [...region.querySelectorAll(".tdl-del .tdl-code")].map((s) => s.textContent);
    expect(adds).toEqual(["B", "c"]);
    expect(dels).toEqual(["b"]);
    expect([...region.querySelectorAll(".tdl-add .tdl-sign")].map((s) => s.textContent)).toEqual(["+", "+"]);
    expect(region.querySelector(".tdl-del .tdl-sign")!.textContent).toBe("-");

    const openDiffs = posted.filter((m: any) => m.type === "openDiff");
    expect(openDiffs).toHaveLength(1);
    expect(openDiffs[0]).toEqual({
      type: "openDiff",
      path: "src/foo.ts",
      oldText: "a\nb",
      newText: "a\nB\nc",
      requestId: 7,
    });
  });

  it("keeps a manual 'open full diff' button that re-opens the same diff", () => {
    const { window, posted, doc } = bootWebview();
    seedDiffAndCard(window, 9);

    const btn = doc.querySelector(".card.permission .preview-link") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("open full diff");
    click(window, btn);

    const openDiffs = posted.filter((m: any) => m.type === "openDiff");
    expect(openDiffs).toHaveLength(2); // auto-open + the manual re-open
    expect(openDiffs[1].requestId).toBe(9);
  });

  it("answering carries the same requestId so the host can close the auto-opened tab", () => {
    const { window, posted, doc } = bootWebview();
    seedDiffAndCard(window, 11);

    const allow = [...doc.querySelectorAll(".card.permission .card-actions button")]
      .find((b) => b.textContent === "Allow once") as HTMLButtonElement;
    click(window, allow);

    const answer = posted.find((m: any) => m.type === "permissionAnswer");
    expect(answer).toEqual({ type: "permissionAnswer", requestId: 11, optionId: "allow" });
  });

  it("does not auto-open when the permission has no diff (e.g. a command)", () => {
    const { window, posted, doc } = bootWebview();
    dispatch(window, {
      type: "permissionRequest",
      req: {
        id: 12,
        toolCall: { toolCallId: "tc-exec", kind: "execute", title: "Run npm test" },
        options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
      },
    });

    expect(doc.querySelector(".card.permission")).not.toBeNull();
    expect(doc.querySelector(".card.permission .preview-link")).toBeNull();
    expect(posted.filter((m: any) => m.type === "openDiff")).toHaveLength(0);
  });
});
