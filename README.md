# inception-engine

Plant skills directly into the minds of your installed AI coding agents — Claude Code, Codex, Gemini CLI, Antigravity, and OpenCode. One command. They'll think they thought of it themselves.

Today, inception-engine works as a cross-agent deployer for skills on all listed agents, plus single-file writes and JSON config patches. It also supports MCP server registration and global rules-file deployment for the subset of agents whose config surfaces are implemented and validated today.

GitHub Copilot is no longer treated as a separate instruction or skill target in the product direction when it can consume Claude-native artifacts directly. If Copilot uses `CLAUDE.md` or Claude-style skill layouts without translation, inception-engine should rely on the Claude deployment path instead of maintaining duplicate Copilot-specific surfaces. Dedicated Copilot customization remains justified only where Copilot exposes a materially different interface, such as MCP-related configuration.

The broader portability layer is the roadmap direction, but this README focuses on what is working now.

`init` is available as a bootstrap command. It scans for directories containing `SKILL.md`, discovers agent-rules Markdown files using the Claude-first portability conventions, and reads `mcp-servers.json` from the repo root to populate `mcpServers`. Shared surfaces now default to the primary deploy target in generated manifests: for example, `init` emits `claude-code` rather than `github-copilot` for shared Claude-native skills and rules, and emits `gemini-cli` rather than `antigravity` for shared `GEMINI.md` rules surfaces. `files` and `configs` remain empty — `init` emits guidance when it detects a `files/` or `configs/` directory.

## Quick Start

```bash
npx @kuznai/inception-engine <directory>
```

Where `<directory>` is a repo (or subdirectory) containing an `inception.json` manifest and skill files.

## How It Works

inception-engine reads a manifest file (`inception.json`) from the target directory, detects which AI coding agents are installed on the system, and deploys skills to each agent's expected location.

- **POSIX (macOS, Linux)**: creates symlinks from the source skill directory to each agent's skill path
- **Windows**: copies skill directories to each agent's skill path

Managed skills overwrite their previous version. If a target exists but was not created by inception-engine, deployment refuses to replace it. On POSIX systems, symlinks mean updates to the source repo are reflected immediately.

Before executing, the deploy command runs preflight analysis on instruction files and capability planning inputs. It validates that `agentRules` and `agentDefinitions` for targets requiring specific structure (like `github-copilot` and `antigravity`) include valid YAML frontmatter with `name` and `description` fields. For `github-copilot`, it further ensures either `tools` or `instructions` are defined; for `antigravity`, it validates the shape of any `mcp-servers` or `mcpServers` defined in the frontmatter. It also warns when a manifest targets a surface that is implementation-only, planned, unsupported, or shared through another agent, when the same agent will have multiple `agentRules` scopes active simultaneously, when the same source file is deployed to multiple scopes (duplicate-content risk), when `agentRules` or `agentDefinitions` source files exceed 50 KB (context-budget risk), and when GitHub Copilot appears to be running under enterprise-managed policy that may override local configuration. Warnings are printed but do not block deployment; structural validation failures block deployment for the affected targets.

## Agent Compatibility Matrix

| Agent | ID | Skills | macOS | Linux | Windows |
|---|---|---|---|---|---|
| Claude Code | `claude-code` | `~/.claude/skills/` | Yes | Yes | Yes |
| OpenAI Codex | `codex` | `~/.codex/skills/` | Yes | Yes | Yes |
| Gemini CLI | `gemini-cli` | `~/.gemini/skills/` | Yes | Yes | Yes |
| Antigravity | `antigravity` | `~/.gemini/antigravity/skills/` | Yes* | Yes* | Yes* |
| OpenCode | `opencode` | `~/.config/opencode/skills/` | Yes | Yes | Yes* |

\* Antigravity support is currently based on the implementation's registry path assumptions and local validation, not a strong official doc set equivalent to the other agents.

