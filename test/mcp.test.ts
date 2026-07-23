import { describe, it, expect } from "vitest";
import {
  buildMcpAddArgs,
  buildMcpRemoveArgs,
  doctorNeedsAuth,
  isValidMcpName,
  listTarget,
  listTransport,
  mergeMcpState,
  mcpHealthCounts,
  mcpPresetById,
  parseMcpDoctorJson,
  parseMcpListJson,
} from "../src/mcp";

describe("mcp pure helpers", () => {
  it("validates server names the CLI accepts", () => {
    expect(isValidMcpName("github")).toBe(true);
    expect(isValidMcpName("figma-desktop")).toBe(true);
    expect(isValidMcpName("my_server")).toBe(true);
    expect(isValidMcpName("bad name")).toBe(false);
    expect(isValidMcpName("a/b")).toBe(false);
  });

  it("parses list --json arrays", () => {
    const listed = parseMcpListJson(
      JSON.stringify([
        { name: "figma", url: "https://mcp.figma.com/mcp", enabled: true, scope: "user" },
        {
          name: "github",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          scope: "user",
        },
      ]),
    );
    expect(listed).toHaveLength(2);
    expect(listTransport(listed[0]!)).toBe("http");
    expect(listTransport(listed[1]!)).toBe("stdio");
    expect(listTarget(listed[0]!)).toContain("figma.com");
    expect(listTarget(listed[1]!)).toContain("npx");
  });

  it("parses doctor --json even when log lines precede the object", () => {
    const report = parseMcpDoctorJson(`
2026-01-01 ERROR worker quit with fatal: Auth
{
  "servers": [
    {
      "name": "figma",
      "transport": "http",
      "target": "https://mcp.figma.com/mcp",
      "healthy": false,
      "checks": [
        { "label": "handshake failed", "passed": false, "detail": "OAuth authorization required" }
      ]
    },
    {
      "name": "github",
      "transport": "stdio",
      "target": "npx -y @modelcontextprotocol/server-github",
      "healthy": true,
      "checks": [
        { "label": "26 tools discovered", "passed": true, "detail": "" }
      ]
    }
  ],
  "healthy_count": 1,
  "failing_count": 1
}`);
    expect(report.servers).toHaveLength(2);
    expect(report.healthy_count).toBe(1);
    expect(doctorNeedsAuth(report.servers[0]!.checks![0]!.detail)).toBe(true);
  });

  it("merges list + doctor into UI rows", () => {
    const rows = mergeMcpState(
      [
        { name: "figma", url: "https://mcp.figma.com/mcp", scope: "user", enabled: true },
        { name: "github", command: "npx", args: ["-y", "x"], scope: "project" },
      ],
      {
        servers: [
          {
            name: "figma",
            transport: "http",
            target: "https://mcp.figma.com/mcp",
            healthy: false,
            checks: [
              {
                label: "handshake failed",
                passed: false,
                detail: "Auth error: OAuth authorization required",
              },
            ],
          },
          {
            name: "github",
            transport: "stdio",
            target: "npx -y x",
            healthy: true,
            checks: [{ label: "3 tools discovered", passed: true }],
          },
        ],
      },
    );
    expect(rows[0]!.statusLabel).toBe("Needs attention");
    expect(rows[0]!.healthy).toBe(false);
    expect(rows[0]!.detail).toMatch(/OAuth|handshake/i);
    expect(rows[1]!.statusLabel).toBe("Connected");
    expect(rows[1]!.scope).toBe("project");
    expect(mcpHealthCounts(rows)).toEqual({ healthy: 1, failing: 1, unknown: 0 });
  });

  it("builds figma / github / gitlab add argv", () => {
    expect(buildMcpAddArgs("figma")).toEqual([
      "--scope",
      "user",
      "--transport",
      "http",
      "figma",
      "https://mcp.figma.com/mcp",
    ]);
    expect(buildMcpAddArgs("gitlab", { host: "https://gitlab.example.com/" })).toEqual([
      "--scope",
      "user",
      "--transport",
      "http",
      "gitlab",
      "https://gitlab.example.com/api/v4/mcp",
    ]);
    expect(buildMcpAddArgs("github", { token: "ghp_x", scope: "project" })).toEqual([
      "--scope",
      "project",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x",
      "github",
      "--",
      "npx",
      "-y",
      "@modelcontextprotocol/server-github",
    ]);
    expect(() => buildMcpAddArgs("github")).toThrow(/token/i);
  });

  it("builds remove argv with optional scope", () => {
    expect(buildMcpRemoveArgs("figma")).toEqual(["figma"]);
    expect(buildMcpRemoveArgs("figma", "project")).toEqual(["--scope", "project", "figma"]);
  });

  it("exposes the three connect presets", () => {
    expect(mcpPresetById("figma")?.label).toBe("Figma");
    expect(mcpPresetById("github")?.tokenEnv).toBe("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(mcpPresetById("gitlab")?.hostDefault).toContain("gitlab.com");
  });
});
