(function () {
  const vscode = acquireVsCodeApi();

  const $ = (id) => document.getElementById(id);
  const messagesEl = $("messages");
  const input = $("input");
  const sendBtn = $("send-btn");
  const newBtn = $("new-btn");
  const modeBtn = $("mode-btn");
  const gearBtn = $("gear-btn");
  const chipsEl = $("chips");
  const donutArc = $("donut-arc");
  const donutLabel = $("donut-label");
  const slashPopover = $("slash-popover");
  const modePopover = $("mode-popover");
  const gearPopover = $("gear-popover");

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

  function updateModeBtn(modeId) {
    const meta = MODE_META[modeId] || MODE_META.agent;
    modeBtn.innerHTML = `${meta.icon}<span class="btn-label">${escapeHtml(meta.label)}</span>`;
    modeBtn.classList.toggle("plan-active", modeId === "plan");
    modeBtn.classList.toggle("yolo-active", modeId === "yolo");
  }

  newBtn.innerHTML = ICON.squarePen;
  sendBtn.innerHTML = ICON.arrowUp;
  gearBtn.innerHTML = ICON.gear;
  updateModeBtn("agent");

  // ---------- markdown ----------

  function renderMarkdown(raw) {
    const codeBlocks = [];
    let s = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
      const i = codeBlocks.length;
      codeBlocks.push(`<pre><code>${escapeHtml(code).trimEnd()}</code></pre>`);
      return `\x00B${i}\x00`;
    });

    function inline(t) {
      return t
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
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
      if (pendingBreak && stack.length === 0) { out += '<br><br>'; pendingBreak = false; lastPara = false; }
      pendingBreak = false;
      lastWasBlock = false;

      const hm = line.match(/^(#{1,3}) (.+)$/);
      if (hm) {
        closeFrom(0);
        out += `<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`;
        lastWasBlock = true;
        lastPara = false;
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
        continue;
      }

      closeFrom(0);
      if (lastPara) out += '<br>';
      out += inline(line);
      lastPara = true;
    }

    closeFrom(0);
    return out.replace(/\x00B(\d+)\x00/g, (_, i) => codeBlocks[+i]);
  }

  // ---------- popovers ----------

  function closePopovers() {
    modePopover.hidden = true;
    gearPopover.hidden = true;
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

  // ---------- messages ----------

  function clearWelcome() {
    if (!state.welcomeVisible) return;
    messagesEl.innerHTML = "";
    state.welcomeVisible = false;
  }

  function makeCollapsible(el) {
    el.classList.add("collapsible");
    const expandBtn = document.createElement("button");
    expandBtn.className = "msg-expand-btn";
    expandBtn.textContent = "Show more";
    el.appendChild(expandBtn);
    expandBtn.onclick = () => {
      el.classList.remove("collapsible");
      expandBtn.style.display = "none";
      const collapseBtn = document.createElement("button");
      collapseBtn.className = "msg-collapse-btn";
      collapseBtn.textContent = "Show less";
      el.appendChild(collapseBtn);
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
    const rolelabel = document.createElement("div");
    rolelabel.className = "role";
    rolelabel.textContent = role === "user" ? "you" : role === "agent" ? "grok" : role;
    el.appendChild(rolelabel);
    const body = document.createElement("div");
    body.className = "body";
    if (text) body.innerHTML = renderMarkdown(text);
    el.appendChild(body);

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
      el.appendChild(chipsRow);
    }

    messagesEl.appendChild(el);
    scrollToBottom();
    if (role === "user" && text) {
      requestAnimationFrame(() => {
        if (body.scrollHeight > 56) makeCollapsible(el);
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
  };

  function toolLabel(call) {
    const name = call.tool || call.name || call.title || "";
    const verb = TOOL_VERB[name] ||
      (call.kind === "read" ? "Read" : call.kind === "edit" ? "Edit" :
       call.kind === "execute" ? "Run" : null);
    const r = call.rawInput || call.input || {};

    const filePath = r.target_file || r.filePath || r.file_path || r.path ||
      (Array.isArray(r.paths) ? r.paths[0] : "");
    const command = r.command || r.cmd;

    let target = "";
    if (filePath) {
      const base = filePath.split("/").pop() || filePath;
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
      const labels = calls.map(toolLabel);
      const summary = labels.length <= 2
        ? labels.join(", ")
        : `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
      const hdr = el.querySelector(".tool-group-header");
      hdr.querySelector(".tool-group-label").textContent = summary;
    }
    state.activeToolGroupEl = null;
  }

  function addToToolGroup(call) {
    clearWelcome();
    if (!state.activeToolGroupEl) {
      const el = document.createElement("div");
      el.className = "tool-group";
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

    const count = el._calls.length;
    const first = toolLabel(el._calls[0]);
    const extra = count > 1 ? ` +${count - 1}` : "";
    hdr.innerHTML = `<span class="tool-chevron">▶</span><span class="tool-group-label">${escapeHtml(first + extra)}</span>`;
    hdr.onclick = () => {
      const expanded = !body.hidden;
      body.hidden = expanded;
      hdr.querySelector(".tool-chevron").textContent = expanded ? "▶" : "▼";
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

  function appendThought(text) {
    clearWelcome();
    if (!state.activeThoughtEl) {
      if (!state.thoughtStartTime) state.thoughtStartTime = Date.now();
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
    state.activeThoughtEl.textContent += text;
    scrollToBottom();
  }

  function appendAgent(text) {
    closeToolGroup();
    clearWelcome();
    if (!state.activeAgentEl) {
      state.activeAgentEl = addMessage("agent", "");
      state.activeAgentRaw = "";
    }
    state.activeAgentRaw += text;
    state.activeAgentEl.innerHTML = renderMarkdown(state.activeAgentRaw);
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
        $("welcome-version").textContent = `connected${ver}`;
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
        messagesEl.innerHTML = "";
        state.welcomeVisible = false;
        state.pendingDiffByToolCallId.clear();
        state.activeAgentEl = null;
        state.activeAgentRaw = "";
        state.activeThoughtEl = null;
        state.activeThoughtHdrEl = null;
        state.activeToolGroupEl = null;
        break;
      case "error":
        addError(msg.text);
        break;
      case "xaiNotification":
        break;
    }
  });

  // ---------- wire ----------

  sendBtn.onclick = send;
  newBtn.onclick = () => {
    messagesEl.innerHTML = "";
    state.welcomeVisible = false;
    state.pendingDiffByToolCallId.clear();
    vscode.postMessage({ type: "newSession" });
  };
  modeBtn.onclick = (e) => { e.stopPropagation(); openModePopover(); };
  gearBtn.onclick = (e) => { e.stopPropagation(); openGearPopover(); };
  modePopover.addEventListener("click", (e) => e.stopPropagation());
  gearPopover.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", (e) => {
    closePopovers();
    const a = e.target.closest("a[href]");
    if (a) { e.preventDefault(); vscode.postMessage({ type: "openUrl", url: a.href }); }
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
