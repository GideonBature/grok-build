// DOM-level regression tests for the webview UI bugs that the native-Windows
// smoke test surfaced and this build fixed (see CLAUDE.md § Status). Each one
// drives the REAL media/chat.js and asserts the fixed behavior, so the bug can't
// silently come back:
//
//   1. History popover that "never closed"  -> open/close toggle + outside-click close
//   2. Session rows "only clickable on the label" -> whole row resumes; action
//      buttons stopPropagation so they don't also resume
//   3. Reasoning traces "no longer expandable" -> header click toggles the body
import { describe, it, expect } from "vitest";
import { bootWebview, dispatch, click, Posted } from "./webview-harness";

const $ = (doc: Document, id: string) => doc.getElementById(id) as HTMLElement;
const types = (posted: Posted[]) => posted.map((p) => p.type);

describe("history popover (regression: popover that never closed)", () => {
  it("opens on the history button and requests the session list", () => {
    const { window, posted, doc } = bootWebview();
    const pop = $(doc, "history-popover");
    expect((pop as any).hidden).toBe(true);

    click(window, $(doc, "history-btn"));

    expect((pop as any).hidden).toBe(false);
    expect(types(posted)).toContain("listSessions");
  });

  it("toggles closed when the history button is clicked again", () => {
    const { window, doc } = bootWebview();
    const pop = $(doc, "history-popover");
    click(window, $(doc, "history-btn"));
    expect((pop as any).hidden).toBe(false);

    click(window, $(doc, "history-btn"));
    expect((pop as any).hidden).toBe(true);
  });

  it("closes on an outside click but stays open on a click inside it", () => {
    const { window, doc } = bootWebview();
    const pop = $(doc, "history-popover");

    click(window, $(doc, "history-btn"));
    expect((pop as any).hidden).toBe(false);

    // click inside the popover -> stopPropagation keeps it open
    click(window, pop);
    expect((pop as any).hidden).toBe(false);

    // click elsewhere in the document -> closePopovers()
    click(window, $(doc, "messages"));
    expect((pop as any).hidden).toBe(true);
  });
});

