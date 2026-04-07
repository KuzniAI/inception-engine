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

1. **Add explicit Windows execution coverage for repo/workspace instruction targets and frontmatter emit.**  
   Windows coverage is better than when this roadmap was first written: there are Windows deploy/revert tests for skill-dir behavior, config-patch revert integration, file-write revert integration, and cross-platform path-template resolution. The remaining gap is end-to-end execution coverage for repo/workspace `agentRules` targets and Antigravity frontmatter emit on Windows, which are still primarily exercised through platform-agnostic tests.  
   `Score 8/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 1, Stability 1)`

2. **Add fixture-based `init` coverage against `limbo/`, sidecar manifests, and README examples.**  
   `init` now has broad CLI coverage for sidecar manifests, shared-surface defaults, `copilot-instructions.md`, hints for `files/` and `configs/`, and `.agents/rules/` filtering. What is still missing is a single fixture-backed test that runs against the real `limbo/` sample tree and README-shaped layouts so documentation drift is caught without reconstructing scenarios piecemeal in tests.  
   `Score 7/12 (Architecture 1, Agents 1, OS 1, Confidence 2, Safety 1, Stability 1)`

## Functional Features

1. ~~**Implement GitHub Copilot MCP support on the documented repo/workspace surfaces.**  
   The north star now treats GitHub Copilot MCP as a real, documented vector, while the current implementation still warns and skips it. Add adapters for workspace and repo-scoped Copilot MCP surfaces, with ownership tracking and safe revert, instead of keeping it in planned state.  
   `Score 8/12 (Architecture 1, Agents 2, OS 1, Confidence 2, Safety 1, Stability 1)`~~

2. ~~**Add Claude Code project-level MCP support via `.claude/mcp.json`.**  
   Current MCP support only targets the global Claude JSON surface, but the north star now calls out a documented project-level config as well. Supporting both levels is necessary before Claude MCP can be considered aligned with the target portability model.  
   `Score 8/12 (Architecture 1, Agents 1, OS 1, Confidence 2, Safety 1, Stability 2)`~~

3. **Finish Gemini CLI documented instruction-surface alignment.**  
   Gemini CLI is much closer to the north star than it was when this item was first written: `GEMINI.md` rules are supported for `scope: "global"`, `scope: "repo"`, and `scope: "workspace"`; Gemini agent definitions are now treated as documented; and both Markdown and TOML files in `.gemini/agents/` deploy correctly for `scope: "global"` and `scope: "repo"`. The remaining gap is instruction-surface authority: inception-engine still always deploys rules to `GEMINI.md`, while the documented surface area also includes `settings.json`-driven `instructionFilename` overrides and native `AGENTS.md` fallback loading. Preflight warns when `instructionFilename` disagrees with the deploy target, but deploy cannot yet target the configured filename or intentionally route to the documented fallback surface without colliding with other agents that own `AGENTS.md`.  
   `Score 8/12 (Architecture 1, Agents 2, OS 1, Confidence 2, Safety 1, Stability 1)`

4. **Extend GitHub Copilot MCP support to the remaining documented surfaces.**  
   The repo/workspace `.vscode/mcp.json` surfaces are now implemented with merge-patch deploy and safe revert, so the earlier MCP gap is closed. What still remains from the north star is the rest of Copilot's documented MCP area: devcontainer-scoped configuration and agent-level tool/frontmatter mapping are not yet modeled in the manifest, planner, or ownership system. Add those surfaces only if they can be represented without weakening current dry-run clarity or creating ambiguous overlap with existing instruction and agent-definition flows.  
   `Score 6/12 (Architecture 1, Agents 2, OS 1, Confidence 1, Safety 0, Stability 1)`
