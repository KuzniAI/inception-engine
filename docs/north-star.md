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
| Claude Code | `CLAUDE.md` (root, folder-level) and `~/.claude/CLAUDE.md` | Confirmed by current official docs | Supports hierarchical loading; folder-specific files override root. Compatibility with `AGENTS.md` is emerging. |
| OpenAI Codex | `AGENTS.md` (root, nested) and `~/.codex/AGENTS.md` | Confirmed by current official docs | Concatenates from root down; files closer to CWD override earlier ones. |
| Gemini CLI | `GEMINI.md` (root, workspace) and `~/.gemini/GEMINI.md` | Confirmed by current official docs | Hierarchical loading with JIT scanning support. Default filename is configurable via `settings.json`. |
| Antigravity | `GEMINI.md` and `.agents/rules/*.md` | Confirmed by current official docs | Uses `GEMINI.md` as an "Agent Blueprint." Supports "Always On" vs "Manual" activation modes. |
| OpenCode | `AGENTS.md` and `opencode.json` | Confirmed by current official docs | Global and repo rules are first-class surfaces. Precedence: Project > Global > Remote. |
| GitHub Copilot | `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md` | Confirmed by current official docs | Scoped instructions use YAML frontmatter to define `applyTo` glob patterns. |

### 2. MCP Configuration

MCP support is standard across modern coding agents, but storage locations and schemas vary.

| Agent | Current surface | Confidence | Notes |
|---|---|---|---|
| Claude Code | `.claude/mcp.json` and `~/.claude.json` | Confirmed by current official docs | Project-level config (committed) vs user-level (global). Uses JSON-based `mcpServers` schema. |
| OpenAI Codex | `~/.codex/config.toml` and `.codex/config.toml` | Confirmed by current official docs | Managed via TOML. Supports tool-specific environment variables and approval policies. |
| Gemini CLI | `~/.gemini/settings.json` | Confirmed by current official docs | Configured under `mcpServers` key. Supports Stdio, SSE, and HTTP transports. |
| Antigravity | Integrated MCP config in `.agents/rules/` | Confirmed by current official docs | Extends custom agents with external tools via frontmatter or `mcp-servers` property. |
| OpenCode | `opencode.json` under `mcp` | Confirmed by current official docs | Supports `local` (command) and `remote` (URL) server types with declarative tool loading. |
| GitHub Copilot | Agent-level MCP config in frontmatter | Confirmed by current official docs | Custom agents can be extended with MCP tools via the `tools` or `mcp-servers` keys. |

### 3. Agents and Subagents

Agent orchestration has converged on Markdown files with YAML frontmatter for custom definitions.

| Agent | Current surface | Confidence | Notes |
|---|---|---|---|
| Claude Code | `.claude/agents/` or `~/.claude/agents/` | Confirmed by current official docs | Uses Markdown with YAML frontmatter. Supports specific model selection and tool sets. |
| OpenAI Codex | Custom GPT-like instructions in `~/.codex/` | Confirmed by current official docs | Managed via `AGENTS.md` and `config.toml`. Subagent behavior is largely model-driven. |
| Gemini CLI | `.gemini/agents/` (provisional) | Confirmed by current implementation only | Moving toward explicit subagent definitions; currently relies on `GEMINI.md` personas. |
| Antigravity | `.agents/rules/*.md` | Confirmed by current official docs | Defines specialized workflows (invoked via `/`) and personas with explicit roles and goals. |
| OpenCode | `.opencode/agents/*.md` and `opencode.json` | Confirmed by current official docs | Multi-agent architecture (Primary vs Subagent). Supports manual @mention or automatic invocation. |
| GitHub Copilot | `.github/agents/*.agent.md` | Confirmed by current official docs | Uses YAML frontmatter (`name`, `description`, `tools`, `model`). Invoked via @mention in chat. |

### 4. Execution and Safety-Oriented Config

Agents expose granular controls over command execution, tool permissions, and lifecycle hooks.

| Agent | Current surface | Confidence | Notes |
|---|---|---|---|
| GitHub Copilot | `.github/copilot-instructions.md` and Agent frontmatter | Confirmed by current official docs | Tool access (`read`, `edit`, `search`) is defined per-agent. Enterprise policies may restrict local config. |
| OpenCode | `opencode.json` permissions | Confirmed by current official docs | Granular permissions (e.g., `"bash": "ask"`, `"edit": "allow"`) with wildcard support for MCP tools. |
| Claude Code | `.claude/mcp.json` and session settings | Confirmed by current official docs | Permission surfaces for external tool execution and data access are real targets. |
| OpenAI Codex | `config.toml` approval policies | Confirmed by current official docs | Defines `approval_policy` (e.g., `always`, `never`, `destructive`) for shell commands. |
| Gemini CLI | `settings.json` and safe-mode flags | Confirmed by current official docs | Execution-hook parity is emerging; priority is on tool-use safety and human-in-the-loop. |

## Portability Principles

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

### Gemini CLI / Antigravity Shared Lineage

This repo currently treats Gemini CLI and Antigravity as related but distinct targets. Any shared config path, especially around `GEMINI.md`, should be treated as a collision risk until the products are better differentiated by official docs and real-world validation.

### Token and Instruction Budget

Instruction overload is a real practical concern across agents, but hard numbers drift quickly. The engine should treat instruction-budget warnings as heuristics rather than fixed limits, and keep any default thresholds configurable.

### Enterprise Overrides

Some agent environments, especially GitHub Copilot, may ignore or constrain local configuration because of organization policy. The engine should detect and warn where possible instead of pretending all local config is authoritative.

## Current Product Boundary

Today the codebase is still a cross-platform skill deployer. The north star is intentionally broader than the implementation, but future work should only promote a vector from "vision" to "supported capability" when both of these are true:

1. The target agent surface is documented or otherwise validated strongly enough.
2. The engine can manage it safely with ownership tracking, dry-run visibility, and reversible behavior.