describe("session rows (regression: only the label was clickable)", () => {
  const entries = [
    { id: "s1", displayName: "Add subtract fn", numMessages: 4, updatedAt: Date.now() - 60000 },
    { id: "s2", displayName: "Refactor parser", numMessages: 9, updatedAt: Date.now() - 3600000 },
  ];

  function openWithSessions() {
    const h = bootWebview();
    click(h.window, $(h.doc, "history-btn")); // open the popover so the list renders
    h.posted.length = 0; // forget the listSessions request; keep only row interactions
    dispatch(h.window, { type: "sessions", entries, activeId: null });
    return h;
  }

  it("renders one row per session with name + meta", () => {
    const { doc } = openWithSessions();
    const rows = doc.querySelectorAll(".history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".history-row-name")!.textContent).toBe("Add subtract fn");
    expect(rows[0].querySelector(".history-row-meta")!.textContent).toContain("4 msg");
  });

  it("resumes the session when the row's META area (not the label) is clicked", () => {
    const { window, posted, doc } = openWithSessions();
    const meta = doc.querySelector(".history-row .history-row-meta") as HTMLElement;
    click(window, meta); // a non-label part of the row

    expect(posted).toContainEqual({ type: "resumeSession", id: "s1" });
  });

  it("delete button posts deleteSession and does NOT also resume (stopPropagation)", () => {
    const { window, posted, doc } = openWithSessions();
    const delBtn = doc.querySelector(".history-row .history-action-danger") as HTMLElement;
    click(window, delBtn);

    expect(posted).toContainEqual({ type: "deleteSession", id: "s1", name: "Add subtract fn" });
    expect(types(posted)).not.toContain("resumeSession");
  });

  it("hides the delete button for the active session, keeps it for others", () => {
    const h = bootWebview();
    click(h.window, $(h.doc, "history-btn"));
    h.posted.length = 0;
    dispatch(h.window, { type: "sessions", entries, activeId: "s1" });
    const rows = h.doc.querySelectorAll(".history-row");
    // s1 is active → no delete button (it's the live session; delete wouldn't stick).
    expect(rows[0].querySelector(".history-action-danger")).toBeNull();
    // s2 is not active → delete button present.
    expect(rows[1].querySelector(".history-action-danger")).not.toBeNull();
    // Rename stays available on the active row.
    expect(rows[0].querySelector(".history-action-btn")).not.toBeNull();
  });

  it("rename button enters rename mode and does NOT resume", () => {
    const { window, posted, doc } = openWithSessions();
    const renameBtn = doc.querySelectorAll(".history-row .history-action-btn")[0] as HTMLElement;
    click(window, renameBtn);

    expect(doc.querySelector(".history-row input.history-rename")).not.toBeNull();
    expect(types(posted)).not.toContain("resumeSession");
  });
});

describe("mode picker (the plan-gate entry path)", () => {
  it("offers Agent / Plan / YOLO and posts setMode with the chosen mode id", () => {
    const { window, posted, doc } = bootWebview();
    const pop = $(doc, "mode-popover");

    click(window, $(doc, "mode-btn"));
    expect((pop as any).hidden).toBe(false);
    const labels = [...pop.querySelectorAll(".mode-item-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Agent mode", "Plan mode", "YOLO"]);

    const planItem = [...pop.querySelectorAll(".mode-popover-item")]
      .find((el) => el.querySelector(".mode-item-label")!.textContent === "Plan mode") as HTMLElement;
    click(window, planItem);

    expect(posted).toContainEqual({ type: "setMode", modeId: "plan" });
    expect((pop as any).hidden).toBe(true); // selecting a mode closes the popover
  });

  it("toggles the mode popover closed when the button is clicked again", () => {
    const { window, doc } = bootWebview();
    const pop = $(doc, "mode-popover");
    click(window, $(doc, "mode-btn"));
    expect((pop as any).hidden).toBe(false);
    click(window, $(doc, "mode-btn"));
    expect((pop as any).hidden).toBe(true);
  });
});

describe("gear settings lock (model + effort disabled while busy / priming)", () => {
  const models = [
    { modelId: "grok-build", name: "Grok Build" },
    { modelId: "grok-composer-2.5-fast", name: "Composer 2.5 Fast" },
  ];
  function bootWithModels(busy?: { value: boolean; locked?: boolean }) {
    const h = bootWebview();
    dispatch(h.window, { type: "session", sessionId: "s1", models, currentModelId: "grok-build" });
    if (busy) dispatch(h.window, { type: "setBusy", ...busy });
    h.posted.length = 0;
    return h;
  }
  const modelBtn = (doc: Document) => doc.querySelector(".model-name-btn") as HTMLButtonElement;

  it("shows the user-facing model name on the gear button, not the raw id", () => {
    const { window, doc } = bootWithModels();
    click(window, $(doc, "gear-btn"));
    expect(modelBtn(doc).textContent).toContain("Grok Build");
    expect(modelBtn(doc).textContent).not.toContain("grok-build");
  });

  it("when idle, the model button opens the picker and a pick posts setModel", () => {
    const { window, posted, doc } = bootWithModels();
    click(window, $(doc, "gear-btn"));
    expect(modelBtn(doc).disabled).toBe(false);

    click(window, modelBtn(doc)); // opens the picker sub-view
    const composer = [...doc.querySelectorAll("#gear-popover .toolbar-popover-item")]
      .find((el) => el.textContent!.includes("Composer 2.5 Fast")) as HTMLElement;
    click(window, composer);

    expect(posted).toContainEqual({ type: "setModel", modelId: "grok-composer-2.5-fast" });
  });

  it("while priming, the model button is disabled and clicking it neither opens the picker nor posts", () => {
    const { window, posted, doc } = bootWithModels({ value: true, locked: true });
    click(window, $(doc, "gear-btn"));

    expect(modelBtn(doc).disabled).toBe(true);
    expect(modelBtn(doc).className).toContain("disabled");

    click(window, modelBtn(doc));
    // still on the main gear view (the picker's "← Model" back row never rendered)
    expect(doc.querySelector("#gear-popover .popover-back")).toBeNull();
    expect(types(posted)).not.toContain("setModel");
  });

  it("while busy, clicking an effort dot does not post setEffort", () => {
    const { window, posted, doc } = bootWithModels({ value: true });
    click(window, $(doc, "gear-btn"));
    const dot = doc.querySelector(".effort-dot") as HTMLElement;

    expect(dot.className).toContain("disabled");
    click(window, dot);
    expect(types(posted)).not.toContain("setEffort");
  });

  it("re-renders an open gear to unlock the controls once busy clears", () => {
    const { window, doc } = bootWithModels({ value: true, locked: true });
    click(window, $(doc, "gear-btn"));
    expect(modelBtn(doc).disabled).toBe(true);

    dispatch(window, { type: "setBusy", value: false });

    expect(($(doc, "gear-popover") as any).hidden).toBe(false); // popover stays open
    expect(modelBtn(doc).disabled).toBe(false); // now unlocked
  });
});

describe("reasoning trace (regression: thinking traces no longer expandable)", () => {
  it("renders a collapsed thinking block whose header toggles the body open/closed", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "thoughtChunk", text: "considering the approach…" });

    const block = doc.querySelector(".msg.thinking")!;
    const hdr = block.querySelector(".thinking-header") as HTMLElement;
    const body = block.querySelector(".thinking-body") as HTMLElement;
    const chevron = block.querySelector(".thinking-chevron") as HTMLElement;

    expect(body.hidden).toBe(true);
    expect(chevron.textContent).toBe("▶");

    click(window, hdr);
    expect(body.hidden).toBe(false);
    expect(chevron.textContent).toBe("▼");

    click(window, hdr);
    expect(body.hidden).toBe(true);
    expect(chevron.textContent).toBe("▶");
  });
});

