# Inception Engine: Roadmap

This document tracks the gap between the current implementation and the strategic vision defined in `docs/north-star.md`.

The current codebase is a cross-platform skill deployer with detection, path resolution, and revert support. It is not yet a full customization engine for persistent instruction files, MCP manifests, subagents, or execution hooks.

## Features

### Customization Vectors
- **Global System Instructions**:
  - Implement synchronization for `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, and supported GitHub Copilot instruction surfaces across detected agent home directories.
  - Add file-level ownership proofs so single-file customizations can be reverted safely.
  - Implement Gemini CLI / Antigravity collision mitigation for the shared `~/.gemini/GEMINI.md` path.
- **Model Context Protocol (MCP)**:
  - Parse and validate `mcpServers` from `inception.json` instead of treating them as opaque arrays.
  - Implement standard-to-OpenCode transformation for `opencode.json`, including `type: "local"`, merged `command`/`args`, `environment`, and `{env:VAR}` rewriting.
  - Add Codex MCP integration based on currently documented config surfaces instead of assuming older or undocumented asset formats.
  - Detect and warn when GitHub Copilot enterprise policy overrides will block local MCP configuration.
- **Subagent Topologies**:
  - Support agent and subagent assets only where the vendor's file format and install surface are currently documented strongly enough to implement safely.
  - Design adapter-based translation only after each target agent schema is validated; avoid assuming a universal cross-agent subagent format.
  - Extend the agent registry and deployment planner to target subagent install locations in addition to skill directories.
- **Execution Hooks**:
  - Deploy GitHub Copilot lifecycle hooks via its JSON schema.
  - Emulate hooks in OpenCode by patching `opencode.json` with `permission: { "bash": "ask" }` and related safe-by-default behavior.
  - Introduce file/config patching primitives so hooks and MCP changes are not limited to directory copies or symlinks.

### UX Improvements
- **Dry-run Enhancements**:
  - Show exact file/config transformations for JSON, TOML, and Markdown outputs instead of only path-level action summaries.
  - Surface overwrite, replace, merge, and delete decisions before execution.
- **Agent-Specific Filters**:
  - Show which manifest entries apply to which agents before deployment.
  - Distinguish detected agents, requested agents, unsupported vectors, and skipped work items.
- **Token Linter**:
  - Warn when global plus workspace instructions exceed configurable heuristic thresholds instead of treating any fixed token number as a stable vendor limit.
  - Call out agent-specific constraints only where the current documentation or direct product behavior supports them.
- **Permission Manifest**:
  - Print a clear summary of every file and config location that will be created, patched, replaced, or removed, especially when operating outside skill directories.

## Issues

### Divergences from North Star
- **Manifest Stagnation**: `inception.json` currently accepts `mcpServers` and `agentRules`, but the deployment engine ignores them entirely.
- **Instruction-File Gap**: The engine does not yet install or update persistent instruction files such as `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or supported Copilot instruction files.
- **Subagent Gap**: The engine does not yet model or deploy any agent or subagent assets despite them being a north-star vector where vendor support is sufficiently documented.
- **Execution-Hook Gap**: The engine does not yet patch `opencode.json` or deploy Copilot lifecycle hooks.
- **Gemini/Antigravity Collision**: The codebase does not yet implement mitigation for the shared `~/.gemini/GEMINI.md` path.
- **OpenCode Windows Paths**: `%APPDATA%\opencode\...` support exists for skills, but the same path logic must extend to instructions, hooks, MCP, and subagents.
- **Skill-Only Scope**: The current engine is still a skill-directory installer and lacks the file-level manipulation required for persistent instructions and config patching.

### Security Posture
- **OpenCode Autonomy Risk**: OpenCode remains effectively fast-by-default until `permission: "ask"` behavior is injected into `opencode.json`.
- **SUDO_USER Validation**: `SUDO_USER` lookup exists, but inherited or externally injected environment values can still steer deployment into the wrong user's home directory unless provenance is checked more strictly.
- **Symlink TOCTOU/Injection Risk**: Deploy and revert still rely on pre-checks that can be invalidated between `lstat`, `readlink`, `rm`, `unlink`, and create operations.
- **Insecure File Permissions**: The engine does not explicitly set or verify permissions on deployed files and config artifacts.

### Interoperability
- **Variable Syntax Mapping**: The engine must translate `${VAR}` to `{env:VAR}` where required so MCP definitions behave consistently across agents.
- **Cross-Platform Ownership Proofs**: ~~`.inception-totem` works only for copied directories;~~ file-level and patched-config ownership tracking is still missing.
- **Enterprise Registry Blocking**: GitHub Copilot may ignore local MCP configuration when org policies are active; the tool should detect and warn about that state.
- **XDG Base Directory Support**: On Linux/POSIX, config paths should respect `XDG_CONFIG_HOME` and related XDG variables instead of always defaulting to `{home}/.config`.
- **Shell-Specific Escaping**: `isBinaryViaCommandV` relies on a POSIX shell fallback that should be verified across minimal and unusual environments.
- **External Surface Drift**: Some agent configuration surfaces change quickly; roadmap work should be gated on current vendor documentation rather than historical assumptions.

### Performance
- **Synchronous I/O in Resolver**: `resolve.ts` uses synchronous `execFileSync` and `readFileSync` for home directory lookup.
- **Sequential Execution**: `executeDeploy` and `executeRevert` process actions sequentially and should eventually batch independent filesystem work.
- **Redundant I/O Calls**: Deploy and revert perform repeated `access`, `lstat`, and path checks that could be consolidated.

### Coding Practices and Dependencies
- **Implicit Casting in Manifest**: `loadManifest` still relies on loose casting for manifest parsing instead of schema-backed validation.
- **Manifest Uniqueness Rules**: `skill.name` values are not enforced as unique, and duplicate agent IDs are not deduplicated, which can create target-path collisions and duplicate actions.
- **Skill Source Contract Validation**: Deploy verifies only that the source exists; it does not verify that the source is a directory with a valid `SKILL.md`.
- **Naming Rule Drift**: README guidance and runtime validation disagree on allowed `skill.name` formats, which should be reconciled and made portable.
- **Test Asset Management**: Tests manually create and delete temporary directories instead of using a more robust fixture lifecycle.

### CLI Reliability
- **Revert Exit Codes**: `revert` can log failures and still exit successfully, which makes automation unreliable.
- **Error Specificity**: Manifest read failures and source access failures are currently collapsed into generic messages, which obscures permission and I/O problems.

### Testing
- **CLI Coverage Gap**: The main CLI flow is not covered by end-to-end tests.
- **Binary Detection Coverage Gap**: Detection fallback behavior for `which`, `where.exe`, and `command -v` is only lightly exercised.
- **Windows Deployment Coverage Gap**: Real copy-based deploy/revert behavior and `.inception-totem` ownership handling are not meaningfully tested on Windows.
