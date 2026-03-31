# inception-engine

Plant skills directly into the minds of your installed AI coding agents — Claude Code, Codex, Gemini CLI, Antigravity, and OpenCode. One command. They'll think they thought of it themselves.

Today, inception-engine works as a cross-agent deployer for skills on all listed agents, plus single-file writes and JSON config patches. It also supports MCP server registration and global rules-file deployment for the subset of agents whose config surfaces are implemented and validated today.

GitHub Copilot is no longer treated as a separate instruction or skill target in the product direction when it can consume Claude-native artifacts directly. If Copilot uses `CLAUDE.md` or Claude-style skill layouts without translation, inception-engine should rely on the Claude deployment path instead of maintaining duplicate Copilot-specific surfaces. Dedicated Copilot customization remains justified only where Copilot exposes a materially different interface, such as MCP-related configuration.

The broader portability layer is the roadmap direction, but this README focuses on what is working now.

`init` is available as a bootstrap command, but what works today is intentionally narrow: it scans for directories containing `SKILL.md` and generates starter `skills` entries plus empty `mcpServers` and `agentRules` arrays. It does not infer `files`, `configs`, MCP server definitions, or rules files from the repository yet.

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
| MCP Servers | claude-code, gemini-cli; other agents are warned and skipped | claude-code, gemini-cli |
| Global Rules Files | claude-code, codex, gemini-cli, opencode; github-copilot reads CLAUDE.md natively (deploy via claude-code); other agents are warned and skipped | claude-code, codex, gemini-cli, opencode |
| `init` manifest generation | Scans `SKILL.md` directories and writes starter `skills` entries | N/A |

Features that depend on agent-specific config surfaces are intentionally conservative: if a target path or schema is not implemented with enough confidence, inception-engine warns and skips it rather than guessing.

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
    }
  ],
  "agentRules": [
    {
      "name": "my-rules",
      "path": "rules/CLAUDE.md",
      "agents": ["claude-code"]
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

MCP server registration is currently supported for `claude-code` (`~/.claude.json`) and `gemini-cli` (`~/.gemini/settings.json`). Other agents emit a schema-aware warning and are skipped when their support would require a non-JSON adapter, such as Codex `config.toml`, Antigravity frontmatter in repo-scoped rules files, OpenCode `opencode.json`, or GitHub Copilot repo-scoped MCP surfaces. Revert removes the registered server entry from the config file.

Each **agentRules** entry deploys a Markdown instruction file to an agent's supported global rules file location:

- **name** - Unique identifier (same format as skill names)
- **path** - Relative path to the source Markdown file within the repo; supported global rules adapters require a `.md` or `.markdown` source path
- **agents** - Array of agent IDs to deploy this file to

Global rules-file deployment is currently supported for `claude-code` (`~/.claude/CLAUDE.md`), `codex` (`~/.codex/AGENTS.md`), `gemini-cli` (`~/.gemini/GEMINI.md`), and `opencode` (`~/.config/opencode/AGENTS.md`). For `github-copilot`, no separate deployment is needed because Copilot reads `CLAUDE.md` natively — target it via the `claude-code` agentRules entry and it reaches Copilot automatically. Other agents emit schema-aware warnings and are skipped when their instruction surfaces are repo-scoped, frontmatter-driven, or otherwise not implemented as a single global Markdown file. Revert removes the deployed rules file.

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

`init` is meant to bootstrap a repository that already has skill folders. It recursively scans the target directory, treats any directory containing `SKILL.md` as a skill, and writes a starter `inception.json`.

Current `init` behavior:

- Generates `skills` entries using the discovered relative paths
- Uses the directory name as the manifest skill name
- Applies either the `--agents` list or all currently known agent IDs
- Refuses to overwrite an existing `inception.json` unless `--force` is provided
- Supports `--dry-run` so you can inspect the generated manifest before writing it

Current `init` limitations:

- It does not reconcile generated manifest entries against `SKILL.md` frontmatter values
- It does not infer `files`, `configs`, `mcpServers`, or `agentRules`
- It does not reconcile generated output with the longer-term Claude-first portability direction

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
| `--dry-run` | Show what would be done without making changes |
| `--agents <list>` | Comma-separated list of agent IDs to target (overrides deploy detection; restricts revert) |
| `--force` | `init` only; overwrite an existing `inception.json` |
| `--verbose` | Show detailed output including file paths |
| `--debug` | Show full error stack traces |
| `--help` | Show help message |

### Examples

```bash
# Deploy all skills to all detected agents
npx @kuznai/inception-engine ./my-skills-repo

# Preview what would be deployed
npx @kuznai/inception-engine ./my-skills-repo --dry-run

# Deploy only to Claude Code and Codex
npx @kuznai/inception-engine ./my-skills-repo --agents claude-code,codex

# Remove deployed skills
npx @kuznai/inception-engine revert ./my-skills-repo

# Preview what would be removed
npx @kuznai/inception-engine revert ./my-skills-repo --dry-run

# Generate a starter manifest from discovered skill folders
npx @kuznai/inception-engine init ./my-skills-repo

# Preview the generated manifest without writing it
npx @kuznai/inception-engine init ./my-skills-repo --dry-run
```

## Sample Skills

The `limbo/` directory contains exceptional sample skills for testing purposes only.

Try them out:

```bash
npx @kuznai/inception-engine init limbo --dry-run
npx @kuznai/inception-engine limbo --dry-run
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

inception-engine maintains a centralized deployment registry at `~/.inception-engine/registry.json`. Each deploy records the target path, skill name, agent ID, action-specific provenance (`source`/`method` for skill-dir, `source` for file-write, `patch`/`undoPatch` for config-patch), and timestamp. No files are written to the source repository.

- **Registry-based ownership**: On revert, the registry is checked before removing any target. Only targets with a valid registry entry are removed. On redeploy, unmanaged targets are never replaced.

- **Strong binding**: Each registry entry binds a specific target path to its skill, agent, and action kind. For `skill-dir` and `file-write`, ownership checks also require the recorded `source` to match before an existing target is treated as managed. For `config-patch`, overwrite protection is keyed by target path, kind, skill, and agent; the stored `patch` and `undoPatch` are used for revert bookkeeping rather than deploy-time identity checks.

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