describe("user message (regression: doubled on grok 0.2.33)", () => {
  const users = (doc: Document) => doc.querySelectorAll(".msg.user");

  it("does not render a second bubble when a live prompt is echoed back as a user chunk", () => {
    const { window, doc } = bootWebview();

    // Live send: the host posts the optimistic bubble.
    dispatch(window, { type: "userMessage", text: "/imagine a rocket", chips: [] });
    expect(users(doc).length).toBe(1);

    // grok 0.2.33 echoes the prompt back as a user_message_chunk mid-turn (not
    // replaying). It must NOT spawn a duplicate bubble.
    dispatch(window, { type: "userMessageChunk", text: "/imagine a rocket" });
    expect(users(doc).length).toBe(1);
  });

  it("still renders the user bubble from chunks during a session replay", () => {
    const { window, doc } = bootWebview();

    dispatch(window, { type: "historyReplay", active: true });
    dispatch(window, { type: "userMessageChunk", text: "resumed prompt" });

    expect(users(doc).length).toBe(1);
    expect(users(doc)[0].textContent).toContain("resumed prompt");
  });
});

describe("welcome version line (session-start lifecycle)", () => {
  const verEl = (doc: Document) => $(doc, "welcome-version");
  const ver = (doc: Document) => verEl(doc).textContent;
  // The trailing dots are an animated ::after pseudo-element (the .loading-dots
  // class), so the literal text is dot-free while a status is transient.
  const animating = (doc: Document) => verEl(doc).classList.contains("loading-dots");

  it("flips to connected only when priming finishes, not at the handshake", () => {
    const { window, doc } = bootWebview();

    // ACP handshake done — but the hidden primer is still in flight, so the
    // line must stay "Starting…" (animated), NOT jump to "Connected" yet.
    dispatch(window, { type: "initialized", info: { version: "0.2.33" } });
    expect(ver(doc)).toBe("Starting");
    expect(animating(doc)).toBe(true);

    // Priming spinner clears → grok is finally ready → reveal the version.
    dispatch(window, { type: "setBusy", value: false });
    expect(ver(doc)).toBe("Connected · v0.2.33");
    expect(animating(doc)).toBe(false); // settled — dots stop
  });

  it("shows the silent-update hint, then starting, then the new version", () => {
    const { window, doc } = bootWebview();

    dispatch(window, { type: "cliUpdating" });
    expect(ver(doc)).toBe("Updating Grok Build CLI");
    expect(animating(doc)).toBe(true);

    dispatch(window, { type: "initialized", info: { version: "0.2.40" } });
    expect(ver(doc)).toBe("Starting");
    expect(animating(doc)).toBe(true);

    dispatch(window, { type: "setBusy", value: false });
    expect(ver(doc)).toBe("Connected · v0.2.40");
    expect(animating(doc)).toBe(false);
  });

  it("does not overwrite the version on later (post-priming) busy toggles", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "initialized", info: { version: "0.2.33" } });
    dispatch(window, { type: "setBusy", value: false });
    expect(ver(doc)).toBe("Connected · v0.2.33");

    // A normal prompt's busy cycle later — the line must not revert.
    dispatch(window, { type: "setBusy", value: true });
    dispatch(window, { type: "setBusy", value: false });
    expect(ver(doc)).toBe("Connected · v0.2.33");
  });
});

