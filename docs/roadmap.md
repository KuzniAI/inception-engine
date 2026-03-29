# Inception Engine: Roadmap

This roadmap is rebuilt from the current codebase and test suite, not from earlier planning assumptions.

As of the current implementation:

- Skill deployment, file writes, and top-level config patching are implemented and covered by tests.
- `mcpServers` and `agentRules` are no longer validation-only. They compile into deploy actions and are exercised by tests.
- Revert is now implemented for `mcpServers` and `agentRules` as well as `skills`, `files`, and `configs`.

## What Is Actually Implemented

### Stable Enough To Treat As Present

- Skill deploy planning and execution for detected agents (`src/core/deploy.ts`)
- Registry-backed ownership checks and safe revert for `skills`, `files`, `configs`, `mcpServers`, and `agentRules` (`src/core/ownership.ts`, `src/core/revert.ts`)
- Adapter compilation for `mcpServers` and `agentRules` into existing action kinds (`src/core/adapters/index.ts`)
- Dry-run output and collision warnings for compiled actions (`src/core/deploy.ts`)
- Agent detection, privilege-aware home resolution, and path placeholder handling (`src/core/detect.ts`, `src/core/resolve.ts`)

### Implemented But Not Complete Enough To Call Closed

1. **Atomic overwrite guarantees are narrower than the docs suggest**
   - Atomic backup-and-restore exists for `skill-dir` redeploys only (`src/core/deploy.ts:633`).
   - `file-write` and `config-patch` deployments write directly to the target without the same backup/rollback model (`src/core/deploy.ts:376`, `src/core/deploy.ts:454`).
   - The README statement about atomic redeploy for "existing managed targets" is therefore broader than the actual code.

2. **"Skill contract validation" only checks presence/readability of `SKILL.md`**
   - The planner validates that the source is a readable directory and that `SKILL.md` exists (`src/core/deploy.ts:539`).
   - It does not validate YAML frontmatter, `name`, or `description`, even though README presents those fields as required for skills.

3. **Raise Windows confidence from inferred to demonstrated**
   - The codebase has useful path-resolution tests and some cross-platform copy/revert coverage.
   - Important behavior is still more thoroughly exercised on POSIX than on real Windows execution paths (`test/cross-platform.test.ts`, `test/deploy.test.ts`, `test/revert.test.ts`).
   - CI should prove Windows copy deploy, overwrite protection, registry handling, and revert behavior directly.

## Obvious Code Problems To Fix Before More Surface Area

- The docs imply stronger safety guarantees for all managed target types than the code actually provides.
- The docs imply stronger skill-file contract enforcement than the code currently performs.

## Exit Criteria For New Capability Work

Feature expansion should wait until these are true:

- `mcpServers` and `agentRules` support deploy, dry-run, ownership checks, and revert end to end.
- README capability claims match the actual guarantees in code.
- Windows behavior is exercised in CI with real execution, not mostly path-resolution tests plus POSIX inference.