\* OpenCode on Windows uses `%APPDATA%\opencode\skills\`.

### Feature Support

| Feature | Deploy | Revert |
|---|---|---|
| Skills (SKILL.md) | All agents via manifest and CLI | All agents |
| File write | All agents via manifest and CLI | All agents |
| Config patch (JSON merge) | All agents via manifest and CLI | All agents |
| MCP Servers | claude-code (`scope: "global"` → `~/.claude.json`; `scope: "repo"` → `{repo}/.claude/mcp.json`; `scope: "workspace"` → `{workspace}/.claude/mcp.json`), gemini-cli, codex, antigravity, opencode; github-copilot with `scope: "repo"` deploys to `{repo}/.vscode/mcp.json` and `scope: "workspace"` deploys to `{workspace}/.vscode/mcp.json`; github-copilot with `scope: "global"` (default) is unsupported and warns | claude-code, gemini-cli, codex, antigravity, opencode, github-copilot |
| Global/Repo/Workspace Rules Files | `scope: "global"` and `scope: "repo"` are supported on the implemented agent surfaces; `scope: "workspace"` is supported for `claude-code`, `codex`, and `gemini-cli`; `github-copilot` reads Claude-native rules via `claude-code` and has no separate rules deployment target | All supported agents |
| Permissions / Approval Config | claude-code (`~/.claude/settings.json`), codex (`~/.codex/config.toml`), opencode (`~/.config/opencode/opencode.json` on POSIX, `%APPDATA%\\opencode\\opencode.json` on Windows); other agents are warned and skipped | claude-code, codex, opencode |
| Agent Definitions | claude-code (`{repo}/.claude/agents/{name}.md`), gemini-cli (`{repo}/.gemini/agents/{name}.md` or `.toml`, plus `scope: "global"` to `~/.gemini/agents/{name}.md` or `.toml`), antigravity (`{repo}/.agents/rules/{name}.md`), opencode (`{repo}/.opencode/agents/{name}.md`, plus `scope: "global"` to the user config dir), github-copilot (`{repo}/.github/copilot/agents/{name}.md`, with migration from legacy `.github/agents/{name}.agent.md`); codex is warned and skipped | All supported agents |
| `init` manifest generation | Scans `SKILL.md` directories (`skills`), `.md` files with Claude-first agent mapping (`agentRules`), `mcp-servers.json` (`mcpServers`), and agent-definition Markdown files (`agentDefinitions`); shared surfaces default to the primary deploy target instead of shared riders; emits hints for `files/` and `configs/` directories | N/A |
| Instruction preflight analysis | Emits capability warnings for implementation-only, planned, unsupported, and shared-through surfaces used by the manifest; emits `precedence` warnings when an agent has multiple `agentRules` scopes active simultaneously or the same source file is deployed to multiple scopes; emits `budget` warnings when `agentRules` or `agentDefinitions` source files exceed 50 KB; emits GitHub Copilot enterprise-policy warnings when local configuration may be overridden; emits a `config-authority` warning when Gemini CLI's `settings.json` contains an `instructionFilename` override that differs from the deploy target | N/A |

Features that depend on agent-specific config surfaces are intentionally conservative: deploy and preflight now classify each surface through the same planner. If a target path or schema is implementation-only, planned, unsupported, or only shared through another agent, inception-engine warns and either routes through the primary surface or skips it rather than guessing.

For GitHub Copilot specifically, the portability rule is Claude-first: if Copilot accepts the same Claude-native instruction or skill artifact, inception-engine should not add a separate Copilot deployment feature for it.

## Manifest Format

Create an `inception.json` file at the root of your skills directory:

```json
{
  "skills": [
    {
      "name": "my-skill",
      "path": "skills/my-skill",
      "agents": ["claude-code", "codex", "gemini-cli", "antigravity", "opencode"]
    }
  ],
  "files": [
    {
      "name": "my-settings",
      "path": "files/settings.json",
      "target": "{home}/.claude/settings.json",
      "agents": ["claude-code"]
    }
  ],
  "configs": [
    {
      "name": "enable-feature",
      "target": "{home}/.claude/settings.json",
      "patch": { "someFeature": true },
      "agents": ["claude-code"]
    }
  ],
  "mcpServers": [
    {
      "name": "my-server",
      "agents": ["claude-code", "gemini-cli"],
      "config": { "command": "npx", "args": ["-y", "my-mcp-server"] }
    },
    {
      "name": "my-server",
      "agents": ["github-copilot"],
      "scope": "repo",
      "config": { "type": "stdio", "command": "npx", "args": ["-y", "my-mcp-server"] }
    }
  ],
  "agentRules": [
    {
      "name": "my-rules",
      "path": "rules/CLAUDE.md",
      "agents": ["claude-code"],
      "scope": "global"
    },
    {
      "name": "project-rules",
      "path": "rules/CLAUDE.md",
      "agents": ["claude-code", "codex", "gemini-cli", "opencode"],
      "scope": "repo"
    }
  ],
  "permissions": [
    {
      "name": "safety-defaults",
      "agents": ["claude-code"],
      "config": {
        "permissions": {
          "allow": ["Read", "Glob"],
          "deny": ["Bash(rm:*)"]
        }
      }
    }
  ],
  "agentDefinitions": [
    {
      "name": "code-reviewer",
      "path": "agents/code-reviewer.md",
      "agents": ["claude-code", "opencode", "github-copilot"]
    }
  ]
}
```

Each **skill** entry has:

- **name** - Unique identifier using letters, digits, dots, underscores, or hyphens; must not start with a dot
- **path** - Relative path to the skill directory within the repo
- **agents** - Array of agent IDs to deploy this skill to. If an agent isn't installed, it's skipped.

Each **file** entry deploys a single file to an agent's configuration location:

- **name** - Unique identifier (same format as skill names)
- **path** - Relative path to the source file within the repo
- **target** - Destination path using a placeholder prefix: `{home}`, `{appdata}` (Windows), or `{xdg_config}` (Linux). For example: `{home}/.claude/settings.json`
- **agents** - Array of agent IDs to deploy this file to

Each **config** entry applies a [JSON merge patch (RFC 7386)](https://datatracker.ietf.org/doc/html/rfc7386) to an existing agent config file:

- **name** - Unique identifier (same format as skill names)
- **target** - Config file to patch, using the same placeholder prefix as file entries
- **patch** - JSON object of keys to set. A `null` value removes the key from the target file. Nested object values are merged recursively; non-object values replace the existing value directly.
- **agents** - Array of agent IDs to apply this patch to

The engine records an undo-patch for each config-patch deployment so that `revert` can restore the original values.

Each **mcpServer** entry registers an MCP server into the agent's config file by applying a JSON merge patch under the `mcpServers` key:

- **name** - Unique identifier (same format as skill names); used as the server's key in the config
- **agents** - Array of agent IDs to register this server with
- **config** - Raw server descriptor object. For the currently supported JSON-backed adapters, inception-engine requires at least one non-empty `command` or `url` field, validates `args` as an array of strings when present, and validates `env` as a string-to-string object when present. Additional keys are passed through verbatim.
- **scope** - `"global"` (default), `"repo"`, or `"workspace"`. For most agents this field is ignored (they have only a single user-level config path). For `github-copilot`, `scope` selects the target file:
  - `"global"` — unsupported; emits a warning and is skipped
  - `"repo"` — deploys to `{repo}/.vscode/mcp.json` under the `servers` key
  - `"workspace"` — deploys to `{workspace}/.vscode/mcp.json` under the `servers` key

  GitHub Copilot's `.vscode/mcp.json` uses `servers` (not `mcpServers`) as the top-level key and optionally accepts a `type` field (`"stdio"` | `"sse"` | `"http"`) in the server descriptor, which is passed through verbatim.

MCP server registration is supported for all agents. Inception-engine automatically uses the correct adapter for each agent's configuration schema:
- **JSON (Merge Patch)**: `claude-code` (`~/.claude.json` for `scope: "global"`; `{repo}/.claude/mcp.json` for `scope: "repo"`; `{workspace}/.claude/mcp.json` for `scope: "workspace"`), `gemini-cli` (`~/.gemini/settings.json`), `opencode` (`~/.config/opencode/opencode.json` using the custom `"mcp"` key), and `github-copilot` (`{repo}/.vscode/mcp.json` or `{workspace}/.vscode/mcp.json` using the `"servers"` key).
- **TOML (Patch)**: `codex` (`~/.codex/config.toml`).
- **Markdown Frontmatter (Emit)**: `antigravity` (repo-local `.agents/rules/{name}.md` files).

For Markdown frontmatter targets, inception-engine now records patch-level provenance for the emitted frontmatter block. Deploy merges only the owned frontmatter keys, preserves unrelated frontmatter and Markdown body content, and `revert` removes only the engine-owned keys instead of deleting the whole file unless inception-engine originally created an otherwise-empty file.

Because Antigravity currently reuses `.agents/rules/{name}.md` for both MCP frontmatter emit and agent-definition files, planning now rejects a manifest when an `mcpServers` entry and an `agentDefinitions` entry would resolve to the same Antigravity target.

Revert removes the registered server entry from the respective configuration file or frontmatter block.

Each **agentRules** entry deploys a Markdown instruction file to an agent's supported instruction file location:

- **name** - Unique identifier (same format as skill names)
- **path** - Relative path to the source Markdown file within the repo; supported rules adapters require a `.md` or `.markdown` source path
- **agents** - Array of agent IDs to deploy this file to
- **scope** - `"global"` (default), `"repo"`, or `"workspace"`. Controls which instruction surface is targeted:
  - `"global"` — deploys to the agent's home-directory instruction file when that surface is supported (e.g., `~/.claude/CLAUDE.md` for `claude-code`)
  - `"repo"` — deploys to the project-root instruction file inside the deployed repository when that surface is supported (e.g., `{repo}/CLAUDE.md` for `claude-code`)
  - `"workspace"` — deploys to the workspace-root instruction file when an agent exposes one (e.g., `{workspace}/CLAUDE.md` for `claude-code`); when unsupported, deployment is skipped with a warning

Instruction rule deployment is supported for implemented global, repo, and workspace surfaces. The target path depends on the agent and the `scope`:

| Agent | `scope: "global"` | `scope: "repo"` | `scope: "workspace"` |
|---|---|---|---|
| `claude-code` | `~/.claude/CLAUDE.md` | `{repo}/CLAUDE.md` | `{workspace}/CLAUDE.md` |
| `codex` | `~/.codex/AGENTS.md` | `{repo}/AGENTS.md` | `{workspace}/AGENTS.md` |
| `gemini-cli` | `~/.gemini/GEMINI.md` | `{repo}/GEMINI.md` | `{workspace}/GEMINI.md` |
| `antigravity` | `~/.gemini/GEMINI.md` | `{repo}/GEMINI.md` | unsupported; warns and skips |
| `opencode` | `~/.config/opencode/AGENTS.md` | `{repo}/AGENTS.md` | unsupported; warns and skips |
| `github-copilot` | unsupported / Claude-first | deploy via `claude-code` | unsupported; deploy via `claude-code` with `scope: "workspace"` |

For `antigravity`, `agentRules` now targets the shared GEMINI.md surface (`~/.gemini/GEMINI.md` for `global`, `{repo}/GEMINI.md` for `repo`) — the same paths used by `gemini-cli`. When both agents appear in the same entry, deduplication ensures only one write action is emitted. `workspace` scope is not supported and is skipped with a warning. For `github-copilot`, no separate deployment is needed — target it via the `claude-code` agentRules entry and it reaches Copilot automatically. Revert removes the deployed rules file.

Each **permissions** entry deploys execution and safety-oriented configuration to an agent's permission or approval surface:

- **name** - Unique identifier (same format as skill names)
- **agents** - Array of agent IDs to deploy this entry to
- **config** - Permission config payload; shape is validated per agent (see below)

Permission deployment is currently supported for `claude-code` and `codex`. Other agents emit a warning and are skipped.

For `claude-code`, the config is merged into `~/.claude/settings.json`. Only the `permissions` key is accepted:

```json
{
  "name": "safety-defaults",
  "agents": ["claude-code"],
  "config": {
    "permissions": {
      "allow": ["Read", "Glob", "Bash(git:*)"],
      "deny": ["Bash(rm:*)"]
    }
  }
}
```

Both `allow` and `deny` are optional string arrays. Tool patterns follow Claude Code's permission glob syntax (e.g., `Bash(git:*)` to allow all git commands).

For `codex`, the config is merged into `~/.codex/config.toml`. Only the `approval_policy` key is accepted:

```json
{
  "name": "codex-approval",
  "agents": ["codex"],
  "config": {
    "approval_policy": "suggest"
  }
}
```

Valid `approval_policy` values are `"auto"`, `"manual"`, `"suggest"`, and `"on-failure"`.

Revert restores the previous config values using the undo patch recorded at deploy time.

Each **agentDefinitions** entry deploys an agent-definition file to the agent-definition directory of each targeted agent. `scope: "repo"` is the default, and some agents also support `scope: "global"`:

- **name** - Unique identifier (same format as skill names); used as the definition filename
- **path** - Relative path to the source file within the repo; `.md` or `.markdown` for Markdown definitions, `.toml` for Gemini CLI TOML subagent definitions
- **agents** - Array of agent IDs to deploy this definition to

Agent-definition deployment is supported for `claude-code`, `gemini-cli`, `antigravity`, `opencode`, and `github-copilot`. For `codex`, inception-engine emits a warning and skips the entry. Gemini CLI and OpenCode also support `scope: "global"` definitions; other supported agents are repo-local only.

Gemini CLI supports two definition formats: Markdown (`.md`) files deploy to `{scope}/.gemini/agents/{name}.md`, and TOML (`.toml`) subagent configuration files deploy to `{scope}/.gemini/agents/{name}.toml`. TOML files are deployed verbatim without frontmatter validation. Agents other than `gemini-cli` that do not have a TOML definition surface silently produce no action when a `.toml` source is specified.

Repo-local targets:
- **claude-code**: `{repo}/.claude/agents/{name}.md`
- **gemini-cli**: `{repo}/.gemini/agents/{name}.md` (Markdown) or `{repo}/.gemini/agents/{name}.toml` (TOML)
- **antigravity**: `{repo}/.agents/rules/{name}.md`
- **opencode**: `{repo}/.opencode/agents/{name}.md`
- **github-copilot**: `{repo}/.github/copilot/agents/{name}.md`

Global targets where supported:
- **gemini-cli**: `~/.gemini/agents/{name}.md` or `~/.gemini/agents/{name}.toml`
- **opencode**: `~/.config/opencode/agents/{name}.md` on POSIX, `%APPDATA%\\opencode\\agents\\{name}.md` on Windows

For GitHub Copilot, deploy also records migration from the legacy `{repo}/.github/agents/{name}.agent.md` path so older installs can be cleaned up safely.

Revert removes the deployed agent-definition file.

## Creating Skills

Each skill is a directory containing at minimum a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does and when to use it
---

# My Skill

Instructions for the AI agent...
```

