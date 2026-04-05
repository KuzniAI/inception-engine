import type { AgentId } from "./schemas/manifest.ts";

export type {
  AgentDefinitionEntry,
  AgentId,
  ConfigEntry,
  FileEntry,
  Manifest,
  SkillEntry,
} from "./schemas/manifest.ts";

export interface AgentPaths {
  posix: string[];
  windows: string[];
}

export type Confidence = "documented" | "implementation-only" | "provisional";

export type CapabilityKind =
  | "skills"
  | "mcpServers"
  | "agentRules"
  | "permissions"
  | "agentDefinitions";

export interface SupportedAgentSurface {
  status: "supported";
  /**
   * Declares how this agent relates to the surface:
   * - "agent-specific" (default when absent): the agent owns this surface
   *   independently and deploy emits a normal action.
   * - "native": the agent reads this surface autonomously without any deploy
   *   action from inception-engine; no action is emitted.
   * - "shared-via": this agent rides another agent's deployment. When the
   *   primary agent (`via`) is also in the target list, deploy skips this
   *   agent's action (the primary writes the shared file). When the primary
   *   is absent, a guidance warning is emitted instead.
   */
  surfaceKind?:
    | { kind: "agent-specific" }
    | { kind: "native" }
    | {
        kind: "shared-via";
        via: AgentId;
        /**
         * When true, this agent cannot deploy to the surface independently —
         * the primary agent (`via`) must also be in the target list. If the
         * primary is absent, a guidance warning is emitted and no action is
         * generated. When false or absent, the agent can deploy to the surface
         * on its own if the primary is not present.
         */
        requiresPrimary?: boolean;
      };
  path: AgentPaths;
  schemaLabel: string;
  // Override the top-level key used when patching a JSON config file.
  // Defaults to "mcpServers" when absent. Allows agents like OpenCode that
  // store MCP servers under a different key (e.g. "mcp") to reuse the
  // existing JSON merge-patch adapter without a new action kind.
  mcpPatchKey?: string;
}

export interface UnsupportedAgentSurface {
  status: "unsupported";
  schemaLabel: string;
  reason: string;
}

/**
 * A surface that is confirmed as Copilot-specific and genuinely justified for
 * future dedicated implementation, but not yet supported. Distinct from
 * "unsupported" (which means the surface is either covered by another target or
 * will never be added) so adapters can emit a forward-looking "planned" notice
 * rather than a blocking skip warning.
 */
export interface PlannedAgentSurface {
  status: "planned";
  schemaLabel: string;
  /** Short description of the concrete file / config surface to be implemented. */
  plannedSurface: string;
  reason: string;
}

export type AgentSurfaceSupport =
  | SupportedAgentSurface
  | UnsupportedAgentSurface
  | PlannedAgentSurface;

export interface AgentProvenance {
  /** Omit when the agent has no separate skill deployment path. */
  skills?: Confidence;
  detectPaths: Confidence;
  detectBinary: Confidence;
  mcpConfig?: Confidence;
  agentRules?: Confidence;
  permissions?: Confidence;
  agentDefinitions?: Confidence;
}

export interface AgentConfig {
  id: AgentId;
  displayName: string;
  /**
   * The on-disk path template for deploying skills to this agent.
   * Omit for agents that consume skills from another agent's path natively
   * (e.g. GitHub Copilot reads `.claude/skills/` directly).
   */
  skills?: AgentPaths;
  /**
   * When `skills` is absent, this field explains why. Currently only
   * "shared-via" is used — the agent reads skills from the `via` agent's
   * deployment path natively and needs no separate skills deploy action.
   */
  skillsSurfaceKind?: { kind: "shared-via"; via: AgentId };
  detectPaths: AgentPaths;
  detectBinary: string | null;
  provenance: AgentProvenance;
  // Agent-specific MCP surface support. Unsupported entries are carried
  // explicitly so adapter warnings can explain whether support is blocked by
  // TOML, frontmatter, repo-scoped files, or other non-JSON schemas.
  mcpSupport?: AgentSurfaceSupport;
  // Agent-specific persistent instruction/rules surface support.
  agentRulesSupport?: AgentSurfaceSupport;
  // Repo-local instruction/rules surface (scope: "repo"). When absent, the
  // adapter falls back to agentRulesSupport (covers antigravity, which is
  // already repo-local).
  agentRulesRepoSupport?: AgentSurfaceSupport;
  // Workspace-local instruction/rules surface (scope: "workspace"). When absent,
  // the adapter handles it by failing or reporting unsupported.
  agentRulesWorkspaceSupport?: AgentSurfaceSupport;
  // Agent-specific execution/safety permission and approval surface support.
  permissionsSupport?: AgentSurfaceSupport;
  // Agent-specific agent/subagent definition file surface support.
  agentDefinitionsSupport?: AgentSurfaceSupport;
  // Repo-local agent/subagent definition file surface support.
  agentDefinitionsRepoSupport?: AgentSurfaceSupport;
  // Workspace-local agent/subagent definition file surface support.
  agentDefinitionsWorkspaceSupport?: AgentSurfaceSupport;
  policyNote?: string;
  /**
   * A list of documented surfaces that are currently not safe to support directly.
   * Preflight will emit warnings for these if the agent is targeted.
   */
  unsupportedSurfaces?: AgentSurfaceSupport[];
  /**
   * When true, instruction files deployed to this agent must include valid
   * YAML frontmatter. Drives validateInstructionFileRequirements without
   * hardcoded agent-ID checks.
   */
  instructionFrontmatterRequired?: boolean;
  /**
   * When true, preflight runs enterprise-policy detection for this agent.
   */
  enterprisePolicyDetection?: boolean;
}

