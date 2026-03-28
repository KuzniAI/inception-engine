import type { AgentId } from "./schemas/manifest.ts";

export type { AgentId, Manifest, SkillEntry } from "./schemas/manifest.ts";

export interface AgentPaths {
  posix: string[];
  windows: string[];
}

export type Confidence = "documented" | "implementation-only" | "provisional";

export interface AgentProvenance {
  skills: Confidence;
  detectPaths: Confidence;
  detectBinary: Confidence;
}

export interface AgentConfig {
  id: AgentId;
  displayName: string;
  skills: AgentPaths;
  detectPaths: AgentPaths;
  detectBinary: string | null;
  provenance: AgentProvenance;
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
}

export interface ConfigPatchDeployAction {
  kind: "config-patch";
  skill: string;
  agent: AgentId;
  target: string;
  patch: unknown;
  confidence?: Confidence;
}

export type DeployAction =
  | SkillDirDeployAction
  | FileWriteDeployAction
  | ConfigPatchDeployAction;

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

export type RevertAction =
  | SkillDirRevertAction
  | FileWriteRevertAction
  | ConfigPatchRevertAction;

export type PlannedChangeVerb =
  | "create-symlink"
  | "copy-dir"
  | "write-file"
  | "patch-config"
  | "remove"
  | "unapply-patch";

export interface PlannedChange {
  verb: PlannedChangeVerb;
  kind: "skill-dir" | "file-write" | "config-patch";
  skill: string;
  agent: AgentId;
  source?: string;
  target: string;
  method?: "symlink" | "copy";
  patch?: Record<string, unknown>;
  confidence?: Confidence;
}

export interface CliOptions {
  command: "deploy" | "revert" | "help";
  directory: string;
  dryRun: boolean;
  agents: AgentId[] | null;
  verbose: boolean;
  debug: boolean;
}
