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
      agentDefinitions: "documented",
    },
    mcpSupport: {
      status: "supported",
      schemaLabel: "JSON mcpServers config",
      path: {
        posix: ["{home}", ".claude.json"],
        windows: ["{home}", ".claude.json"],
      },
    },
    mcpRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local .claude/mcp.json",
      path: {
        posix: ["{repo}", ".claude", "mcp.json"],
        windows: ["{repo}", ".claude", "mcp.json"],
      },
    },
    mcpWorkspaceSupport: {
      status: "supported",
      schemaLabel: "workspace-local .claude/mcp.json",
      path: {
        posix: ["{workspace}", ".claude", "mcp.json"],
        windows: ["{workspace}", ".claude", "mcp.json"],
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
    agentRulesRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local CLAUDE.md",
      path: {
        posix: ["{repo}", "CLAUDE.md"],
        windows: ["{repo}", "CLAUDE.md"],
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
    agentDefinitionsRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local agent definition Markdown file",
      path: {
        posix: ["{repo}", ".claude", "agents", "{name}.md"],
        windows: ["{repo}", ".claude", "agents", "{name}.md"],
      },
    },
    agentRulesWorkspaceSupport: {
      status: "supported",
      schemaLabel: "workspace-local CLAUDE.md",
      path: {
        posix: ["{workspace}", "CLAUDE.md"],
        windows: ["{workspace}", "CLAUDE.md"],
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
    agentRulesRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local AGENTS.md",
      path: {
        posix: ["{repo}", "AGENTS.md"],
        windows: ["{repo}", "AGENTS.md"],
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
    agentDefinitionsRepoSupport: {
      status: "unsupported",
      schemaLabel: "dedicated agent definition directory",
      reason:
        "OpenAI Codex does not expose a documented dedicated per-agent definition directory surface separate from AGENTS.md and config.toml — use agentRules to deploy persona instructions instead",
    },
    agentRulesWorkspaceSupport: {
      status: "supported",
      schemaLabel: "workspace-local AGENTS.md",
      path: {
        posix: ["{workspace}", "AGENTS.md"],
        windows: ["{workspace}", "AGENTS.md"],
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
      agentDefinitions: "documented",
    },
    mcpSupport: {
      status: "supported",
      schemaLabel: "JSON mcpServers config",
      path: {
        posix: ["{home}", ".gemini", "settings.json"],
        windows: ["{home}", ".gemini", "settings.json"],
      },
    },
    // NOTE: Gemini CLI also reads AGENTS.md as a fallback when GEMINI.md is absent.
    // inception-engine intentionally targets GEMINI.md to avoid ownership collisions
    // with codex and opencode, which also write AGENTS.md.
    agentRulesSupport: {
      status: "supported",
      schemaLabel: "global Markdown rules file",
      path: {
        posix: ["{home}", ".gemini", "GEMINI.md"],
        windows: ["{home}", ".gemini", "GEMINI.md"],
      },
    },
    agentRulesRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local GEMINI.md",
      path: {
        posix: ["{repo}", "GEMINI.md"],
        windows: ["{repo}", "GEMINI.md"],
      },
    },
    permissionsSupport: {
      status: "unsupported",
      schemaLabel: "global permissions surface",
      reason:
        "Gemini CLI does not expose a documented global per-user permission or approval config surface",
    },
    agentDefinitionsSupport: {
      status: "supported",
      schemaLabel: "global agent definition Markdown file",
      path: {
        posix: ["{home}", ".gemini", "agents", "{name}.md"],
        windows: ["{home}", ".gemini", "agents", "{name}.md"],
      },
    },
    agentDefinitionsRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local agent definition Markdown file",
      path: {
        posix: ["{repo}", ".gemini", "agents", "{name}.md"],
        windows: ["{repo}", ".gemini", "agents", "{name}.md"],
      },
    },
    agentDefinitionsTomlSupport: {
      status: "supported",
      schemaLabel: "global agent definition TOML file",
      path: {
        posix: ["{home}", ".gemini", "agents", "{name}.toml"],
        windows: ["{home}", ".gemini", "agents", "{name}.toml"],
      },
    },
    agentDefinitionsTomlRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local agent definition TOML file",
      path: {
        posix: ["{repo}", ".gemini", "agents", "{name}.toml"],
        windows: ["{repo}", ".gemini", "agents", "{name}.toml"],
      },
    },
    agentRulesWorkspaceSupport: {
      status: "supported",
      schemaLabel: "workspace-local GEMINI.md",
      path: {
        posix: ["{workspace}", "GEMINI.md"],
        windows: ["{workspace}", "GEMINI.md"],
      },
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
      agentRules: "documented",
      agentDefinitions: "documented",
    },
    mcpSupport: {
      status: "supported",
      schemaLabel: "repo-local frontmatter-emit MCP rules",
      path: {
        posix: ["{repo}", ".agents", "rules", "{name}.md"],
        windows: ["{repo}", ".agents", "rules", "{name}.md"],
      },
    },
    // Antigravity shares its instruction surfaces with gemini-cli (both target
    // the same GEMINI.md paths). surfaceKind: shared-via drives deduplication
    // when both agents appear in the same agentRules entry.
    agentRulesSupport: {
      status: "supported",
      surfaceKind: { kind: "shared-via", via: "gemini-cli" },
      schemaLabel: "global Gemini blueprint instructions file",
      path: {
        posix: ["{home}", ".gemini", "GEMINI.md"],
        windows: ["{home}", ".gemini", "GEMINI.md"],
      },
    },
    agentRulesRepoSupport: {
      status: "supported",
      surfaceKind: { kind: "shared-via", via: "gemini-cli" },
      schemaLabel: "repo-local GEMINI.md",
      path: {
        posix: ["{repo}", "GEMINI.md"],
        windows: ["{repo}", "GEMINI.md"],
      },
    },
    permissionsSupport: {
      status: "unsupported",
      schemaLabel: "global permissions surface",
      reason:
        "Antigravity does not expose a documented global per-user permission or approval config surface",
    },
    agentDefinitionsRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local agent definition Markdown file",
      path: {
        posix: ["{repo}", ".agents", "rules", "{name}.md"],
        windows: ["{repo}", ".agents", "rules", "{name}.md"],
      },
    },
    agentRulesWorkspaceSupport: {
      status: "unsupported",
      schemaLabel: "workspace-local instruction surface",
      reason:
        "Antigravity is natively repo-local and does not expose a separate workspace-local instruction surface",
    },
    instructionFrontmatterRequired: true,
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
      agentDefinitions: "documented",
      permissions: "documented",
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
    agentRulesRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local AGENTS.md",
      path: {
        posix: ["{repo}", "AGENTS.md"],
        windows: ["{repo}", "AGENTS.md"],
      },
    },
    permissionsSupport: {
      status: "supported",
      schemaLabel: "opencode.json permissions config",
      path: {
        posix: ["{xdg_config}", "opencode", "opencode.json"],
        windows: ["{appdata}", "opencode", "opencode.json"],
      },
    },
    agentDefinitionsSupport: {
      status: "supported",
      schemaLabel: "global agent definition Markdown file",
      path: {
        posix: ["{xdg_config}", "opencode", "agents", "{name}.md"],
        windows: ["{appdata}", "opencode", "agents", "{name}.md"],
      },
    },
    agentDefinitionsRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local agent definition Markdown file",
      path: {
        posix: ["{repo}", ".opencode", "agents", "{name}.md"],
        windows: ["{repo}", ".opencode", "agents", "{name}.md"],
      },
    },
    agentRulesWorkspaceSupport: {
      status: "unsupported",
      schemaLabel: "workspace-local AGENTS.md",
      reason:
        "OpenCode does not expose a documented workspace-local instruction surface distinct from repo-local AGENTS.md",
    },
  },
  {
    id: "github-copilot",
    displayName: "GitHub Copilot",
    // No `skills` field: GitHub Copilot natively executes Claude-style skills
    // from `.claude/skills/` (the same path used by claude-code). Deploying
    // via the `claude-code` skills target automatically covers Copilot — no
    // separate `~/.copilot/skills/` path is needed or maintained.
    skillsSurfaceKind: { kind: "shared-via", via: "claude-code" },
    detectPaths: {
      posix: ["{home}", ".copilot"],
      windows: ["{home}", ".copilot"],
    },
    detectBinary: "github-copilot",
    provenance: {
      detectPaths: "documented",
      detectBinary: "documented",
      agentDefinitions: "documented",
      mcpConfig: "documented",
    },
    mcpSupport: {
      status: "unsupported",
      schemaLabel: "global MCP config",
      reason:
        'GitHub Copilot has no user-level MCP config file; use scope: "repo" or scope: "workspace" to target .vscode/mcp.json instead',
    },
    mcpRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local .vscode/mcp.json",
      mcpPatchKey: "servers",
      path: {
        posix: ["{repo}", ".vscode", "mcp.json"],
        windows: ["{repo}", ".vscode", "mcp.json"],
      },
    },
    mcpWorkspaceSupport: {
      status: "supported",
      schemaLabel: "workspace-local .vscode/mcp.json",
      mcpPatchKey: "servers",
      path: {
        posix: ["{workspace}", ".vscode", "mcp.json"],
        windows: ["{workspace}", ".vscode", "mcp.json"],
      },
    },
    // GitHub Copilot reads Claude-native instruction files (CLAUDE.md) without
    // a separate deploy action. These surfaces are marked shared-via claude-code
    // with requiresPrimary: true so deploy skips emitting a separate action
    // when claude-code is also targeted, and emits a guidance warning when it
    // is not (copilot cannot write to these surfaces independently).
    agentRulesSupport: {
      status: "supported",
      surfaceKind: {
        kind: "shared-via",
        via: "claude-code",
        requiresPrimary: true,
      },
      schemaLabel: "Claude-native shared instructions",
      path: {
        posix: ["{home}", ".claude", "CLAUDE.md"],
        windows: ["{home}", ".claude", "CLAUDE.md"],
      },
    },
    agentRulesRepoSupport: {
      status: "supported",
      surfaceKind: {
        kind: "shared-via",
        via: "claude-code",
        requiresPrimary: true,
      },
      schemaLabel: "repo-local CLAUDE.md",
      path: {
        posix: ["{repo}", "CLAUDE.md"],
        windows: ["{repo}", "CLAUDE.md"],
      },
    },
    agentRulesWorkspaceSupport: {
      status: "supported",
      surfaceKind: {
        kind: "shared-via",
        via: "claude-code",
        requiresPrimary: true,
      },
      schemaLabel: "workspace-local CLAUDE.md",
      path: {
        posix: ["{workspace}", "CLAUDE.md"],
        windows: ["{workspace}", "CLAUDE.md"],
      },
    },
    mcpDevcontainerSupport: {
      status: "planned",
      schemaLabel: "devcontainer.json MCP surface",
      plannedSurface: "devcontainer.json customizations.vscode.mcp.servers",
      reason:
        'devcontainer.json MCP support is planned — use scope: "repo" or scope: "workspace" to target .vscode/mcp.json in the meantime',
    },
    permissionsSupport: {
      status: "unsupported",
      schemaLabel: "global permissions surface",
      reason:
        "GitHub Copilot permissions are managed via organization policy, not a deployable per-user config surface",
    },
    agentDefinitionsRepoSupport: {
      status: "supported",
      schemaLabel: "repo-local agent definition Markdown file",
      path: {
        posix: ["{repo}", ".github", "copilot", "agents", "{name}.md"],
        windows: ["{repo}", ".github", "copilot", "agents", "{name}.md"],
      },
    },
    policyNote:
      "Organization policies may override locally deployed configuration. Verify with your GitHub org admin if deployed skills or rules are not active.",
    unsupportedSurfaces: [
      {
        status: "planned",
        schemaLabel: "devcontainer.json MCP surface",
        plannedSurface: "devcontainer.json customizations.vscode.mcp.servers",
        reason:
          'devcontainer.json MCP support is planned — use scope: "repo" or scope: "workspace" to target .vscode/mcp.json in the meantime',
      },
    ],
    instructionFrontmatterRequired: true,
    enterprisePolicyDetection: true,
  },
] as const;

export const AGENT_REGISTRY_BY_ID: Readonly<Record<AgentId, AgentConfig>> =
  Object.fromEntries(AGENT_REGISTRY.map((a) => [a.id, a])) as Record<
    AgentId,
    AgentConfig
  >;
