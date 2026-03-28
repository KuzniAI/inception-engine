# Inception Engine: Roadmap

This roadmap is ordered against the strategic direction in `docs/north-star.md`, but it prioritizes the refactors and quality work that remove current safety, portability, and enterprise-readiness blockers first.

It intentionally focuses on code quality, known issues, OS and agent portability, and compliance-oriented behavior rather than feature-count gaps.

## Suggested Implementation Order

1. **Generalize the deploy and ownership model before expanding scope**
   - Refactor `DeployAction`, `RevertAction`, and the planner or executor split so the engine can represent directory copy or symlink, file write, and structured config patch as distinct action types (`src/types.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
   - Extend the registry and ownership model so revert and safety checks can reason about file-level instructions and config patches, not only skill directories (`src/schemas/registry.ts`, `src/core/ownership.ts`).
   - Keep dry-run and revert logic action-aware so later work does not get bolted onto the current skill-directory path model.

2. **Tighten the remaining safety and validation gaps**
   - Reduce the current TOCTOU window in deploy and revert so ownership checks and mutations are less exposed to path-state changes between validation and mutation (`src/core/deploy.ts`, `src/core/revert.ts`).
   - Tighten schema-backed validation for `mcpServers` and `agentRules`. Wrong top-level types are now rejected, but entry shape still resolves to `unknown[]` and is not validated (`src/config/manifest.ts`, `src/schemas/manifest.ts`).
   - Finish the skill contract validation story so the implementation fully matches the intended readable-directory-plus-`SKILL.md` contract and reports permission failures clearly (`src/core/deploy.ts`).

3. **Improve portability and confidence in platform-specific behavior**
   - Add stronger Windows-realistic coverage for copy deploy or revert, ownership handling, and `%APPDATA%` path behavior. `%APPDATA%` path resolution and cross-platform copy paths are covered, but much of the Windows-specific behavior still depends on platform-gated tests (`test/cross-platform.test.ts`, `test/deploy.test.ts`, `test/revert.test.ts`, `test/ownership.test.ts`).
   - Add detection-path coverage that meaningfully exercises `where.exe`, missing `which`, and `/bin/sh` fallback across test environments. Missing-`which` fallback is covered, but the `where.exe` branch still lacks robust non-gated validation (`src/core/detect.ts`, `test/detect.test.ts`).
   - Reassess whether the documented Node `>=23.6.0` baseline is truly required for the published runtime or mostly for local TypeScript execution and tests (`package.json`, `README.md`).

4. **Upgrade dry-run reporting before adding config mutation features**
   - Current dry-run output is action-aware and includes method, source, and target details, which is adequate for directory deploys.
   - Before config or file mutations are added, introduce a structured way to show exact planned changes instead of directory-level summaries (`src/core/deploy.ts`, `src/core/revert.ts`, `src/logger.ts`).

## Current Roadmap

### Highest Priority

- **Directory-Only Action Model**: `DeployAction`, `RevertAction`, and the current planner or executor split are still centered on skill-directory deploys. Generalize them before adding single-file writes or structured config patches (`src/types.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
- **Directory-Only Ownership Semantics**: The current registry model tracks directory symlink or copy deploys, but it is not yet a generalized ownership model for file-level instructions or config patching (`src/schemas/registry.ts`, `src/core/ownership.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
- **TOCTOU Race Window**: Backup, ownership check, removal, and recreate are split across multiple `lstat`, `rename`, `rm`, and `unlink` steps, so path state can change between validation and mutation (`src/core/deploy.ts`, `src/core/revert.ts`).

### Validation and Planning

- **Partial Manifest Validation**: Wrong top-level types for `mcpServers` and `agentRules` are now rejected, but their entries still resolve to `unknown[]` and are not schema-validated. That is acceptable for forward compatibility today, but it is not yet strict manifest validation (`src/config/manifest.ts`, `src/schemas/manifest.ts`).
- **Partially Closed Skill Contract Validation**: Planning now checks that each skill source exists, is a directory, and contains `SKILL.md`, but the implementation should fully match the intended readable-directory contract and keep failure messages specific (`src/core/deploy.ts`).

### Portability and Testing

- **Partial Windows Deployment Coverage**: The copy-based deploy or revert path and `%APPDATA%` path handling have test coverage, but Windows-native ownership behavior and more realistic end-to-end Windows execution still need stronger validation (`src/core/deploy.ts`, `src/core/revert.ts`, `test/cross-platform.test.ts`, `test/deploy.test.ts`, `test/revert.test.ts`, `test/ownership.test.ts`).
- **Partial Binary Detection Coverage**: Tests cover missing `which` and the `/bin/sh` `command -v` fallback path, but `where.exe` coverage is still limited by real-platform gating and should be made more robust (`src/core/detect.ts`, `test/detect.test.ts`).
- **Packaging Portability**: The Node `>=23.6.0` requirement is documented in `package.json` and `README.md`, but it is still worth reassessing whether that minimum is truly required for the published runtime or mostly for local TypeScript execution and tests.

### Automation and Enterprise Readiness

- **Dry-Run Precision Gap**: Current dry-run output is action-aware and includes method, source, and target details, which is adequate for directory deploys. Before config or file mutations are added, the reporting model still needs a structured way to show exact planned changes instead of directory-level summaries (`src/core/deploy.ts`, `src/core/revert.ts`, `src/logger.ts`).
