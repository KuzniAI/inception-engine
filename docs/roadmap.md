# Inception Engine: Roadmap

This roadmap is now trimmed to the remaining architecture work that should land before feature expansion resumes.

The completed action-model, dry-run reporting, validation, TOCTOU hardening, skill-contract validation, and enterprise-policy warning work has been removed from this document because it is already implemented in the codebase and covered by tests.

## Architecture Close-Out

1. **Raise cross-platform confidence to release quality**
   - Add stronger Windows-realistic coverage for copy deploy and revert, ownership enforcement, backup and rollback behavior, and `%APPDATA%` path handling. The implementation exists, but several important cases are still covered mainly by platform-gated or mocked tests (`test/cross-platform.test.ts`, `test/deploy.test.ts`, `test/revert.test.ts`, `test/ownership.test.ts`).
   - Make sure CI treats those paths as first-class, so architecture claims are not based mostly on POSIX behavior plus inference.

2. ~~**Add the adapter boundary for future capability surfaces**~~
   - ~~Introduce a planner-facing adapter layer that can compile higher-level manifest intent into engine-owned actions for instruction files, MCP configuration, and agent/rule definitions, instead of wiring each future capability directly into ad hoc file writes or config patches.~~
   - ~~Keep ownership tracking, revert behavior, conflict detection, and exact dry-run output at the compiled-action layer so new vectors inherit the current safety model rather than reimplementing it.~~

3. ~~**Promote manifest sections from validation-only to executable architecture**~~
   - ~~`mcpServers` and `agentRules` now validate structurally, but they are still not consumed by planning or execution. Define the public manifest contract for those sections and connect them to agent-specific adapters before treating the engine as ready for MCP or subagent feature work (`src/config/manifest.ts`, `src/schemas/manifest.ts`).~~
   - ~~Keep support confidence explicit per target surface. A vector should only move from roadmap to supported capability when the target path/schema is documented strongly enough and the engine can manage it with reversible ownership semantics (`docs/north-star.md`).~~

## Exit Criteria For Feature Work

Feature expansion should start only after these are true:

- Windows behavior is exercised by realistic automated coverage, not mostly inferred from POSIX runs.
- New capability vectors compile through a stable adapter layer into the existing action and ownership model.
- Manifest sections intended for MCP, rules, or other agent-specific surfaces are executable through planning and revert, not just accepted by schema validation.
