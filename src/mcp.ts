/**
 * Pure MCP helpers for the extension's in-panel MCP manager.
 *
 * The CLI owns MCP config (`grok mcp add|remove|list|doctor`). This module builds
 * argv, parses `--json` output, and merges list+doctor into a UI-friendly row
 * shape — no spawn, no vscode, no network.
 */

export type McpScope = "user" | "project";
export type McpPresetId = "figma" | "github" | "gitlab";

/** One entry from `grok mcp list --json`. */
export interface McpServerListed {
  name: string;
  scope?: string;
  enabled?: boolean;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface McpDoctorCheck {
  label: string;
  passed: boolean;
  detail?: string;
  hint?: string;
}

export interface McpDoctorServer {
  name: string;
  transport?: string;
  target?: string;
  source?: string;
  healthy?: boolean;
  checks?: McpDoctorCheck[];
}

export interface McpDoctorReport {
  servers: McpDoctorServer[];
  healthy_count?: number;
  failing_count?: number;
}

/** Webview row after merging list + optional doctor. */
export interface McpServerUi {
  name: string;
  scope: string;
  enabled: boolean;
  transport: "http" | "sse" | "stdio" | "unknown";
  target: string;
  /** true/false when doctor ran; null when unknown. */
  healthy: boolean | null;
  statusLabel: string;
  detail?: string;
}

export interface McpPreset {
  id: McpPresetId;
  /** Default server name written to config. */
  name: string;
  label: string;
  description: string;
  /** Prompt the user for a secret before add. */
  tokenEnv?: string;
  tokenPrompt?: string;
  tokenPlaceholder?: string;
  /** Optional second prompt (e.g. GitLab host). */
  hostPrompt?: string;
  hostDefault?: string;
}

export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: "figma",
    name: "figma",
    label: "Figma",
    description: "Design context via Figma’s remote MCP (OAuth on first use)",
  },
  {
    id: "github",
    name: "github",
    label: "GitHub",
    description: "Issues, PRs, and repos via the official GitHub MCP server",
    tokenEnv: "GITHUB_PERSONAL_ACCESS_TOKEN",
    tokenPrompt: "GitHub personal access token (repo / read:org as needed)",
    tokenPlaceholder: "ghp_…",
  },
  {
    id: "gitlab",
    name: "gitlab",
    label: "GitLab",
    description: "MRs, issues, and pipelines via GitLab’s MCP endpoint (OAuth on first use)",
    hostPrompt: "GitLab host (no path)",
    hostDefault: "https://gitlab.com",
  },
] as const;

export function mcpPresetById(id: string): McpPreset | undefined {
  return MCP_PRESETS.find((p) => p.id === id);
}

/** Safe server name: letters, digits, hyphen, underscore (CLI constraint). */
export function isValidMcpName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name);
}

export function parseMcpListJson(stdout: string): McpServerListed[] {
  const raw = stdout.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("mcp list --json: expected an array");
  }
  return parsed.filter(
    (x): x is McpServerListed =>
      !!x && typeof x === "object" && typeof (x as McpServerListed).name === "string",
  );
}

/** Extract a top-level JSON object from stdout that may have log lines before it. */
export function extractJsonObject(text: string): string {
  const raw = text.trim();
  if (!raw) return raw;
  if (raw.startsWith("{")) return raw;
  // Prefer a line that is exactly `{` or starts a JSON object (doctor prints
  // ERROR lines, then a multi-line object).
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith("{")) {
      return lines.slice(i).join("\n");
    }
  }
  const start = raw.indexOf("{");
  return start >= 0 ? raw.slice(start) : raw;
}

export function parseMcpDoctorJson(stdout: string): McpDoctorReport {
  const jsonText = extractJsonObject(stdout);
  if (!jsonText.trim()) return { servers: [] };
  const parsed = JSON.parse(jsonText) as McpDoctorReport;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("mcp doctor --json: expected an object");
  }
  return {
    servers: Array.isArray(parsed.servers) ? parsed.servers : [],
    healthy_count: parsed.healthy_count,
    failing_count: parsed.failing_count,
  };
}

export function listTarget(entry: McpServerListed): string {
  if (entry.url) return entry.url;
  const cmd = entry.command || "";
  const args = Array.isArray(entry.args) ? entry.args.join(" ") : "";
  return [cmd, args].filter(Boolean).join(" ").trim() || "(no target)";
}

