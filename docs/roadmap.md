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

1. Expand instruction-file support beyond today's global and repo-local rules-file deployment to cover workspace-local instruction surfaces for agents with documented behavior. Repo-local support exists today; workspace-local support does not. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
2. ~~Move today's instruction precedence and instruction-budget analysis from deploy planning into true preflight so the implementation matches the documented preflight model. Score: `3/8` (`Architecture 1`, `Agents 0`, `OS 0`, `Confidence 2`)~~

## Quality And Maintenance

Ordered from highest to lowest.

1. Expand Windows test coverage for additional edge cases. Score: `4/8` (`Architecture 0`, `Agents 0`, `OS 2`, `Confidence 2`)
2. Add validation for agent instruction files beyond existence/readability checks, including structure required by supported targets. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
3. Improve dry-run visibility so planned changes for file writes, rules files, and config patches are easier to inspect before deployment. Score: `4/8` (`Architecture 1`, `Agents 0`, `OS 1`, `Confidence 2`)
4. Extend today's Gemini CLI / Antigravity shared-surface ambiguity tests into stronger precedence and behavioral coverage. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)
5. Add stronger detection and warnings for enterprise or policy-managed environments where local configuration may be ignored or overridden. Score: `3/8` (`Architecture 0`, `Agents 1`, `OS 0`, `Confidence 2`)
6. Add fixture-based `init` coverage against `limbo/` so the sample bundle, generated manifest, and README examples do not drift. Score: `4/8` (`Architecture 1`, `Agents 1`, `OS 0`, `Confidence 2`)

## Format Handling Simplification

This is the concrete cleanup needed around YAML frontmatter and TOML handling:

1. Replace `front-matter` with a lower-dependency YAML implementation and stop relying on the current hand-rolled frontmatter serializer. The preferred direction is a tiny local frontmatter delimiter splitter plus `yaml.parse` / `yaml.stringify`, while keeping Jon Schlinkert packages out of the dependency graph.
2. Keep `smol-toml` unless a demonstrably smaller and equally capable TOML option appears. The current TOML library is already low-cost; the main maintenance burden is the duplicated logic around frontmatter parsing, serialization, and validation.
3. Unify frontmatter parsing across deploy-time reads and `SKILL.md` validation so there is one implementation path for extracting the YAML block, parsing it, and surfacing errors.
4. Preserve the current behavior contract while simplifying the internals: atomic writes, Markdown body preservation, and validation that `SKILL.md` begins with YAML frontmatter and contains non-empty single-line `name` and `description` fields.
5. Expand tests to cover malformed YAML, nested objects and arrays in emitted frontmatter, quoted scalars and special characters, body preservation, and rejection of multiline/block-scalar values for required `SKILL.md` fields.


## Additional Dimensions To Consider

These are not included in the scores above, but they would help with later prioritization:

- `User impact`: how many users are likely to feel the benefit quickly
- `Maintenance cost`: how much long-term adapter and test burden the feature creates
- `Vendor churn risk`: how likely the target surface is to change soon
- `Safety risk`: how easy it is to preserve ownership, dry-run clarity, and safe revert
- `Sequencing`: whether the item is blocked by another roadmap item even if its raw score is high