describe("gear menu — Other group + About / Config & debug sub-views", () => {
  function boot() {
    const h = bootWebview();
    dispatch(h.window, { type: "initialState", useCtrlEnter: false, effort: "", cwd: "/x", extVersion: "1.4.0" });
    dispatch(h.window, { type: "initialized", info: { version: "0.2.33" } });
    dispatch(h.window, { type: "session", sessionId: "s1", models: [], currentModelId: "grok-build" });
    h.posted.length = 0;
    return h;
  }
  const gear = (doc: Document) => $(doc, "gear-popover");
  const items = (doc: Document) => [...doc.querySelectorAll("#gear-popover .toolbar-popover-item")] as HTMLElement[];
  const itemByText = (doc: Document, text: string) =>
    items(doc).find((el) => el.textContent!.includes(text)) as HTMLElement;

  it("replaces the flat Config/Account/Debug sections with an Other group", () => {
    const h = boot();
    click(h.window, $(h.doc, "gear-btn"));
    const labels = items(h.doc).map((el) => el.textContent || "");
    expect(labels.some((l) => l.includes("About"))).toBe(true);
    expect(labels.some((l) => l.includes("Config & debug"))).toBe(true);
    expect(labels.some((l) => l.includes("Log out"))).toBe(true);
    // the old standalone items no longer live on the main view
    expect(labels.some((l) => l.trim() === "Sign out")).toBe(false);
    expect(labels.some((l) => l.includes("Show extension logs"))).toBe(false);
  });

  it("About shows both versions and requests an update check", () => {
    const h = boot();
    click(h.window, $(h.doc, "gear-btn"));
    click(h.window, itemByText(h.doc, "About"));

    const text = gear(h.doc).textContent || "";
    expect(text).toContain("This extension");
    expect(text).toContain("v1.4.0");
    expect(text).toContain("Grok Build CLI");
    expect(text).toContain("v0.2.33");
    expect(types(h.posted)).toContain("checkGrokUpdate");
  });

  it("enables Update Grok Build when an update is available and posts updateGrok", () => {
    const h = boot();
    click(h.window, $(h.doc, "gear-btn"));
    click(h.window, itemByText(h.doc, "About"));
    dispatch(h.window, { type: "grokUpdateStatus", current: "0.2.3", latest: "0.2.33", updateAvailable: true });

    expect(gear(h.doc).textContent).toContain("Update available");
    const btn = itemByText(h.doc, "Update Grok Build");
    expect(btn.className).not.toContain("disabled");

    h.posted.length = 0;
    click(h.window, btn);
    expect(types(h.posted)).toContain("updateGrok");
  });

  it("shows a grayed up-to-date status and no update action when current", () => {
    const h = boot();
    click(h.window, $(h.doc, "gear-btn"));
    click(h.window, itemByText(h.doc, "About"));
    dispatch(h.window, { type: "grokUpdateStatus", current: "0.2.33", latest: "0.2.33", updateAvailable: false });

    expect(gear(h.doc).textContent).toContain("up to date");
    expect(itemByText(h.doc, "Update Grok Build")).toBeUndefined();
  });

  it("falls back to the update check's version when the handshake gave none", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "initialState", useCtrlEnter: false, effort: "", cwd: "/x", extVersion: "1.4.0" });
    // No `initialized` version (native Windows build) — the panel starts at "—".
    dispatch(h.window, { type: "session", sessionId: "s1", models: [], currentModelId: "grok-build" });
    click(h.window, $(h.doc, "gear-btn"));
    click(h.window, itemByText(h.doc, "About"));
    dispatch(h.window, { type: "grokUpdateStatus", current: "0.2.3", latest: "0.2.3", updateAvailable: false });

    const text = gear(h.doc).textContent || "";
    expect(text).toContain("Grok Build CLI");
    expect(text).toContain("v0.2.3");
    expect(text).not.toContain("—");
  });

  it("the About back row returns to the main menu", () => {
    const h = boot();
    click(h.window, $(h.doc, "gear-btn"));
    click(h.window, itemByText(h.doc, "About"));
    click(h.window, itemByText(h.doc, "← About"));
    expect(items(h.doc).some((el) => (el.textContent || "").includes("Config & debug"))).toBe(true);
  });

  it("Config & debug exposes the config + logs links and posts the right message", () => {
    const h = boot();
    click(h.window, $(h.doc, "gear-btn"));
    click(h.window, itemByText(h.doc, "Config & debug"));

    const labels = items(h.doc).map((el) => el.textContent || "");
    expect(labels.some((l) => l.includes("Open global config"))).toBe(true);
    expect(labels.some((l) => l.includes("Open project config"))).toBe(true);
    expect(labels.some((l) => l.includes("MCP servers"))).toBe(true);
    expect(labels.some((l) => l.includes("Show extension logs"))).toBe(true);

    click(h.window, itemByText(h.doc, "Show extension logs"));
    expect(types(h.posted)).toContain("showLogs");
  });
});