export function listTransport(entry: McpServerListed): McpServerUi["transport"] {
  if (entry.url) return "http";
  if (entry.command) return "stdio";
  return "unknown";
}

function failedCheckSummary(server: McpDoctorServer | undefined): string | undefined {
  if (!server?.checks?.length) return undefined;
  const failed = server.checks.filter((c) => !c.passed);
  if (!failed.length) {
    const tools = server.checks.find((c) => /tools discovered/i.test(c.label));
    return tools?.label || "OK";
  }
  const first = failed[0]!;
  const bits = [first.label, first.detail, first.hint].filter(Boolean);
  return bits.join(" — ").slice(0, 220);
}

export function mergeMcpState(
  list: McpServerListed[],
  doctor?: McpDoctorReport | null,
): McpServerUi[] {
  const byName = new Map((doctor?.servers ?? []).map((s) => [s.name, s]));
  return list.map((entry) => {
    const d = byName.get(entry.name);
    const healthy = d ? (d.healthy === true ? true : d.healthy === false ? false : null) : null;
    let statusLabel = "Configured";
    if (healthy === true) statusLabel = "Connected";
    else if (healthy === false) statusLabel = "Needs attention";
    else if (entry.enabled === false) statusLabel = "Disabled";

    const transport =
      (d?.transport as McpServerUi["transport"] | undefined) || listTransport(entry);
    const target = d?.target || listTarget(entry);

    return {
      name: entry.name,
      scope: entry.scope || "user",
      enabled: entry.enabled !== false,
      transport,
      target,
      healthy,
      statusLabel,
      detail: failedCheckSummary(d),
    };
  });
}

export interface BuildMcpAddOptions {
  scope?: McpScope;
  /** GitHub PAT or other token value (written as env KEY=value). */
  token?: string;
  /** Override default server name. */
  name?: string;
  /** GitLab base URL, e.g. https://gitlab.com or https://gitlab.example.com */
  host?: string;
}

/**
 * Build argv for `grok mcp add` (everything after `add`).
 * Pure: token must be supplied by the caller when the preset needs one.
 */
export function buildMcpAddArgs(presetId: McpPresetId, opts: BuildMcpAddOptions = {}): string[] {
  const preset = mcpPresetById(presetId);
  if (!preset) throw new Error(`Unknown MCP preset: ${presetId}`);
  const name = opts.name || preset.name;
  if (!isValidMcpName(name)) {
    throw new Error(`Invalid MCP server name: ${name}`);
  }
  const scope = opts.scope || "user";
  const args: string[] = ["--scope", scope];

  if (presetId === "figma") {
    args.push("--transport", "http", name, "https://mcp.figma.com/mcp");
    return args;
  }

  if (presetId === "gitlab") {
    const host = (opts.host || preset.hostDefault || "https://gitlab.com").replace(/\/+$/, "");
    const url = /\/api\//.test(host) ? host : `${host}/api/v4/mcp`;
    args.push("--transport", "http", name, url);
    return args;
  }

  // github — stdio via npx
  if (preset.tokenEnv) {
    const token = opts.token?.trim();
    if (!token) {
      throw new Error(`GitHub personal access token is required (${preset.tokenEnv})`);
    }
    args.push("-e", `${preset.tokenEnv}=${token}`);
  }
  args.push(name, "--", "npx", "-y", "@modelcontextprotocol/server-github");
  return args;
}

export function buildMcpRemoveArgs(name: string, scope?: McpScope): string[] {
  if (!isValidMcpName(name)) throw new Error(`Invalid MCP server name: ${name}`);
  const args: string[] = [];
  if (scope) args.push("--scope", scope);
  args.push(name);
  return args;
}

export function doctorNeedsAuth(detail: string | undefined): boolean {
  if (!detail) return false;
  return /oauth|authorization required|auth error|sign.?in/i.test(detail);
}

/** Counts for the panel header from a merged row list. */
export function mcpHealthCounts(servers: McpServerUi[]): {
  healthy: number;
  failing: number;
  unknown: number;
} {
  let healthy = 0;
  let failing = 0;
  let unknown = 0;
  for (const s of servers) {
    if (s.healthy === true) healthy++;
    else if (s.healthy === false) failing++;
    else unknown++;
  }
  return { healthy, failing, unknown };
}