The `name` and `description` fields in the frontmatter are used by most agents. The description determines when the agent activates the skill. inception-engine now validates this minimum contract during deploy: `SKILL.md` must start with YAML frontmatter and include non-empty single-line `name` and `description` fields. It still does not attempt full YAML/schema validation beyond that targeted check.

## `init` Command

`init` is meant to bootstrap a repository that already has skills and related manifest assets. It recursively scans the target directory, treats any directory containing `SKILL.md` as a skill, discovers supported instruction and MCP conventions, and writes a starter `inception.json`.

Current `init` behavior:

- Generates `skills` entries using the discovered relative paths
- Uses the directory name as the manifest skill name
- Applies either the `--agents` list or all currently known agent IDs
- Refuses to overwrite an existing `inception.json` unless `--force` is provided
- Supports `--plan` so you can inspect the generated manifest before writing it
- Discovers agent-rules Markdown files in the root and conventional subdirectories (`rules/`, `instructions/`, `.github/`), mapping them to agents using Claude-first portability conventions: `copilot-instructions.md` maps to `claude-code` (Copilot reads `CLAUDE.md` natively), and the fallback for unrecognized files excludes unsupported agents plus shared-surface riders that should default to their primary deploy target
- Reads `mcp-servers.json` from the repo root (if present) and generates `mcpServers` entries; invalid entries are warned and skipped
- Reads `files-manifest.json` from the repo root (if present) and generates `files` entries; invalid entries are warned and skipped
- Reads `configs-manifest.json` from the repo root (if present) and generates `configs` entries; invalid entries are warned and skipped
- Reads `agent-definitions-manifest.json` from the repo root (if present) and generates `agentDefinitions` entries; if absent, auto-discovers agent-definition Markdown files from `.claude/agents/`, `.gemini/agents/`, `.agents/rules/`, `.opencode/agents/`, `.github/copilot/agents/`, and legacy `.github/agents/`; invalid entries are warned and skipped
- Emits guidance to create a sidecar manifest when a `files/` or `configs/` directory is detected but the corresponding sidecar file is absent

