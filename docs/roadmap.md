# Inception Engine: Roadmap

This roadmap is forward-looking and prioritized against four values:

- `Architecture`: how much enabling platform work the item unlocks
- `Agents`: how much it increases supported-agent coverage for a capability
- `OS`: how much it improves portability across operating systems
- `Confidence`: how well documented and stable the target surface appears

Each scored item uses a simple `0-2` scale per value for a maximum score of `8`.

## Architecture Enablers

No active items.

## Functional Features

Ordered from highest to lowest after the fixed first step and architecture enablers.

1. Add support for agent definition deployment for agents that expose dedicated agent directories or frontmatter-based agent files. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 1`, `Confidence 1`)
2. Remove legacy GitHub Copilot skill-target assumptions and related docs/tests/manifests where Copilot can execute Claude-style skills directly. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)
3. Finish Antigravity instruction deployment coverage by reconciling today's repo-local `.agents/rules/*.md` support with any remaining shared `GEMINI.md` behavior and documented precedence semantics. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
4. Retain dedicated GitHub Copilot MCP deployment only for the surfaces that are genuinely Copilot-specific, such as devcontainer or agent-frontmatter mappings. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)
5. Expand instruction-file support beyond today's global rules-file deployment to cover repo-local and workspace-local instruction surfaces for agents with documented behavior. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
6. Add preflight analysis for instruction precedence, collisions, and instruction-budget risk before deployment. Score: `3/8` (`Architecture 1`, `Agents 0`, `OS 0`, `Confidence 2`)

## Quality And Maintenance

Ordered from highest to lowest.

1. Expand Windows test coverage for additional edge cases. Score: `4/8` (`Architecture 0`, `Agents 0`, `OS 2`, `Confidence 2`)
2. Add validation for agent instruction files beyond existence/readability checks, including structure required by supported targets. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
3. Improve dry-run visibility so planned changes for file writes, rules files, and config patches are easier to inspect before deployment. Score: `4/8` (`Architecture 1`, `Agents 0`, `OS 1`, `Confidence 2`)
4. Extend today's Gemini CLI / Antigravity shared-surface ambiguity tests into stronger precedence and behavioral coverage. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
5. Add stronger detection and warnings for enterprise or policy-managed environments where local configuration may be ignored or overridden. Score: `3/8` (`Architecture 0`, `Agents 1`, `OS 0`, `Confidence 2`)
6. Add fixture-based `init` coverage against `limbo/` so the sample bundle, generated manifest, and README examples do not drift. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)

## Completed

1. ~~Infer or scaffold `files` and `configs` manifest entries from repo conventions without guessing unsafe target paths, so `init` covers more than skills, `agentRules`, and `mcpServers`. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)~~
   Implemented via explicit repo-sidecar conventions: `init` reads `files-manifest.json` and `configs-manifest.json` to populate those sections, while still avoiding unsafe target-path guessing.
2. ~~Add execution and safety-oriented config support for agent-specific permission and approval surfaces where safe patching and revert semantics can be implemented cleanly. Score: `6/8` (`Architecture 2`, `Agents 2`, `OS 0`, `Confidence 2`)~~
   Implemented via a dedicated `permissions` manifest section. Claude Code deploys a JSON merge patch to `~/.claude/settings.json` under the `permissions` key (`allow`/`deny` string arrays). Codex deploys a TOML patch to `~/.codex/config.toml` (`approval_policy`). Agents without a documented global permission surface (Gemini CLI, OpenCode, Antigravity, GitHub Copilot) emit a warning and are skipped.
3. ~~Add Codex MCP deployment via `config.toml`. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)~~
   Implemented via the TOML MCP adapter targeting `~/.codex/config.toml`, with deploy/revert coverage and schema validation for MCP server descriptors.
4. ~~Add OpenCode MCP deployment via `opencode.json` under `mcp`. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)~~
   Implemented via the JSON MCP adapter targeting `opencode.json` and patching under the `mcp` key rather than `mcpServers`.
5. ~~Add Antigravity MCP deployment via `.agents/rules/` frontmatter or `mcp-servers` properties. Score: `5/8` (`Architecture 1`, `Agents 2`, `OS 0`, `Confidence 2`)~~
   Implemented via frontmatter-emitted `.agents/rules/{name}.md` files using the `mcp-servers` property, with corresponding revert support.

## Additional Dimensions To Consider

These are not included in the scores above, but they would help with later prioritization:

- `User impact`: how many users are likely to feel the benefit quickly
- `Maintenance cost`: how much long-term adapter and test burden the feature creates
- `Vendor churn risk`: how likely the target surface is to change soon
- `Safety risk`: how easy it is to preserve ownership, dry-run clarity, and safe revert
- `Sequencing`: whether the item is blocked by another roadmap item even if its raw score is high
