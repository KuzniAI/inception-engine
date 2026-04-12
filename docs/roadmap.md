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

~~1. **Add GitHub Copilot devcontainer MCP support.**  
   The north star still lists `devcontainer.json` as part of GitHub Copilot's documented MCP surface, and the agent registry still marks this as planned rather than supported. Add manifest/planner/adapter support only if it can preserve current ownership tracking, dry-run visibility, and safe revert semantics for nested JSON patching under `customizations.vscode.mcp.servers`.  
   `Score 7/12 (Architecture 1, Agents 2, OS 1, Confidence 2, Safety 0, Stability 1)`~~

~~2. **Add Antigravity raw `mcp_config.json` support.**  
   The implemented Antigravity MCP path is the repo-local `.agents/rules/{name}.md` frontmatter emit flow, but the north star also calls out a raw `mcp_config.json` surface that is not modeled in the manifest, planner, or ownership system. Add this only if the engine can track ownership and revert behavior as safely as the existing config-patch and frontmatter-emit adapters, and only if the raw JSON surface can coexist cleanly with the current `.agents/rules/` path without ambiguous precedence.  
   `Score 6/12 (Architecture 1, Agents 1, OS 1, Confidence 2, Safety 0, Stability 1)`~~

~~3. **Expand execution and safety-oriented config beyond today's `permissions` surface.**  
   The north star still includes broader execution-control surfaces such as Claude hooks, GitHub Copilot binary hooks, and Gemini safe-mode or hook-adjacent settings, but the current manifest only models `permissions`. Add new execution-oriented manifest surfaces only when they can be represented with explicit ownership, dry-run visibility, and narrow revert semantics instead of broad file replacement.  
   `Score 8/12 (Architecture 2, Agents 2, OS 1, Confidence 1, Safety 0, Stability 2)`~~

~~4. **Decide whether execution-surface support should be split by capability instead of folded into `permissions`.**  
   If hook configuration, approval policy, and safety flags are all pursued, the current `permissions` bucket may become too vague for planning and validation. Before implementing more of the north-star execution vector, decide whether the manifest should keep one umbrella section or introduce a more explicit capability split so adapters can stay conservative and warnings remain understandable.  
   `Score 7/12 (Architecture 2, Agents 1, OS 0, Confidence 1, Safety 1, Stability 2)`~~
