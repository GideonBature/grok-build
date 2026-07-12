// DOM tests for #41 — full command text + captured output on command rows,
// driving the REAL media/chat.js. The host snapshots each terminal's buffer at
// terminal/release (the extension runs the commands itself, so the output is
// exactly what grok received) and posts it as `commandOutput`; the webview
// renders a Claude-Code-style IN/OUT block under the row, collapsed by default
// with the tool-group header's chevron affordance. Outputs attach by
// exact-command FIFO, with a standalone fallback row so output is never
// dropped. Success is silent (exit 0 = just the output); failure gets an
// [Error] marker + error tint; a kill is [Cancelled], not an error.
import { describe, it, expect } from "vitest";
import { bootWebview, dispatch, click } from "./webview-harness";

const exec = (id: string, command: string, title?: string) => ({
  type: "toolCall",
  call: {
    toolCallId: id,
    kind: "execute",
    title: title ?? `Run ${command.slice(0, 20)}…`,
    rawInput: { variant: "Bash", command, is_background: false },
  },
});
const out = (command: string, output: string, exitCode: number | null = 0, truncated = false) => ({
  type: "commandOutput",
  command,
  output,
  exitCode,
  truncated,
});
const close = (window: Window) => dispatch(window, { type: "messageChunk", text: "done" });

