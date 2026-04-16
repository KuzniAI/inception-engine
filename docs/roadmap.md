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

1. ~~**Deduplicate instruction-file parsing across multi-agent planning.**~~  
   ~~Shared `agentRules` and `agentDefinitions` sources can be re-opened and re-parsed once per target agent during planning. That repeats the same markdown and frontmatter validation work and inflates planning cost for entries that fan out to multiple agents. Cache parsed instruction documents and reuse the result for agent-specific validation so planning remains linear in source files rather than target combinations.~~  
   `Score 10/12 (Architecture 1, Agents 2, OS 2, Confidence 2, Safety 1, Stability 2)`

2. ~~**Parallelize independent deploy work with bounded concurrency and target isolation.**~~  
   ~~The deploy executor currently processes all actions serially even when they write to unrelated targets. After registry writes are decoupled from each action, non-conflicting actions should be grouped and executed with bounded concurrency so large manifests can make better use of Node.js asynchronous filesystem throughput without weakening collision handling, dry-run reporting, or rollback safety.~~  
   `Score 9/12 (Architecture 2, Agents 1, OS 2, Confidence 1, Safety 1, Stability 2)`

3. ~~**Parallelize preflight checks that read independent agent state.**~~  
    ~~Preflight still collects some agent-specific warnings sequentially even though the work is mostly independent file reads and environment inspection. Running those checks concurrently would not change behavior, but it would reduce startup latency as the number of detected agents grows. Keep warning ordering deterministic if the output contract depends on it.~~  
    `Score 8/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 1, Stability 1)`

4. ~~**Memoize symlink-containment validation for manifest source paths.**~~  
   ~~Source-path validation defends correctly against symlink escape, but its identity fallback can walk ancestor chains and issue repeated `stat` calls for the same paths. On deeper trees or manifests with many entries, that becomes avoidable syscall overhead. Add memoization around resolved source validation so repository-root safety guarantees are preserved without redoing the same containment checks across planning stages.~~  
   `Score 9/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 1, Stability 2)`

5. **Make `init` repo scanning scale better on large trees.**  
   `init` currently discovers skills with a mostly serialized recursive walk and then does repeated linear prefix checks to decide whether markdown files sit inside skill directories. That is simple and correct, but it leaves performance on the table for larger repositories. Rework discovery around bounded-concurrency traversal and cheaper prefix-membership checks so initialization cost grows more predictably with repository size. Favor modern Node directory-iteration patterns that avoid repeatedly materializing large entry arrays when a streaming walk would do.  
   `Score 8/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 1, Stability 1)`
