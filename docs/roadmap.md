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

1. **Add GitHub Copilot devcontainer MCP support.**  
   The north star still lists `devcontainer.json` as part of GitHub Copilot's documented MCP surface, and the agent registry still marks this as planned rather than supported. Add manifest/planner/adapter support only if it can preserve current ownership tracking, dry-run visibility, and safe revert semantics for nested JSON patching under `customizations.vscode.mcp.servers`.  
   `Score 7/12 (Architecture 1, Agents 2, OS 1, Confidence 2, Safety 0, Stability 1)`

2. ~~**Model GitHub Copilot agent-level MCP/tool frontmatter mapping.**  
   GitHub Copilot agent definitions already deploy as Markdown files, but the north star still calls out agent frontmatter as an MCP-related surface and the roadmap does not track that gap explicitly. Add manifest and validation support for agent-level tool mapping only if it can stay distinct from existing `agentDefinitions` and `mcpServers` flows without creating ambiguous ownership between definition content and deploy-time config patches.  
   `Score 5/12 (Architecture 1, Agents 2, OS 0, Confidence 1, Safety 0, Stability 1)`~~
