# Inception Engine: North Star
Technical specification for global AI agent customizations and cross-platform compatibility.

## Global Customization Vectors

### 1. Global System Instructions
Persistent Markdown files containing rules and context loaded at the start of every session.
- **Claude Code**: `~/.claude/CLAUDE.md`
- **OpenAI Codex**: `~/.codex/AGENTS.md`
- **Gemini CLI / Antigravity**: `~/.gemini/GEMINI.md` (Shared path collision)
- **OpenCode**: `~/.config/opencode/AGENTS.md`
- **GitHub Copilot**: Org-level `.github/copilot-instructions.md`

### 2. Model Context Protocol (MCP)
Registration of external tools and resources via JSON/YAML manifests.
- **Standard Schema**: Used by Claude Code; nested JSON mapping server names to binaries/args.
- **OpenCode Divergence**: Embedded in `opencode.json` under `mcp` key. Requires `type: "local"`, merged command/args array, and `{env:VAR}` syntax.
- **Codex Divergence**: Declared in `agents/openai.yaml` within skill directories (just-in-time loading).
- **Copilot Divergence**: Requires explicit `stdio` or `sse` transport flags in `mcp.json`.

### 3. Subagent Topologies
Isolated background workers with specialized prompts and toolsets.
- **TOML-based (Codex)**: `~/.codex/agents/*.toml`. Supports parallel execution (`max_threads`) and fan-out via CSV.
- **Markdown + YAML (OpenCode/Claude)**: `~/.config/opencode/agents/*.md` or `.claude/agents/*.md`. Frontmatter defines model and parameters.
- **Sequential (Gemini CLI)**: Lacks parallel orchestration; subagents run in a single event loop.

### 4. Execution Hooks
Lifecycle event triggers for pre-validation, linting, or state sync.
- **GitHub Copilot**: Formal JSON schema in config (bash/powershell paths, `timeoutSec`).
- **OpenCode**: Emulated via `commands` in `opencode.json` and strict `permission: { "bash": "ask" }` blocks to force pauses.

## Compatibility Matrix

| Feature | Claude Code | OpenAI Codex | Gemini CLI | Antigravity | OpenCode | GitHub Copilot |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Global Path** | `~/.claude/` | `~/.codex/` | `~/.gemini/` | `~/.gemini/` | `~/.config/opencode/` | `.github/` (Org) |
| **Instruction File** | `CLAUDE.md` | `AGENTS.md` | `GEMINI.md` | `GEMINI.md` | `AGENTS.md` | `copilot-instructions.md` |
| **MCP Format** | Native JSON | `openai.yaml` | CLI/JSON | Proprietary | `opencode.json` | `mcp.json` |
| **Subagent Spec** | MD + YAML | TOML | Sequential | Task Groups | MD + YAML | YAML Frontmatter |
| **Variable Syntax**| `${VAR}` | Shell Env | Shell Env | Shell Env | `{env:VAR}` | `env` object |

## Critical Discrepancies & Implementation Notes

### Google Path Collision
Both Gemini CLI and Antigravity target `~/.gemini/GEMINI.md`. Deployment must prevent workspace-specific Antigravity rules from polluting the global Gemini CLI context.

### Token Economics (Context Rot)
- **Limit**: Frontier models degrade after ~150-200 instructions.
- **Safe Guard**: Inception Engine must lint payloads; warnings should trigger if global + workspace rules exceed ~4,000 tokens or 65KB.
- **Claude Constraint**: Claude's internal prompt consumes ~50 instruction slots, further limiting `CLAUDE.md` capacity.

### Security Paradigms
- **Claude Code**: "Safe by default" (prompts for confirmation).
- **OpenCode**: "Fast by default" (autonomous execution). Future config-patching support should inject `ask` permissions in `opencode.json` to emulate "safe" hooks.

### MCP Transformation (Standard to OpenCode)
1. Rename `env` to `environment`.
2. Convert `${VAR}` to `{env:VAR}`.
3. Merge `command` and `args` into a single array.
4. Add `"type": "local"`.
