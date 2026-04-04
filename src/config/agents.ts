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
      permissions: "documented",
    },
    mcpSupport: {
      status: "supported",
      schemaLabel: "JSON mcpServers config",
      path: {
        posix: ["{home}", ".claude.json"],
        windows: ["{home}", ".claude.json"],
      },
    },
    agentRulesSupport: {
      status: "supported",
      schemaLabel: "global Markdown rules file",
      path: {
        posix: ["{home}", ".claude", "CLAUDE.md"],
        windows: ["{home}", ".claude", "CLAUDE.md"],
      },
    },
    permissionsSupport: {
      status: "supported",
      schemaLabel: "JSON permissions config",
      path: {
        posix: ["{home}", ".claude", "settings.json"],
        windows: ["{home}", ".claude", "settings.json"],
      },
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
      permissions: "documented",
    },
    mcpSupport: {
      status: "supported",
      schemaLabel: "TOML mcpServers config",
      path: {
        posix: ["{home}", ".codex", "config.toml"],
        windows: ["{home}", ".codex", "config.toml"],
      },
    },
    agentRulesSupport: {
      status: "supported",
      schemaLabel: "global Markdown rules file",
      path: {
        posix: ["{home}", ".codex", "AGENTS.md"],
        windows: ["{home}", ".codex", "AGENTS.md"],
      },
    },
    permissionsSupport: {
      status: "supported",
      schemaLabel: "TOML approval policy config",
      path: {
        posix: ["{home}", ".codex", "config.toml"],
        windows: ["{home}", ".codex", "config.toml"],
      },
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
    mcpSupport: {
      status: "supported",
      schemaLabel: "JSON mcpServers config",
      path: {
        posix: ["{home}", ".gemini", "settings.json"],
        windows: ["{home}", ".gemini", "settings.json"],
      },
    },
    agentRulesSupport: {
      status: "supported",
      schemaLabel: "global Markdown rules file",
      path: {
        posix: ["{home}", ".gemini", "GEMINI.md"],
        windows: ["{home}", ".gemini", "GEMINI.md"],
      },
    },
    permissionsSupport: {
      status: "unsupported",
      schemaLabel: "global permissions surface",
      reason:
        "Gemini CLI does not expose a documented global per-user permission or approval config surface",
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
    mcpSupport: {
      status: "supported",
      schemaLabel: "repo-local frontmatter-emit MCP rules",
      path: {
        posix: ["{repo}", ".agents", "rules", "{name}.md"],
        windows: ["{repo}", ".agents", "rules", "{name}.md"],
      },
    },
    agentRulesSupport: {
      status: "supported",
      schemaLabel: "repo-local Markdown rules file",
      path: {
        posix: ["{repo}", ".agents", "rules", "{name}.md"],
        windows: ["{repo}", ".agents", "rules", "{name}.md"],
      },
    },
    permissionsSupport: {
      status: "unsupported",
      schemaLabel: "global permissions surface",
      reason:
        "Antigravity does not expose a documented global per-user permission or approval config surface",
    },
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
    mcpSupport: {
      status: "supported",
      schemaLabel: "opencode.json MCP config",
      path: {
        posix: ["{xdg_config}", "opencode", "opencode.json"],
        windows: ["{appdata}", "opencode", "opencode.json"],
      },
      mcpPatchKey: "mcp",
    },
    agentRulesSupport: {
      status: "supported",
      schemaLabel: "global Markdown rules file",
      path: {
        posix: ["{xdg_config}", "opencode", "AGENTS.md"],
        windows: ["{appdata}", "opencode", "AGENTS.md"],
      },
    },
    permissionsSupport: {
      status: "unsupported",
      schemaLabel: "global permissions surface",
      reason:
        "OpenCode does not expose a documented global per-user permission or approval config surface",
    },
  },
  {
    id: "github-copilot",
    displayName: "GitHub Copilot",
    // No `skills` field: GitHub Copilot natively executes Claude-style skills
    // from `.claude/skills/` (the same path used by claude-code). Deploying
    // via the `claude-code` skills target automatically covers Copilot — no
    // separate `~/.copilot/skills/` path is needed or maintained.
    detectPaths: {
      posix: ["{home}", ".copilot"],
      windows: ["{home}", ".copilot"],
    },
    detectBinary: "github-copilot",
    provenance: {
      detectPaths: "documented",
      detectBinary: "documented",
    },
    mcpSupport: {
      status: "planned",
      schemaLabel: "repo-scoped MCP surfaces",
      plannedSurface:
        "devcontainer (.devcontainer/devcontainer.json) and agent-frontmatter (.github/agents/*.agent.md)",
      reason:
        "GitHub Copilot MCP support will be implemented via repo-scoped devcontainer features and agent-frontmatter mappings — surfaces that are genuinely Copilot-specific and not covered by other agent targets",
    },
    agentRulesSupport: {
      status: "unsupported",
      schemaLabel: "Claude-native shared instructions",
      reason:
        'GitHub Copilot reads CLAUDE.md natively, so deploy via the "claude-code" agentRules target instead of a separate rules surface',
    },
    permissionsSupport: {
      status: "unsupported",
      schemaLabel: "global permissions surface",
      reason:
        "GitHub Copilot permissions are managed via organization policy, not a deployable per-user config surface",
    },
    policyNote:
      "Organization policies may override locally deployed configuration. Verify with your GitHub org admin if deployed skills or rules are not active.",
  },
] as const;

export const AGENT_REGISTRY_BY_ID: Readonly<Record<AgentId, AgentConfig>> =
  Object.fromEntries(AGENT_REGISTRY.map((a) => [a.id, a])) as Record<
    AgentId,
    AgentConfig
  >;
