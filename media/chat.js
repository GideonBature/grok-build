(function () {
  const vscode = acquireVsCodeApi();

  const $ = (id) => document.getElementById(id);
  const messagesEl = $("messages");
  const input = $("input");
  const sendBtn = $("send-btn");
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

  const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
  const EFFORT_TOOLTIPS = {
    low: "Low — fast, lightweight reasoning",
    medium: "Medium — balanced",
    high: "High — deeper reasoning",
    xhigh: "XHigh — very deep reasoning",
    max: "Max — maximum depth, slowest",
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
    activeAgentEl: null,
    activeAgentRaw: "",
    activeThoughtEl: null,
    activeThoughtHdrEl: null,
    thoughtStartTime: null,
    activeToolGroupEl: null,
    slashFiltered: [],
    slashActive: 0,
    pendingDiffByToolCallId: new Map(),
    agentRenderScheduled: false,
    thoughtBuffer: "",
    thoughtRenderScheduled: false,
    sessions: [],
    activeSessionId: null,
    sessionSearch: "",
    renamingSessionId: null,
  };

  // ---------- icons ----------

  const ICON = {
    eye: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`,
    file: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`,
    cpu: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>`,
    squarePen: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>`,
    arrowUp: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`,
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
  };

  const MODE_META = {
    agent: {
      icon: ICON.bot,
      label: "Agent mode",
      desc: "Grok will ask for approval before making each change",
    },
    plan: {
      icon: ICON.listTree,
      label: "Plan mode",
      desc: "Grok will explore the task and present a plan before acting",
      disabled: true,
      disabledNote: "Reject / Abandon not yet supported by the CLI via ACP — any response is treated as approval.",
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

  const { looksLikeFileRef, formatRelativeTime } = globalThis.GrokWebviewHelpers;

  function renderMarkdown(raw) {
    const codeBlocks = [];
    let s = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
      const i = codeBlocks.length;
      codeBlocks.push(
        `<div class="code-block">` +
          `<button class="code-copy-btn" type="button" title="Copy code">` +
            `<span class="code-copy-glyph">${ICON.copy}</span>` +
            `<span class="code-copy-label">Copy code</span>` +
          `</button>` +
          `<pre><code>${escapeHtml(code).trimEnd()}</code></pre>` +
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

    const nameBtn = document.createElement("button");
    nameBtn.className = "toolbar-btn model-name-btn";
    const modelName = state.currentModelId || "grok-build";
    nameBtn.innerHTML = `<span class="btn-label">${escapeHtml(truncate(modelName, 16))}</span>`;
    nameBtn.title = `${modelName} — click to change`;
    nameBtn.onclick = (e) => { e.stopPropagation(); renderModelPicker(); };
    row.appendChild(nameBtn);

    const dotsEl = document.createElement("span");
    dotsEl.className = "effort-dots";
    const currentIdx = EFFORT_LEVELS.indexOf(state.effort);
    EFFORT_LEVELS.forEach((id, i) => {
      const dot = document.createElement("span");
      dot.className = "effort-dot" + (i <= currentIdx ? " active" : "");
      dot.textContent = i <= currentIdx ? "●" : "○";
      dot.title = EFFORT_TOOLTIPS[id] || capitalize(id);
      dot.onclick = (e) => {
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
        name.onclick = (e) => {
          e.stopPropagation();
          if (active) { closePopovers(); return; }
          vscode.postMessage({ type: "resumeSession", id: s.id });
          closePopovers();
        };
        main.appendChild(name);

        const meta = document.createElement("div");
        meta.className = "history-row-meta";
        const parts = [];
        if (s.numMessages) parts.push(`${s.numMessages} msg`);
        parts.push(formatRelativeTime(s.updatedAt));
        meta.textContent = parts.join(" · ");
        main.appendChild(meta);
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
      const delBtn = document.createElement("button");
      delBtn.className = "history-action-btn history-action-danger";
      delBtn.innerHTML = ICON.trash;
      delBtn.title = "Delete";
      delBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Delete session "${s.displayName}"? This cannot be undone.`)) {
          vscode.postMessage({ type: "deleteSession", id: s.id });
        }
      };
      actions.appendChild(renameBtn);
      actions.appendChild(delBtn);
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
      const tips = $("welcome-tips");
      if (tips) tips.hidden = false;
      const ver = $("welcome-version");
      if (ver) ver.textContent = "starting...";
    }
    state.welcomeVisible = true;
    state.pendingDiffByToolCallId.clear();
    state.activeAgentEl = null;
    state.activeAgentRaw = "";
    state.activeThoughtEl = null;
    state.activeThoughtHdrEl = null;
    state.thoughtBuffer = "";
    state.activeToolGroupEl = null;
  }

  function showOnboarding(mode, info) {
    info = info || {};
    const welcome = $("welcome");
    if (welcome) welcome.hidden = false;
    state.welcomeVisible = true;
    const tips = $("welcome-tips");
    const onb = $("welcome-onboarding");
    const ver = $("welcome-version");
    if (!onb) return;
    if (mode === "missing-cli") {
      if (tips) tips.hidden = true;
      if (info.platform === "win32") {
        if (ver) ver.textContent = "Windows not supported";
        onb.innerHTML =
          `<div class="onb">` +
            `<p class="onb-heading">Windows isn&rsquo;t supported</p>` +
            `<p class="onb-desc">The Grok CLI has no Windows build, so this extension can&rsquo;t run natively here. See the <a href="https://github.com/phuryn/grok-build-vscode#readme" class="onb-link">README</a> for the WSL workaround.</p>` +
          `</div>`;
      } else {
        if (ver) ver.textContent = "CLI not installed";
        onb.innerHTML =
          `<div class="onb">` +
            `<p class="onb-heading">Install the Grok CLI</p>` +
            `<div class="onb-cmd">` +
              `<code>curl -fsSL https://x.ai/cli/install.sh | bash</code>` +
              `<button class="onb-copy" type="button" title="Copy" data-cmd="curl -fsSL https://x.ai/cli/install.sh | bash">${ICON.copy}</button>` +
            `</div>` +
            `<button class="onb-action" type="button" data-act="runInstall">Open terminal &amp; run</button>` +
            `<button class="onb-action onb-secondary" type="button" data-act="recheck">Re-check connection</button>` +
          `</div>`;
      }
    } else if (mode === "auth-required") {
      if (tips) tips.hidden = true;
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
      if (tips) tips.hidden = false;
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

  function appendThought(_text) {
    clearWelcome();
    if (state.activeThoughtHdrEl) return;
    if (!state.thoughtStartTime) state.thoughtStartTime = Date.now();
    const el = document.createElement("div");
    el.className = "msg thinking";
    const hdr = document.createElement("div");
    hdr.className = "thinking-header";
    hdr.innerHTML = `<span class="thinking-label">Thinking...</span>`;
    el.appendChild(hdr);
    messagesEl.appendChild(el);
    state.activeThoughtHdrEl = hdr;
  }

  function appendAgent(text) {
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

  // ---------- plan card ----------

  function addPlanCard(req) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = "card plan";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = "Plan ready for review";
    el.appendChild(title);

    const body = document.createElement("pre");
    body.className = "plan-body";
    body.textContent = req.plan || "(empty plan)";
    el.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const mk = (label, cls, verdict) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.classList.add(cls);
      b.onclick = () => {
        vscode.postMessage({ type: "exitPlanAnswer", requestId: req.id, verdict });
        el.classList.add("resolved");
        for (const x of actions.querySelectorAll("button")) x.disabled = true;
      };
      return b;
    };
    actions.appendChild(mk("Approve", "primary", "approved"));
    actions.appendChild(mk("Abandon", "danger", "abandoned"));
    actions.appendChild(mk("Reject", "", "rejected"));
    el.appendChild(actions);
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

  function send() {
    if (state.busy) return;
    const text = input.value.trim();
    if (!text && state.chips.every((c) => c.hidden)) return;
    sendBtn.disabled = true;
    state.busy = true;
    state.activeAgentEl = null;
    state.activeAgentRaw = "";
    state.activeThoughtEl = null;
    state.activeThoughtHdrEl = null;
    state.thoughtStartTime = null;
    state.activeToolGroupEl = null;
    vscode.postMessage({ type: "send", text, chips: state.chips });
    input.value = "";
    slashPopover.hidden = true;
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
        const tips = $("welcome-tips");
        if (tips) tips.hidden = false;
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
      case "chips":
        state.chips = msg.chips;
        renderChips();
        break;
      case "commandsUpdate":
        state.commands = msg.commands || [];
        break;
      case "userMessage":
        // Close any active agent/thought bubble so replayed turns (which arrive
        // without promptComplete between them) don't merge into one message.
        flushAgent();
        state.activeAgentEl = null;
        state.activeAgentRaw = "";
        state.activeThoughtEl = null;
        state.activeThoughtHdrEl = null;
        state.thoughtStartTime = null;
        closeToolGroup();
        addMessage("user", msg.text, msg.chips || []);
        break;
      case "agentStart":
        break;
      case "thoughtChunk":
        appendThought(msg.text);
        break;
      case "messageChunk":
        appendAgent(msg.text);
        break;
      case "toolCall":
        addToToolGroup(msg.call);
        break;
      case "toolCallUpdate": {
        const c = msg.call?.content;
        if (Array.isArray(c)) {
          for (const item of c) {
            if (item?.type === "diff") {
              state.pendingDiffByToolCallId.set(msg.call.toolCallId, {
                path: item.path,
                oldText: item.oldText ?? "",
                newText: item.newText ?? "",
              });
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
      case "promptComplete":
        flushAgent();
        if (state.thoughtStartTime && state.activeThoughtHdrEl) {
          const secs = Math.round((Date.now() - state.thoughtStartTime) / 1000);
          const label = state.activeThoughtHdrEl.querySelector(".thinking-label");
          if (label) label.textContent = `Thought for ${secs}s`;
          state.thoughtStartTime = null;
        }
        closeToolGroup();
        if (msg.meta?.totalTokens) updateDonut(msg.meta.totalTokens);
        state.busy = false;
        sendBtn.disabled = false;
        state.activeAgentEl = null;
        state.activeAgentRaw = "";
        state.activeThoughtEl = null;
        state.activeThoughtHdrEl = null;
        break;
      case "agentError":
        addError(msg.text);
        state.busy = false;
        sendBtn.disabled = false;
        break;
      case "agentEnd":
        state.busy = false;
        sendBtn.disabled = false;
        break;
      case "exit":
        addError(`Grok exited (code ${msg.code}). Click the new session button to restart.`);
        state.busy = false;
        sendBtn.disabled = false;
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

  sendBtn.onclick = send;
  newBtn.onclick = () => {
    closePopovers();
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
      const text = codeEl ? codeEl.textContent : "";
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
    } else if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      vscode.postMessage({ type: "openFile", path: href });
    }
  });

  input.addEventListener("input", updateSlash);
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
    if (sendKey) { e.preventDefault(); send(); }
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