export interface PlanWarning {
  kind: "confidence" | "collision" | "ambiguity";
  message: string;
}

export interface SkillDirDeployAction {
  kind: "skill-dir";
  skill: string;
  agent: AgentId;
  source: string;
  target: string;
  method: "symlink" | "copy";
  confidence: Confidence;
}

export interface FileWriteDeployAction {
  kind: "file-write";
  skill: string;
  agent: AgentId;
  source: string;
  target: string;
  confidence?: Confidence;
  migratedFrom?: string[];
}

export interface ConfigPatchDeployAction {
  kind: "config-patch";
  skill: string;
  agent: AgentId;
  target: string;
  patch: unknown;
  confidence?: Confidence;
}

export interface TomlPatchDeployAction {
  kind: "toml-patch";
  skill: string;
  agent: AgentId;
  target: string;
  config: Record<string, unknown>;
  confidence?: Confidence;
}

export interface FrontmatterEmitDeployAction {
  kind: "frontmatter-emit";
  skill: string;
  agent: AgentId;
  // Absolute path to the .md file to create/update.
  target: string;
  // Key-value pairs to write into the YAML frontmatter block.
  frontmatter: Record<string, unknown>;
  confidence?: Confidence;
}

export type DeployAction =
  | SkillDirDeployAction
  | FileWriteDeployAction
  | ConfigPatchDeployAction
  | TomlPatchDeployAction
  | FrontmatterEmitDeployAction;

export interface SkillDirRevertAction {
  kind: "skill-dir";
  skill: string;
  agent: AgentId;
  target: string;
}

export interface FileWriteRevertAction {
  kind: "file-write";
  skill: string;
  agent: AgentId;
  target: string;
}

export interface ConfigPatchRevertAction {
  kind: "config-patch";
  skill: string;
  agent: AgentId;
  target: string;
}

export interface TomlPatchRevertAction {
  kind: "toml-patch";
  skill: string;
  agent: AgentId;
  target: string;
}

export interface FrontmatterEmitRevertAction {
  kind: "frontmatter-emit";
  skill: string;
  agent: AgentId;
  target: string;
}

export type RevertAction =
  | SkillDirRevertAction
  | FileWriteRevertAction
  | ConfigPatchRevertAction
  | TomlPatchRevertAction
  | FrontmatterEmitRevertAction;

export type PlannedChangeVerb =
  | "create-symlink"
  | "copy-dir"
  | "write-file"
  | "patch-config"
  | "patch-toml"
  | "emit-frontmatter"
  | "remove"
  | "unapply-patch";

export interface PlannedChange {
  verb: PlannedChangeVerb;
  kind:
    | "skill-dir"
    | "file-write"
    | "config-patch"
    | "toml-patch"
    | "frontmatter-emit";
  skill: string;
  agent: AgentId;
  source?: string;
  target: string;
  method?: "symlink" | "copy";
  patch?: Record<string, unknown>;
  frontmatter?: Record<string, unknown>;
  confidence?: Confidence;
}

export interface CliOptions {
  command: "deploy" | "revert" | "init" | "help";
  directory: string;
  dryRun: boolean;
  agents: AgentId[] | null;
  verbose: boolean;
  debug: boolean;
  force: boolean;
}