Current `init` limitations:

- It does not reconcile generated manifest entries against `SKILL.md` frontmatter values
- `files` and `configs` target paths are deployment-system-specific and cannot be inferred; they must be provided explicitly in `files-manifest.json` and `configs-manifest.json`

### Repo Conventions Recognized by `init`

Place a `mcp-servers.json` file at the repo root to have `init` populate the `mcpServers` section automatically. The file must be a JSON array of MCP server entries using the same schema as the `mcpServers` field in `inception.json`:

```json
[
  {
    "name": "my-server",
    "agents": ["claude-code", "gemini-cli"],
    "config": { "command": "npx", "args": ["-y", "my-mcp-server"] }
  }
]
```

Place a `files-manifest.json` file at the repo root to have `init` populate the `files` section automatically. The file must be a JSON array of file entries using the same schema as the `files` field in `inception.json`:

```json
[
  {
    "name": "my-settings",
    "path": "files/settings.json",
    "target": "{home}/.claude/settings.json",
    "agents": ["claude-code"]
  }
]
```

Place a `configs-manifest.json` file at the repo root to have `init` populate the `configs` section automatically. The file must be a JSON array of config entries using the same schema as the `configs` field in `inception.json`:

```json
[
  {
    "name": "enable-feature",
    "target": "{home}/.claude/settings.json",
    "patch": { "someFeature": true },
    "agents": ["claude-code"]
  }
]
```