describe("command details (#41)", () => {
  it("a lone command flattens WITH its trailing chevron + expandable IN/OUT block", () => {
    const { window, doc } = bootWebview();
    const longCmd = "node -e \"const fs=require('fs');const paths=fs.readdirSync('.').filter(p=>p.endsWith('.md'));console.log(paths.join('\\n'))\"";
    dispatch(window, exec("t1", longCmd, "Run node -e \"const fs=require('fs');const pa…"));
    close(window);

    const flat = doc.querySelector(".tool-flat.has-details") as HTMLElement;
    expect(flat).not.toBeNull();
    expect(flat.querySelector(".tool-chevron")).not.toBeNull(); // › after the label, moved with the flatten
    const details = flat.querySelector(".tool-item-details") as HTMLElement;
    expect(details.hidden).toBe(true); // collapsed by default
    expect(flat.classList.contains("expanded")).toBe(false);

    click(window, flat);
    expect(details.hidden).toBe(false);
    expect(flat.classList.contains("expanded")).toBe(true); // › rotated to v

    // The FULL command under an IN tag, not grok's truncated title.
    expect(details.querySelector(".cmd-io-tag")!.textContent).toBe("IN");
    expect(details.querySelector(".tool-cmd")!.textContent).toBe(longCmd);

    // Output lands after the flatten — the moved node still receives it.
    // Success is silent: OUT tag + text, no exit marker.
    dispatch(window, out(longCmd, "CLAUDE.md\nREADME.md", 0));
    const outRow = details.querySelector(".cmd-out") as HTMLElement;
    expect(outRow.querySelector(".cmd-io-tag")!.textContent).toBe("OUT");
    expect(outRow.querySelector(".tool-cmd-output")!.textContent).toBe("CLAUDE.md\nREADME.md");
    expect(outRow.classList.contains("failed")).toBe(false);
    expect(outRow.querySelector(".cmd-out-marker")).toBeNull();

    click(window, flat);
    expect(details.hidden).toBe(true);
    expect(flat.classList.contains("expanded")).toBe(false); // back to ›
  });

  it("grok.expandCommandOutputs pre-expands new rows and applies live to existing ones", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "initialState",
      effort: "", cwd: "/w", useCtrlEnter: false, extVersion: "0",
      showThinking: false, expandCommandOutputs: true,
    });
    dispatch(window, exec("a", "git status"));
    close(window);

    const flat = doc.querySelector(".tool-flat.has-details") as HTMLElement;
    const details = flat.querySelector(".tool-item-details") as HTMLElement;
    expect(details.hidden).toBe(false); // pre-expanded (v)
    expect(flat.classList.contains("expanded")).toBe(true);

    // Live config change collapses existing rows too.
    dispatch(window, { type: "expandCommandOutputs", value: false });
    expect(details.hidden).toBe(true);
    expect(flat.classList.contains("expanded")).toBe(false);

    dispatch(window, { type: "expandCommandOutputs", value: true });
    expect(details.hidden).toBe(false);
    expect(flat.classList.contains("expanded")).toBe(true);
  });

  it("outputs attach FIFO when the same command runs twice in one batch; exit 1 is [Error]", () => {
    const { window, doc } = bootWebview();
    dispatch(window, exec("a", "npm test"));
    dispatch(window, exec("b", "npm test"));
    close(window); // 2 calls → stays a group with .tool-item rows

    dispatch(window, out("npm test", "first run", 0));
    dispatch(window, out("npm test", "second run", 1));

    const items = [...doc.querySelectorAll(".tool-item.has-details")];
    expect(items).toHaveLength(2);
    // Labels in their own span (single-line ellipsis) + trailing chevron each.
    expect(items.every((i) => i.querySelector(".tool-item-label"))).toBe(true);
    expect(items.every((i) => i.querySelector(".tool-chevron"))).toBe(true);

    const details = [...doc.querySelectorAll(".tool-item .tool-item-details")];
    expect(details[0].querySelector(".tool-cmd-output")!.textContent).toBe("first run");
    expect(details[1].querySelector(".tool-cmd-output")!.textContent).toBe("second run");
    const failedRow = details[1].querySelector(".cmd-out") as HTMLElement;
    expect(failedRow.classList.contains("failed")).toBe(true);
    expect(failedRow.querySelector(".cmd-out-marker")!.textContent).toBe("[Error] exit 1");
  });

  it("an output with no matching row gets a standalone fallback row (never dropped)", () => {
    const { window, doc } = bootWebview();
    dispatch(window, out("echo orphan", "orphan output", 0));

    const details = doc.querySelector(".tool-item-details") as HTMLElement;
    expect(details).not.toBeNull();
    expect(details.querySelector(".tool-cmd")!.textContent).toBe("echo orphan");
    expect(details.querySelector(".tool-cmd-output")!.textContent).toBe("orphan output");
  });

  it("killed commands read [Cancelled] (muted, not an error); truncation is noted", () => {
    const { window, doc } = bootWebview();
    dispatch(window, exec("k", "sleep 999"));
    close(window);
    dispatch(window, out("sleep 999", "partial", null, true));

    const outRow = doc.querySelector(".cmd-out") as HTMLElement;
    expect(outRow.classList.contains("failed")).toBe(false);
    const markers = [...outRow.querySelectorAll(".cmd-out-marker")];
    expect(markers[0].textContent).toBe("[Cancelled] no exit code");
    expect(markers[0].classList.contains("muted")).toBe(true);
    expect(markers[1].textContent).toContain("output truncated");
  });

  it("clicking inside the expanded block (text selection) does not collapse it", () => {
    const { window, doc } = bootWebview();
    dispatch(window, exec("s", "git status"));
    close(window);
    const flat = doc.querySelector(".tool-flat.has-details") as HTMLElement;
    click(window, flat);
    const details = flat.querySelector(".tool-item-details") as HTMLElement;
    expect(details.hidden).toBe(false);

    click(window, details.querySelector(".tool-cmd")!);
    expect(details.hidden).toBe(false); // still open
  });

  it("row chevrons are independent of the group's state (present mid-run, per-row rotation)", () => {
    const { window, doc } = bootWebview();
    dispatch(window, exec("a", "npm test"));
    dispatch(window, exec("b", "git status"));
    // Group still IN PROGRESS — expand it and inspect the rows.
    const group = doc.querySelector(".tool-group.in-progress") as HTMLElement;
    click(window, group.querySelector(".tool-group-header")!);

    const rows = [...group.querySelectorAll(".tool-item.has-details")] as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.querySelector(".tool-chevron"))).toBe(true); // chevrons exist mid-run
    expect(rows.every((r) => !r.classList.contains("expanded"))).toBe(true); // each starts ›

    click(window, rows[0]);
    expect(rows[0].classList.contains("expanded")).toBe(true); // v — this row only
    expect(rows[1].classList.contains("expanded")).toBe(false); // still ›
  });

  it("a lone RUNNING command is expandable immediately (no waiting for the batch to close)", () => {
    const { window, doc } = bootWebview();
    dispatch(window, exec("live", "npm run build"));
    // No close(): the batch is still in progress.
    const group = doc.querySelector(".tool-group.in-progress") as HTMLElement;
    expect(group.classList.contains("cmd-single")).toBe(true);

    // One click on the header reveals the row AND its IN detail.
    click(window, group.querySelector(".tool-group-header")!);
    const details = group.querySelector(".tool-item-details") as HTMLElement;
    expect(details.hidden).toBe(false);
    expect(details.querySelector(".tool-cmd")!.textContent).toBe("npm run build");

    // A second tool joining the batch demotes it to normal group behavior.
    dispatch(window, exec("live2", "git status"));
    expect(group.classList.contains("cmd-single")).toBe(false);
  });

  it("non-command tools get no details block and no clickable-highlight class", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "toolCall", call: { toolCallId: "r", kind: "read", rawInput: { path: "/a.ts" } } });
    close(window);
    expect(doc.querySelector(".tool-item-details")).toBeNull();
    expect(doc.querySelector(".has-details")).toBeNull();
  });

  it("the output poller and kill tools stay plain (no details, no highlight)", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "toolCall",
      call: { toolCallId: "p1", title: "Get task output: t1", rawInput: { variant: "TaskOutput", task_id: "t1", block: true } },
    });
    dispatch(window, {
      type: "toolCall",
      call: { toolCallId: "p2", title: "kill_command_or_subagent", rawInput: { task_id: "t1" } },
    });
    close(window);
    expect(doc.querySelector(".has-details")).toBeNull();
    expect(doc.querySelector(".tool-item-details")).toBeNull();
  });
});
