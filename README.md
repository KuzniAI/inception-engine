# inception-engine

Plant skills directly into the minds of your installed AI coding agents — Claude Code, Codex, Gemini CLI, Antigravity, OpenCode, and GitHub Copilot. One command. They'll think they thought of it themselves.

## Quick Start

```bash
npx inception-engine <directory>
```

Where `<directory>` is a repo (or subdirectory) containing an `inception.json` manifest and skill files.

## How It Works

inception-engine reads a manifest file (`inception.json`) from the target directory, detects which AI coding agents are installed on the system, and deploys skills to each agent's expected location.

- **POSIX (macOS, Linux)**: creates symlinks from the source skill directory to each agent's skill path
- **Windows**: copies skill directories to each agent's skill path

Skills always overwrite their previous version. On POSIX systems, symlinks mean updates to the source repo are reflected immediately.

## Agent Compatibility Matrix

| Agent | ID | Skills | macOS | Linux | Windows |
|---|---|---|---|---|---|
| Claude Code | `claude-code` | `~/.claude/skills/` | Yes | Yes | Yes |
| OpenAI Codex | `codex` | `~/.codex/skills/` | Yes | Yes | Yes |
| Gemini CLI | `gemini-cli` | `~/.gemini/skills/` | Yes | Yes | Yes |
| Antigravity | `antigravity` | `~/.gemini/antigravity/skills/` | Yes | Yes | Yes |
| OpenCode | `opencode` | `~/.config/opencode/skills/` | Yes | Yes | Yes* |
| GitHub Copilot | `github-copilot` | `~/.copilot/skills/` | Yes | Yes | Yes |

\* OpenCode on Windows uses `%APPDATA%\opencode\skills\`.

### Feature Support

| Feature | Status |
|---|---|
| Skills (SKILL.md) | Supported |
| MCP Servers | Planned |
| Agent Rules | Planned |

## Manifest Format

Create an `inception.json` file at the root of your skills directory:

```json
{
  "skills": [
    {
      "name": "my-skill",
      "path": "skills/my-skill",
      "agents": ["claude-code", "codex", "gemini-cli", "antigravity", "opencode", "github-copilot"]
    }
  ],
  "mcpServers": [],
  "agentRules": []
}
```

Each skill entry has:

- **name** - Unique skill identifier (lowercase, hyphens allowed)
- **path** - Relative path to the skill directory within the repo
- **agents** - Array of agent IDs to deploy this skill to. If an agent isn't installed, it's skipped.

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

The `name` and `description` fields in the frontmatter are required by most agents. The description determines when the agent activates the skill.

## CLI Reference

```
inception-engine <directory> [options]
inception-engine revert <directory> [options]
```

### Commands

| Command | Description |
|---|---|
| `<directory>` | Deploy skills from the manifest in the given directory |
| `revert <directory>` | Remove all skills declared in the manifest |

### Options

| Option | Description |
|---|---|
| `--dry-run` | Show what would be done without making changes |
| `--agents <list>` | Comma-separated list of agent IDs to target (skips detection) |
| `--verbose` | Show detailed output including file paths |
| `--debug` | Show full error stack traces |
| `--help` | Show help message |

### Examples

```bash
# Deploy all skills to all detected agents
npx inception-engine ./my-skills-repo

# Preview what would be deployed
npx inception-engine ./my-skills-repo --dry-run

# Deploy only to Claude Code and Codex
npx inception-engine ./my-skills-repo --agents claude-code,codex

# Remove deployed skills
npx inception-engine revert ./my-skills-repo

# Preview what would be removed
npx inception-engine revert ./my-skills-repo --dry-run
```

## Sample Skills

The `limbo/` directory contains exceptional sample skills for testing purposes only.

Try them out:

```bash
npx inception-engine limbo --dry-run
```

## Agent Detection

inception-engine automatically detects which agents are installed by checking:

1. Whether the agent's config directory exists (e.g., `~/.claude/` for Claude Code)
2. Whether the agent's binary is in your PATH (e.g., `claude`, `codex`, `gemini`)

If an agent isn't detected, its skills are skipped. Use `--agents` to override detection.

## Cross-Platform Behavior

| Platform | Deploy Method | Behavior |
|---|---|---|
| macOS | Symlink | Source changes are reflected immediately |
| Linux | Symlink | Source changes are reflected immediately |
| Windows | Copy | Source must be re-deployed after changes |

## Running with Privilege Escalation

The tool works without elevated privileges. If run with `sudo` on POSIX systems, it resolves the real user's home directory via `SUDO_USER` so skills are deployed to the correct location (not `/root/`).

On Windows, `os.homedir()` correctly resolves even in elevated PowerShell or cmd.

## Requirements

- Node.js >= 23.6.0

## License

MIT
