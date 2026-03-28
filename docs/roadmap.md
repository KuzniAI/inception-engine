# Inception Engine: Roadmap

This roadmap is ordered against the strategic direction in `docs/north-star.md`, but it prioritizes the refactors and quality work that remove current safety, portability, and enterprise-readiness blockers first.

It intentionally focuses on enabling architecture rather than prematurely implementing every future capability surface. The goal is to keep the current skills deployer safe and portable while building the planner, ownership, and reporting foundations that later capabilities will need.

## Suggested Implementation Order

1. **Generalize the action, ownership, and reporting model**
   - Refactor `DeployAction`, `RevertAction`, and the planner or executor split so the engine can represent directory copy or symlink, file write, and structured config patch as distinct action types (`src/types.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
   - Extend the registry and ownership model so revert and safety checks can reason about file-level instructions and config patches, not only skill directories (`src/schemas/registry.ts`, `src/core/ownership.ts`).
   - Keep dry-run and revert logic action-aware, and evolve dry-run output toward exact planned changes instead of directory-level summaries (`src/core/deploy.ts`, `src/core/revert.ts`, `src/logger.ts`).

2. **Strengthen planning semantics before widening support**
   - Add confidence-aware planning so each supported surface can be classified as doc-backed, implementation-only, or speculative, with planner-visible consequences for warnings and support claims (`docs/north-star.md`, `src/config/agents.ts`, `src/core/preflight.ts`).
   - Preserve agent-specific adapter boundaries instead of drifting toward a single lossy universal deploy model (`docs/north-star.md`, `src/config/agents.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
   - Add cross-agent collision and ambiguity handling for overlapping or related targets before more surfaces are introduced (`docs/north-star.md`, `src/core/resolve.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).

3. **Close the remaining safety and validation gaps**
   - Reduce the current TOCTOU window in deploy and revert so ownership checks and mutations are less exposed to path-state changes between validation and mutation (`src/core/deploy.ts`, `src/core/revert.ts`).
   - Tighten schema-backed validation for `mcpServers` and `agentRules`. Wrong top-level types are now rejected, but entry shape still resolves to `unknown[]` and is not validated (`src/config/manifest.ts`, `src/schemas/manifest.ts`).
   - Finish the skill contract validation story so the implementation fully matches the intended readable-directory-plus-`SKILL.md` contract and reports permission failures clearly (`src/core/deploy.ts`).

4. **Improve portability, policy awareness, and confidence in real-world behavior**
   - Add stronger Windows-realistic coverage for copy deploy or revert, ownership handling, and `%APPDATA%` path behavior. `%APPDATA%` path resolution and cross-platform copy paths are covered, but much of the Windows-specific behavior still depends on platform-gated tests (`test/cross-platform.test.ts`, `test/deploy.test.ts`, `test/revert.test.ts`, `test/ownership.test.ts`).
   - Add detection-path coverage that meaningfully exercises `where.exe`, missing `which`, and `/bin/sh` fallback across test environments. Missing-`which` fallback is covered, but the `where.exe` branch still lacks robust non-gated validation (`src/core/detect.ts`, `test/detect.test.ts`).
   - Add enterprise-override awareness so planner and reporting layers can warn when local configuration may not be authoritative, instead of overstating support in constrained environments (`docs/north-star.md`, `src/core/preflight.ts`, `src/index.ts`).
   - Reassess whether the documented Node `>=23.6.0` baseline is truly required for the published runtime or mostly for local TypeScript execution and tests (`package.json`, `README.md`).

## Current Roadmap

### Core Architecture

- **Directory-Only Action Model**: `DeployAction`, `RevertAction`, and the current planner or executor split are still centered on skill-directory deploys. Generalize them before adding single-file writes or structured config patches (`src/types.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
- **Directory-Only Ownership and Provenance**: The current registry model tracks directory symlink or copy deploys, but it is not yet a generalized ownership and provenance model for file-level instructions or config patching (`src/schemas/registry.ts`, `src/core/ownership.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
- **Dry-Run Precision Gap**: Current dry-run output is action-aware and includes method, source, and target details, which is adequate for directory deploys. Before config or file mutations are added, the reporting model still needs a structured way to show exact planned changes instead of directory-level summaries (`src/core/deploy.ts`, `src/core/revert.ts`, `src/logger.ts`).

### Planning and Support Semantics

- **Confidence-Aware Planning**: The north star distinguishes documented, implementation-only, and speculative support, but the planner does not yet model that distinction in warnings, execution policy, or user-visible reporting (`docs/north-star.md`, `src/config/agents.ts`, `src/core/preflight.ts`).
- **Agent-Specific Adapter Boundaries**: The engine should preserve explicit per-agent adapter boundaries as it expands, rather than assuming future instruction, config, and agent surfaces can all fit a single canonical deploy shape (`docs/north-star.md`, `src/config/agents.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
- **Cross-Agent Target Collision and Ambiguity Handling**: The north star already calls out overlap risk between related agent surfaces such as Gemini CLI and Antigravity. The planner and ownership model should gain a general way to detect and reason about overlapping or ambiguous targets before additional surfaces are added (`docs/north-star.md`, `src/core/resolve.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
- **Partial Manifest Validation**: Wrong top-level types for `mcpServers` and `agentRules` are now rejected, but their entries still resolve to `unknown[]` and are not schema-validated. That is useful for forward compatibility, but it is not yet strict planner-ready validation (`src/config/manifest.ts`, `src/schemas/manifest.ts`).
- **Partially Closed Skill Contract Validation**: Planning now checks that each skill source exists, is a directory, and contains `SKILL.md`, but the implementation should fully match the intended readable-directory contract and keep failure messages specific (`src/core/deploy.ts`).

### Safety and Reversibility

- **TOCTOU Race Window**: Backup, ownership check, removal, and recreate are split across multiple `lstat`, `rename`, `rm`, and `unlink` steps, so path state can change between validation and mutation (`src/core/deploy.ts`, `src/core/revert.ts`).

### Portability and Testing

- **Partial Windows Deployment Coverage**: The copy-based deploy or revert path and `%APPDATA%` path handling have test coverage, but Windows-native ownership behavior and more realistic end-to-end Windows execution still need stronger validation (`src/core/deploy.ts`, `src/core/revert.ts`, `test/cross-platform.test.ts`, `test/deploy.test.ts`, `test/revert.test.ts`, `test/ownership.test.ts`).
- **Partial Binary Detection Coverage**: Tests cover missing `which` and the `/bin/sh` `command -v` fallback path, but `where.exe` coverage is still limited by real-platform gating and should be made more robust (`src/core/detect.ts`, `test/detect.test.ts`).
- **Packaging Portability**: The Node `>=23.6.0` requirement is documented in `package.json` and `README.md`, but it is still worth reassessing whether that minimum is truly required for the published runtime or mostly for local TypeScript execution and tests.

### Enterprise and Policy Awareness

- **Enterprise Override Awareness**: Some target environments may ignore or constrain local configuration because of organization policy. The engine should detect and warn where possible instead of presenting local state as fully authoritative (`docs/north-star.md`, `src/core/preflight.ts`, `src/index.ts`).
