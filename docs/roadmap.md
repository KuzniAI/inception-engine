# Inception Engine: Roadmap

This roadmap is ordered against the strategic direction in `docs/north-star.md`, but it prioritizes the refactors and quality work that remove current safety, portability, and enterprise-readiness blockers first.

It intentionally focuses on code quality, known issues, OS and agent portability, and compliance-oriented behavior rather than feature-count gaps.

## Suggested Implementation Order

1. **Make manifest parsing strict and lossless**
   - Replace `unknown[]` parsing with schema-backed validation for every top-level section. `mcpServers` and `agentRules` currently accept any array and silently fall back to `[]` when the type is wrong (`src/config/manifest.ts`, `src/types.ts`).
   - Reject duplicate `skill.name` values and deduplicate per-skill agent IDs before planning to prevent target collisions and repeated writes.
   - Validate that each skill source is a readable directory containing `SKILL.md` during planning, not only an existing path during execution.

2. **Make automation and enterprise failures explicit**
   - Change revert and deploy result handling so any failed destructive step is surfaced as a failure count and a non-zero exit code (`src/core/revert.ts`, `src/index.ts`).
   - Differentiate permission, policy, and missing-file errors. `loadManifest` and deploy source checks currently collapse several I/O failures into “not found” style messages, which is not sufficient for locked-down environments.
   - Add an enterprise or policy preflight layer before touching agent-managed config so later work has a place to warn about local-config overrides and policy blocks.

3. **Close the validation gaps with platform-realistic tests**
   - Add CLI end-to-end tests that exercise `src/index.ts` result codes and user-visible reporting.
   - Add Windows-realistic coverage for copy deploy or revert, ownership handling, and `%APPDATA%` path behavior.
   - Add detection-path tests for `where.exe`, missing `which`, and `/bin/sh` fallback, plus ownership tests that verify source trees remain unmodified after deploy and revert.

4. **Generalize the action model before expanding beyond skill directories**
   - Refactor `DeployAction`, `RevertAction`, and the planner/executor split so the engine can represent directory copy or symlink, file write, and structured config patch as distinct action types (`src/types.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
   - Keep dry-run and revert logic action-aware so later work does not get bolted onto the current skill-directory path model.

## Roadmap Items

### Ownership and Reversibility

- **TOCTOU Race Window**: Backup, ownership check, removal, and recreate are split across multiple `lstat`, `readlink`, `rename`, `rm`, and `unlink` steps, so path state can change between validation and mutation (`src/core/deploy.ts`, `src/core/revert.ts`).

### Manifest and Planning Quality

- **Lossy Manifest Parsing**: `mcpServers` and `agentRules` are stored as `unknown[]`; wrong types are silently converted to empty arrays, and entry shape is never validated (`src/config/manifest.ts`, `src/types.ts`).
- **Target Collision Risk**: `skill.name` is not enforced as unique and duplicate agent IDs are not deduplicated, so one manifest can plan repeated writes to the same target path (`src/config/manifest.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
- **Late Skill Contract Failure**: The planner validates repository escape, but deploy only checks `access()` on the source path. It does not require a readable directory with `SKILL.md`, so malformed skill entries fail late and with generic messaging (`src/core/deploy.ts`).
- **Error Specificity Gap**: Manifest read failures and source-access failures are collapsed into generic “no file” or “source not found” errors even when the real cause is permissions or I/O policy (`src/config/manifest.ts`, `src/core/deploy.ts`).

### Portability and Agent-Surface Hygiene

- **Packaging Portability**: `package.json` requires Node `>=23.6.0`, which is higher than many enterprise LTS baselines. Reassess the true runtime minimum or document the dependency clearly before broader rollout.

### Automation and Enterprise Readiness

- **Revert Exit-Code Reliability**: `executeRevert` converts destructive failures into “skip” outcomes, and `runRevert` still exits `0`. That makes CI and fleet automation unable to distinguish success from partial failure (`src/core/revert.ts`, `src/index.ts`).
- **No Enterprise Preflight Abstraction**: The current CLI has nowhere to surface policy or local-config authority checks before future config or file patch work. Add a preflight or reporting layer before broadening beyond skill directories (`src/index.ts`, future planner and report modules).
- **Dry-Run Precision Gap**: Current dry-run output is path and action oriented only. Before config or file mutations are added, the reporting model needs a structured way to show exact planned changes instead of directory-level summaries (`src/core/deploy.ts`, `src/logger.ts`).

### Future Deploy-Surface Expansion

- **Directory-Only Action Model**: `DeployAction`, `RevertAction`, and the current planner or executor split are still centered on skill-directory deploys. Generalize them before adding single-file writes or structured config patches (`src/types.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).
- **Directory-Only Ownership Semantics**: The current registry model tracks directory symlink or copy deploys, but it is not yet a generalized ownership model for file-level instructions or config patching (`src/types.ts`, `src/core/ownership.ts`, `src/core/deploy.ts`, `src/core/revert.ts`).

### Testing and Validation

- **CLI End-to-End Coverage Gap**: The main command path in `src/index.ts` is not exercised by integration tests, so exit codes and user-facing summaries can drift.
- **Binary Detection Coverage Gap**: Tests do not meaningfully exercise `where.exe`, missing `which`, or the `/bin/sh` `command -v` fallback (`src/core/detect.ts`, `test/detect.test.ts`).
- **Windows Deployment Coverage Gap**: The copy-based deploy or revert path and Windows ownership behavior are not covered by realistic Windows tests (`src/core/deploy.ts`, `src/core/revert.ts`, `test/deploy.test.ts`, `test/revert.test.ts`).
- **Source-Immutability Coverage Gap**: There is no regression test that fails if deploy or revert mutates the checked-out source tree on POSIX. The ownership refactor should add one.
