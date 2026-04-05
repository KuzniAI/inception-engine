# Inception Engine: North Star
Portability target for global AI agent customizations and cross-platform compatibility.

This document describes where the project should aim, not a guarantee that every agent currently supports every vector in exactly the same way. Each claim below is labeled by confidence level:

- **Confirmed by current official docs**: verified in current vendor documentation.
- **Confirmed by current implementation only**: supported by this repo's current registry or behavior, but not strongly verified in current vendor docs.
- **Unverified / speculative**: plausible direction, but not something the engine should treat as settled fact.

## Goal

Evolve inception-engine from a skills-only deployer into a portability layer for the customization surfaces that modern coding agents expose today:

1. Persistent instruction files
2. MCP configuration
3. Agent and subagent definitions
4. Execution and safety-oriented config patching

The engine should prefer:

- explicit ownership tracking
- reversible changes
- agent-specific adapters over lossy "universal" formats
- conservative handling where vendor behavior is unclear

## Customization Vectors

### 1. Persistent Instruction Files

These are durable instruction surfaces loaded outside a single prompt.

| Agent | Current surface | Confidence | Notes |
|---|---|---|---|
| Claude Code | `CLAUDE.md` (root, folder-level) and `~/.claude/CLAUDE.md` | Confirmed by current official docs | Supports hierarchical loading; folder-specific files override root. |
| OpenAI Codex | `AGENTS.md` (root, nested) and `~/.codex/AGENTS.md` | Confirmed by current official docs | Concatenates from root down; files closer to CWD override earlier ones. |
| Gemini CLI | `GEMINI.md` (root, workspace), `AGENTS.md`, and `~/.gemini/GEMINI.md` | Confirmed by current official docs | Hierarchical loading with JIT scanning support; configurable filenames via `settings.json`. |
| Antigravity | `.agents/rules/*.md` (repo-local); `GEMINI.md` used as "Agent Blueprint" | Confirmed by current official docs | Deploys to `{repo}/.agents/rules/{name}.md`. Reads `GEMINI.md` for blueprint instructions. |
| OpenCode | `AGENTS.md`, `CLAUDE.md` (fallback), and `opencode.json` | Confirmed by current official docs | Project > Global precedence. Supports Claude Code fallback. |
| GitHub Copilot | `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, and `.github/instructions/*.instructions.md` | Confirmed by current official docs | **Claude Precedence**: Natively consumes `CLAUDE.md`. Scoped rules via `.github/instructions/`. |

### 2. MCP Configuration

MCP support is standard across modern coding agents, but storage locations and schemas vary.

| Agent | Current surface | Confidence | Notes |
|---|---|---|---|
| Claude Code | `.claude/mcp.json` and `~/.claude.json` | Confirmed by current official docs | Project-level config (committed) vs user-level (global). Global config also in `~/.claude/settings.json`. |
| OpenAI Codex | `~/.codex/config.toml` | Confirmed by current official docs | Managed via TOML. |
| Gemini CLI | `~/.gemini/settings.json` | Confirmed by current official docs | Configured under `mcpServers` key. |
| Antigravity | `mcp_config.json` and `.agents/rules/` frontmatter | Confirmed by current official docs | Extends custom agents with external tools via frontmatter or raw JSON config. |
| OpenCode | `opencode.json` under `mcp` | Confirmed by current official docs | Supports `local` (command) and `remote` (URL) server types. |
| GitHub Copilot | `.vscode/mcp.json`, `devcontainer.json`, and agent frontmatter | Confirmed by current official docs | Supports workspace-level, devcontainer-level, and agent-specific tool mapping. |

### 3. Agents and Subagents

Agent orchestration has converged on Markdown files with YAML frontmatter for custom definitions.

| Agent | Current surface | Confidence | Notes |
|---|---|---|---|
| Claude Code | `.claude/agents/` or `.claude/skills/` | Confirmed by current official docs | Uses Markdown with YAML frontmatter or `SKILL.md` files. |
| OpenAI Codex | Custom GPT-like instructions in `~/.codex/` | Confirmed by current official docs | Managed via `AGENTS.md` and `config.toml`. |
| Gemini CLI | `.gemini/agents/` and `~/.gemini/agents/` | Confirmed by current official docs | Supports Markdown and TOML subagent definitions. Managed via `/agents` commands. |
| Antigravity | `.agents/rules/*.md` and `.agents/skills/` | Confirmed by current official docs | Defines specialized workflows and personas using `SKILL.md` with frontmatter. |
| OpenCode | `.opencode/agents/*.md` and `~/.config/opencode/agents/` | Confirmed by current official docs | Multi-agent architecture (Primary vs Subagent). |
| GitHub Copilot | `.github/copilot/agents/*.md` | Confirmed by current official docs | **Skill Mirroring**: Natively executes Claude-style skills from `.claude/skills/`. |

### 4. Execution and Safety-Oriented Config

Agents expose granular controls over command execution, tool permissions, and lifecycle hooks.

| Agent | Current surface | Confidence | Notes |
|---|---|---|---|
| GitHub Copilot | Agent frontmatter and binary hooks | Confirmed by current official docs | Supports pre/post-execution hooks calling external binaries via stdin/stdout. |
| OpenCode | `opencode.json` permissions | Confirmed by current official docs | Granular permissions with wildcard support (`allow`, `ask`, `deny`). |
| Claude Code | `.claude/settings.json` and `.claude/hooks/` | Confirmed by current official docs | Extensive lifecycle hooks (15+ events); supports JS/Python/Shell via stdout injection and exit codes. |
| OpenAI Codex | `config.toml` approval policies | Confirmed by current official docs | Defines `approval_policy` for shell commands. |
| Gemini CLI | `settings.json` and safe-mode flags | Confirmed by current official docs | Execution-hook parity is emerging. |

## Portability Principles

### Claude-First Portability

When multiple agents support the same artifact (e.g., `CLAUDE.md` or `.claude/skills/`), the engine treats the Claude-native format as the authoritative source for cross-platform synchronization. This reduces "drift" between agent behaviors.

### Agent-Specific Adapters Over Forced Uniformity

The engine should normalize the manifest model only where behavior is genuinely shared. It should not force a single canonical on-disk representation for MCP, agents, or instructions when vendors expose materially different schemas.

### Confidence-Aware Planning

Every new vector should be classified before implementation:

- **Confirmed by docs**: safe to design concrete deploy logic.
- **Confirmed by implementation only**: acceptable for targeted support, but document that the behavior is based on observed paths or local testing.
- **Unverified / speculative**: roadmap candidate only, not a committed contract.

### Reversible Ownership

Directory copies and symlinks are not enough once the engine manages single files and config patches. The long-term design needs:

- file-level ownership proofs
- patch-level provenance for config files
- dry-run visibility into exact changes
- revert behavior that only removes engine-owned content

### Conservative Transformations

Cross-agent translation should be explicit and minimal. Example: OpenCode MCP transforms may require environment-key renaming or command-shape changes, but those rules should be implemented only where documented.

## Known Cross-Agent Tensions

### Infrastructure Resilience (Agentic Brown-out)

The "Agentic Brown-out" risk requires the engine to support dual-path configurations (e.g., Anthropic Direct and GitHub Infrastructure) to ensure continuous operation when a primary provider is unreachable.

### Gemini CLI / Antigravity Shared Lineage

This repo currently treats Gemini CLI and Antigravity as related but distinct targets. Any shared config path, especially around `GEMINI.md`, should be treated as a collision risk until the products are better differentiated.

### Token and Instruction Budget

Instruction overload is a real practical concern across agents, but hard numbers drift quickly. The engine should treat instruction-budget warnings as heuristics rather than fixed limits, and keep any default thresholds configurable.

### Enterprise Overrides

Some agent environments, especially GitHub Copilot, may ignore or constrain local configuration because of organization policy. The engine should detect and warn where possible instead of pretending all local config is authoritative.

Detection and warning for GitHub Copilot is now implemented via preflight `"policy"` warnings surfaced before deployment begins.

## Current Product Boundary

Today the codebase is still a cross-platform skill deployer. The north star is intentionally broader than the implementation, but future work should only promote a vector from "vision" to "supported capability" when both of these are true:

1. The target agent surface is documented or otherwise validated strongly enough.
2. The engine can manage it safely with ownership tracking, dry-run visibility, and reversible behavior.
