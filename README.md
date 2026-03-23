# inception-engine

Plant skills directly into the minds of your installed AI coding agents — Claude Code, Codex, Gemini CLI, Antigravity, OpenCode, and GitHub Copilot. One command. They'll think they thought of it themselves.

Today, inception-engine is a skills deployer. It does not yet manage persistent instruction files, MCP configuration, subagents, or agent-specific config patching.

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
| GitHub Copilot | `github-copilot` | `~/.copilot/skills/` | Yes | Yes | Yes |

\* Antigravity support is currently based on the implementation's registry path assumptions and local validation, not a strong official doc set equivalent to the other agents.

\* OpenCode on Windows uses `%APPDATA%\opencode\skills\`.

### Feature Support

| Feature | Status |
|---|---|
| Skills (SKILL.md) | Supported |
| MCP Servers | Accepted in manifest, not implemented |
| Agent Rules | Accepted in manifest, not implemented |

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

- **name** - Unique skill identifier using letters, digits, dots, underscores, or hyphens; it must not start with a dot
- **path** - Relative path to the skill directory within the repo
- **agents** - Array of agent IDs to deploy this skill to. If an agent isn't installed, it's skipped.

`mcpServers` and `agentRules` are currently parsed for forward compatibility, but the deployment engine ignores them today.

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
| `revert <directory>` | Remove previously deployed skills declared in the manifest |

### Options

| Option | Description |
|---|---|
| `--dry-run` | Show what would be done without making changes |
| `--agents <list>` | Comma-separated list of agent IDs to target (overrides deploy detection; restricts revert) |
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

If an agent isn't detected, its skills are skipped during deploy. Use `--agents` to override detection.

Revert targets all agents listed in the manifest by default (regardless of detection) so that previously deployed skills are cleaned up even if the agent has since been uninstalled. Use `--agents` to restrict revert to specific agents.

## Cross-Platform Behavior

| Platform | Deploy Method | Behavior |
|---|---|---|
| macOS | Symlink | Source changes are reflected immediately |
| Linux | Symlink | Source changes are reflected immediately |
| Windows | Copy | Source must be re-deployed after changes |

### Ownership Tracking and Safe Revert

inception-engine writes a structured `.inception-totem` marker file during every deploy so that `revert` and future deploys never touch content they did not create. The totem contains metadata (source path, skill name, agent ID, deploy timestamp) and is validated on both revert and redeploy.

- **POSIX (symlink)**: `.inception-totem` is written inside the skill source directory. On revert, the tool resolves the symlink target and checks for a valid `.inception-totem` there. Only symlinks whose resolved target contains a valid totem are removed.

- **Windows (copy)**: `.inception-totem` is written inside each deployed skill directory. On revert, this file must be present and valid for the directory to be removed.

- **Deploy safety**: Before overwriting an existing target, the engine checks for a valid `.inception-totem`. If the target exists but is not managed by inception-engine, the deploy is skipped with an error — the unmanaged content is never removed.

- **Atomic redeploy**: When overwriting an existing managed target, the engine renames the old target to a backup, creates the new deployment, and only removes the backup on success. If the new deployment fails, the backup is restored.

## Running with Privilege Escalation

The tool works without elevated privileges. If run with `sudo` on POSIX systems, it looks up the real user's home directory from the OS directory services (`getent passwd` on Linux, `dscl` on macOS, `/etc/passwd` as a universal fallback) so skills are deployed to the correct location regardless of where home directories are stored — standard `/home/<user>`, LDAP/NIS paths, enterprise layouts, or otherwise.

If the real home cannot be determined, the tool exits with an error rather than silently deploying to a guessed path.

On Windows, `os.homedir()` correctly resolves even in elevated PowerShell or cmd.

## Security & Compatibility Notes

### SUDO_USER handling

When run under `sudo` on POSIX, `SUDO_USER` is read as an advisory signal to identify the real user. The username is validated through OS directory services (`getent passwd` on Linux, `dscl` on macOS, `/etc/passwd` as a fallback) — it is never used as a raw path. This is standard practice for sudo-aware CLI tools.

Automation edge case: if the tool runs inside a pipeline where `SUDO_USER` has been set externally in the environment before the process starts, the tool will look up that username's home directory. To avoid this in automation, either run without `sudo` or set `HOME` explicitly before invoking the tool.

### Windows %APPDATA% fallback

On Windows, `%APPDATA%` is used to locate agent config directories (currently only OpenCode). When `%APPDATA%` is unset — which can happen in some service or minimal sandbox contexts — the tool falls back to `AppData\Roaming` under the resolved home directory. This fallback is intentional and correct for interactive user sessions and elevated PowerShell. Running as a Windows service account is outside the supported use case for this tool.

### Future: mixed asset layouts on Windows

Windows deployment currently uses directory-level copy (one `cp -r` per skill). This works correctly for the present skill model where each skill is a single directory. If file-based assets or mixed (file + directory) skill layouts are added in the future, the copy strategy in `src/core/deploy.ts` will need revisiting — including `.inception-totem` placement and revert logic.

## Requirements

- Node.js >= 23.6.0

## License

MIT
