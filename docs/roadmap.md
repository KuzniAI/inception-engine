# Inception Engine: Roadmap

This roadmap is ordered against the strategic direction in `docs/north-star.md`, but it prioritizes the refactors and quality work that remove current safety, portability, and enterprise-readiness blockers first.

It intentionally focuses on enabling architecture rather than prematurely implementing every future capability surface. The goal is to keep the current skills deployer safe and portable while building the planner, ownership, and reporting foundations that later capabilities will need.

## Suggested Implementation Order

1. **Finish the remaining public-surface action model work**
   - ~~Complete planner and manifest-level support for distinct action types so the public engine can actually plan and revert file-write and structured config patch actions, not only execute them when constructed internally (`src/core/deploy.ts`, `src/core/revert.ts`, `src/config/manifest.ts`, `src/schemas/manifest.ts`).~~
   - ~~Replace user-facing log-string dry-run summaries with structured exact-change reporting that the CLI actually surfaces, instead of only returning `planned` entries from the executor internals (`src/core/deploy.ts`, `src/core/revert.ts`, `src/index.ts`, `src/logger.ts`).~~

2. **Close the remaining safety and validation gaps**
   - ~~Reduce the current TOCTOU window in deploy and revert so ownership checks and mutations are less exposed to path-state changes between validation and mutation (`src/core/deploy.ts`, `src/core/revert.ts`).~~
   - ~~Tighten schema-backed validation for `mcpServers` and `agentRules`. Wrong top-level types are now rejected, but entry shape still resolves to `unknown[]` and is not validated (`src/config/manifest.ts`, `src/schemas/manifest.ts`).~~
   - ~~Finish the skill contract validation story so the implementation fully matches the intended readable-directory-plus-`SKILL.md` contract and reports permission failures clearly (`src/core/deploy.ts`).~~

3. **Improve portability, policy awareness, and confidence in real-world behavior**
   - Add stronger Windows-realistic coverage for copy deploy or revert, ownership handling, and `%APPDATA%` path behavior. `%APPDATA%` path resolution and cross-platform copy paths are covered, but much of the Windows-specific behavior still depends on platform-gated tests (`test/cross-platform.test.ts`, `test/deploy.test.ts`, `test/revert.test.ts`, `test/ownership.test.ts`).
   - ~~Add enterprise-override awareness so planner and reporting layers can warn when local configuration may not be authoritative, instead of overstating support in constrained environments (`docs/north-star.md`, `src/core/preflight.ts`, `src/index.ts`).~~

## Current Roadmap

### Core Architecture

- ~~**Public Action Model Gap**: `DeployAction` and `RevertAction` can represent `file-write` and `config-patch`, and the executors can run them, but the manifest-driven planner and revert flow still only derive `skill-dir` actions. Finish the public planning surface before treating the deploy model as fully generalized (`src/types.ts`, `src/core/deploy.ts`, `src/core/revert.ts`, `src/config/manifest.ts`, `src/schemas/manifest.ts`).~~
- ~~**User-Facing Dry-Run Precision Gap**: Executors now return structured `planned` changes for writes, removals, and patches, but the CLI still reports dry-runs through logger strings and does not surface the structured plan output (`src/core/deploy.ts`, `src/core/revert.ts`, `src/index.ts`, `src/logger.ts`).~~

### Planning and Support Semantics

- ~~**Partial Manifest Validation**: Wrong top-level types for `mcpServers` and `agentRules` are now rejected, but their entries still resolve to `unknown[]` and are not schema-validated. That is useful for forward compatibility, but it is not yet strict planner-ready validation (`src/config/manifest.ts`, `src/schemas/manifest.ts`).~~
- ~~**Partially Closed Skill Contract Validation**: Planning now checks that each skill source exists, is a directory, and contains `SKILL.md`, but the implementation should fully match the intended readable-directory contract and keep failure messages specific (`src/core/deploy.ts`).~~

### Safety and Reversibility

- ~~**TOCTOU Race Window**: Backup, ownership check, removal, and recreate are split across multiple `lstat`, `rename`, `rm`, and `unlink` steps, so path state can change between validation and mutation (`src/core/deploy.ts`, `src/core/revert.ts`).~~

### Enterprise and Policy Awareness

- ~~**Enterprise Override Awareness**: Some target environments may ignore or constrain local configuration because of organization policy. The engine should detect and warn where possible instead of presenting local state as fully authoritative (`docs/north-star.md`, `src/core/preflight.ts`, `src/index.ts`).~~
