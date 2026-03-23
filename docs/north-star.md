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
| Claude Code | `~/.claude/CLAUDE.md` and repo-local `CLAUDE.md` patterns | Confirmed by current official docs | Instruction loading is a real customization vector and should be a first-class target. |
| OpenAI Codex | `AGENTS.md` in repo/home context | Confirmed by current official docs | `AGENTS.md` is real; deeper precedence and placement should be treated as agent-specific behavior, not normalized away. |
| Gemini CLI | `GEMINI.md` in repo/home hierarchy | Confirmed by current official docs | Hierarchical loading exists and should be modeled explicitly. |
| Antigravity | likely `GEMINI.md`-compatible surfaces | Confirmed by current implementation only | Keep support provisional until backed by stronger official product docs. |
| OpenCode | `AGENTS.md` | Confirmed by current official docs | Global and repo rules are a real target surface. |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, and CLI `AGENTS.md` | Confirmed by current official docs | Copilot has multiple instruction surfaces; avoid reducing this to a single org-level file. |

### 2. MCP Configuration

MCP support exists across modern coding agents, but the storage shape and transformation rules differ.

| Agent | Current surface | Confidence | Notes |
|---|---|---|---|
| Claude Code | `~/.claude.json` and project `.mcp.json` | Confirmed by current official docs | JSON-based MCP surfaces are real and should be patchable. |
| OpenAI Codex | CLI-managed MCP and `~/.codex/config.toml` | Confirmed by current official docs | Treat Codex MCP as config-driven; do not assume skill-local `openai.yaml`. |
| Gemini CLI | MCP support exists | Confirmed by current official docs | Exact transformation policy should remain adapter-specific. |
| Antigravity | likely Gemini-adjacent or proprietary MCP integration | Unverified / speculative | Do not lock implementation around assumed format yet. |
| OpenCode | `opencode.json` under `mcp` | Confirmed by current official docs | Current docs support `type`, command array, and `environment`; transformations should target the documented schema exactly. |
| GitHub Copilot | MCP config with explicit transport definitions | Confirmed by current official docs | Enterprise policy may override or disable local behavior, so warnings matter. |

### 3. Agents and Subagents

Agent orchestration is becoming common, but the representation differs enough that the engine should adapt per platform rather than assume a universal source format.

| Agent | Current surface | Confidence | Notes |
|---|---|---|---|
| Claude Code | Markdown files with YAML frontmatter in `.claude/agents/` or `~/.claude/agents/` | Confirmed by current official docs | Good candidate for first concrete subagent adapter support. |
| OpenAI Codex | Subagent concepts exist, but user-defined on-disk format is not strongly verified | Unverified / speculative | Do not assume TOML files or stable install paths until backed by primary docs. |
| Gemini CLI | Agentic workflows exist, but specific user-defined subagent file schema is not strongly verified | Unverified / speculative | Avoid hard claims such as "sequential single event loop" without source support. |
| Antigravity | multi-agent positioning appears central | Confirmed by current implementation only | Treat as provisional until there is stronger official schema documentation. |
| OpenCode | agent and subagent support with documented config surfaces | Confirmed by current official docs | Support should follow the documented OpenCode schema, not inferred parity with Claude. |
| GitHub Copilot | custom agents exist in CLI workflows | Confirmed by current official docs | File formats and deployment surfaces should be modeled from current docs, not guessed from adjacent tools. |

### 4. Execution and Safety-Oriented Config

Some agents expose lifecycle hooks or permission controls directly; others only allow indirect safety shaping through config.

| Agent | Current surface | Confidence | Notes |
|---|---|---|---|
| GitHub Copilot | lifecycle and agent config surfaces | Confirmed by current official docs | Worth targeting once file/config patching exists. |
| OpenCode | permissions and command config in `opencode.json` | Confirmed by current official docs | Safe-by-default patching is a practical target. |
| Claude Code | permission and settings surfaces exist | Confirmed by current official docs | Hook-style behavior should be modeled carefully rather than assumed equivalent to Copilot. |
| OpenAI Codex | safety and config surfaces exist | Confirmed by current official docs | Keep scope to documented config, not undocumented internal orchestration files. |
| Gemini CLI / Antigravity | execution-hook parity unclear | Unverified / speculative | Do not promise hook support before vendor surfaces are clearly documented. |

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
