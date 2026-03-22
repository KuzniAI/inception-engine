export type AgentId =
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "antigravity"
  | "opencode"
  | "github-copilot";

export const AGENT_IDS: readonly AgentId[] = [
  "claude-code",
  "codex",
  "gemini-cli",
  "antigravity",
  "opencode",
  "github-copilot",
] as const;

export interface SkillEntry {
  name: string;
  path: string;
  agents: AgentId[];
}

export interface Manifest {
  skills: SkillEntry[];
  mcpServers: unknown[];
  agentRules: unknown[];
}

export interface AgentPaths {
  posix: string[];
  windows: string[];
}

export interface AgentConfig {
  id: AgentId;
  displayName: string;
  skills: AgentPaths;
  detectPaths: AgentPaths;
  detectBinary: string | null;
}

export interface DeployAction {
  skill: string;
  agent: AgentId;
  source: string;
  target: string;
  method: "symlink" | "copy";
}

export interface RevertAction {
  skill: string;
  agent: AgentId;
  target: string;
}

export interface CliOptions {
  command: "deploy" | "revert" | "help";
  directory: string;
  dryRun: boolean;
  agents: AgentId[] | null;
  verbose: boolean;
  debug: boolean;
}