// LaTeX rendering: grok now emits TeX (\(...\) inline, \[...\] display). The
// webview pulls math out before HTML-escaping and renders it via KaTeX. KaTeX
// isn't loaded in the happy-dom harness, so renderMarkdown falls back to the
// escaped raw TeX (.math-raw) — which is exactly what proves the extract/restore
// pipeline runs and that the backslashes survive the inline-markdown pass.
describe("LaTeX math rendering", () => {
  // promptComplete forces a synchronous flushAgent so the markdown is in the DOM.
  const renderAgent = (text: string) => {
    const { doc, window } = bootWebview();
    dispatch(window, { type: "messageChunk", text });
    dispatch(window, { type: "promptComplete" });
    return doc.querySelector(".msg.agent") as HTMLElement;
  };

  it("renders inline \\(...\\) math as a math node, not raw delimiters", () => {
    const el = renderAgent("The area is \\(\\pi r^2\\) exactly.");
    const math = el.querySelector(".math-raw");
    expect(math).not.toBeNull();
    expect(math!.textContent).toBe("\\pi r^2");
    // the literal delimiters must NOT survive into the rendered text
    expect(el.textContent).not.toContain("\\(");
    expect(el.textContent).not.toContain("\\)");
  });

  it("renders display \\[...\\] math as a block", () => {
    const el = renderAgent("Result:\n\\[E = mc^2\\]\ndone");
    const math = el.querySelector(".math-raw.math-display");
    expect(math).not.toBeNull();
    expect(math!.textContent).toBe("E = mc^2");
  });

  it("preserves a matrix (backslashes + braces) through the markdown pipeline", () => {
    const el = renderAgent("\\[\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\\]");
    const math = el.querySelector(".math-raw.math-display") as HTMLElement;
    expect(math).not.toBeNull();
    expect(math.textContent).toContain("\\begin{pmatrix}");
    expect(math.textContent).toContain("&");
  });

  it("leaves prose with bare dollar amounts untouched", () => {
    const el = renderAgent("it costs $5 and then $10");
    expect(el.querySelector(".math-raw")).toBeNull();
    expect(el.textContent).toContain("it costs $5 and then $10");
  });

  it("strips \\label{...} so an align block doesn't render a red error (KaTeX has no \\ref)", () => {
    const el = renderAgent(
      "\\[\\begin{align} f(x) &= x^2 \\label{eq:quadratic} \\\\ f'(x) &= 2x \\end{align}\\]",
    );
    const math = el.querySelector(".math-raw.math-display") as HTMLElement;
    expect(math).not.toBeNull();
    // the unsupported \label macro is gone, the equation body survives
    expect(math.textContent).not.toContain("\\label");
    expect(math.textContent).not.toContain("eq:quadratic");
    expect(math.textContent).toContain("\\begin{align}");
    expect(math.textContent).toContain("f(x) &= x^2");
  });
});
