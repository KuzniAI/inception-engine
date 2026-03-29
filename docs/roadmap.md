# Inception Engine: Roadmap

This roadmap is forward-looking. It lists work we may choose to prioritize next based on the gap between the broad north star and the narrower set of capabilities described in the README.

## Functional Features

- Add a CLI command that scans a directory containing agent instruction files and generates an `inception.json` manifest for it.
- Expand instruction-file support beyond today's global rules-file deployment to cover repo-local and workspace-local instruction surfaces where the target agent behavior is documented strongly enough.
- Add support for GitHub Copilot instruction deployment, including repo-scoped `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md` surfaces.
- Add support for Antigravity instruction deployment, including `GEMINI.md` and `.agents/rules/*.md`, with clear handling for Gemini CLI / Antigravity path collisions.
- Expand MCP deployment beyond the current JSON-backed targets to additional agents whose MCP surfaces use different schemas or file formats, especially Codex, OpenCode, Antigravity, and GitHub Copilot.
- Add support for agent and subagent definition deployment for agents that expose dedicated agent directories or frontmatter-based agent files.
- Add execution and safety-oriented config support for agent-specific permission and approval surfaces where safe patching and revert semantics can be implemented cleanly.
- Add preflight analysis for instruction-surface collisions, precedence, and instruction-budget risk before deployment.
- Add manifest-generation or adapter-assisted workflows for non-JSON targets where a direct JSON merge patch is not the right model.

## Hardening And Quality

- Expand Windows test coverage for additional edge cases.
- Add validation for agent instruction files beyond existence/readability checks, including structure required by supported targets.
- Strengthen MCP and instruction adapters with per-agent schema validation where current support relies on pass-through config shapes.
- Improve dry-run visibility so planned changes for file writes, rules files, and config patches are easier to inspect before deployment.
- Add stronger detection and warnings for enterprise or policy-managed environments where local configuration may be ignored or overridden.
