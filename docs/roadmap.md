# Inception Engine: Roadmap

This document outlines the gap between the current implementation and the strategic vision defined in `docs/north-star.md`.

## Features

### Customization Vectors
- **Global System Instructions**: Implementation of automated synchronization for `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` across all detected agent home directories.
- **Model Context Protocol (MCP)**:
    - Support for parsing `mcpServers` from `inception.json`.
    - AST-based transformation for OpenCode (`opencode.json` structure, `{env:VAR}` syntax).
    - Just-in-time `openai.yaml` generation for Codex skill dependencies.
- **Subagent Topologies**:
    - Support for `.toml` (Codex) and Markdown + YAML (OpenCode/Claude) subagent definitions.
    - Transpilation logic to convert Codex TOML to OpenCode/Claude Markdown formats.
- **Execution Hooks**:
    - Deployment of GitHub Copilot lifecycle hooks via JSON schema.
    - Emulation of hooks in OpenCode by patching `opencode.json` with `ask` permissions.

### UX Improvements
- **Dry-run Enhancements**: Show the exact AST transformations that would be applied to JSON/TOML configs.
- **Agent-Specific Filters**: Allow users to see which customizations are applicable to which agents before deployment.
- **Token Linter**: Integrated check to warn users if their instruction sets exceed the ~4,000 token / 65KB safety threshold (Context Rot prevention).

## Issues

### Divergences from North Star
- **Manifest Stagnation**: `inception.json` currently contains `mcpServers` and `agentRules` arrays that are completely ignored by the deployment engine.
- **Gemini/Antigravity Collision**: The codebase does not yet implement the "collision mitigation logic" required to prevent workspace Antigravity rules from corrupting global Gemini CLI state in `~/.gemini/GEMINI.md`.
- **OpenCode Windows Paths**: `README.md` specifies `%APPDATA%\opencode\skills\`, but code must ensure this extends to the new customization vectors (instructions, subagents) once implemented.
- **Skill-Only Scope**: The current engine is strictly a "skill directory" installer; it lacks the file-level manipulation capability required for persistent instructions and JSON/TOML config patching.

### Security Posture
- **OpenCode Autonomy Risk**: Currently, OpenCode executes bash commands and writes immediately ("Fast by default"). The roadmap must prioritize the injection of `permission: "ask"` blocks to ensure parity with Claude Code's "Safe by default" behavior.
- **SUDO_USER Validation**: While `SUDO_USER` is correctly resolved, the tool lacks an explicit "Permission Manifest" to show exactly what system-level files (outside of skill directories) are being modified during customization deployment.
- **Symlink TOCTOU/Injection Risk**: `executeDeploy` and `executeRevert` lack comprehensive protection against symlink attacks. A malicious skill or compromised home directory could potentially cause the engine to overwrite or delete sensitive system files if symlinks are used to point target paths outside intended skill directories.
- **Ownership Proof Bypass**: The `isOwnedByInceptionEngine` check for symlinks relies on the presence of `SKILL.md` in the destination. This could be spoofed by an attacker to trick the engine into "reverting" (deleting) a legitimate directory.
- **Insecure File Permissions**: The current engine does not explicitly set or verify file permissions on deployed skills, potentially leaving sensitive configuration files readable by other users on the system.

### Interoperability
- **Variable Syntax Mapping**: The engine must handle the transition between `${VAR}` (Standard/Claude) and `{env:VAR}` (OpenCode) to ensure environment variables function across all agents.
- **Cross-Platform Symlink Proofs**: The current `.inception-totem` logic works for directories but needs a file-level equivalent (e.g., hidden sidecar files or metadata store) for single-file customizations like `CLAUDE.md`.
- **Enterprise Registry Blocking**: GitHub Copilot may ignore local MCP configs if organization policies are active; the tool should detect and warn about these overrides.
- **XDG Base Directory Support**: On Linux/POSIX, the engine should respect `XDG_CONFIG_HOME` and other XDG variables instead of defaulting to `{home}/.config`.
- **Shell-Specific Escaping**: `isBinaryViaCommandV` uses a POSIX-style shell call that may behave differently on non-standard shells (e.g., Fish, Zsh) if environment variables are not correctly isolated.

### Performance
- **Synchronous I/O in Resolver**: `resolve.ts` uses synchronous `execFileSync` and `readFileSync` for home directory lookup, which can block the event loop in high-throughput or constrained environments.
- **Parallel Deployment Execution**: `executeDeploy` and `executeRevert` process skill actions sequentially. Performance could be significantly improved by parallelizing file system operations (e.g., via `Promise.all`).
- **Redundant I/O calls**: `executeRevert` and `executeDeploy` perform multiple `access`/`lstat` calls on the same paths. These could be cached or consolidated to reduce syscall overhead.

### Node.js practices and dependecies
- TBD