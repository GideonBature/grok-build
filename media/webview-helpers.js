(function (root) {
  const FILE_EXTS = new Set([
    "ts","tsx","js","jsx","mjs","cjs","json","md","mdx","toml","yml","yaml",
    "css","scss","sass","less","html","htm","xml","svg",
    "py","rb","go","rs","java","kt","kts","swift","c","cc","cpp","cxx","h","hh","hpp",
    "cs","php","lua","sh","bash","zsh","fish","ps1","bat","cmd",
    "txt","lock","env","ini","cfg","conf","gitignore","dockerignore",
    "vue","svelte","astro","sql","prisma","graphql","gql",
  ]);

  function looksLikeFileRef(s) {
    if (!s || s.length > 200) return false;
    const core = s.replace(/[:#].*$/, "");
    if (/[\s"'`<>|&;]/.test(core)) return false;
    const m = core.match(/\.([A-Za-z0-9]+)$/);
    if (!m) return false;
    return FILE_EXTS.has(m[1].toLowerCase());
  }

  function formatRelativeTime(ts, now) {
    if (!ts) return "";
    const base = typeof now === "number" ? now : Date.now();
    const diff = base - ts;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 7) return `${day}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  // Resolve a model ID to its user-facing name (e.g. "grok-build" → "Grok Build")
  // using the availableModels list from session/new. Falls back to the ID when
  // the model isn't in the list or has no name, so the label is never blank.
  function modelDisplayName(modelId, availableModels) {
    if (!modelId) return "";
    const m = (availableModels || []).find((x) => x && x.modelId === modelId);
    return (m && m.name) || modelId;
  }

  // Mic button state machine for voice input:
  //   idle → (start) → connecting → [host ready] → listening → (stop) → transcribing → (transcript) → idle
  // "connecting" covers the ~½–1s while the stream (ws + ffmpeg) spins up, so the
  // blue "listening" waves only appear once it's actually ready to capture — the
  // host moves connecting→listening by posting voiceState "listening". Any failure
  // resolves back to idle ("error"/"reset"). Pure + here so it's unit-testable.
  const MIC_STATES = ["idle", "connecting", "listening", "transcribing"];
  function nextMicState(current, event) {
    switch (event) {
      case "start":
        // Begin connecting (not yet capturing). Don't interrupt a transcription.
        return current === "idle" ? "connecting" : current;
      case "stop":
        // Stoppable while connecting or listening.
        return current === "listening" || current === "connecting" ? "transcribing" : current;
      case "transcript":
      case "error":
      case "reset":
        return "idle";
      default:
        return current;
    }
  }

  // Locate a TRAILING send-phrase (e.g. "grok send", any capitalization) in the
  // composer text — the occurrence that actually acts as the submit command — so
  // the webview can highlight it. Tolerates a comma/whitespace between words and
  // trailing punctuation, mirroring the host's parseVoiceCommand. Returns the
  // {index, length} of the match, or null. An empty phrase disables it.
  // One phrase word, tolerating the "send" ⇄ "sent" STT confusion (kept in sync
  // with phraseWordPattern in src/voice.ts).
  function phraseWordPattern(word) {
    const lower = word.toLowerCase();
    if (lower === "send" || lower === "sent") return "sen[dt]";
    return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function trailingSendPhrase(text, phrase) {
    const t = text == null ? "" : String(text);
    const p = (phrase || "").trim();
    if (!p) return null;
    const words = p.split(/\s+/).map(phraseWordPattern);
    // Lookahead for trailing punctuation so the highlight covers only the phrase
    // words — the trailing "?"/"." stays part of the message and unhighlighted.
    const re = new RegExp("\\b" + words.join("[,\\s]+") + "\\b(?=[\\s.!?…]*$)", "i");
    const m = re.exec(t);
    if (!m) return null;
    return { index: m.index, length: m[0].length };
  }

  // Build the `answers` map for an ask_user_question response from the user's
  // per-question selections. `selections` is an array parallel to `questions`,
  // each entry the array of chosen option labels for that question. Returns the
  // map keyed by question text (multi-select labels joined with ", ", matching
  // grok's HashMap<String,String> contract) and `allAnswered` so the card knows
  // when Submit should be enabled.
  function buildQuestionAnswers(questions, selections) {
    const answers = {};
    let allAnswered = true;
    (questions || []).forEach((q, i) => {
      const picked = (selections && selections[i]) || [];
      if (picked.length === 0) allAnswered = false;
      answers[q.question] = picked.join(", ");
    });
    return { answers, allAnswered };
  }

  // Recognize a tool call that *spawns* a subagent, so the webview can give it a
  // distinct labeled card instead of burying it in the generic tool group.
  // grok's bundled docs describe a `spawn_subagent` tool with a `subagent_type`
  // parameter (general-purpose | explore | plan | custom), and we match that
  // shape (forward-compat; some builds may emit it). BUT the native-Windows
  // grok 0.2.x build does NOT actually emit `spawn_subagent` over ACP — it
  // delegates via a *background* `run_terminal_command` (`is_background:true`),
  // which we DO card, and then reads its output with
  // `get_command_or_subagent_output`. That output READER is not a delegation,
  // yet its name contains the substring "subagent", so it must be explicitly
  // excluded or it false-fires a card on the poller. See research/subagents.md
  // for the wire capture. Degrades gracefully (no match → the call stays in the
  // generic tool group).
  function isSubagentToolCall(call) {
    if (!call) return false;
    if (call.kind === "subagent" || call.kind === "agent") return true;
    const n = String(call.tool || call.name || call.title || "")
      .replace(/[_\s-]/g, "").toLowerCase();
    // grok's `get_command_or_subagent_output` polls a background task's output —
    // its name carries "subagent" but it is NOT a delegation, so never card it.
    if (/output$/.test(n) || n.startsWith("getcommand")) return false;
    if (/subagent|spawnagent|launchagent|dispatchagent|runagent|delegat/.test(n)) return true;
    if (n === "task" || n === "agent" || n === "agents") return true;
    const r = call.rawInput || call.input || {};
    if (r.subagent_type || r.subagentType || r.subagent ||
      r.agent_type || r.agentType || r.agent) return true;
    // grok 0.2.x has no spawn_subagent tool — it delegates by *backgrounding* a
    // run_terminal_command (rawInput.is_background:true, or a "[bg]" title) and
    // reads the result with the get_command_or_subagent_output poller (already
    // excluded above). Backgrounding IS grok's subagent mechanism on the native
    // build, so surface the spawn as a card. See research/subagents.md § Ground
    // truth. (A foreground command — is_background:false/absent — is untouched.)
    if (r.is_background === true || r.background === true) return true;
    if (/^\s*\[bg\]/i.test(String(call.title || ""))) return true;
    return false;
  }

  // Human label for a subagent card: the agent type grok delegated to
  // (`subagent_type`, e.g. "general-purpose"/"explore"/"plan"), or a description,
  // else a generic fallback.
  function subagentLabel(call) {
    const r = (call && (call.rawInput || call.input)) || {};
    // Prefer a named agent type; for a background-task delegation (no type) fall
    // back to the command being backgrounded, truncated for the card.
    const name = r.subagent_type || r.subagentType || r.agent_type || r.agentType ||
      r.subagent || r.agent || r.description || r.name || r.command;
    let s = name != null ? String(name).trim() : "";
    if (s.length > 48) s = s.slice(0, 47).replace(/\s+$/, "") + "…";
    if (s) return s;
    if (r.is_background === true || r.background === true) return "background task";
    return "Subagent";
  }

  // True when the scroll viewport is at (or within `threshold` px of) the
  // bottom. Drives the chat's "stick to bottom" auto-scroll: while the user is
  // pinned we follow streaming output, but once they scroll up to read history
  // we leave the view alone (#16). The threshold absorbs sub-pixel rounding and
  // lets a near-bottom position still count as pinned.
  function shouldStickToBottom(scrollTop, scrollHeight, clientHeight, threshold) {
    const t = typeof threshold === "number" ? threshold : 40;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    return distanceFromBottom <= t;
  }

  const api = { FILE_EXTS, looksLikeFileRef, formatRelativeTime, modelDisplayName, MIC_STATES, nextMicState, trailingSendPhrase, buildQuestionAnswers, isSubagentToolCall, subagentLabel, shouldStickToBottom };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.GrokWebviewHelpers = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