Invalid entries are warned and skipped; the rest are written into the generated manifest verbatim.

Place an `agent-definitions-manifest.json` file at the repo root to have `init` populate the `agentDefinitions` section automatically. The file must be a JSON array of agent-definition entries using the same schema as the `agentDefinitions` field in `inception.json`:

```json
[
  {
    "name": "code-reviewer",
    "path": "agents/code-reviewer.md",
    "agents": ["claude-code", "opencode", "github-copilot"]
  }
]
```

If no `agent-definitions-manifest.json` is present, `init` auto-discovers agent-definition Markdown files from six conventional subdirectories: `.claude/agents/`, `.gemini/agents/`, `.agents/rules/`, `.opencode/agents/`, `.github/copilot/agents/`, and legacy `.github/agents/`. Each discovered file is mapped to the owning agent(s). GitHub Copilot files named `{name}.agent.md` in the legacy directory have the `.agent` infix stripped to derive the manifest name (e.g., `foo.agent.md` -> name `foo`).

Invalid entries are warned and skipped; the rest are written into the generated manifest verbatim.

For shared surfaces, `init` prefers the primary deploy target instead of emitting both agents. That means generated `skills` entries exclude `github-copilot` in favor of `claude-code`, and generated shared `GEMINI.md` `agentRules` entries exclude `antigravity` in favor of `gemini-cli`. This keeps starter manifests minimal while preserving deploy behavior for explicitly authored shared-rider entries.

