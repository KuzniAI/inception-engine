# Inception Engine: Roadmap

This roadmap is rebuilt from the current codebase and test suite, not from earlier planning assumptions.

As of the current implementation:

- Skill deployment, file writes, and top-level config patching are implemented and covered by tests.
- `mcpServers` and `agentRules` are no longer validation-only. They compile into deploy actions and are exercised by tests.
- ~~The old crossed-out claim that these sections were "executable through planning and revert" is still false. Deploy exists; revert still does not.~~ Revert is now implemented for both surfaces.

## What Is Actually Implemented

### Stable Enough To Treat As Present

- Skill deploy planning and execution for detected agents (`src/core/deploy.ts`)
- Registry-backed ownership checks and safe revert for `skills`, `files`, `configs`, `mcpServers`, and `agentRules` (`src/core/ownership.ts`, `src/core/revert.ts`)
- Adapter compilation for `mcpServers` and `agentRules` into existing action kinds (`src/core/adapters/index.ts`)
- Dry-run output and collision warnings for compiled actions (`src/core/deploy.ts`)
- Agent detection, privilege-aware home resolution, and path placeholder handling (`src/core/detect.ts`, `src/core/resolve.ts`)

### Implemented But Not Complete Enough To Call Closed

~~1. **Adapter-backed deploy without adapter-backed revert**~~
   - ~~`mcpServers` compiles into `config-patch` deploy actions.~~
   - ~~`agentRules` compiles into `file-write` deploy actions.~~
   - ~~`planRevert` and `planRevertAll` still explicitly omit both surfaces (`src/core/revert.ts:95`, `src/core/revert.ts:112`).~~
   - ~~This means README is currently accurate when it says revert is not implemented for those surfaces, and the old struck-through roadmap item was premature.~~

2. **Config patching is not RFC 7386 / RFC 7396 JSON Merge Patch**
   - README says config entries apply a JSON merge patch.
   - The implementation only patches top-level keys by assignment or deletion (`src/core/deploy.ts:82`).
   - Nested objects are replaced wholesale instead of recursively merged, and undo state is also captured only at the top level (`src/core/deploy.ts:71`).
   - This is especially risky for MCP registration because the adapter writes `{ mcpServers: { [name]: config } }` (`src/core/adapters/mcp.ts:45`), which can replace the entire existing `mcpServers` object instead of adding one server.

3. **Atomic overwrite guarantees are narrower than the docs suggest**
   - Atomic backup-and-restore exists for `skill-dir` redeploys only (`src/core/deploy.ts:633`).
   - `file-write` and `config-patch` deployments write directly to the target without the same backup/rollback model (`src/core/deploy.ts:376`, `src/core/deploy.ts:454`).
   - The README statement about atomic redeploy for "existing managed targets" is therefore broader than the actual code.

4. **"Skill contract validation" only checks presence/readability of `SKILL.md`**
   - The planner validates that the source is a readable directory and that `SKILL.md` exists (`src/core/deploy.ts:539`).
   - It does not validate YAML frontmatter, `name`, or `description`, even though README presents those fields as required for skills.

## Priority Gaps

~~1. **Finish revert support for adapter-driven capabilities**~~
   - ~~Add adapter mirror functions for `mcpServers` and `agentRules`.~~
   - ~~Make `planRevert` and `planRevertAll` generate matching revert actions.~~
   - Add end-to-end tests that deploy and revert both surfaces through the manifest, not just adapter compilation tests.

~~2. **Fix config patch semantics before expanding config-driven features**~~
   - ~~Replace the shallow patcher with real JSON Merge Patch behavior.~~
   - ~~Preserve nested sibling keys during MCP registration.~~
   - ~~Update undo-patch generation and revert logic to match the same semantics.~~
   - ~~Add tests for nested object merge, nested deletion, and MCP coexistence with pre-existing servers.~~

3. **Bring docs back in line with the code**
   - Narrow README claims around atomic redeploy so they describe `skill-dir` behavior specifically.
   - Stop calling the current patcher RFC 7386 / RFC 7396 compliant until it actually is.
   - Distinguish "deploy supported" from "revert supported" in the feature matrix.
   - Either validate skill frontmatter or soften README language about required skill structure.

4. **Raise Windows confidence from inferred to demonstrated**
   - The codebase has useful path-resolution tests and some cross-platform copy/revert coverage.
   - Important behavior is still more thoroughly exercised on POSIX than on real Windows execution paths (`test/cross-platform.test.ts`, `test/deploy.test.ts`, `test/revert.test.ts`).
   - CI should prove Windows copy deploy, overwrite protection, registry handling, and revert behavior directly.

## Obvious Code Problems To Fix Before More Surface Area

- ~~`mcpServers` registration can clobber existing sibling MCP entries because config patching is shallow.~~
- Adapter-owned deploys leave registry-managed state behind that the manifest-level revert planner does not currently clean up.
- The docs imply stronger safety guarantees for all managed target types than the code actually provides.
- The docs imply stronger skill-file contract enforcement than the code currently performs.

## Exit Criteria For New Capability Work

Feature expansion should wait until these are true:

- `mcpServers` and `agentRules` support deploy, dry-run, ownership checks, and revert end to end.
- ~~Config patch behavior matches the documented merge semantics and is covered by nested-object tests.~~
- README capability claims match the actual guarantees in code.
- Windows behavior is exercised in CI with real execution, not mostly path-resolution tests plus POSIX inference.
