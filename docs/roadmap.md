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

## Redundant Configuration

Ordered from highest to lowest.

1. ~~**Collapse Antigravity repo-level instruction deployment onto shared instruction surfaces where the behavior is now redundant.**
   The current implementation still treats Antigravity repo rules as a custom `.agents/rules/{name}.md` path in both adapters and `init`, even though the north-star now calls out repo-level instruction overlap that should let us remove at least part of this bespoke handling. Keep `.agents/rules/` only for genuinely Antigravity-specific surfaces such as frontmatter-driven MCP or agent-definition cases that cannot be expressed through shared rule files.
   `Score 11/12 (Architecture 2, Agents 2, OS 1, Confidence 2, Safety 2, Stability 2)`~~

2. **Introduce a first-class shared-surface model in the agent registry.**  
   Today, shared-surface behavior is encoded as one-off exceptions: GitHub Copilot rides Claude-native instructions, while Gemini CLI and Antigravity trigger ambiguity warnings because they partly share lineage but not the same target paths. Replace these ad hoc branches with explicit metadata for `native`, `shared-via`, and `agent-specific` surfaces so deploy, revert, preflight, and `init` all reason from the same model.  
   `Score 11/12 (Architecture 2, Agents 2, OS 1, Confidence 2, Safety 2, Stability 2)`

3. ~~**Stop treating Antigravity `.agents/rules/` as two independent concepts unless the file shape proves it.**
   The current code uses the same Antigravity path family for both `agentRules` and `agentDefinitions`, which creates redundant configuration and collision potential. Tighten discovery and planning so one file is not silently modeled as two different portability vectors unless the north-star and file schema clearly justify that split.
   `Score 10/12 (Architecture 2, Agents 2, OS 1, Confidence 1, Safety 2, Stability 2)`~~

## Architecture Enablers

Ordered from highest to lowest.

1. **Extend ownership tracking to cover frontmatter-emit and surface migrations, not just whole-file writes and config patches.**  
   The north star explicitly requires patch-level provenance and safe reverts for config-like edits. That is still incomplete for Markdown frontmatter emit targets and for any future migration from one surface to another. Add provenance that can prove which frontmatter block or migrated target is engine-owned before more portability vectors are promoted from roadmap to supported behavior.  
   `Score 10/12 (Architecture 2, Agents 2, OS 1, Confidence 2, Safety 1, Stability 2)`

2. **Make capability confidence a first-class planning input across `init`, deploy, and preflight.**  
   The codebase already distinguishes documented, implementation-only, unsupported, and planned surfaces in different places, but not through a single planning model. Unify that so generated manifests, warnings, and skips consistently reflect whether a surface is documented, implementation-only, shared through another agent, or deliberately redundant.  
   `Score 10/12 (Architecture 2, Agents 2, OS 1, Confidence 2, Safety 2, Stability 1)`

3. **Add migration primitives for surface realignment.**  
   Several north-star corrections imply moving existing deployments between paths or schemas, for example GitHub Copilot agent-definition paths or Antigravity shared-surface cleanup. Add explicit migration planning so the engine can move engine-owned artifacts without orphaning registry entries or leaving revert in an inconsistent state.  
   `Score 8/12 (Architecture 2, Agents 1, OS 1, Confidence 1, Safety 1, Stability 2)`

## Quality And Maintenance

Ordered from highest to lowest.

1. **Add matrix tests for shared-surface collisions and ambiguity cases.**  
   The current tests cover many Gemini CLI and Antigravity ambiguity warnings plus Copilot-via-Claude behavior, but the roadmap direction now depends on safely collapsing redundant surfaces. Add focused tests for shared-via aliasing, rule-vs-definition collisions, repo/workspace overlap, and migration-safe revert behavior before removing special-case code.  
   `Score 10/12 (Architecture 1, Agents 2, OS 2, Confidence 2, Safety 2, Stability 1)`

2. **Expand Windows coverage beyond skill-directory deployment into repo/workspace rules and config-adapter behavior.**  
   Windows tests exist, but the deepest portability work now sits in rules, config patches, frontmatter emit, and revert semantics. Add coverage for rule scopes, config targets, and revert behavior on Windows so future portability work does not remain POSIX-biased.  
   `Score 10/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 2, Stability 2)`

3. **Add fixture-based `init` coverage against `limbo/`, sidecar manifests, and README examples.**  
   `init` now scans rules, agent definitions, MCP sidecars, files sidecars, and configs sidecars. A fixture-based test that exercises the real sample bundle and README-facing conventions will catch drift earlier than unit-only coverage.  
   `Score 9/12 (Architecture 1, Agents 1, OS 1, Confidence 2, Safety 2, Stability 2)`

4. **Add golden tests for registry behavior during surface migrations and redundant-path removal.**  
   Once redundant configuration starts collapsing, regressions will likely appear in ownership and revert rather than raw planning. Add golden-style tests around registry entries, undo patches, and migrated targets so cleanup work remains reversible.  
   `Score 9/12 (Architecture 1, Agents 1, OS 2, Confidence 1, Safety 2, Stability 2)`

## Functional Features

Ordered from highest to lowest.

1. **Implement GitHub Copilot MCP support on the documented repo/workspace surfaces.**  
   The north star now treats GitHub Copilot MCP as a real, documented vector, while the current implementation still warns and skips it. Add adapters for workspace and repo-scoped Copilot MCP surfaces, with ownership tracking and safe revert, instead of keeping it in planned state.  
   `Score 8/12 (Architecture 1, Agents 2, OS 1, Confidence 2, Safety 1, Stability 1)`

2. **Add Claude Code project-level MCP support via `.claude/mcp.json`.**  
   Current MCP support only targets the global Claude JSON surface, but the north star now calls out a documented project-level config as well. Supporting both levels is necessary before Claude MCP can be considered aligned with the target portability model.  
   `Score 8/12 (Architecture 1, Agents 1, OS 1, Confidence 2, Safety 1, Stability 2)`

3. **Implement OpenCode permissions support in `opencode.json`.**  
   The north star now treats OpenCode permissions as a real execution/safety surface, but the current registry still marks it unsupported. Add an adapter for `allow` / `ask` / `deny` semantics with validation and revert coverage.  
   `Score 8/12 (Architecture 1, Agents 1, OS 1, Confidence 2, Safety 1, Stability 2)`

4. **Realign GitHub Copilot agent-definition support with the latest documented on-disk surface.**  
   The current implementation deploys Copilot agent definitions to `.github/agents/{name}.agent.md`, while the north star now points at a different documented target. Reconcile the path, update `init` discovery, and add migration coverage so the implementation does not hard-code an outdated Copilot layout.  
   `Score 8/12 (Architecture 1, Agents 1, OS 1, Confidence 2, Safety 1, Stability 2)`

5. **Expand Gemini CLI instruction and agent-definition coverage to match the current documented surface area.**  
   The north star now calls out Gemini support for additional instruction filename behavior and broader agent-definition locations than the current implementation models. Evaluate which of those surfaces are safe to support directly and which should remain warning-only until ownership and revert semantics are clear.  
   `Score 7/12 (Architecture 1, Agents 1, OS 1, Confidence 1, Safety 1, Stability 2)`
