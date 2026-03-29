# Inception Engine: Roadmap

This roadmap is forward-looking and prioritized against four values:

- `Architecture`: how much enabling platform work the item unlocks
- `Agents`: how much it increases supported-agent coverage for a capability
- `OS`: how much it improves portability across operating systems
- `Confidence`: how well documented and stable the target surface appears

Each scored item uses a simple `0-2` scale per value for a maximum score of `8`.

## Fixed First Step

- Add a CLI command that scans a directory containing agent instruction files and generates an `inception.json` manifest for it. This stays first by product direction and is not scored against the rest.

## Architecture Enablers

These items should stay near the top because they unlock multiple follow-on features.

### Feature Enablers

1. Add manifest-generation or adapter-assisted workflows for non-JSON targets such as TOML, frontmatter-driven files, and mixed repo-local instruction surfaces. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)
2. Add explicit Gemini CLI / Antigravity collision handling for shared `GEMINI.md`-adjacent workflows. Score: `5/8` (`Architecture 2`, `Agents 1`, `OS 0`, `Confidence 2`)

### Quality Enablers

1. Strengthen MCP and instruction adapters with per-agent schema validation where support depends on TOML, frontmatter, repo-scoped files, or other non-JSON shapes. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)
2. Add targeted validation and revert tests for agent-definition surfaces before promoting them from roadmap to supported capability. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 1`, `Confidence 1`)

## Functional Features

Ordered from highest to lowest after the fixed first step and architecture enablers.

1. Add execution and safety-oriented config support for agent-specific permission and approval surfaces where safe patching and revert semantics can be implemented cleanly. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)
2. Add support for agent definition deployment for agents that expose dedicated agent directories or frontmatter-based agent files. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 1`, `Confidence 1`)
3. Add GitHub Copilot instruction deployment for `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md`. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
4. Add Codex MCP deployment via `config.toml`. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
5. Add OpenCode MCP deployment via `opencode.json` under `mcp`. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
6. Add Antigravity instruction deployment for `GEMINI.md` and `.agents/rules/*.md`. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
7. Add Antigravity MCP deployment via `.agents/rules/` frontmatter or `mcp-servers` properties. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
8. Add GitHub Copilot MCP deployment through agent frontmatter. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
9. Expand instruction-file support beyond today's global rules-file deployment to cover repo-local and workspace-local instruction surfaces for agents with documented behavior. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
10. Add preflight analysis for instruction precedence, collisions, and instruction-budget risk before deployment. Score: `3/8` (`Architecture 1`, `Agents 0`, `OS 0`, `Confidence 2`)

## Quality And Maintenance

Ordered from highest to lowest.

1. Expand Windows test coverage for additional edge cases. Score: `4/8` (`Architecture 0`, `Agents 0`, `OS 2`, `Confidence 2`)
2. Add validation for agent instruction files beyond existence/readability checks, including structure required by supported targets. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
3. Improve dry-run visibility so planned changes for file writes, rules files, and config patches are easier to inspect before deployment. Score: `4/8` (`Architecture 1`, `Agents 0`, `OS 1`, `Confidence 2`)
4. Add targeted tests for Gemini CLI / Antigravity instruction collisions and precedence behavior. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
5. Add stronger detection and warnings for enterprise or policy-managed environments where local configuration may be ignored or overridden. Score: `3/8` (`Architecture 0`, `Agents 1`, `OS 0`, `Confidence 2`)

## Additional Dimensions To Consider

These are not included in the scores above, but they would help with later prioritization:

- `User impact`: how many users are likely to feel the benefit quickly
- `Maintenance cost`: how much long-term adapter and test burden the feature creates
- `Vendor churn risk`: how likely the target surface is to change soon
- `Safety risk`: how easy it is to preserve ownership, dry-run clarity, and safe revert
- `Sequencing`: whether the item is blocked by another roadmap item even if its raw score is high
