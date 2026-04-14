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

1. ~~**Cache registry state per run instead of reparsing and rewriting it for every deploy action.**~~  
   ~~Ownership tracking is currently correct, but the registry is loaded, parsed, stringified, and permission-adjusted repeatedly during deploy and revert flows. As manifests grow, this makes runtime scale with both action count and registry size. Introduce a per-run in-memory registry layer with an explicit flush boundary so ownership checks remain accurate while repeated JSON and filesystem churn are removed. Use that flush boundary to standardize a single durable write path for registry persistence rather than letting each update behave like an isolated full-file rewrite.~~  
   `Score 11/12 (Architecture 2, Agents 1, OS 2, Confidence 2, Safety 2, Stability 2)`

2. **Parallelize independent deploy work with bounded concurrency and target isolation.**  
   The deploy executor currently processes all actions serially even when they write to unrelated targets. After registry writes are decoupled from each action, non-conflicting actions should be grouped and executed with bounded concurrency so large manifests can make better use of Node.js asynchronous filesystem throughput without weakening collision handling, dry-run reporting, or rollback safety.  
   `Score 9/12 (Architecture 2, Agents 1, OS 2, Confidence 1, Safety 1, Stability 2)`

3. **Deduplicate instruction-file parsing across multi-agent planning.**  
   Shared `agentRules` and `agentDefinitions` sources can be re-opened and re-parsed once per target agent during planning. That repeats the same markdown and frontmatter validation work and inflates planning cost for entries that fan out to multiple agents. Cache parsed instruction documents and reuse the result for agent-specific validation so planning remains linear in source files rather than target combinations.  
   `Score 10/12 (Architecture 1, Agents 2, OS 2, Confidence 2, Safety 1, Stability 2)`

4. **Memoize symlink-containment validation for manifest source paths.**  
   Source-path validation defends correctly against symlink escape, but its identity fallback can walk ancestor chains and issue repeated `stat` calls for the same paths. On deeper trees or manifests with many entries, that becomes avoidable syscall overhead. Add memoization around resolved source validation so repository-root safety guarantees are preserved without redoing the same containment checks across planning stages.  
   `Score 9/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 1, Stability 2)`

5. **Make `init` repo scanning scale better on large trees.**  
   `init` currently discovers skills with a mostly serialized recursive walk and then does repeated linear prefix checks to decide whether markdown files sit inside skill directories. That is simple and correct, but it leaves performance on the table for larger repositories. Rework discovery around bounded-concurrency traversal and cheaper prefix-membership checks so initialization cost grows more predictably with repository size. Favor modern Node directory-iteration patterns that avoid repeatedly materializing large entry arrays when a streaming walk would do.  
   `Score 8/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 1, Stability 1)`

6. **Parallelize preflight checks that read independent agent state.**  
    Preflight still collects some agent-specific warnings sequentially even though the work is mostly independent file reads and environment inspection. Running those checks concurrently would not change behavior, but it would reduce startup latency as the number of detected agents grows. Keep warning ordering deterministic if the output contract depends on it.  
    `Score 8/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 1, Stability 1)`

7. ~~**Replace top-level `process.exit(...)` control flow with exit-code assignment and signal-aware shutdown.**~~  
   ~~The CLI currently exits directly from the top-level wrapper after `main()` resolves or throws. In modern Node.js CLIs, setting `process.exitCode` and letting the event loop drain is safer because it reduces the risk of truncating buffered stdout or stderr output and leaves room for shared cleanup paths. Add explicit `SIGINT` and `SIGTERM` handling so long-running deploy, revert, and init flows can stop cleanly and report partial progress consistently.~~  
   `Score 10/12 (Architecture 2, Agents 1, OS 2, Confidence 2, Safety 1, Stability 2)`

8. **Thread cancellation through long-running filesystem workflows with `AbortSignal`.**  
   Deploy, revert, preflight, and init are written as async flows, but once started they mostly run to completion even if the user interrupts the process. Add a root `AbortController`, pass its signal through the planning and execution layers, and teach long loops plus supported filesystem calls to stop at explicit checkpoints. That aligns better with modern Node patterns for cooperative cancellation and makes signal handling practical instead of best-effort only at the process boundary.  
   `Score 9/12 (Architecture 2, Agents 1, OS 2, Confidence 2, Safety 1, Stability 1)`

9. ~~**Standardize every state and config write on one atomic file-write primitive.**~~  
   ~~Some write paths already stage to a temp file and `rename()` into place, but others still write final targets directly, including registry persistence, `init` manifest generation, and parts of revert. Unify these on a shared helper that stages in the target directory, renames atomically, and handles cleanup consistently. This is a modern Node CLI reliability baseline for tools that mutate user config and local state, especially when an interruption or crash lands between serialize and persist steps.~~  
   `Score 11/12 (Architecture 2, Agents 1, OS 2, Confidence 2, Safety 2, Stability 2)`

10. **Preserve underlying failure causes in a typed CLI error model.**  
    The codebase already has a `UserError` boundary, but many lower-level failures are still collapsed into plain `Error` messages that discard errno context and causal chains. Expand the typed error model so operational failures keep their original `cause`, can be mapped to stable exit behavior, and remain debuggable without string-parsing. Modern Node gives enough native support for error causes that the CLI can stay dependency-light while still producing better diagnostics and more maintainable error handling.  
    `Score 9/12 (Architecture 1, Agents 1, OS 2, Confidence 2, Safety 1, Stability 2)`