## CLI Reference

```
inception-engine <directory> [options]
inception-engine revert <directory> [options]
inception-engine init <directory> [options]
```

### Commands

| Command | Description |
|---|---|
| `<directory>` | Deploy skills from the manifest in the given directory |
| `revert <directory>` | Remove previously deployed skills declared in the manifest |
| `init <directory>` | Scan a directory for skill folders and generate `inception.json` |

### Options

| Option | Description |
|---|---|
| `--plan` | Show what would be done without making changes |
| `--agents <list>` | Comma-separated list of agent IDs to target (overrides deploy detection; restricts revert) |
| `--force` | `init` only; overwrite an existing `inception.json` |
| `--verbose` | Show detailed output including file paths |
| `--debug` | Show full error stack traces |
| `--help` | Show help message |

With `--plan`, deploy and revert print a grouped action preview by agent. Each planned change includes the source path when applicable, the resolved target path, and action-specific details such as JSON/TOML patch payloads or emitted frontmatter content.

### Examples

```bash
# Deploy all skills to all detected agents
npx @kuznai/inception-engine ./my-skills-repo

# Preview what would be deployed
npx @kuznai/inception-engine ./my-skills-repo --plan

# Deploy only to Claude Code and Codex
npx @kuznai/inception-engine ./my-skills-repo --agents claude-code,codex

# Remove deployed skills
npx @kuznai/inception-engine revert ./my-skills-repo

# Preview what would be removed
npx @kuznai/inception-engine revert ./my-skills-repo --plan

# Generate a starter manifest from discovered skill folders
npx @kuznai/inception-engine init ./my-skills-repo

# Preview the generated manifest without writing it
npx @kuznai/inception-engine init ./my-skills-repo --plan
```

