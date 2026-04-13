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

1. **Model folder-aware and nested instruction surfaces instead of only one file per scope.**  
   The current `agentRules` model supports `global`, `repo`, and `workspace`, but it does not represent the hierarchical instruction loading that `docs/north-star.md` still calls out for Claude Code (`CLAUDE.md` at folder-level), Codex (`AGENTS.md` nested from repo root down), or GitHub Copilot's `.github/instructions/*.instructions.md` surface. Add explicit manifest and planner support only if the engine can target these additional files without introducing ownership ambiguity between overlapping parent and child instruction files.  
   `Score 8/12 (Architecture 2, Agents 2, OS 1, Confidence 2, Safety 0, Stability 1)`

2. ~~**Add explicit GitHub Copilot scoped-instructions support beyond Claude-shared `CLAUDE.md`.**  
   GitHub Copilot's shared-via-Claude handling is correct for `CLAUDE.md`, but the north star still lists `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md` as native Copilot instruction surfaces. Today `init` maps `copilot-instructions.md` back to `claude-code`, and there is no deploy surface for the `.github/instructions/` directory at all. Add a dedicated Copilot instructions capability only if it can coexist cleanly with the Claude-first path and preflight can explain precedence when both are present.  
   `Score 9/12 (Architecture 2, Agents 2, OS 1, Confidence 2, Safety 1, Stability 1)`~~

3. ~~**Tighten hook support from generic config patching into validated agent-specific adapters.**  
   The manifest now has a separate `hooks` section, but the implementation currently treats it as an unvalidated record and writes it through the same generic config-patch path. That is enough for basic ownership and revert behavior, but it is not enough to claim that Claude's hook surface is implemented properly or to safely expand toward GitHub Copilot's planned binary hooks. Add schema validation and narrower adapters before expanding hook coverage further.  
   `Score 9/12 (Architecture 2, Agents 2, OS 1, Confidence 2, Safety 1, Stability 1)`~~

4. **Add Gemini CLI execution-safety settings beyond instruction-file warnings.**  
   The codebase correctly warns when Gemini's `instructionFilename` changes, but the north star still calls out execution and safety-oriented settings such as safe-mode flags. Those settings are not modeled in `permissions`, `hooks`, or any Gemini-specific adapter today. Add a Gemini execution-config surface only if it can be represented as explicit patch ownership rather than a broad opaque `settings.json` write.  
   `Score 7/12 (Architecture 2, Agents 1, OS 1, Confidence 1, Safety 1, Stability 1)`
