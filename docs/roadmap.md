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

1. Clarify and complete workspace-local instruction-file support. The manifest schema and adapter plumbing accept `scope: "workspace"`, but current agent registry entries still mark workspace-local instruction surfaces as unsupported and deployments are skipped with warnings. Ship real workspace-local targets only for agents with documented behavior, then update README claims accordingly. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)

## Quality And Maintenance

Ordered from highest to lowest.

1. Expand Windows test coverage for additional edge cases. Score: `4/8` (`Architecture 0`, `Agents 0`, `OS 2`, `Confidence 2`)
2. ~~Add validation for agent instruction files beyond existence/readability checks, including structure required by supported targets. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)~~
3. ~~Add specific field validation (e.g., `tools`, `instructions`) for `github-copilot` instruction files as a follow-up to structural validation. Score: `3/8` (`Architecture 0`, `Agents 1`, `OS 0`, `Confidence 2`)~~
4. ~~Add specific field validation for `antigravity` instruction files (e.g., ensuring MCP rules structure) as a follow-up to structural validation. Score: `3/8` (`Architecture 0`, `Agents 1`, `OS 0`, `Confidence 2`)~~
5. ~~Extend today's Gemini CLI / Antigravity shared-surface ambiguity tests into stronger precedence and behavioral coverage. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)~~
6. Improve dry-run visibility so planned changes for file writes, rules files, and config patches are easier to inspect before deployment. Score: `4/8` (`Architecture 1`, `Agents 0`, `OS 1`, `Confidence 2`)
7. ~~Add stronger detection and warnings for enterprise or policy-managed environments where local configuration may be ignored or overridden. Score: `3/8` (`Architecture 0`, `Agents 1`, `OS 0`, `Confidence 2`)~~
8. Add fixture-based `init` coverage against `limbo/` so the sample bundle, generated manifest, and README examples do not drift. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)

## Additional Dimensions To Consider

These are not included in the scores above, but they would help with later prioritization:

- `User impact`: how many users are likely to feel the benefit quickly
- `Maintenance cost`: how much long-term adapter and test burden the feature creates
- `Vendor churn risk`: how likely the target surface is to change soon
- `Safety risk`: how easy it is to preserve ownership, dry-run clarity, and safe revert
- `Sequencing`: whether the item is blocked by another roadmap item even if its raw score is high
