# Inception Engine: Roadmap

This roadmap is rebuilt from the current codebase and test suite, not from earlier planning assumptions.

As of the current implementation:

- Skill deployment, file writes, and top-level config patching are implemented and covered by tests.
- `mcpServers` and `agentRules` are no longer validation-only. They compile into deploy actions and are exercised by tests.
- Revert is now implemented for `mcpServers` and `agentRules` as well as `skills`, `files`, and `configs`.

## Implemented But Not Complete Enough To Call Closed

1. **Atomic overwrite guarantees are narrower across deployment kinds**
   - `skill-dir` redeploys have the strongest overwrite protection: the existing managed target is renamed to a backup before replacement and restored if the new deploy fails (`src/core/deploy.ts:769`, `src/core/deploy.ts:819`).
   - `file-write` redeploys also back up an existing managed target first, but the replacement is still written directly to the final path rather than being atomically swapped into place (`src/core/deploy.ts:411`, `src/core/deploy.ts:445`).
   - `config-patch` deployments patch the target in place and only attempt to rewrite the original content on failure, so they do not provide the same backup-and-restore semantics as `skill-dir` (`src/core/deploy.ts:579`).

## Exit Criteria For New Capability Work

Feature expansion should wait until these are true:

- `mcpServers` and `agentRules` support deploy, dry-run, ownership checks, and revert end to end.

## Things to do later

1. **Expand Windows coverage** for additional edge cases
2. **Skill contract validation is intentionally minimal**
   - The planner validates that the source is a readable directory and that `SKILL.md` exists and is readable (`src/core/deploy.ts:672`).
   - It does not parse or validate YAML frontmatter fields such as `name` and `description`.
   - README already documents this limitation, so any follow-up here is hardening work rather than a docs-correction issue.