## Sample Skills

The `limbo/` directory contains exceptional sample skills for testing purposes only.

Try them out:

```bash
npx @kuznai/inception-engine init limbo --plan
npx @kuznai/inception-engine limbo --plan
```

## Agent Detection

inception-engine automatically detects which agents are installed by checking:

1. Whether the agent's config directory exists (e.g., `~/.claude/` for Claude Code)
2. Whether the agent's binary is in your PATH (e.g., `claude`, `codex`, `gemini`)

If an agent isn't detected, its skills are skipped during deploy. Use `--agents` to override detection.

Revert targets all agents listed in the manifest by default (regardless of detection) so that previously deployed skills are cleaned up even if the agent has since been uninstalled. Use `--agents` to restrict revert to specific agents.

## Cross-Platform Behavior

| Platform | Deploy Method | Behavior |
|---|---|---|
| macOS | Symlink | Source changes are reflected immediately |
| Linux | Symlink | Source changes are reflected immediately |
| Windows | Copy | Source must be re-deployed after changes |

### Ownership Tracking and Safe Revert

inception-engine maintains a centralized deployment registry at `~/.inception-engine/registry.json`. Each deploy records the target path, skill name, agent ID, action-specific provenance (`source`/`method` for skill-dir, `source` for file-write, `patch`/`undoPatch` for config-patch, `patch`/`undoPatch` plus frontmatter-shape metadata for frontmatter-emit), and timestamp. Registry entries also carry a stable surface ID so future surface migrations can preserve ownership continuity. No files are written to the source repository.

