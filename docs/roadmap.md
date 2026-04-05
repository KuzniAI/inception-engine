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

1. ~~Workspace-local instruction-file support is implemented for the documented agent surfaces: `claude-code` deploys to `{workspace}/CLAUDE.md`, `codex` to `{workspace}/AGENTS.md`, and `gemini-cli` to `{workspace}/GEMINI.md`. Agents without a distinct documented workspace surface (`antigravity`, `opencode`, `github-copilot`) emit warnings and are skipped. README now documents the supported matrix accordingly. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)~~

## Quality And Maintenance

Ordered from highest to lowest.

1. Expand Windows test coverage for additional edge cases. Score: `4/8` (`Architecture 0`, `Agents 0`, `OS 2`, `Confidence 2`)
2. ~~Instruction-file validation now goes beyond existence/readability checks for supported targets. Deploy validates required YAML frontmatter with non-empty single-line `name` and `description` fields before accepting structured instruction surfaces. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)~~
3. ~~`github-copilot` instruction-file validation now enforces the follow-up field requirements: frontmatter must define either `tools` or `instructions` in addition to the shared structural checks. Score: `3/8` (`Architecture 0`, `Agents 1`, `OS 0`, `Confidence 2`)~~
4. ~~`antigravity` instruction-file validation now enforces the follow-up MCP structure checks: any `mcp-servers` / `mcpServers` frontmatter must be an object whose entries satisfy the MCP server config shape validation. Score: `3/8` (`Architecture 0`, `Agents 1`, `OS 0`, `Confidence 2`)~~
5. ~~Gemini CLI / Antigravity ambiguity coverage now includes stronger precedence and behavioral checks, including repo/workspace scope interactions, duplicate-content warnings, and divergence warnings for shared surfaces. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)~~
6. ~~Dry-run visibility now shows grouped planned changes with source and target paths plus action-specific payload details for config patches, TOML patches, and frontmatter emits before deployment. Score: `4/8` (`Architecture 1`, `Agents 0`, `OS 1`, `Confidence 2`)~~
7. ~~Preflight now detects stronger policy and enterprise-management signals, especially for `github-copilot`, by checking enterprise environment variables, enterprise `hosts.json` entries, and emitting policy/config-authority warnings when local config may be ignored or overridden. Score: `3/8` (`Architecture 0`, `Agents 1`, `OS 0`, `Confidence 2`)~~
8. Add fixture-based `init` coverage against `limbo/` so the sample bundle, generated manifest, and README examples do not drift. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)

## Additional Dimensions To Consider

These are not included in the scores above, but they would help with later prioritization:

- `User impact`: how many users are likely to feel the benefit quickly
- `Maintenance cost`: how much long-term adapter and test burden the feature creates
- `Vendor churn risk`: how likely the target surface is to change soon
- `Safety risk`: how easy it is to preserve ownership, dry-run clarity, and safe revert
- `Sequencing`: whether the item is blocked by another roadmap item even if its raw score is high
