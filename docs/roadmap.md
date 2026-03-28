# Inception Engine: Roadmap

This roadmap is ordered against the strategic direction in `docs/north-star.md`, but it prioritizes the refactors and quality work that remove current safety, portability, and enterprise-readiness blockers first.

It intentionally focuses on enabling architecture rather than prematurely implementing every future capability surface. The goal is to keep the current skills deployer safe and portable while building the planner, ownership, and reporting foundations that later capabilities will need.

## Suggested Implementation Order

1. ~~**Finish generalizing the action, ownership, and reporting model**~~
   - ~~Complete planner and executor support for distinct action types so the engine can actually plan, deploy, and revert directory copy or symlink, file write, and structured config patch actions (`src/types.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).~~
   - ~~Extend the registry and ownership model with action-specific provenance so revert and safety checks can reason about file-level instructions and config patches, not only skill directories (`src/schemas/registry.ts`, `src/core/ownership.ts`).~~
   - ~~Replace log-string dry-run summaries with structured exact-change reporting for planned writes, removals, and patches (`src/core/deploy.ts`, `src/core/revert.ts`, `src/logger.ts`).~~

2. ~~**Strengthen planning semantics before widening support**~~
   - ~~Add confidence-aware planning so each supported surface can be classified as doc-backed, implementation-only, or speculative, with planner-visible consequences for warnings and support claims (`docs/north-star.md`, `src/config/agents.ts`, `src/core/preflight.ts`).~~
   - ~~Preserve agent-specific adapter boundaries instead of drifting toward a single lossy universal deploy model (`docs/north-star.md`, `src/config/agents.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).~~
   - ~~Add cross-agent collision and ambiguity handling for overlapping or related targets before more surfaces are introduced (`docs/north-star.md`, `src/core/resolve.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).~~

3. **Close the remaining safety and validation gaps**
   - Reduce the current TOCTOU window in deploy and revert so ownership checks and mutations are less exposed to path-state changes between validation and mutation (`src/core/deploy.ts`, `src/core/revert.ts`).
   - Tighten schema-backed validation for `mcpServers` and `agentRules`. Wrong top-level types are now rejected, but entry shape still resolves to `unknown[]` and is not validated (`src/config/manifest.ts`, `src/schemas/manifest.ts`).
   - Finish the skill contract validation story so the implementation fully matches the intended readable-directory-plus-`SKILL.md` contract and reports permission failures clearly (`src/core/deploy.ts`).

4. **Improve portability, policy awareness, and confidence in real-world behavior**
   - Add stronger Windows-realistic coverage for copy deploy or revert, ownership handling, and `%APPDATA%` path behavior. `%APPDATA%` path resolution and cross-platform copy paths are covered, but much of the Windows-specific behavior still depends on platform-gated tests (`test/cross-platform.test.ts`, `test/deploy.test.ts`, `test/revert.test.ts`, `test/ownership.test.ts`).
   - Add enterprise-override awareness so planner and reporting layers can warn when local configuration may not be authoritative, instead of overstating support in constrained environments (`docs/north-star.md`, `src/core/preflight.ts`, `src/index.ts`).

## Current Roadmap

### Core Architecture

- ~~**Incomplete Action Model Generalization**: `DeployAction` and `RevertAction` can now represent `file-write` and `config-patch`, but planning and execution still only implement `skill-dir`. Finish planner and executor support before treating the deploy model as generalized (`src/types.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).~~
- ~~**Incomplete Ownership and Provenance Generalization**: The registry schema now admits more action kinds, but ownership verification and revert safety checks still lack action-specific provenance for file writes and config patches (`src/schemas/registry.ts`, `src/core/ownership.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).~~
- ~~**Dry-Run Precision Gap**: Current dry-run output is action-aware for directory deploys, but it is still log-string based and does not yet model exact planned file writes or config patches in a structured way (`src/core/deploy.ts`, `src/core/revert.ts`, `src/logger.ts`).~~

### Planning and Support Semantics

- ~~**Confidence-Aware Planning**: The north star distinguishes documented, implementation-only, and speculative support, but the planner does not yet model that distinction in warnings, execution policy, or user-visible reporting (`docs/north-star.md`, `src/config/agents.ts`, `src/core/preflight.ts`).~~
- ~~**Agent-Specific Adapter Boundaries**: The engine should preserve explicit per-agent adapter boundaries as it expands, rather than assuming future instruction, config, and agent surfaces can all fit a single canonical deploy shape (`docs/north-star.md`, `src/config/agents.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).~~
- ~~**Cross-Agent Target Collision and Ambiguity Handling**: The north star already calls out overlap risk between related agent surfaces such as Gemini CLI and Antigravity. The planner and ownership model should gain a general way to detect and reason about overlapping or ambiguous targets before additional surfaces are added (`docs/north-star.md`, `src/core/resolve.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).~~
- **Partial Manifest Validation**: Wrong top-level types for `mcpServers` and `agentRules` are now rejected, but their entries still resolve to `unknown[]` and are not schema-validated. That is useful for forward compatibility, but it is not yet strict planner-ready validation (`src/config/manifest.ts`, `src/schemas/manifest.ts`).
- **Partially Closed Skill Contract Validation**: Planning now checks that each skill source exists, is a directory, and contains `SKILL.md`, but the implementation should fully match the intended readable-directory contract and keep failure messages specific (`src/core/deploy.ts`).

### Safety and Reversibility

- **TOCTOU Race Window**: Backup, ownership check, removal, and recreate are split across multiple `lstat`, `rename`, `rm`, and `unlink` steps, so path state can change between validation and mutation (`src/core/deploy.ts`, `src/core/revert.ts`).

### Enterprise and Policy Awareness

- **Enterprise Override Awareness**: Some target environments may ignore or constrain local configuration because of organization policy. The engine should detect and warn where possible instead of presenting local state as fully authoritative (`docs/north-star.md`, `src/core/preflight.ts`, `src/index.ts`).