- **Registry-based ownership**: On revert, the registry is checked before removing any target. Only targets with a valid registry entry are removed. On redeploy, unmanaged targets are never replaced.

- **Strong binding**: Each registry entry binds a specific target path to its skill, agent, and action kind. For `skill-dir` and `file-write`, ownership checks also require the recorded `source` to match before an existing target is treated as managed. For `config-patch` and `frontmatter-emit`, overwrite protection is keyed by target path, kind, skill, and agent; the stored `patch` and `undoPatch` are used for patch-level revert bookkeeping rather than deploy-time identity checks.

- **Atomic redeploy**: When overwriting an existing managed `skill-dir` target, the engine renames the old target to a backup, creates the new deployment, and only removes the backup on success. If the new deployment fails, the backup is restored. `file-write` and `config-patch` deployments write directly to the target without this backup/rollback model.

- **Cross-platform**: The registry uses the same resolved home directory as the rest of the tool, including sudo scenarios on POSIX and elevated PowerShell on Windows.

## Running with Privilege Escalation

The tool works without elevated privileges. If run with `sudo` on POSIX systems, it looks up the real user's home directory from the OS directory services (`getent passwd` on Linux, `dscl` on macOS, `/etc/passwd` as a universal fallback) so skills are deployed to the correct location regardless of where home directories are stored — standard `/home/<user>`, LDAP/NIS paths, enterprise layouts, or otherwise.

If the real home cannot be determined, the tool exits with an error rather than silently deploying to a guessed path.

On Windows, `os.homedir()` correctly resolves even in elevated PowerShell or cmd.

## Security & Compatibility Notes

### SUDO_USER handling

When run under `sudo` on POSIX, `SUDO_USER` is read as an advisory signal to identify the real user. The username is validated through OS directory services (`getent passwd` on Linux, `dscl` on macOS, `/etc/passwd` as a fallback) — it is never used as a raw path. This is standard practice for sudo-aware CLI tools.

`SUDO_USER` is only consulted when the process is actually running as root (UID 0). If `SUDO_USER` is present in the environment but the process is not root — for example, as a stale shell variable from a prior `sudo` session or an externally injected value in automation — it is ignored and the standard home directory is used instead.

### XDG_CONFIG_HOME support

On POSIX, agents whose config lives under `~/.config/` (currently OpenCode) honor `$XDG_CONFIG_HOME` when it is set to an absolute path. If the variable is unset or contains a relative path (which the XDG Base Directory Specification disallows), the tool falls back to the standard `~/.config` default. This has no effect on Windows.

### Windows %APPDATA% fallback

On Windows, `%APPDATA%` is used to locate agent config directories (currently only OpenCode). When `%APPDATA%` is unset — which can happen in some service or minimal sandbox contexts — the tool falls back to `AppData\Roaming` under the resolved home directory. This fallback is intentional and correct for interactive user sessions and elevated PowerShell. Running as a Windows service account is outside the supported use case for this tool.

### Future: mixed asset layouts on Windows

Windows deployment currently uses directory-level copy (one `cp -r` per skill). This works correctly for the present skill model where each skill is a single directory. If file-based assets or mixed (file + directory) skill layouts are added in the future, the copy strategy in `src/core/deploy.ts` will need revisiting.

## Requirements

- Published CLI runtime: Node.js >= 22.3.0
- Direct TypeScript execution in this repo (`npm run dev`, `npm test`): Node.js >= 22.18.0

`inception-engine` publishes compiled JavaScript from `dist/`, so end users do not need the newer Node version required for this repository's direct `.ts` workflows. The higher contributor floor exists only because this repo intentionally runs TypeScript straight through `node` for local development and tests, with no `tsx`, `ts-node`, or experimental TypeScript flags.

## License

MIT
