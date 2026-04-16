# Inception Engine: Roadmap

This roadmap is derived from the current codebase and test suite, using `docs/north-star.md` as the target state.

Each item is scored `0-2` on six criteria. Higher is better.

- `Architecture`: how much enabling platform work the item unlocks
- `Agents`: how much supported-agent coverage or correctness it improves
- `OS`: how much it improves portability across operating systems
- `Confidence`: how well documented and settled the target surface appears
- `Safety`: how safely it can be implemented while preserving ownership, dry-run clarity, and revert behavior
- `Stability`: how unlikely the target surface is to churn soon

Maximum score: `12`

Score format:
`Score X/12 (Architecture A, Agents B, OS C, Confidence D, Safety E, Stability F)`
