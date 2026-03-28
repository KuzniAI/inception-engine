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

export interface SkillDirDeployAction {
  kind: "skill-dir";
  skill: string;
  agent: AgentId;
  source: string;
  target: string;
  method: "symlink" | "copy";
}

// Union-ready: add new action kinds here as the engine expands
export type DeployAction = SkillDirDeployAction;

export interface SkillDirRevertAction {
  kind: "skill-dir";
  skill: string;
  agent: AgentId;
  target: string;
}

// Union-ready: add new action kinds here as the engine expands
export type RevertAction = SkillDirRevertAction;

export interface CliOptions {
  command: "deploy" | "revert" | "help";
  directory: string;
  dryRun: boolean;
  agents: AgentId[] | null;
  verbose: boolean;
  debug: boolean;
}
