(function () {
  const vscode = acquireVsCodeApi();

  const $ = (id) => document.getElementById(id);
  const messagesEl = $("messages");
  const input = $("input");
  const sendBtn = $("send-btn");
  const micBtn = $("mic-btn");
  const inputHighlight = $("input-highlight");
  const newBtn = $("new-btn");
  const historyBtn = $("history-btn");
  const modeBtn = $("mode-btn");
  const gearBtn = $("gear-btn");
  const addBtn = $("add-btn");
  const chipsEl = $("chips");
  const donutArc = $("donut-arc");
  const donutLabel = $("donut-label");
  const slashPopover = $("slash-popover");
  const modePopover = $("mode-popover");
  const gearPopover = $("gear-popover");
  const addPopover = $("add-popover");
  const historyPopover = $("history-popover");

  // grok's accepted reasoning-effort values, lowest → highest (matches the CLI;
  // `max` is not a real grok level and is intentionally excluded — see #3/#4).
  const EFFORT_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh"];
  const EFFORT_TOOLTIPS = {
    none: "None — no extra reasoning",
    minimal: "Minimal — least reasoning",
    low: "Low — fast, lightweight reasoning",
    medium: "Medium — balanced",
    high: "High — deeper reasoning",
    xhigh: "XHigh — deepest reasoning, slowest",
  };

  const state = {
    welcomeVisible: true,
    currentModelId: null,
    availableModels: [],
    currentModeId: "agent",
    effort: "",
    cwd: "",
    contextWindow: 200000,
    useCtrlEnter: false,
    commands: [],
    chips: [],
    busy: false,
    // Voice-input button: "idle" | "listening" | "transcribing" (see nextMicState).
    mic: "idle",
    // Whether the host found a voice API key. Optimistic until the host says
    // otherwise; drives the mic button's "needs setup" hint.
    voiceConfigured: true,
    // Streaming dictation: text typed before the mic started ("base"), and
    // whether live partials have begun replacing the tail.
    voiceBase: "",
    voiceLive: false,
    // The configured send phrase (for highlighting it in the composer).
    voiceSendPhrase: "grok send",
    // Messages dictated while Grok was busy, flushed when the turn ends.
    voiceQueue: [],
    activeAgentEl: null,
    activeAgentRaw: "",
    activeUserEl: null,
    activeUserRaw: "",
    activeThoughtEl: null,
    activeThoughtHdrEl: null,
    thoughtStartTime: null,
    activeToolGroupEl: null,
    slashFiltered: [],
    slashActive: 0,
    pendingDiffByToolCallId: new Map(),
    toolItemsByToolCallId: new Map(),
    agentRenderScheduled: false,
    thoughtBuffer: "",
    thoughtRenderScheduled: false,
    sessions: [],
    activeSessionId: null,
    sessionSearch: "",
    renamingSessionId: null,
    replaying: false,
    // Live ask_user_question tool calls (toolCallId → {questions, fromReplay}).
    // grok emits a tool_call alongside the live x.ai/ask_user_question request; we
    // stash it to suppress the generic tool chip (the interactive card from
    // `questionRequest` stands in).
    questionToolCalls: new Map(),
    // Restored question cards on resume (toolCallId → card element). On replay grok
    // sends a tool_call per question (with rawInput.questions); we render the card
    // immediately and fill the answer in whenever it arrives — on the tool_call
    // snapshot or a later update with the same toolCallId.
    restoredCardsByToolCallId: new Map(),
    // Saved plan cards waiting to be rendered inline as the conversation replays.
    // Each entry has { text, verdict, afterUserMessage? }. We drain entries whose
    // afterUserMessage matches the current userMsgCount as user messages stream
    // in, and dump anything left (legacy plans w/o position, or plans after the
    // last replayed user msg) at the end of replay.
    planHistoryQueue: [],
    userMsgCount: 0,
    // Element rendered below a resolved plan card while the host is waiting on
    // grok's response to the verdict (or its comment). Visible only between
    // the verdict click and the first incoming agent chunk; cleared by any
    // arriving content or by reset.
    planProcessingEl: null,
    // When true, the busy state is "locked" (e.g. session-start priming): the
    // send button shows a spinner and is disabled. When false, busy is
    // "stoppable" (regular prompts, verdict afterTurn) and the send button
    // shows a stop icon that the user can click to cancel grok mid-stream.
    busyLocked: false,
    // While replaying, suppress everything from the start of the current user
    // message (a primer turn) through the end of grok's response to it — until
    // the next user message starts. Keeps the chat clean of our session-start
    // priming when the user resumes a session.
    suppressReplayTurn: false,
    // While replaying, suppress just the user bubble for a marker-only verdict
    // message ([Plan cancelled] with no comment) — grok's response to it still
    // renders. Distinct from suppressReplayTurn (which hides the whole turn).
    skipUserBubble: false,
  };

  // Matches any version of the extension's primer (v1, v2, …). Used during
  // session replay to detect and hide the primer + grok's ack from the
  // restored conversation.
  const PRIMER_PATTERN = /^\s*\[grok-build-vscode primer v\d+\]/;

  // The host prepends a plan-verdict protocol marker ([Plan approved|rejected|
  // cancelled]) to the wire-level prompt so grok can recognize the verdict. It's
  // grok-only plumbing — never shown live. On replay grok echoes the raw prompt,
  // so strip the marker here to keep the restored view consistent with live.
  const PLAN_MARKER_PATTERN = /^\s*\[Plan (approved|rejected|cancelled)\]\s*/i;
  function stripPlanMarker(text) {
    const m = PLAN_MARKER_PATTERN.exec(text || "");
    if (!m) return { matched: false, rest: text };
    return { matched: true, rest: (text || "").slice(m[0].length) };
  }

  // ---------- icons ----------

  const ICON = {
    eye: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`,
    file: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`,
    cpu: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>`,
    squarePen: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>`,
    arrowUp: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`,
    square: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>`,
    spinner: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    gear: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    sparkle: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
    shield: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
    bot: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`,
    listTree: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/></svg>`,
    zap: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`,
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    clock: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    upload: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
    pencil: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`,
    mic: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`,
    // Animated equalizer bars shown while listening (CSS drives the bounce).
    micWaves: `<span class="mic-waves" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`,
  };

  const MODE_META = {
    agent: {
      icon: ICON.bot,
      label: "Agent mode",
      desc: "Grok acts directly, asking approval only for changes it judges sensitive",
    },
    plan: {
      icon: ICON.listTree,
      label: "Plan mode",
      desc: "Grok explores and proposes a plan; file writes and commands are blocked until you approve it",
    },
    yolo: {
      icon: ICON.zap,
      label: "YOLO",
      desc: "Grok will automatically approve all permission requests",
    },
  };

  // ---------- helpers ----------

  function capitalize(s) {
    if (!s) return "";
    if (s === "xhigh") return "XHigh";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function toK(n) {
    return Math.round(n / 1000) + "K";
  }

  function truncate(s, max) {
    return s.length > max ? s.slice(0, max) + "…" : s;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatTime(ts) {
    const d = new Date(ts);
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
  }

  function updateModeBtn(modeId) {
    const meta = MODE_META[modeId] || MODE_META.agent;
    modeBtn.innerHTML = `${meta.icon}<span class="btn-label">${escapeHtml(meta.label)}</span>`;
    modeBtn.classList.toggle("plan-active", modeId === "plan");
    modeBtn.classList.toggle("yolo-active", modeId === "yolo");
  }

  newBtn.innerHTML = ICON.squarePen;
  historyBtn.innerHTML = ICON.clock;
  sendBtn.innerHTML = ICON.arrowUp;
  gearBtn.innerHTML = ICON.gear;
  addBtn.innerHTML = ICON.plus;
  updateModeBtn("agent");

  // ---------- markdown ----------

  const { looksLikeFileRef, formatRelativeTime, modelDisplayName, nextMicState, trailingSendPhrase, buildQuestionAnswers } = globalThis.GrokWebviewHelpers;

  function renderDiffCode(code) {
    const lines = code.replace(/\n+$/, "").split("\n");
    const body = lines.map((ln) => {
      let cls = "diff-line";
      if (/^@@/.test(ln)) cls += " diff-hunk";
      else if (/^(\+\+\+|---|diff |index )/.test(ln)) cls += " diff-meta";
      else if (ln[0] === "+") cls += " diff-add";
      else if (ln[0] === "-") cls += " diff-del";
      return `<span class="${cls}">${escapeHtml(ln) || "&nbsp;"}</span>`;
    }).join("");
    return `<code class="diff-code">${body}</code>`;
  }

  function renderMarkdown(raw) {
    const codeBlocks = [];
    let s = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const i = codeBlocks.length;
      const isDiff = lang === "diff";
      const inner = isDiff
        ? renderDiffCode(code)
        : `<code>${escapeHtml(code).trimEnd()}</code>`;
      codeBlocks.push(
        `<div class="code-block${isDiff ? " diff" : ""}">` +
          `<button class="code-copy-btn" type="button" title="Copy code">` +
            `<span class="code-copy-glyph">${ICON.copy}</span>` +
            `<span class="code-copy-label">Copy code</span>` +
          `</button>` +
          `<pre>${inner}</pre>` +
        `</div>`
      );
      return `\x00B${i}\x00`;
    });

    function inline(t) {
      return t
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/`([^`\n]+)`/g, (_, code) => {
          if (looksLikeFileRef(code)) {
            const safe = code.replace(/"/g, "&quot;");
            return `<a href="${safe}" class="file-ref-link"><code>${code}</code></a>`;
          }
          return `<code>${code}</code>`;
        })
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
          const safe = url.replace(/"/g, "&quot;");
          return `<a href="${safe}">${text}</a>`;
        })
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    }

    // GFM tables: header row | separator row (|---|---|) | data rows
    const tables = [];
    {
      const isTableRow = (l) => /^\s*\|.+\|\s*$/.test(l);
      const isSep = (l) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(l);
      const splitRow = (l) =>
        l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const srcLines = s.split('\n');
      const kept = [];
      let i = 0;
      while (i < srcLines.length) {
        if (i + 1 < srcLines.length && isTableRow(srcLines[i]) && isSep(srcLines[i + 1])) {
          const headers = splitRow(srcLines[i]);
          const sepCells = splitRow(srcLines[i + 1]);
          if (headers.length === sepCells.length) {
            const aligns = sepCells.map(c => {
              const L = c.startsWith(':'), R = c.endsWith(':');
              return L && R ? 'center' : R ? 'right' : L ? 'left' : '';
            });
            const rows = [];
            let j = i + 2;
            while (j < srcLines.length && isTableRow(srcLines[j])) {
              const cells = splitRow(srcLines[j]);
              while (cells.length < headers.length) cells.push('');
              rows.push(cells.slice(0, headers.length));
              j++;
            }
            const styleFor = (k) => aligns[k] ? ` style="text-align:${aligns[k]}"` : '';
            let html = '<div class="md-table-wrap"><table><thead><tr>';
            headers.forEach((h, k) => { html += `<th${styleFor(k)}>${inline(h)}</th>`; });
            html += '</tr></thead><tbody>';
            for (const row of rows) {
              html += '<tr>';
              row.forEach((c, k) => { html += `<td${styleFor(k)}>${inline(c)}</td>`; });
              html += '</tr>';
            }
            html += '</tbody></table></div>';
            const idx = tables.length;
            tables.push(html);
            kept.push(`\x00T${idx}\x00`);
            i = j;
            continue;
          }
        }
        kept.push(srcLines[i]);
        i++;
      }
      s = kept.join('\n');
    }

    // Expand inline numbered lists: "1. A 2. B 3. C" on one line → separate lines
    function expandInline(line) {
      if (!/^\s*\d+\. /.test(line)) return [line];
      const indent = line.match(/^(\s*)/)[1];
      const parts = line.trim().split(/(?<=\S)\s+(?=\d+\. )/);
      if (parts.length <= 1) return [line];
      const nums = parts.map(p => parseInt(p.match(/^(\d+)\./)?.[1] ?? '0'));
      const sequential = nums.every((n, i) => n === i + 1);
      return sequential ? parts.map(p => indent + p) : [line];
    }

    const rawLines = s.split('\n');
    const lines = [];
    for (const ln of rawLines) lines.push(...expandInline(ln));

    let out = '';
    // stack: { tag:'ul'|'ol', indent:number, liOpen:boolean }[]
    let stack = [];
    let pendingBreak = false;
    let lastWasBlock = false;
    let lastPara = false;

    function closeLiAt(i) {
      if (stack[i].liOpen) { out += '</li>'; stack[i].liOpen = false; }
    }
    function closeFrom(depth) {
      for (let i = stack.length - 1; i >= depth; i--) {
        closeLiAt(i);
        out += `</${stack[i].tag}>`;
      }
      stack = stack.slice(0, depth);
    }

    for (const line of lines) {
      if (!line.trim()) {
        if (stack.length === 0 && !lastWasBlock) pendingBreak = true;
        lastPara = false;
        continue;
      }
      lastWasBlock = false;

      const tm = line.trim().match(/^\x00T(\d+)\x00$/);
      if (tm) {
        closeFrom(0);
        out += `\x00T${tm[1]}\x00`;
        lastWasBlock = true;
        lastPara = false;
        pendingBreak = false;
        continue;
      }

      const hm = line.match(/^(#{1,3}) (.+)$/);
      if (hm) {
        closeFrom(0);
        out += `<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`;
        lastWasBlock = true;
        lastPara = false;
        pendingBreak = false;
        continue;
      }

      const lm = line.match(/^( *)([-*]|\d+\.) (.+)$/);
      if (lm) {
        const indent = lm[1].length;
        const isOl = /\d/.test(lm[2][0]);
        const tag = isOl ? 'ol' : 'ul';
        const content = lm[3];

        while (stack.length > 0 && stack[stack.length - 1].indent > indent) {
          closeLiAt(stack.length - 1);
          out += `</${stack[stack.length - 1].tag}>`;
          stack.pop();
        }

        if (stack.length === 0 || stack[stack.length - 1].indent < indent) {
          out += `<${tag}>`;
          stack.push({ tag, indent, liOpen: false });
        } else {
          closeLiAt(stack.length - 1);
          if (stack[stack.length - 1].tag !== tag) {
            out += `</${stack[stack.length - 1].tag}><${tag}>`;
            stack[stack.length - 1].tag = tag;
          }
        }

        out += `<li>${inline(content)}`;
        stack[stack.length - 1].liOpen = true;
        lastPara = false;
        pendingBreak = false;
        continue;
      }

      closeFrom(0);
      if (pendingBreak) { out += '<br><br>'; pendingBreak = false; }
      else if (lastPara) out += '<br>';
      out += inline(line);
      lastPara = true;
    }

    closeFrom(0);
    return out
      .replace(/\x00B(\d+)\x00/g, (_, i) => codeBlocks[+i])
      .replace(/\x00T(\d+)\x00/g, (_, i) => tables[+i]);
  }

  // ---------- popovers ----------

  function closePopovers() {
    modePopover.hidden = true;
    gearPopover.hidden = true;
    addPopover.hidden = true;
    historyPopover.hidden = true;
  }

  function positionPopover(popover, btn) {
    const composerRect = popover.parentElement.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    popover.style.top = "auto";
    popover.style.bottom = (composerRect.bottom - btnRect.top + 4) + "px";
    popover.style.left = (btnRect.left - composerRect.left) + "px";
    popover.style.right = "auto";
    requestAnimationFrame(() => {
      const pw = popover.getBoundingClientRect().width;
      const leftOffset = btnRect.left - composerRect.left;
      if (leftOffset + pw > composerRect.width) {
        popover.style.left = Math.max(0, composerRect.width - pw) + "px";
      }
    });
  }

  function positionDropdownPopover(popover, btn) {
    const parentRect = popover.parentElement.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    popover.style.bottom = "auto";
    popover.style.top = (btnRect.bottom - parentRect.top + 4) + "px";
    popover.style.left = (btnRect.left - parentRect.left) + "px";
    popover.style.right = "auto";
    requestAnimationFrame(() => {
      const pw = popover.getBoundingClientRect().width;
      const leftOffset = btnRect.left - parentRect.left;
      if (leftOffset + pw > parentRect.width) {
        popover.style.left = Math.max(0, parentRect.width - pw) + "px";
      }
    });
  }

  // ---------- gear popover ----------

  function addSection(label) {
    const el = document.createElement("div");
    el.className = "popover-section";
    el.textContent = label;
    gearPopover.appendChild(el);
  }

  function addGearItem(labelHtml, onclick) {
    const el = document.createElement("div");
    el.className = "toolbar-popover-item";
    el.innerHTML = labelHtml;
    el.onclick = (e) => { e.stopPropagation(); onclick(); };
    gearPopover.appendChild(el);
  }

  function renderGearMain() {
    gearPopover.innerHTML = "";

    // ── Model + effort header ─────────────────────────────────────────────
    const modelEffortSection = document.createElement("div");
    modelEffortSection.className = "popover-section popover-section-first";
    modelEffortSection.textContent = "Model and Effort";
    gearPopover.appendChild(modelEffortSection);

    // ── Model + effort row ────────────────────────────────────────────────
    const row = document.createElement("div");
    row.className = "model-effort-row";

    // Model + effort both restart or race the session, so they're locked while
    // a turn is in flight or the session is still priming (the hidden primer) —
    // the same `busy` signal that disables send/submit.
    const settingsLocked = state.busy;

    const nameBtn = document.createElement("button");
    nameBtn.className = "toolbar-btn model-name-btn" + (settingsLocked ? " disabled" : "");
    const modelName = modelDisplayName(state.currentModelId, state.availableModels) || "Grok Build";
    nameBtn.innerHTML = `<span class="btn-label">${escapeHtml(truncate(modelName, 16))}</span>`;
    nameBtn.disabled = settingsLocked;
    nameBtn.title = settingsLocked
      ? `${modelName} — available once the session is ready`
      : `${modelName} — click to change`;
    if (!settingsLocked) nameBtn.onclick = (e) => { e.stopPropagation(); renderModelPicker(); };
    row.appendChild(nameBtn);

    const dotsEl = document.createElement("span");
    dotsEl.className = "effort-dots" + (settingsLocked ? " disabled" : "");
    const currentIdx = EFFORT_LEVELS.indexOf(state.effort);
    EFFORT_LEVELS.forEach((id, i) => {
      const dot = document.createElement("span");
      dot.className = "effort-dot" + (i <= currentIdx ? " active" : "") + (settingsLocked ? " disabled" : "");
      // Render the dot as a CSS-shaped span (see chat.css). Avoids the classic
      // ● vs ○ Unicode size mismatch where the empty glyph is visibly larger.
      dot.title = settingsLocked
        ? "Available once the session is ready"
        : (EFFORT_TOOLTIPS[id] || capitalize(id));
      if (!settingsLocked) dot.onclick = (e) => {
        e.stopPropagation();
        state.effort = state.effort === id ? "" : id;
        vscode.postMessage({ type: "setEffort", level: state.effort });
        renderGearMain();
        gearPopover.hidden = false;
      };
      dotsEl.appendChild(dot);
    });
    row.appendChild(dotsEl);
    gearPopover.appendChild(row);

    // ── Session ───────────────────────────────────────────────────────────
    addSection("Session");
    addGearItem("<span>Compact conversation</span>", () => {
      vscode.postMessage({ type: "send", text: "/compact", chips: [] });
      closePopovers();
    });

    // ── Config ────────────────────────────────────────────────────────────
    addSection("Config");
    addGearItem('<span>Open global config</span><span class="popover-external">↗</span>', () => {
      vscode.postMessage({ type: "openGlobalConfig" });
      closePopovers();
    });
    addGearItem('<span>Open project config</span><span class="popover-external">↗</span>', () => {
      vscode.postMessage({ type: "openProjectConfig" });
      closePopovers();
    });
    addGearItem('<span>MCP servers</span><span class="popover-external">↗</span>', () => {
      vscode.postMessage({ type: "runMcpList" });
      closePopovers();
    });

    // ── Debug ─────────────────────────────────────────────────────────────
    addSection("Debug");
    addGearItem("<span>Show extension logs</span>", () => {
      vscode.postMessage({ type: "showLogs" });
      closePopovers();
    });
  }

  function renderModelPicker() {
    gearPopover.innerHTML = "";
    addGearItem('<span class="popover-back">← Model</span>', renderGearMain);
    const models = state.availableModels.length
      ? state.availableModels
      : [{ modelId: state.currentModelId || "grok-build", name: state.currentModelId || "grok-build" }];
    for (const m of models) {
      const el = document.createElement("div");
      const active = m.modelId === state.currentModelId;
      el.className = "toolbar-popover-item" + (active ? " active" : "");
      el.innerHTML = `<span>${escapeHtml(truncate(m.name || m.modelId, 28))}</span>${active ? '<span class="popover-check">✓</span>' : ""}`;
      el.title = m.modelId;
      el.onclick = (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: "setModel", modelId: m.modelId });
        closePopovers();
      };
      gearPopover.appendChild(el);
    }
  }

  function openGearPopover() {
    if (!gearPopover.hidden) { closePopovers(); return; }
    closePopovers();
    renderGearMain();
    positionPopover(gearPopover, gearBtn);
    gearPopover.hidden = false;
  }

  function openModePopover() {
    if (!modePopover.hidden) { closePopovers(); return; }
    modePopover.innerHTML = "";
    for (const [id, meta] of Object.entries(MODE_META)) {
      const el = document.createElement("div");
      const active = id === state.currentModeId;
      el.className = "toolbar-popover-item mode-popover-item" +
        (active ? " active" : "") +
        (meta.disabled ? " disabled" : "");
      el.innerHTML =
        `<span class="mode-item-icon">${meta.icon}</span>` +
        `<span class="mode-item-body">` +
          `<span class="mode-item-label">${escapeHtml(meta.label)}</span>` +
          `<span class="mode-item-desc">${escapeHtml(meta.desc)}</span>` +
          (meta.disabledNote ? `<span class="mode-item-disabled-note">${escapeHtml(meta.disabledNote)}</span>` : "") +
        `</span>` +
        (active ? '<span class="popover-check">✓</span>' : "");
      el.onclick = (e) => {
        e.stopPropagation();
        if (meta.disabled) return;
        vscode.postMessage({ type: "setMode", modeId: id });
        closePopovers();
      };
      modePopover.appendChild(el);
    }
    positionPopover(modePopover, modeBtn);
    modePopover.hidden = false;
  }

  function openAddPopover() {
    if (!addPopover.hidden) { closePopovers(); return; }
    closePopovers();
    addPopover.innerHTML = "";
    const item = document.createElement("div");
    item.className = "toolbar-popover-item";
    item.innerHTML = `<span class="add-item-icon">${ICON.upload}</span><span>Upload from computer</span>`;
    item.onclick = (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: "pickFile" });
      closePopovers();
    };
    addPopover.appendChild(item);
    positionPopover(addPopover, addBtn);
    addPopover.hidden = false;
  }

  function renderHistoryList() {
    historyPopover.innerHTML = "";

    const searchWrap = document.createElement("div");
    searchWrap.className = "history-search-wrap";
    const search = document.createElement("input");
    search.type = "text";
    search.className = "history-search";
    search.placeholder = "Search sessions…";
    search.value = state.sessionSearch;
    search.oninput = () => {
      state.sessionSearch = search.value;
      renderSessionRows();
    };
    search.onkeydown = (e) => { e.stopPropagation(); };
    search.onclick = (e) => e.stopPropagation();
    searchWrap.appendChild(search);
    historyPopover.appendChild(searchWrap);

    const list = document.createElement("div");
    list.className = "history-list";
    historyPopover.appendChild(list);

    function renderSessionRows() {
      list.innerHTML = "";
      const q = state.sessionSearch.trim().toLowerCase();
      const filtered = state.sessions.filter((s) => {
        if (!q) return true;
        return (s.displayName || "").toLowerCase().includes(q);
      });
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = state.sessions.length === 0 ? "No sessions yet." : "No matches.";
        list.appendChild(empty);
        return;
      }
      for (const s of filtered) {
        list.appendChild(renderSessionRow(s));
      }
    }

    function renderSessionRow(s) {
      const row = document.createElement("div");
      const active = s.id === state.activeSessionId;
      row.className = "history-row" + (active ? " active" : "");

      const main = document.createElement("div");
      main.className = "history-row-main";

      if (state.renamingSessionId === s.id) {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "history-rename";
        inp.value = s.displayName;
        inp.onclick = (e) => e.stopPropagation();
        inp.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            vscode.postMessage({ type: "renameSession", id: s.id, name: inp.value });
            state.renamingSessionId = null;
          } else if (e.key === "Escape") {
            state.renamingSessionId = null;
            renderSessionRows();
          }
        };
        inp.onblur = () => {
          if (state.renamingSessionId === s.id) {
            vscode.postMessage({ type: "renameSession", id: s.id, name: inp.value });
            state.renamingSessionId = null;
          }
        };
        main.appendChild(inp);
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
      } else {
        const name = document.createElement("div");
        name.className = "history-row-name";
        name.textContent = s.displayName || "Untitled";
        name.title = s.rawSummary || s.displayName || "";
        main.appendChild(name);

        const meta = document.createElement("div");
        meta.className = "history-row-meta";
        const parts = [];
        if (s.numMessages) parts.push(`${s.numMessages} msg`);
        parts.push(formatRelativeTime(s.updatedAt));
        meta.textContent = parts.join(" · ");
        main.appendChild(meta);

        // Whole row is the click target; the rename/delete buttons below
        // stopPropagation so they don't also trigger a resume.
        row.onclick = () => {
          if (active) { closePopovers(); return; }
          vscode.postMessage({ type: "resumeSession", id: s.id });
          closePopovers();
        };
      }

      row.appendChild(main);

      const actions = document.createElement("div");
      actions.className = "history-row-actions";
      const renameBtn = document.createElement("button");
      renameBtn.className = "history-action-btn";
      renameBtn.innerHTML = ICON.pencil;
      renameBtn.title = "Rename";
      renameBtn.onclick = (e) => {
        e.stopPropagation();
        state.renamingSessionId = s.id;
        renderSessionRows();
      };
      actions.appendChild(renameBtn);
      // No delete for the active session: it's the live conversation and the CLI
      // re-persists it, so a delete wouldn't stick. Rename is still fine.
      if (!active) {
        const delBtn = document.createElement("button");
        delBtn.className = "history-action-btn history-action-danger";
        delBtn.innerHTML = ICON.trash;
        delBtn.title = "Delete";
        delBtn.onclick = (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "deleteSession", id: s.id, name: s.displayName });
        };
        actions.appendChild(delBtn);
      }
      row.appendChild(actions);

      return row;
    }

    renderSessionRows();
  }

  function openHistoryPopover() {
    if (!historyPopover.hidden) { closePopovers(); return; }
    closePopovers();
    state.sessionSearch = "";
    state.renamingSessionId = null;
    renderHistoryList();
    positionDropdownPopover(historyPopover, historyBtn);
    historyPopover.hidden = false;
    vscode.postMessage({ type: "listSessions" });
  }

  // ---------- messages ----------

  function clearWelcome() {
    if (!state.welcomeVisible) return;
    const welcome = $("welcome");
    if (welcome) welcome.hidden = true;
    state.welcomeVisible = false;
  }

  function resetForNewSession() {
    for (const child of Array.from(messagesEl.children)) {
      if (child.id !== "welcome") child.remove();
    }
    const welcome = $("welcome");
    if (welcome) {
      welcome.hidden = false;
      const onb = $("welcome-onboarding");
      if (onb) onb.innerHTML = "";
      const ver = $("welcome-version");
      if (ver) ver.textContent = "starting...";
    }
    state.welcomeVisible = true;
    state.pendingDiffByToolCallId.clear();
    state.toolItemsByToolCallId.clear();
    state.activeAgentEl = null;
    state.activeAgentRaw = "";
    state.activeUserEl = null;
    state.activeUserRaw = "";
    state.activeThoughtEl = null;
    state.activeThoughtHdrEl = null;
    state.thoughtBuffer = "";
    state.activeToolGroupEl = null;
    state.replaying = false;
    state.planHistoryQueue = [];
    state.userMsgCount = 0;
    state.suppressReplayTurn = false;
    state.skipUserBubble = false;
    hidePlanProcessing();
  }

  function showOnboarding(mode, info) {
    info = info || {};
    const welcome = $("welcome");
    if (welcome) welcome.hidden = false;
    state.welcomeVisible = true;
    const onb = $("welcome-onboarding");
    const ver = $("welcome-version");
    if (!onb) return;
    if (mode === "missing-cli") {
      if (ver) ver.textContent = "CLI not installed";
      const installCmd = info.platform === "win32"
        ? "irm https://x.ai/cli/install.ps1 | iex"
        : "curl -fsSL https://x.ai/cli/install.sh | bash";
      onb.innerHTML =
        `<div class="onb">` +
          `<p class="onb-heading">Install the Grok CLI</p>` +
          `<div class="onb-cmd">` +
            `<code>${installCmd}</code>` +
            `<button class="onb-copy" type="button" title="Copy" data-cmd="${installCmd}">${ICON.copy}</button>` +
          `</div>` +
          `<button class="onb-action" type="button" data-act="runInstall">Open terminal &amp; run</button>` +
          `<button class="onb-action onb-secondary" type="button" data-act="recheck">Re-check connection</button>` +
        `</div>`;
    } else if (mode === "auth-required") {
      if (ver) ver.textContent = "Authentication required";
      onb.innerHTML =
        `<div class="onb">` +
          `<p class="onb-heading">Sign in to continue</p>` +
          `<p class="onb-desc"><strong>SuperGrok Heavy subscription</strong> &mdash; required for the <em>Grok Build</em> entitlement.</p>` +
          `<button class="onb-action" type="button" data-act="runLogin">Open terminal &amp; run <code>grok /login</code></button>` +
          `<p class="onb-or">or</p>` +
          `<p class="onb-desc"><strong>API key</strong> &mdash; pay per token; unlocks additional models (grok-4.20, grok-4.3, grok-imagine). Get a key at <a href="https://console.x.ai" class="onb-link">console.x.ai</a>, then add to your shell or a workspace <code>.env</code>:</p>` +
          `<div class="onb-cmd">` +
            `<code>XAI_API_KEY=your-key-here</code>` +
            `<button class="onb-copy" type="button" title="Copy" data-cmd="XAI_API_KEY=">${ICON.copy}</button>` +
          `</div>` +
          `<button class="onb-action onb-secondary" type="button" data-act="recheck">Re-check connection</button>` +
        `</div>`;
    } else {
      onb.innerHTML = "";
    }
  }

  function makeCollapsible(el, container) {
    el.classList.add("collapsible");
    const expandBtn = document.createElement("button");
    expandBtn.className = "msg-expand-btn";
    expandBtn.textContent = "Show more";
    container.appendChild(expandBtn);
    expandBtn.onclick = () => {
      el.classList.remove("collapsible");
      expandBtn.style.display = "none";
      const collapseBtn = document.createElement("button");
      collapseBtn.className = "msg-collapse-btn";
      collapseBtn.textContent = "Show less";
      container.appendChild(collapseBtn);
      collapseBtn.onclick = () => {
        el.classList.add("collapsible");
        expandBtn.style.display = "";
        collapseBtn.remove();
      };
    };
  }

  function addMessage(role, text, chips) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el._copyText = text || "";

    let contentParent = el;
    if (role === "user") {
      const bubble = document.createElement("div");
      bubble.className = "msg-bubble";
      el.appendChild(bubble);
      contentParent = bubble;
    }

    const body = document.createElement("div");
    body.className = "body";
    if (text) body.innerHTML = renderMarkdown(text);
    contentParent.appendChild(body);

    if (role === "user" && chips && chips.length > 0) {
      const chipsRow = document.createElement("div");
      chipsRow.className = "msg-chips";
      for (const chip of chips) {
        const tag = document.createElement("span");
        tag.className = "msg-chip";
        const fileName = chip.relPath.split("/").pop() || chip.relPath;
        tag.innerHTML = ICON.file + `<span>${escapeHtml(truncate(fileName, 20))}</span>`;
        tag.title = chip.relPath;
        chipsRow.appendChild(tag);
      }
      contentParent.appendChild(chipsRow);
    }

    if (role === "user" || role === "agent") {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      const copyBtn = document.createElement("button");
      copyBtn.className = "msg-action-btn msg-copy-btn";
      copyBtn.type = "button";
      copyBtn.title = "Copy message";
      copyBtn.innerHTML = `<span class="msg-action-glyph">${ICON.copy}</span>`;
      const ts = document.createElement("span");
      ts.className = "msg-timestamp";
      ts.textContent = formatTime(Date.now());
      actions.appendChild(copyBtn);
      actions.appendChild(ts);
      el.appendChild(actions);
    }

    messagesEl.appendChild(el);
    scrollToBottom();
    if (role === "user" && text) {
      requestAnimationFrame(() => {
        if (body.scrollHeight > 56) makeCollapsible(el, contentParent);
      });
    }
    return body;
  }

  const TOOL_VERB = {
    read_file: "Read", file_read: "Read",
    write_file: "Write", file_write: "Write", write: "Write",
    bash: "Run", execute: "Run", run_command: "Run", run_terminal_command: "Run",
    shell: "Run", run_bash: "Run",
    list_dir: "List", list_directory: "List",
    search_files: "Search", grep: "Search", ripgrep: "Search",
    search_replace: "Edit", edit_file: "Edit", str_replace: "Edit",
    web_search: "Web search", search_web: "Web search",
    web_fetch: "Fetch", webfetch: "Fetch",
  };

  function toolName(call) {
    return call.tool || call.name || call.title || "";
  }
  function toolFilePath(call) {
    const r = call.rawInput || call.input || {};
    return r.target_file || r.filePath || r.file_path || r.path ||
      (Array.isArray(r.paths) ? r.paths[0] : "");
  }
  function prettyPath(p) {
    if (!p) return "";
    if (p === "." || p === "./") return "root folder";
    return p.split("/").pop() || p;
  }
  function categorize(call) {
    const n = toolName(call);
    if (call.kind === "read" || /^(read_file|file_read|list_dir|list_directory)$/.test(n)) return "explore";
    if (/^(web_search|search_web|web_fetch|webfetch)$/.test(n)) return "web";
    return "other";
  }
  function summarizeTools(calls) {
    let explore = 0, web = 0, other = 0;
    for (const c of calls) {
      const cat = categorize(c);
      if (cat === "explore") explore++;
      else if (cat === "web") web++;
      else other++;
    }
    const parts = [];
    if (explore) parts.push(`Explored ${explore} item${explore === 1 ? "" : "s"}`);
    if (web) parts.push("searched web");
    if (other) parts.push(`ran ${other} command${other === 1 ? "" : "s"}`);
    return parts.length ? parts.join(", ").replace(/^./, (c) => c.toUpperCase()) : "Tool calls";
  }

  function inProgressLabel(call) {
    const name = toolName(call);
    const filePath = toolFilePath(call);
    if (/^(list_dir|list_directory)$/.test(name)) {
      return filePath ? `Listing ${prettyPath(filePath)}` : "Listing files";
    }
    if (/^(read_file|file_read)$/.test(name) || call.kind === "read") {
      return filePath ? `Reading ${prettyPath(filePath)}` : "Reading file";
    }
    if (/^(web_search|search_web)$/.test(name)) return "Searching web";
    if (/^(web_fetch|webfetch)$/.test(name)) return "Fetching page";
    if (/^(grep|ripgrep|search_files)$/.test(name)) return "Searching code";
    if (/^(write_file|file_write|write|edit_file|search_replace|str_replace)$/.test(name) || call.kind === "edit") {
      return filePath ? `Editing ${prettyPath(filePath)}` : "Editing file";
    }
    if (/^(bash|execute|run_command|run_terminal_command|shell|run_bash)$/.test(name) || call.kind === "execute") {
      return "Running command";
    }
    return name ? `Running ${name}` : "Running tool";
  }

  function toolLabel(call) {
    const name = toolName(call);
    const verb = TOOL_VERB[name] ||
      (call.kind === "read" ? "Read" : call.kind === "edit" ? "Edit" :
       call.kind === "execute" ? "Run" : null);
    const r = call.rawInput || call.input || {};
    const filePath = toolFilePath(call);
    const command = r.command || r.cmd;

    let target = "";
    if (filePath) {
      const base = prettyPath(filePath);
      const isRead = name === "read_file" || name === "file_read";
      if (isRead && r.offset != null && r.limit != null) {
        const end = Number(r.offset) + Number(r.limit) - 1;
        target = `${base} lines ${r.offset}-${end}`;
      } else {
        target = base;
      }
    } else if (command) {
      target = command.length > 40 ? command.slice(0, 40) + "…" : command;
    } else {
      const fallback = Object.values(r).find(
        (v) => typeof v === "string" && v.length > 0 && v.length < 120
      ) || "";
      target = fallback ? fallback.split("/").pop() || fallback : "";
    }

    if (verb && target) return `${verb} ${target}`;
    if (verb) return verb;
    return name || "tool";
  }

  function closeToolGroup() {
    if (!state.activeToolGroupEl) return;
    const el = state.activeToolGroupEl;
    const calls = el._calls || [];

    if (calls.length === 1) {
      const flat = document.createElement("div");
      flat.className = "tool-flat";
      flat.textContent = toolLabel(calls[0]);
      el.replaceWith(flat);
    } else {
      el.classList.remove("in-progress");
      const hdr = el.querySelector(".tool-group-header");
      hdr.querySelector(".tool-group-label").textContent = summarizeTools(calls);
    }
    state.activeToolGroupEl = null;
  }

  function addToToolGroup(call) {
    clearWelcome();
    if (!state.activeToolGroupEl) {
      const el = document.createElement("div");
      el.className = "tool-group in-progress";
      el._calls = [];
      const hdr = document.createElement("div");
      hdr.className = "tool-group-header";
      const body = document.createElement("div");
      body.className = "tool-group-body";
      body.hidden = true;
      el.appendChild(hdr);
      el.appendChild(body);
      messagesEl.appendChild(el);
      state.activeToolGroupEl = el;
    }

    const el = state.activeToolGroupEl;
    el._calls.push(call);
    const hdr = el.querySelector(".tool-group-header");
    const body = el.querySelector(".tool-group-body");

    const item = document.createElement("div");
    item.className = "tool-item";
    item.textContent = toolLabel(call);
    body.appendChild(item);
    if (call.toolCallId) state.toolItemsByToolCallId.set(call.toolCallId, item);

    hdr.innerHTML =
      `<span class="tool-group-label">${escapeHtml(inProgressLabel(call))}</span>` +
      `<span class="tool-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>` +
      `<span class="tool-chevron" aria-hidden="true">›</span>`;
    hdr.onclick = () => {
      const expanded = !body.hidden;
      body.hidden = expanded;
      el.classList.toggle("expanded", !expanded);
    };
    scrollToBottom();
  }

  function attachDiffPreviewToToolItem(toolCallId, diff) {
    const item = state.toolItemsByToolCallId.get(toolCallId);
    if (!item || item.querySelector(".preview-link")) return; // already attached
    const oldLines = (diff.oldText || "").split("\n").length;
    const newLines = (diff.newText || "").split("\n").length;
    const sub = document.createElement("div");
    sub.className = "tool-item-subtitle";
    sub.textContent = `${oldLines} → ${newLines} lines`;
    item.appendChild(sub);
    const preview = document.createElement("button");
    preview.className = "preview-link";
    preview.textContent = "open diff preview →";
    preview.onclick = (e) => {
      e.stopPropagation(); // don't toggle the tool-group expand/collapse
      vscode.postMessage({
        type: "openDiff",
        path: diff.path,
        oldText: diff.oldText,
        newText: diff.newText,
      });
    };
    item.appendChild(preview);
    scrollToBottom();
  }

  function addSessionContextBanner() {
    clearWelcome();
    const existing = document.getElementById("summarizing-indicator");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "session-context-banner";
    el.textContent = "Context from previous session applied";
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function addError(text) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = "msg error";
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function addPlanNotice(text) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = "plan-notice";
    el.innerHTML = `${ICON.listTree}<span>${escapeHtml(text)}</span>`;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function appendThought(text) {
    if (state.suppressReplayTurn) return; // thinking inside the primer turn
    hidePlanProcessing(); // thought streaming → indicator obsolete
    state.activeUserEl = null;
    state.skipUserBubble = false; // marker-only verdict turn is over
    clearWelcome();
    if (!state.activeThoughtEl) {
      if (!state.thoughtStartTime) state.thoughtStartTime = Date.now();
      state.thoughtBuffer = "";
      const el = document.createElement("div");
      el.className = "msg thinking";
      const hdr = document.createElement("div");
      hdr.className = "thinking-header";
      hdr.innerHTML = `<span class="thinking-chevron">▶</span><span class="thinking-label">Thinking...</span>`;
      const body = document.createElement("div");
      body.className = "thinking-body";
      body.hidden = true;
      hdr.onclick = () => {
        const open = body.hidden;
        body.hidden = !open;
        hdr.querySelector(".thinking-chevron").textContent = open ? "▼" : "▶";
      };
      el.appendChild(hdr);
      el.appendChild(body);
      messagesEl.appendChild(el);
      state.activeThoughtEl = body;
      state.activeThoughtHdrEl = hdr;
    }
    state.thoughtBuffer += text;
    if (!state.thoughtRenderScheduled) {
      state.thoughtRenderScheduled = true;
      requestAnimationFrame(flushThought);
    }
  }

  function flushThought() {
    state.thoughtRenderScheduled = false;
    if (!state.activeThoughtEl) return;
    state.activeThoughtEl.textContent = state.thoughtBuffer;
    scrollToBottom();
  }

  function appendAgent(text) {
    if (state.suppressReplayTurn) return; // grok's response to the primer
    hidePlanProcessing(); // agent output started — clear the indicator
    state.activeUserEl = null;
    state.skipUserBubble = false; // marker-only verdict turn is over
    closeToolGroup();
    clearWelcome();
    if (!state.activeAgentEl) {
      state.activeAgentEl = addMessage("agent", "");
      state.activeAgentRaw = "";
    }
    state.activeAgentRaw += text;
    if (!state.agentRenderScheduled) {
      state.agentRenderScheduled = true;
      requestAnimationFrame(flushAgent);
    }
  }

  function flushAgent() {
    state.agentRenderScheduled = false;
    if (!state.activeAgentEl) return;
    state.activeAgentEl.innerHTML = renderMarkdown(state.activeAgentRaw);
    const wrapper = state.activeAgentEl.parentElement;
    if (wrapper) wrapper._copyText = state.activeAgentRaw;
    scrollToBottom();
  }

  // Finalize the current agent turn (flush buffers, stamp the "Thought for Ns"
  // label, close any open tool group) and clear the active-element handles so
  // the next chunk starts a fresh bubble. Used on promptComplete and at the
  // user-message boundary while replaying a loaded session.
  function commitAgentTurn() {
    flushAgent();
    flushThought();
    if (state.thoughtStartTime && state.activeThoughtHdrEl) {
      const label = state.activeThoughtHdrEl.querySelector(".thinking-label");
      // Replayed turns have no real elapsed time, so drop the seconds.
      if (label) label.textContent = state.replaying
        ? "Thought"
        : `Thought for ${Math.round((Date.now() - state.thoughtStartTime) / 1000)}s`;
      state.thoughtStartTime = null;
    }
    closeToolGroup();
    state.activeAgentEl = null;
    state.activeAgentRaw = "";
    state.activeThoughtEl = null;
    state.activeThoughtHdrEl = null;
  }

  // Replayed user prompts (session/load) arrive as user_message_chunk updates.
  // Commit any in-flight agent turn first, then accumulate into one user bubble.
  function appendUserChunk(text) {
    if (state.activeAgentEl || state.activeThoughtEl || state.activeToolGroupEl) {
      commitAgentTurn();
    }
    clearWelcome();
    if (!state.activeUserEl && !state.skipUserBubble) {
      // A new user message is starting. If we're replaying and this message is
      // the extension's primer, suppress it AND grok's response to it — both
      // are extension plumbing the user never typed, and we don't want them
      // surfacing as fake user bubbles on every session restore.
      if (state.replaying && PRIMER_PATTERN.test(text)) {
        state.suppressReplayTurn = true;
        return;
      }
      state.suppressReplayTurn = false;
      // Drain saved plan cards that should appear BEFORE this user message — the
      // verdict message that resolved a plan is the boundary, so drain first even
      // for a marker-only verdict that itself renders no bubble.
      drainPlanHistory(state.userMsgCount);
      if (state.replaying) {
        const mk = stripPlanMarker(text);
        if (mk.matched) {
          // A plan-verdict protocol message. Live never counted or showed a
          // marker-only verdict (e.g. plain "[Plan cancelled]"), so skip it here
          // too — both to hide the grok-only marker and to keep userMsgCount
          // aligned with the afterUserMessage positions the host persisted.
          if (!mk.rest.trim()) {
            state.skipUserBubble = true;
            return;
          }
          // Marker + comment: drop the marker, keep the user's words. Live
          // counted this (the comment), so we count it here too.
          text = mk.rest;
        }
      }
      state.userMsgCount += 1;
      state.activeUserEl = addMessage("user", "");
      state.activeUserRaw = "";
    }
    if (state.skipUserBubble) return; // marker-only verdict: no user bubble
    if (state.suppressReplayTurn) return; // still inside the primer's user message
    state.activeUserRaw += text;
    state.activeUserEl.innerHTML = renderMarkdown(state.activeUserRaw);
    scrollToBottom();
  }

  // Render and dequeue every saved plan whose `afterUserMessage` <= cutoff.
  // Plans without a saved position never drain here — they fall out at the end
  // of replay when we flush the rest of the queue.
  function drainPlanHistory(cutoff) {
    if (!state.planHistoryQueue.length) return;
    state.planHistoryQueue = state.planHistoryQueue.filter((p) => {
      if (typeof p.afterUserMessage === "number" && p.afterUserMessage <= cutoff) {
        addPlanHistoryCard(p.text, p.verdict, p.planPath, p.planName);
        return false;
      }
      return true;
    });
  }

  function flushPlanHistory() {
    if (!state.planHistoryQueue.length) return;
    for (const p of state.planHistoryQueue) addPlanHistoryCard(p.text, p.verdict, p.planPath, p.planName);
    state.planHistoryQueue = [];
  }

  function showPlanProcessing() {
    hidePlanProcessing(); // dedupe
    clearWelcome();
    const el = document.createElement("div");
    el.className = "plan-processing";
    el.innerHTML = '<span class="plan-processing-dots"><span></span><span></span><span></span></span>';
    el.setAttribute("aria-label", "Grok is processing");
    messagesEl.appendChild(el);
    state.planProcessingEl = el;
    scrollToBottom();
  }

  function hidePlanProcessing() {
    if (state.planProcessingEl && state.planProcessingEl.parentElement) {
      state.planProcessingEl.parentElement.removeChild(state.planProcessingEl);
    }
    state.planProcessingEl = null;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------- permission card ----------

  function addPermissionCard(req) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = "card permission";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = req.toolCall?.title || `permission: ${req.toolCall?.kind || "tool"}`;
    el.appendChild(title);

    const diff = state.pendingDiffByToolCallId.get(req.toolCall?.toolCallId);
    if (diff) {
      const subtitle = document.createElement("div");
      subtitle.className = "card-subtitle";
      const oldLines = (diff.oldText || "").split("\n").length;
      const newLines = (diff.newText || "").split("\n").length;
      subtitle.textContent = `${diff.path} — ${oldLines} → ${newLines} lines`;
      el.appendChild(subtitle);

      const preview = document.createElement("button");
      preview.className = "preview-link";
      preview.textContent = "open diff preview →";
      preview.onclick = () =>
        vscode.postMessage({
          type: "openDiff",
          path: diff.path,
          oldText: diff.oldText,
          newText: diff.newText,
        });
      el.appendChild(preview);
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";
    for (const opt of req.options || []) {
      const btn = document.createElement("button");
      btn.textContent = opt.name;
      if (opt.kind === "allow_once") btn.classList.add("primary");
      if (opt.kind === "reject_once") btn.classList.add("danger");
      btn.onclick = () => {
        vscode.postMessage({
          type: "permissionAnswer",
          requestId: req.id,
          optionId: opt.optionId,
        });
        el.classList.add("resolved");
        for (const b of actions.querySelectorAll("button")) b.disabled = true;
        const chosen = document.createElement("div");
        chosen.className = "card-subtitle";
        chosen.textContent = `you chose: ${opt.name}`;
        el.appendChild(chosen);
      };
      actions.appendChild(btn);
    }
    el.appendChild(actions);
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  // ---------- question card (ask_user_question) ----------

  // A "Grok is asking" label + the question text, prominent. Shared by the live
  // and restored cards so they look identical.
  function buildQuestionHead(el, headingText) {
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = headingText;
    el.appendChild(title);
    return title;
  }

  // The green "✓ <labels>" line shown once a question is answered (or "(skipped)").
  function answerLineEl(labels) {
    const ans = document.createElement("div");
    ans.className = "question-answer";
    ans.textContent = labels ? "✓ " + labels : "(skipped)";
    return ans;
  }

  // Inline card for grok's x.ai/ask_user_question. Renders each question with
  // its options; single-select with one question resolves on click (like the
  // permission card), otherwise the user picks across questions and submits.
  // The host replies with { outcome: "accepted", answers } — keyed by question
  // text — which unblocks grok's tool mid-turn. On answer the card COLLAPSES to
  // the question + a clear green "✓ <chosen>" so it's obvious grok received it
  // (the bare grey-out gave no such signal).
  function addQuestionCard(req) {
    clearWelcome();
    const questions = Array.isArray(req.questions) ? req.questions : [];
    const el = document.createElement("div");
    el.className = "card question";

    const title = buildQuestionHead(el, "Grok is asking");

    // selections[i] = array of chosen labels for question i.
    const selections = questions.map(() => []);
    const oneClick = questions.length === 1 && !questions[0].multiSelect;

    let submitBtn;
    let skip;
    // Collapse the card to its answered/skipped representation: drop the option
    // buttons + Submit + Skip, retitle, and append the chosen answer per block.
    const collapse = (skipped) => {
      el.classList.add("resolved");
      title.textContent = skipped ? "Skipped" : "You answered";
      const actions = el.querySelector(".card-actions");
      if (actions) actions.remove();
      if (skip) skip.remove();
      [...el.querySelectorAll(".question-block")].forEach((block, qi) => {
        const opts = block.querySelector(".question-options");
        if (opts) opts.remove();
        block.appendChild(answerLineEl(skipped ? "" : (selections[qi] || []).join(", ")));
      });
    };
    const submit = () => {
      const { answers } = buildQuestionAnswers(questions, selections);
      vscode.postMessage({ type: "questionAnswer", requestId: req.id, answers, annotations: {} });
      collapse(false);
    };

    questions.forEach((q, qi) => {
      const block = document.createElement("div");
      block.className = "question-block";
      const qText = document.createElement("div");
      qText.className = "question-text";
      qText.textContent = questionText(q);
      block.appendChild(qText);

      const opts = document.createElement("div");
      opts.className = "question-options";
      for (const opt of q.options || []) {
        const btn = document.createElement("button");
        btn.className = "question-option";
        const lbl = document.createElement("span");
        lbl.className = "question-option-label";
        lbl.textContent = opt.label || "";
        btn.appendChild(lbl);
        if (opt.description) {
          const desc = document.createElement("span");
          desc.className = "question-option-desc";
          desc.textContent = opt.description;
          btn.appendChild(desc);
        }
        btn.onclick = () => {
          if (oneClick) {
            selections[qi] = [opt.label];
            submit();
            return;
          }
          if (q.multiSelect) {
            const i = selections[qi].indexOf(opt.label);
            if (i >= 0) { selections[qi].splice(i, 1); btn.classList.remove("selected"); }
            else { selections[qi].push(opt.label); btn.classList.add("selected"); }
          } else {
            selections[qi] = [opt.label];
            for (const sib of opts.querySelectorAll(".question-option")) sib.classList.remove("selected");
            btn.classList.add("selected");
          }
          if (submitBtn) {
            submitBtn.disabled = !buildQuestionAnswers(questions, selections).allAnswered;
          }
        };
        opts.appendChild(btn);
      }
      block.appendChild(opts);
      el.appendChild(block);
    });

    if (!oneClick) {
      const actions = document.createElement("div");
      actions.className = "card-actions";
      submitBtn = document.createElement("button");
      submitBtn.className = "primary";
      submitBtn.textContent = "Submit";
      submitBtn.disabled = true;
      submitBtn.onclick = submit;
      actions.appendChild(submitBtn);
      el.appendChild(actions);
    }

    skip = document.createElement("button");
    skip.className = "question-skip";
    skip.textContent = "Skip";
    skip.onclick = () => {
      vscode.postMessage({ type: "questionCancel", requestId: req.id });
      collapse(true);
    };
    el.appendChild(skip);

    messagesEl.appendChild(el);
    scrollToBottom();
  }

  // Extract the text payload from a tool_call_update's content array
  // (`[{ type:"content", content:{ type:"text", text } }]`, with a flatter
  // `{ text }` fallback).
  function toolUpdateText(call) {
    const c = call && call.content;
    if (Array.isArray(c)) {
      for (const item of c) {
        const t = (item && item.content && item.content.text) ?? (item && item.text);
        if (typeof t === "string") return t;
      }
    }
    return "";
  }

  // The ask_user_question tool is named differently per agent (grok-build:
  // `ask_user_question`, cursor/composer: `AskQuestion`), and on session REPLAY
  // grok relabels the tool_call's title to the display form "Ask: <question>".
  // So we detect by title OR by the presence of `rawInput.questions`.
  function isQuestionToolTitle(title) {
    const t = String(title || "").replace(/[_\s]/g, "").toLowerCase();
    return t === "askuserquestion" || t === "askquestion";
  }
  // Pull the question list from a (possibly replayed) ask tool_call. Falls back to
  // synthesizing one question from an "Ask: <question>" display title when the
  // structured rawInput.questions didn't survive the replay.
  function questionsFromCall(call) {
    const q = call && call.rawInput && call.rawInput.questions;
    if (Array.isArray(q) && q.length) return q;
    const title = String((call && call.title) || "");
    if (/^ask[:\s]/i.test(title)) return [{ question: title.replace(/^ask[:\s]+/i, "").trim() }];
    return null;
  }
  function isQuestionTool(call) {
    return isQuestionToolTitle(call && call.title) || questionsFromCall(call) != null;
  }

  // A question's display text (grok-build uses `question`, cursor uses `prompt`).
  function questionText(q) {
    return (q && (q.question || q.prompt)) || "";
  }

  // Resolve the chosen labels per question from grok's replayed tool result.
  // Two formats exist (the agents differ):
  //   grok-build: `User has answered your questions: "<question>"="<labels>", …`
  //   cursor:     `User questions responses:\nQuestion <qid>: Selected option(s) <oid>, <oid>`
  // Returns an array of label strings parallel to `questions` (empty = unmatched).
  function restoredLabelsByQuestion(questions, answerText) {
    const text = String(answerText || "");
    const out = questions.map(() => "");
    let m, matched = false;
    // Format A — quoted "question"="labels".
    const reA = /"([^"]+)"\s*=\s*"([^"]*)"/g;
    while ((m = reA.exec(text))) {
      const qi = questions.findIndex((q) => questionText(q) === m[1]);
      if (qi >= 0) { out[qi] = m[2]; matched = true; }
    }
    if (matched) return out;
    // Format B — option ids per question id; map ids back to labels.
    const reB = /Question\s+([^\s:]+)\s*:\s*Selected option\(s\)\s*([^\n]*)/gi;
    while ((m = reB.exec(text))) {
      const qid = m[1].trim();
      const qi = questions.findIndex((q) => String(q && q.id) === qid);
      if (qi < 0) continue;
      const opts = questions[qi].options || [];
      out[qi] = m[2].split(",").map((s) => s.trim()).filter(Boolean).map((id) => {
        const o = opts.find((x) => String(x && x.id) === id || (x && x.label) === id);
        return o ? o.label : id;
      }).join(", ");
    }
    return out;
  }

  function cleanAnswerText(text) {
    return String(text || "")
      .replace(/^User has answered your questions:\s*/i, "")
      .replace(/^User questions responses:\s*/i, "")
      .replace(/\s*You can now continue.*$/is, "")
      .trim();
  }

  // Read-only "You answered" card rebuilt during session resume. The questions
  // render immediately (they're always on the replayed tool_call); the answer is
  // filled in by `fillRestoredAnswer` when it lands (on the tool_call snapshot or
  // a later update). Handles both the grok-build and cursor/composer schemas.
  // Returns the card element so the update path can fill its answer later.
  function addRestoredQuestionCard(questions, answerText) {
    clearWelcome();
    const qs = Array.isArray(questions) ? questions : [];
    const el = document.createElement("div");
    el.className = "card question resolved";
    el._questions = qs;
    buildQuestionHead(el, "You answered");
    qs.forEach((q) => {
      const block = document.createElement("div");
      block.className = "question-block";
      const qText = document.createElement("div");
      qText.className = "question-text";
      qText.textContent = questionText(q);
      block.appendChild(qText);
      el.appendChild(block);
    });
    messagesEl.appendChild(el);
    if (answerText) fillRestoredAnswer(el, answerText);
    scrollToBottom();
    return el;
  }

  // Append the chosen answer(s) to a restored card once the result text is known.
  // Idempotent — the answer often arrives both on the tool_call and in an update.
  function fillRestoredAnswer(el, answerText) {
    if (!el || el._answered || !answerText) return;
    const qs = el._questions || [];
    const labels = restoredLabelsByQuestion(qs, answerText);
    const anyLabel = labels.some((l) => l);
    if (qs.length && anyLabel) {
      [...el.querySelectorAll(".question-block")].forEach((block, qi) => {
        if (!block.querySelector(".question-answer")) block.appendChild(answerLineEl(labels[qi]));
      });
    } else {
      const clean = cleanAnswerText(answerText);
      if (clean) el.appendChild(answerLineEl(clean));
    }
    el._answered = true;
  }

  // ---------- plan card ----------

  const VERDICT_LABEL = {
    approved: "Approved",
    rejected: "Rejected",
    abandoned: "Cancelled",
  };

  function pathBaseName(p) {
    return String(p || "").split(/[\\/]/).filter(Boolean).pop() || "plan.md";
  }

  function addPlanFileLink(el, planPath, planName) {
    if (!planPath) return;
    const planTools = document.createElement("div");
    planTools.className = "plan-tools";
    const link = document.createElement("a");
    link.className = "file-ref-link plan-file-link";
    link.href = planPath;
    link.title = planPath;
    const code = document.createElement("code");
    code.textContent = planName || pathBaseName(planPath);
    link.appendChild(code);
    planTools.appendChild(link);
    el.appendChild(planTools);
  }

  function addPlanCard(req) {
    clearWelcome();
    // Finalize any in-flight Thinking / agent / tool group so it doesn't sit
    // above the plan card showing "Thinking..." forever. Stamps "Thought for Ns"
    // on the header and closes the tool group.
    commitAgentTurn();
    const el = document.createElement("div");
    el.className = "card plan";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = "Plan ready for review";
    el.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "card-subtitle";
    sub.textContent = "Nothing has been written yet. Approve, reject with feedback, or cancel to leave plan mode.";
    el.appendChild(sub);

    const planText = req.plan || "";
    addPlanFileLink(el, req.planPath, req.planName);

    const body = document.createElement("div");
    body.className = "plan-body";
    body.innerHTML = planText ? renderMarkdown(planText) : "(empty plan)";
    el.appendChild(body);

    const feedback = document.createElement("textarea");
    feedback.className = "plan-feedback";
    feedback.rows = 2;
    feedback.placeholder = "Optional comment — Grok decides what to do with it";
    el.appendChild(feedback);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const mk = (label, cls, verdict, withComment) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.classList.add(cls);
      b.dataset.verdict = verdict;
      b.onclick = () => {
        const comment = withComment ? feedback.value.trim() : "";
        vscode.postMessage({
          type: "exitPlanAnswer",
          requestId: req.id,
          verdict,
          ...(comment ? { comment } : {}),
        });
        el.classList.add("resolved");
        // Collapse to the same clean representation as a restored history card:
        // drop the buttons + comment box and show one colored verdict label.
        // (The comment, if any, lands as its own user bubble below.)
        actions.remove();
        feedback.remove();
        const status = document.createElement("div");
        status.className = "plan-verdict-label plan-verdict-" + verdict;
        status.textContent = VERDICT_LABEL[verdict] ?? "Resolved";
        el.appendChild(status);
      };
      return b;
    };
    actions.appendChild(mk("Approve & implement", "primary", "approved", true));
    actions.appendChild(mk("Reject", "", "rejected", true));
    actions.appendChild(mk("Cancel", "secondary", "abandoned", true));
    el.appendChild(actions);
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  // Read-only plan card for resumed sessions. The original exit_plan_mode request
  // is long gone, so there's nothing to respond to — we just show the plan text
  // grok wrote during that session, recovered from ~/.grok/sessions/.../plan.md,
  // and the verdict the user gave it (persisted in globalState).
  function addPlanHistoryCard(text, verdict, planPath, planName) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = "card plan plan-history";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = "Plan from this session";
    el.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "card-subtitle";
    const verdictLabel = VERDICT_LABEL[verdict];
    sub.textContent = verdictLabel
      ? `Restored from the previous session — you ${verdictLabel.toLowerCase()} this plan.`
      : "Restored from the previous session.";
    el.appendChild(sub);

    addPlanFileLink(el, planPath, planName);

    const body = document.createElement("div");
    body.className = "plan-body";
    body.innerHTML = text ? renderMarkdown(text) : "(empty plan)";
    el.appendChild(body);

    if (verdictLabel) {
      const status = document.createElement("div");
      status.className = "plan-verdict-label plan-verdict-" + verdict;
      status.textContent = verdictLabel;
      el.appendChild(status);
    }

    messagesEl.appendChild(el);
    scrollToBottom();
  }

  // ---------- chips ----------

  function renderChips() {
    chipsEl.innerHTML = "";
    for (const chip of state.chips) {
      const el = document.createElement("div");
      el.className = "chip" + (chip.hidden ? " chip-hidden" : "");
      el.title = chip.path;
      const fileName = (chip.relPath.split("/").pop() || chip.relPath);
      el.innerHTML = (chip.hidden ? ICON.eyeOff : ICON.file) +
        `<span>${truncate(fileName, 10)}</span>`;
      el.onclick = () => vscode.postMessage({ type: "toggleChip", id: chip.id });
      chipsEl.appendChild(el);
    }
  }

  // ---------- donut ----------

  function updateDonut(used) {
    const max = state.contextWindow;
    const pct = Math.min(100, Math.round((used / max) * 100));
    const circumference = 2 * Math.PI * 5;
    const arc = (pct / 100) * circumference;
    donutArc.setAttribute("stroke-dasharray", `${arc} ${circumference}`);
    let color = "var(--vscode-charts-green, #4ec9b0)";
    if (pct > 90) color = "var(--vscode-charts-red, #f48771)";
    else if (pct > 70) color = "var(--vscode-charts-yellow, #d7ba7d)";
    donutArc.setAttribute("stroke", color);
    donutLabel.textContent = `${toK(used)}/${toK(max)}`;
    donutLabel.title = `${used.toLocaleString()} / ${max.toLocaleString()} tokens`;
  }

  // ---------- slash autocomplete ----------

  function updateSlash() {
    const m = (input.value.slice(0, input.selectionStart || 0)).match(/(?:^|\n)\/(\S*)$/);
    if (!m) { slashPopover.hidden = true; state.slashFiltered = []; return; }
    const q = m[1].toLowerCase();
    state.slashFiltered = state.commands.filter((c) => c.name.toLowerCase().startsWith(q));
    if (!state.slashFiltered.length) { slashPopover.hidden = true; return; }
    state.slashActive = 0;
    renderSlash();
    slashPopover.hidden = false;
  }

  function renderSlash() {
    slashPopover.innerHTML = "";
    let activeEl = null;
    state.slashFiltered.forEach((cmd, i) => {
      const el = document.createElement("div");
      el.className = `slash-item${i === state.slashActive ? " active" : ""}`;
      if (i === state.slashActive) activeEl = el;
      const name = document.createElement("div");
      name.className = "slash-name";
      name.textContent = `/${cmd.name}`;
      el.appendChild(name);
      if (cmd.description) {
        const d = document.createElement("div");
        d.className = "slash-desc";
        d.textContent = cmd.description;
        el.appendChild(d);
      }
      el.onclick = () => pickSlash(cmd);
      slashPopover.appendChild(el);
    });
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }

  function pickSlash(cmd) {
    input.value = input.value.replace(/(?:^|\n)\/(\S*)$/, (full) =>
      full.startsWith("\n") ? `\n/${cmd.name} ` : `/${cmd.name} `,
    );
    slashPopover.hidden = true;
    input.focus();
  }

  // ---------- send ----------

  function updateSendButton() {
    // Three states:
    //  - idle (!busy): send icon, enabled, click → send the typed message.
    //  - busy + locked: spinner icon, disabled, no click action. Used for
    //    session-start priming and other flows the user shouldn't interrupt.
    //  - busy + stoppable: stop icon, enabled, click → cancel grok mid-stream.
    //    Used for regular prompts and the verdict afterTurn flow.
    sendBtn.classList.remove("stop", "initializing");
    if (!state.busy) {
      sendBtn.innerHTML = ICON.arrowUp;
      sendBtn.title = "Send";
      sendBtn.disabled = false;
    } else if (state.busyLocked) {
      sendBtn.innerHTML = ICON.spinner;
      sendBtn.title = "Initializing…";
      sendBtn.classList.add("initializing");
      sendBtn.disabled = true;
    } else {
      sendBtn.innerHTML = ICON.square;
      sendBtn.title = "Stop";
      sendBtn.classList.add("stop");
      sendBtn.disabled = false;
    }
  }

  function sendOrStop() {
    if (state.busy) {
      // Stop mode: ask the host to cancel grok's in-flight turn. We do NOT
      // clear state.busy here — that happens when the cancelled turn actually
      // ends (agentEnd / agentError), so the button stays as "Stop" until the
      // CLI confirms.
      vscode.postMessage({ type: "cancel" });
      return;
    }
    const text = input.value.trim();
    if (!text && state.chips.every((c) => c.hidden)) return;
    state.busy = true;
    updateSendButton();
    state.activeAgentEl = null;
    state.activeAgentRaw = "";
    state.activeThoughtEl = null;
    state.activeThoughtHdrEl = null;
    state.thoughtStartTime = null;
    state.activeToolGroupEl = null;
    vscode.postMessage({ type: "send", text, chips: state.chips });
    input.value = "";
    renderInputHighlight();
    slashPopover.hidden = true;
  }

  // ---------- voice input ----------

  // The mic button records in the extension host (webviews can't reach the mic)
  // and transcribes via xAI Speech-to-Text. We optimistically flip to
  // "listening" on click for instant feedback; the host confirms or, on any
  // setup failure (no API key, ffmpeg missing), sends "voiceError" to reset us.
  function renderMic() {
    if (!micBtn) return;
    micBtn.classList.toggle("listening", state.mic === "listening");
    micBtn.classList.toggle("transcribing", state.mic === "transcribing");
    micBtn.classList.toggle("connecting", state.mic === "connecting");
    if (state.mic === "listening") {
      micBtn.innerHTML = ICON.micWaves;
      micBtn.title = "Listening — say 'grok send' to submit, or click to stop";
      micBtn.disabled = false;
    } else if (state.mic === "connecting") {
      micBtn.innerHTML = ICON.spinner;
      micBtn.title = "Starting mic… wait for the waves before speaking";
      micBtn.disabled = false; // clickable to cancel
    } else if (state.mic === "transcribing") {
      micBtn.innerHTML = ICON.spinner;
      micBtn.title = "Transcribing…";
      micBtn.disabled = true;
    } else {
      micBtn.innerHTML = ICON.mic;
      micBtn.title = state.voiceConfigured
        ? "Voice input"
        : "Voice input — click to set up (needs an xAI API key)";
      micBtn.disabled = false;
    }
    // "needs setup" dot only when idle and no key is configured.
    micBtn.classList.toggle("needs-setup", state.mic === "idle" && !state.voiceConfigured);
  }

  function setMic(event) {
    state.mic = nextMicState(state.mic, event);
    renderMic();
  }

  function toggleMic() {
    if (state.mic === "idle") {
      // Skip the optimistic "listening" flash when we know no key is set — the
      // host will pop the setup guidance instead of recording. Still send
      // voiceStart so the host (the authority on the key) makes the call.
      if (state.voiceConfigured) {
        // Remember what's already typed; live partials replace only the tail.
        state.voiceBase = input.value;
        state.voiceLive = false;
        state.voiceQueue = [];
        setMic("start");
      }
      vscode.postMessage({ type: "voiceStart" });
    } else if (state.mic === "listening" || state.mic === "connecting") {
      setMic("stop");
      vscode.postMessage({ type: "voiceStop" });
    }
    // "transcribing": ignore clicks until the transcript or an error arrives.
  }

  // Append a transcript to whatever's typed (batch mode — one-shot result).
  function insertTranscript(text) {
    const t = (text || "").trim();
    if (!t) return;
    const cur = input.value;
    const sep = cur && !/\s$/.test(cur) ? " " : "";
    input.value = cur + sep + t;
    input.focus();
    updateSlash();
    renderInputHighlight();
  }

  // base + live transcript, with a separating space unless base already ends in
  // whitespace (or the tail is empty). Used for streaming partials/final.
  function composeVoiceTail(base, text) {
    const t = text || "";
    if (!base) return t;
    if (!t || /\s$/.test(base)) return base + t;
    return base + " " + t;
  }

  // Mirror the composer text onto the backdrop, wrapping a trailing send command
  // ("grok send") in an accent pill. Call whenever the input value changes.
  function renderInputHighlight() {
    if (!inputHighlight) return;
    const text = input.value;
    const range = trailingSendPhrase(text, state.voiceSendPhrase);
    if (!range) {
      inputHighlight.textContent = "";
    } else {
      const before = text.slice(0, range.index);
      const cmd = text.slice(range.index, range.index + range.length);
      inputHighlight.innerHTML = escapeHtml(before) + '<span class="cmd-token">' + escapeHtml(cmd) + "</span>";
    }
    inputHighlight.scrollTop = input.scrollTop;
    inputHighlight.scrollLeft = input.scrollLeft;
  }

  // Submit a voice-dictated message (continuous "grok send"). Mirrors sendOrStop's
  // send path but takes explicit text (the composer is cleared separately so the
  // mic can keep listening for the next utterance).
  function submitVoiceMessage(text) {
    const t = (text || "").trim();
    if (!t) return;
    state.busy = true;
    updateSendButton();
    state.activeAgentEl = null;
    state.activeAgentRaw = "";
    state.activeThoughtEl = null;
    state.activeThoughtHdrEl = null;
    state.thoughtStartTime = null;
    state.activeToolGroupEl = null;
    vscode.postMessage({ type: "send", text: t, chips: state.chips });
  }

  // Send the next message dictated while Grok was busy (so you can keep talking
  // through Grok's responses without waiting).
  function flushVoiceQueue() {
    if (state.busy || !state.voiceQueue.length) return;
    submitVoiceMessage(state.voiceQueue.shift());
  }

  // ---------- inbound ----------

  window.addEventListener("message", (e) => {
    const msg = e.data;
    switch (msg.type) {
      case "initialState":
        state.useCtrlEnter = msg.useCtrlEnter;
        state.effort = msg.effort || "";
        state.cwd = msg.cwd || "";
        break;
      case "initialized": {
        const ver = msg.info.version ? ` · v${msg.info.version}` : "";
        const verEl = $("welcome-version");
        if (verEl) verEl.textContent = `connected${ver}`;
        const onb = $("welcome-onboarding");
        if (onb) onb.innerHTML = "";
        break;
      }
      case "session": {
        state.currentModelId = msg.currentModelId;
        state.availableModels = msg.models || [];
        const m = state.availableModels.find((x) => x.modelId === msg.currentModelId);
        if (m?.totalContextTokens) state.contextWindow = m.totalContextTokens;
        updateDonut(0);
        break;
      }
      case "modelChanged":
        state.currentModelId = msg.modelId;
        break;
      case "modeChanged":
        state.currentModeId = msg.modeId;
        updateModeBtn(msg.modeId);
        break;
      case "openModePopover":
        openModePopover();
        break;
      case "voiceState":
        // Host confirms a transition (e.g. recording actually started). Only
        // accept the known states; ignore anything unexpected.
        if (msg.status === "listening" || msg.status === "transcribing") {
          state.mic = msg.status;
          renderMic();
        } else if (msg.status === "idle") {
          // Hard reset — the host stopped voice (e.g. session switch). Clear the
          // live flag and any queued messages too, not just the button.
          state.mic = "idle";
          state.voiceLive = false;
          state.voiceQueue = [];
          renderMic();
        }
        break;
      case "voiceConfigured":
        state.voiceConfigured = !!msg.value;
        if (typeof msg.sendPhrase === "string") state.voiceSendPhrase = msg.sendPhrase;
        renderMic();
        renderInputHighlight();
        break;
      case "voicePartial":
        // Live streaming update: replace the tail after the pre-dictation base.
        state.voiceLive = true;
        input.value = composeVoiceTail(state.voiceBase, msg.text || "");
        renderInputHighlight();
        break;
      case "voiceSubmit": {
        // Continuous "grok send": submit now (or queue if Grok is mid-response),
        // clear the composer, and keep the mic listening for the next utterance.
        const t = (msg.text || "").trim();
        state.voiceBase = "";
        state.voiceLive = false;
        input.value = "";
        renderInputHighlight();
        if (t) {
          if (state.busy) state.voiceQueue.push(t);
          else submitVoiceMessage(t);
        }
        break;
      }
      case "voiceTranscript":
        // Final result. Streaming replaces the live tail; batch appends.
        if (state.voiceLive) {
          input.value = composeVoiceTail(state.voiceBase, (msg.text || "").trim());
          input.focus();
          updateSlash();
          renderInputHighlight();
        } else {
          insertTranscript(msg.text);
        }
        state.voiceLive = false;
        setMic("transcript");
        // "grok send" detected: submit hands-free — but only when idle, so it
        // never doubles as a "stop" on an in-flight turn.
        if (msg.send && !state.busy) sendOrStop();
        break;
      case "voiceError":
        // Setup/record/transcribe failed (the host already showed the reason).
        state.voiceLive = false;
        setMic("error");
        break;
      case "chips":
        state.chips = msg.chips;
        renderChips();
        break;
      case "commandsUpdate":
        state.commands = msg.commands || [];
        break;
      case "userMessage":
        // Live send (or immediate verdict-feedback bubble): render and bump the
        // counter so any plan history queued for this position drains first.
        drainPlanHistory(state.userMsgCount);
        state.userMsgCount += 1;
        addMessage("user", msg.text, msg.chips || []);
        // If the indicator is showing and a NEW (live-send) user message comes
        // in, hide it. (When the host posts a userMessage as part of the verdict
        // flow, it then immediately posts planProcessing, which re-shows it
        // after we hide here — the net effect is correct: indicator below.)
        hidePlanProcessing();
        break;
      case "agentStart":
        break;
      case "thoughtChunk":
        appendThought(msg.text);
        break;
      case "messageChunk":
        appendAgent(msg.text);
        break;
      case "userMessageChunk":
        appendUserChunk(msg.text);
        break;
      case "historyReplay":
        if (msg.active) {
          state.replaying = true;
          state.suppressReplayTurn = false; // fresh replay starts unsuppressed
        } else {
          commitAgentTurn(); // finalize the last turn while still flagged as replay
          state.replaying = false;
          state.suppressReplayTurn = false; // replay over → no longer suppressing
          // Anything left in the queue is either legacy (no afterUserMessage)
          // or was resolved after the final user message of the session. Render
          // it now at the bottom so we don't silently drop those plans.
          flushPlanHistory();
        }
        break;
      case "planHistoryQueue":
        // Sent by the host right before replay starts. Drives inline placement
        // of historical plan cards from appendUserChunk / live userMessage.
        state.planHistoryQueue = (msg.plans || []).slice();
        state.userMsgCount = 0;
        break;
      case "planProcessing":
        showPlanProcessing();
        break;
      case "toolCall":
        if (state.suppressReplayTurn) break; // tool calls inside the primer turn (unlikely but defensive)
        if (isQuestionTool(msg.call)) {
          // No generic tool chip — the question card stands in for it.
          if (state.replaying) {
            // Resume: render the read-only card NOW from the tool_call (the
            // questions are always present); the answer rides on this snapshot or
            // arrives in a later update keyed by the same toolCallId.
            const el = addRestoredQuestionCard(questionsFromCall(msg.call) || [], toolUpdateText(msg.call));
            if (msg.call.toolCallId) state.restoredCardsByToolCallId.set(msg.call.toolCallId, el);
          } else {
            // Live: the interactive card comes from `questionRequest`; just stash
            // so the matching update is recognized (and the chip stays suppressed).
            state.questionToolCalls.set(msg.call.toolCallId, { questions: questionsFromCall(msg.call) || [] });
          }
          break;
        }
        addToToolGroup(msg.call);
        break;
      case "toolCallUpdate": {
        if (state.suppressReplayTurn) break;
        // Resume: fill the answer into the matching restored card when it lands.
        const restoredEl = state.restoredCardsByToolCallId.get(msg.call?.toolCallId);
        if (restoredEl) {
          fillRestoredAnswer(restoredEl, toolUpdateText(msg.call));
          break;
        }
        // Live: the interactive card already handled the answer; drop the stash so
        // the chip stays suppressed and we don't fall through to the diff path.
        if (state.questionToolCalls.has(msg.call?.toolCallId)) {
          if (toolUpdateText(msg.call) || String(msg.call?.status).toLowerCase() === "completed") {
            state.questionToolCalls.delete(msg.call.toolCallId);
          }
          break;
        }
        // Fallback: a replayed answer update with no matching card (tool_call
        // missing/unmatched). Rebuild a card from the result text rather than
        // leaving the resumed turn blank.
        if (state.replaying) {
          const t = toolUpdateText(msg.call);
          if (/answered your questions|questions responses/i.test(t)) {
            addRestoredQuestionCard([], t);
            break;
          }
        }
        const c = msg.call?.content;
        if (Array.isArray(c)) {
          for (const item of c) {
            if (item?.type === "diff") {
              const diff = {
                path: item.path,
                oldText: item.oldText ?? "",
                newText: item.newText ?? "",
              };
              state.pendingDiffByToolCallId.set(msg.call.toolCallId, diff);
              attachDiffPreviewToToolItem(msg.call.toolCallId, diff);
            }
          }
        }
        break;
      }
      case "permissionRequest":
        addPermissionCard(msg.req);
        break;
      case "exitPlanRequest":
        addPlanCard(msg.req);
        break;
      case "questionRequest":
        addQuestionCard(msg.req);
        break;
      case "planHistory":
        addPlanHistoryCard(msg.text, msg.verdict, msg.planPath, msg.planName);
        break;
      case "planNotice":
        addPlanNotice(msg.text);
        break;
      case "planBlocked":
        addPlanNotice(
          msg.kind === "terminal"
            ? `Plan mode blocked a command: ${msg.target}`
            : `Plan mode blocked a write to ${msg.target}`,
        );
        break;
      case "promptComplete":
        // Finalize the Thinking block and update the token donut — but DO NOT
        // clear busy here. agentEnd is now the single authoritative "user can
        // send again" signal, so that the verdict → afterTurn flow can keep
        // busy=true across two consecutive client.prompt() calls (the original
        // turn ends emitting promptComplete; afterTurn's follow-up turn then
        // runs and emits its own agentEnd at the end, which clears busy).
        commitAgentTurn();
        if (msg.meta?.totalTokens) updateDonut(msg.meta.totalTokens);
        break;
      case "agentReset": {
        hidePlanProcessing(); // turn is being reset, indicator no longer applies
        // Drop the in-flight agent bubble entirely. Used when the host wants to
        // suppress the rest of the current turn (e.g. after Reject, where
        // grok's false "approved" response would otherwise leak through).
        if (state.activeAgentEl) {
          const wrapper = state.activeAgentEl.closest(".msg-wrapper") ?? state.activeAgentEl.parentElement;
          (wrapper ?? state.activeAgentEl).remove();
        }
        state.activeAgentEl = null;
        state.activeAgentRaw = "";
        state.activeThoughtEl = null;
        state.activeThoughtHdrEl = null;
        state.thoughtStartTime = null;
        // Also clear the rAF-scheduled flag so the next messageChunk arms its
        // own rAF instead of relying on the stale one that might fire on a
        // detached element.
        state.agentRenderScheduled = false;
        break;
      }
      case "agentError":
        addError(msg.text);
        state.busy = false;
        updateSendButton();
        flushVoiceQueue(); // don't strand messages dictated during this turn
        break;
      case "agentEnd":
        state.busy = false;
        updateSendButton();
        flushVoiceQueue(); // send anything dictated while Grok was responding
        break;
      case "exit":
        addError(`Grok exited (code ${msg.code}). Click the new session button to restart.`);
        state.busy = false;
        state.voiceQueue = []; // session is dead — drop anything queued for it
        updateSendButton();
        break;
      case "setBusy":
        // Host-driven busy state for flows where there's no natural agentEnd
        // (e.g. session-start priming). When `locked` is true the button shows
        // a spinner and is disabled (no interrupt option); when false (or
        // omitted) the button shows a stop icon and clicks cancel the in-flight
        // CLI work.
        state.busy = !!msg.value;
        state.busyLocked = !!msg.locked;
        updateSendButton();
        // When a non-turn busy window clears (e.g. session-start priming), send
        // anything dictated during it — priming has no agentEnd to flush on.
        if (!state.busy) flushVoiceQueue();
        // Refresh the gear popover's model/effort lock state if it's open.
        if (!gearPopover.hidden) renderGearMain();
        break;
      case "summarizing": {
        clearWelcome();
        const si = document.createElement("div");
        si.id = "summarizing-indicator";
        si.className = "session-context-banner";
        si.textContent = "Summarizing…";
        messagesEl.appendChild(si);
        scrollToBottom();
        break;
      }
      case "sessionContext":
        addSessionContextBanner();
        break;
      case "clearMessages":
        resetForNewSession();
        break;
      case "onboarding":
        showOnboarding(msg.state, { platform: msg.platform });
        break;
      case "error":
        addError(msg.text);
        break;
      case "xaiNotification":
        break;
      case "sessions":
        state.sessions = msg.entries || [];
        state.activeSessionId = msg.activeId || null;
        if (!historyPopover.hidden) renderHistoryList();
        break;
    }
  });

  // ---------- wire ----------

  sendBtn.onclick = sendOrStop;
  updateSendButton();
  if (micBtn) {
    micBtn.onclick = (e) => { e.stopPropagation(); toggleMic(); };
    renderMic();
  }
  newBtn.onclick = () => {
    resetForNewSession();
    vscode.postMessage({ type: "newSession" });
  };
  modeBtn.onclick = (e) => { e.stopPropagation(); openModePopover(); };
  gearBtn.onclick = (e) => { e.stopPropagation(); openGearPopover(); };
  addBtn.onclick = (e) => { e.stopPropagation(); openAddPopover(); };
  historyBtn.onclick = (e) => { e.stopPropagation(); openHistoryPopover(); };
  modePopover.addEventListener("click", (e) => e.stopPropagation());
  gearPopover.addEventListener("click", (e) => e.stopPropagation());
  addPopover.addEventListener("click", (e) => e.stopPropagation());
  historyPopover.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", (e) => {
    const copyBtn = e.target.closest(".code-copy-btn");
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const codeEl = copyBtn.parentElement && copyBtn.parentElement.querySelector("pre code");
      // innerText (not textContent) so diff blocks, whose lines are block-level
      // spans with no literal newlines, still copy as one line per row.
      const text = codeEl ? codeEl.innerText : "";
      navigator.clipboard.writeText(text).then(() => {
        const label = copyBtn.querySelector(".code-copy-label");
        const glyph = copyBtn.querySelector(".code-copy-glyph");
        const prevLabel = label ? label.textContent : "";
        const prevGlyph = glyph ? glyph.innerHTML : "";
        if (label) label.textContent = "Copied";
        if (glyph) glyph.innerHTML = ICON.check;
        copyBtn.classList.add("copied");
        setTimeout(() => {
          if (label) label.textContent = prevLabel;
          if (glyph) glyph.innerHTML = prevGlyph;
          copyBtn.classList.remove("copied");
        }, 1500);
      });
      return;
    }
    const onbAction = e.target.closest(".onb-action");
    if (onbAction) {
      e.preventDefault();
      e.stopPropagation();
      const act = onbAction.dataset.act;
      if (act === "runInstall") vscode.postMessage({ type: "runInstallCmd" });
      else if (act === "runLogin") vscode.postMessage({ type: "runGrokLogin" });
      else if (act === "recheck") vscode.postMessage({ type: "recheckConnection" });
      return;
    }
    const onbCopy = e.target.closest(".onb-copy");
    if (onbCopy) {
      e.preventDefault();
      e.stopPropagation();
      const cmd = onbCopy.dataset.cmd || "";
      navigator.clipboard.writeText(cmd).then(() => {
        const prevHtml = onbCopy.innerHTML;
        onbCopy.innerHTML = ICON.check;
        onbCopy.classList.add("copied");
        setTimeout(() => {
          onbCopy.innerHTML = prevHtml;
          onbCopy.classList.remove("copied");
        }, 1500);
      });
      return;
    }
    const msgCopyBtn = e.target.closest(".msg-copy-btn");
    if (msgCopyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const msgEl = msgCopyBtn.closest(".msg");
      const text = (msgEl && msgEl._copyText) || "";
      navigator.clipboard.writeText(text).then(() => {
        const glyph = msgCopyBtn.querySelector(".msg-action-glyph");
        const prevGlyph = glyph ? glyph.innerHTML : "";
        if (glyph) glyph.innerHTML = ICON.check;
        msgCopyBtn.classList.add("copied");
        setTimeout(() => {
          if (glyph) glyph.innerHTML = prevGlyph;
          msgCopyBtn.classList.remove("copied");
        }, 1500);
      });
      return;
    }
    closePopovers();
    const a = e.target.closest("a[href]");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      vscode.postMessage({ type: "openUrl", url: href });
    } else if (/^[a-zA-Z]:[\\/]/.test(href) || href.startsWith("\\\\") || !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      vscode.postMessage({ type: "openFile", path: href });
    }
  });

  input.addEventListener("input", () => { updateSlash(); renderInputHighlight(); });
  input.addEventListener("scroll", () => {
    if (!inputHighlight) return;
    inputHighlight.scrollTop = input.scrollTop;
    inputHighlight.scrollLeft = input.scrollLeft;
  });
  renderInputHighlight();
  input.addEventListener("keydown", (e) => {
    if (!slashPopover.hidden && state.slashFiltered.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.slashActive = (state.slashActive + 1) % state.slashFiltered.length;
        renderSlash(); return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        state.slashActive = (state.slashActive - 1 + state.slashFiltered.length) % state.slashFiltered.length;
        renderSlash(); return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        pickSlash(state.slashFiltered[state.slashActive]); return;
      }
      if (e.key === "Escape") { slashPopover.hidden = true; return; }
    }
    const sendKey = state.useCtrlEnter
      ? e.key === "Enter" && (e.metaKey || e.ctrlKey)
      : e.key === "Enter" && !e.shiftKey;
    if (sendKey) { e.preventDefault(); sendOrStop(); }
  });

  document.addEventListener("dragenter", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("dragleave", () => document.body.classList.remove("dragging"));
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    document.body.classList.remove("dragging");
    const data = e.dataTransfer?.getData("text/uri-list");
    if (!data) return;
    const uris = data.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
    for (const uri of uris) {
      const m = uri.match(/^file:\/\/(.+)$/);
      if (!m) continue;
      vscode.postMessage({ type: "dropFile", path: decodeURIComponent(m[1]), shift: e.shiftKey });
    }
  });

  vscode.postMessage({ type: "ready" });
})();
