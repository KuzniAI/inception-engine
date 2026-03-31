# Inception Engine: Roadmap

This roadmap is forward-looking and prioritized against four values:

- `Architecture`: how much enabling platform work the item unlocks
- `Agents`: how much it increases supported-agent coverage for a capability
- `OS`: how much it improves portability across operating systems
- `Confidence`: how well documented and stable the target surface appears

Each scored item uses a simple `0-2` scale per value for a maximum score of `8`.

## Architecture Enablers

These items should stay near the top because they unlock multiple follow-on features.

### Feature Enablers

1. Add manifest-generation or adapter-assisted workflows for non-JSON targets such as TOML, frontmatter-driven files, and mixed repo-local instruction surfaces. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)
2. Add explicit Gemini CLI / Antigravity collision handling for shared `GEMINI.md`-adjacent workflows. Score: `5/8` (`Architecture 2`, `Agents 1`, `OS 0`, `Confidence 2`)
3. Expand `init` from skill-folder discovery into a real bootstrap flow that can scaffold the broader manifest surfaces the north star depends on, including `files`, `configs`, `mcpServers`, and `agentRules`, or emit agent-aware placeholders instead of a skills-only manifest. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)

### Quality Enablers

1. Strengthen MCP and instruction adapters with per-agent schema validation where support depends on TOML, frontmatter, repo-scoped files, or other non-JSON shapes. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)
2. ~~Add targeted validation and revert tests for agent-definition surfaces before promoting them from roadmap to supported capability.~~ Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 1`, `Confidence 1`)

## Functional Features

Ordered from highest to lowest after the fixed first step and architecture enablers.

1. Add execution and safety-oriented config support for agent-specific permission and approval surfaces where safe patching and revert semantics can be implemented cleanly. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)
2. Add support for agent definition deployment for agents that expose dedicated agent directories or frontmatter-based agent files. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 1`, `Confidence 1`)
3. ~~Remove GitHub Copilot-specific instruction deployment work where Copilot already consumes Claude-native artifacts such as `CLAUDE.md`.~~ Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)
4. Remove legacy GitHub Copilot skill-target assumptions and related docs/tests/manifests where Copilot can execute Claude-style skills directly. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)
5. Add Codex MCP deployment via `config.toml`. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
6. Add OpenCode MCP deployment via `opencode.json` under `mcp`. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
7. Add Antigravity instruction deployment for `GEMINI.md` and `.agents/rules/*.md`. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
8. Add Antigravity MCP deployment via `.agents/rules/` frontmatter or `mcp-servers` properties. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
9. Retain dedicated GitHub Copilot MCP deployment only for the surfaces that are genuinely Copilot-specific, such as devcontainer or agent-frontmatter mappings. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
10. Expand instruction-file support beyond today's global rules-file deployment to cover repo-local and workspace-local instruction surfaces for agents with documented behavior. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
11. Add preflight analysis for instruction precedence, collisions, and instruction-budget risk before deployment. Score: `3/8` (`Architecture 1`, `Agents 0`, `OS 0`, `Confidence 2`)
12. Update `init` so generated manifests stop baking in legacy `github-copilot` skill targets by default when the product direction is Claude-first portability for shared artifacts. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)

## Quality And Maintenance

Ordered from highest to lowest.

1. Expand Windows test coverage for additional edge cases. Score: `4/8` (`Architecture 0`, `Agents 0`, `OS 2`, `Confidence 2`)
2. Add validation for agent instruction files beyond existence/readability checks, including structure required by supported targets. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
3. Improve dry-run visibility so planned changes for file writes, rules files, and config patches are easier to inspect before deployment. Score: `4/8` (`Architecture 1`, `Agents 0`, `OS 1`, `Confidence 2`)
4. Add targeted tests for Gemini CLI / Antigravity instruction collisions and precedence behavior. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
5. Add stronger detection and warnings for enterprise or policy-managed environments where local configuration may be ignored or overridden. Score: `3/8` (`Architecture 0`, `Agents 1`, `OS 0`, `Confidence 2`)
6. Add fixture-based `init` coverage against `limbo/` so the sample bundle, generated manifest, and README examples do not drift. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)

## Additional Dimensions To Consider

These are not included in the scores above, but they would help with later prioritization:

- `User impact`: how many users are likely to feel the benefit quickly
- `Maintenance cost`: how much long-term adapter and test burden the feature creates
- `Vendor churn risk`: how likely the target surface is to change soon
- `Safety risk`: how easy it is to preserve ownership, dry-run clarity, and safe revert
- `Sequencing`: whether the item is blocked by another roadmap item even if its raw score is high
