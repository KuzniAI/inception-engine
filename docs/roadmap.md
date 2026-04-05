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

## Quality And Maintenance

Ordered from highest to lowest.

1. **Add explicit Windows execution coverage for repo/workspace instruction targets and frontmatter emit.**  
   Windows coverage is better than when this roadmap was first written: there are Windows deploy/revert tests for skill-dir behavior, config-patch revert integration, file-write revert integration, and cross-platform path-template resolution. The remaining gap is end-to-end execution coverage for repo/workspace `agentRules` targets and Antigravity frontmatter emit on Windows, which are still primarily exercised through platform-agnostic tests.  
   `Score 8/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 1, Stability 1)`

2. **Add fixture-based `init` coverage against `limbo/`, sidecar manifests, and README examples.**  
   `init` now has broad CLI coverage for sidecar manifests, shared-surface defaults, `copilot-instructions.md`, hints for `files/` and `configs/`, and `.agents/rules/` filtering. What is still missing is a single fixture-backed test that runs against the real `limbo/` sample tree and README-shaped layouts so documentation drift is caught without reconstructing scenarios piecemeal in tests.  
   `Score 7/12 (Architecture 1, Agents 1, OS 1, Confidence 2, Safety 1, Stability 1)`

3. **Refactor the test suite onto shared cross-platform path assertion helpers.**  
   New tests keep reintroducing one-off path workarounds, and those assertions regularly fail on `windows-latest` because they hard-code POSIX or Windows separators. Do a deliberate cleanup pass across the unit test suite: add a small shared helper layer for path normalization and path-aware assertions, migrate existing tests to it, and remove ad-hoc separator fixes so new coverage follows one consistent pattern. Treat this as both a refactor and a guardrail task: every test that asserts on paths should either normalize separators through the shared helper or assert via `path` utilities, and agent instructions should explicitly forbid hard-coded path-separator assertions in new tests.  
   `Score 8/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 1, Stability 1)`


## Functional Features

Ordered from highest to lowest.

1. **Implement GitHub Copilot MCP support on the documented repo/workspace surfaces.**  
   The north star now treats GitHub Copilot MCP as a real, documented vector, while the current implementation still warns and skips it. Add adapters for workspace and repo-scoped Copilot MCP surfaces, with ownership tracking and safe revert, instead of keeping it in planned state.  
   `Score 8/12 (Architecture 1, Agents 2, OS 1, Confidence 2, Safety 1, Stability 1)`

2. **Add Claude Code project-level MCP support via `.claude/mcp.json`.**  
   Current MCP support only targets the global Claude JSON surface, but the north star now calls out a documented project-level config as well. Supporting both levels is necessary before Claude MCP can be considered aligned with the target portability model.  
   `Score 8/12 (Architecture 1, Agents 1, OS 1, Confidence 2, Safety 1, Stability 2)`

3. **Finish Gemini CLI documented-surface alignment.**  
   The implementation now supports `GEMINI.md` rules plus Markdown agent definitions in `.gemini/agents/` for both `scope: "repo"` and `scope: "global"`, and preflight explicitly warns about documented-but-not-yet-supported Gemini surfaces. What is still missing is full alignment with the documented surface area: configurable instruction filename overrides from `settings.json`, native `AGENTS.md` fallback targeting, and documented TOML subagent definitions are still warning-only, and Gemini agent definitions are still classified as implementation-only rather than fully documented.  
   `Score 7/12 (Architecture 1, Agents 1, OS 1, Confidence 1, Safety 1, Stability 2)`
