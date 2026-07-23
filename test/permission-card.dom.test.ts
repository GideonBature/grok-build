// DOM-level test of the permission card's Keep/Undo edit-proposal UX — drives
// the REAL shipped media/chat.js in a happy-dom window. It seeds the edit diff
// (via the toolCallUpdate the host posts), renders the permission card, and
// asserts the webview now:
//   - shows a Cursor-style Keep / Undo proposal on the card itself,
//   - does NOT auto-open the native side-by-side editor (that was the "always
//     looks like a line dump" problem),
//   - still offers a manual "open full diff →" button,
//   - maps Keep → allow_once and Undo → reject_once with the right requestId.
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
        { optionId: "always", name: "Allow always", kind: "allow_always" },
        { optionId: "rej", name: "Reject", kind: "reject_once" },
      ],
    },
  });
}

describe("permission card Keep/Undo edit proposal (real chat.js in a DOM)", () => {
  it("shows a Keep/Undo proposal and does not auto-open the native diff", () => {
    const { window, posted, doc } = bootWebview();
    seedDiffAndCard(window, 7);

    const card = doc.querySelector(".card.permission");
    expect(card).not.toBeNull();
    const proposal = card!.querySelector(".edit-proposal") as HTMLElement;
    expect(proposal).not.toBeNull();
    expect(proposal.querySelector(".edit-proposal-path")!.textContent).toBe("src/foo.ts");
    // +2 −1 from "a\\nb" → "a\\nB\\nc"
    expect(proposal.querySelector(".diff-stat-add")!.textContent).toBe("+2");
    expect(proposal.querySelector(".diff-stat-del")!.textContent).toBe("−1");

    const keep = proposal.querySelector(".edit-proposal-keep") as HTMLButtonElement;
    const undo = proposal.querySelector(".edit-proposal-undo") as HTMLButtonElement;
    expect(keep).not.toBeNull();
    expect(undo).not.toBeNull();
    expect(keep.textContent).toBe("Keep");
    expect(undo.textContent).toBe("Undo");
    // Allow always is the optional third action on the bar.
    expect(proposal.querySelector(".edit-proposal-extra")!.textContent).toMatch(/Always/i);

    // Mixed replace → line-by-line body (not the soft pure-add path).
    const dels = [...proposal.querySelectorAll(".tdl-del .tdl-code")].map((s) => s.textContent);
    const adds = [...proposal.querySelectorAll(".tdl-add .tdl-code")].map((s) => s.textContent);
    expect(dels).toEqual(["b"]);
    expect(adds).toEqual(["B", "c"]);

    // No auto-open — that was the "always looks like image 1" native dump.
    expect(posted.filter((m: any) => m.type === "openDiff")).toHaveLength(0);
  });

  it("keeps a manual 'open full diff' button that opens the native editor on demand", () => {
    const { window, posted, doc } = bootWebview();
    seedDiffAndCard(window, 9);

    const btn = doc.querySelector(".card.permission .preview-link") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("open full diff");
    click(window, btn);

    const openDiffs = posted.filter((m: any) => m.type === "openDiff");
    expect(openDiffs).toHaveLength(1);
    expect(openDiffs[0]).toEqual({
      type: "openDiff",
      path: "src/foo.ts",
      oldText: "a\nb",
      newText: "a\nB\nc",
      requestId: 9,
    });
  });

  it("Keep posts allow_once; Undo posts reject_once", () => {
    const { window, posted, doc } = bootWebview();
    seedDiffAndCard(window, 11);

    click(window, doc.querySelector(".edit-proposal-keep") as HTMLElement);
    expect(posted.find((m: any) => m.type === "permissionAnswer")).toEqual({
      type: "permissionAnswer",
      requestId: 11,
      optionId: "allow",
    });

    // Fresh card for Undo.
    const { window: w2, posted: p2, doc: d2 } = bootWebview();
    seedDiffAndCard(w2, 12);
    click(w2, d2.querySelector(".edit-proposal-undo") as HTMLElement);
    expect(p2.find((m: any) => m.type === "permissionAnswer")).toEqual({
      type: "permissionAnswer",
      requestId: 12,
      optionId: "rej",
    });
  });

  it("pure additions use the soft green proposal body (no line gutters)", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "toolCallUpdate",
      call: {
        toolCallId: "tc-add",
        content: [{ type: "diff", path: "README.md", oldText: "", newText: "hello\nworld" }],
      },
    });
    dispatch(window, {
      type: "permissionRequest",
      req: {
        id: 20,
        toolCall: { toolCallId: "tc-add", kind: "edit", title: "Edit README.md" },
        options: [
          { optionId: "allow", name: "Allow once", kind: "allow_once" },
          { optionId: "rej", name: "Reject", kind: "reject_once" },
        ],
      },
    });
    const soft = doc.querySelector(".edit-proposal-soft") as HTMLElement;
    expect(soft).not.toBeNull();
    expect(soft.textContent).toBe("hello\nworld");
    expect(doc.querySelector(".tdl")).toBeNull();
  });

  it("does not use the proposal shell when the permission has no diff (e.g. a command)", () => {
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
    expect(doc.querySelector(".edit-proposal")).toBeNull();
    expect(doc.querySelector(".card.permission .preview-link")).toBeNull();
    expect(posted.filter((m: any) => m.type === "openDiff")).toHaveLength(0);
    // Classic option list still works.
    expect(
      [...doc.querySelectorAll(".card.permission .card-actions button")].map((b) => b.textContent),
    ).toEqual(["Allow once"]);
  });
});
