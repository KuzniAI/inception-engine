import type { AgentConfig, AgentId } from "../types.ts";

export const AGENT_REGISTRY: readonly AgentConfig[] = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    skills: {
      posix: ["{home}", ".claude", "skills", "{name}"],
      windows: ["{home}", ".claude", "skills", "{name}"],
    },
    detectPaths: {
      posix: ["{home}", ".claude"],
      windows: ["{home}", ".claude"],
    },
    detectBinary: "claude",
    provenance: {
      skills: "documented",
      detectPaths: "documented",
      detectBinary: "documented",
      mcpConfig: "documented",
      agentRules: "documented",
    },
    mcpConfigPath: {
      posix: ["{home}", ".claude.json"],
      windows: ["{home}", ".claude.json"],
    },
    agentRulesPath: {
      posix: ["{home}", ".claude", "CLAUDE.md"],
      windows: ["{home}", ".claude", "CLAUDE.md"],
    },
  },
  {
    id: "codex",
    displayName: "OpenAI Codex",
    skills: {
      posix: ["{home}", ".codex", "skills", "{name}"],
      windows: ["{home}", ".codex", "skills", "{name}"],
    },
    detectPaths: {
      posix: ["{home}", ".codex"],
      windows: ["{home}", ".codex"],
    },
    detectBinary: "codex",
    provenance: {
      skills: "documented",
      detectPaths: "documented",
      detectBinary: "documented",
      agentRules: "documented",
    },
    // mcpConfigPath omitted: Codex uses TOML config, not JSON — not supported by config-patch
    agentRulesPath: {
      posix: ["{home}", ".codex", "AGENTS.md"],
      windows: ["{home}", ".codex", "AGENTS.md"],
    },
  },
  {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    skills: {
      posix: ["{home}", ".gemini", "skills", "{name}"],
      windows: ["{home}", ".gemini", "skills", "{name}"],
    },
    detectPaths: {
      posix: ["{home}", ".gemini"],
      windows: ["{home}", ".gemini"],
    },
    detectBinary: "gemini",
    provenance: {
      skills: "documented",
      detectPaths: "documented",
      detectBinary: "documented",
      mcpConfig: "documented",
      agentRules: "documented",
    },
    mcpConfigPath: {
      posix: ["{home}", ".gemini", "settings.json"],
      windows: ["{home}", ".gemini", "settings.json"],
    },
    agentRulesPath: {
      posix: ["{home}", ".gemini", "GEMINI.md"],
      windows: ["{home}", ".gemini", "GEMINI.md"],
    },
  },
  {
    id: "antigravity",
    displayName: "Antigravity",
    skills: {
      posix: ["{home}", ".gemini", "antigravity", "skills", "{name}"],
      windows: ["{home}", ".gemini", "antigravity", "skills", "{name}"],
    },
    detectPaths: {
      posix: ["{home}", ".gemini", "antigravity"],
      windows: ["{home}", ".gemini", "antigravity"],
    },
    detectBinary: null,
    provenance: {
      skills: "implementation-only",
      detectPaths: "implementation-only",
      detectBinary: "provisional",
    },
    // mcpConfigPath and agentRulesPath omitted: paths not documented strongly enough for this release
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    skills: {
      posix: ["{xdg_config}", "opencode", "skills", "{name}"],
      windows: ["{appdata}", "opencode", "skills", "{name}"],
    },
    detectPaths: {
      posix: ["{xdg_config}", "opencode"],
      windows: ["{appdata}", "opencode"],
    },
    detectBinary: "opencode",
    provenance: {
      skills: "documented",
      detectPaths: "documented",
      detectBinary: "documented",
      agentRules: "documented",
    },
    // mcpConfigPath omitted: OpenCode uses opencode.json (TOML-adjacent format), not plain JSON
    agentRulesPath: {
      posix: ["{xdg_config}", "opencode", "AGENTS.md"],
      windows: ["{appdata}", "opencode", "AGENTS.md"],
    },
  },
  {
    id: "github-copilot",
    displayName: "GitHub Copilot",
    skills: {
      posix: ["{home}", ".copilot", "skills", "{name}"],
      windows: ["{home}", ".copilot", "skills", "{name}"],
    },
    detectPaths: {
      posix: ["{home}", ".copilot"],
      windows: ["{home}", ".copilot"],
    },
    detectBinary: "github-copilot",
    provenance: {
      skills: "documented",
      detectPaths: "documented",
      detectBinary: "documented",
    },
    // mcpConfigPath and agentRulesPath omitted: rules live in repo, not home dir; MCP config unclear
    policyNote:
      "Organization policies may override locally deployed skills. Verify with your GitHub org admin if deployed skills are not active.",
  },
] as const;

export const AGENT_REGISTRY_BY_ID: Readonly<Record<AgentId, AgentConfig>> =
  Object.fromEntries(AGENT_REGISTRY.map((a) => [a.id, a])) as Record<
    AgentId,
    AgentConfig
  >;
