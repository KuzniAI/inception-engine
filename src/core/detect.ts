import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { AGENT_REGISTRY } from "../config/agents.ts";
import { resolveAgentDetectPath } from "./resolve.ts";
import type { AgentId, AgentConfig } from "../types.ts";

export function detectInstalledAgents(home: string): AgentId[] {
  const detected: AgentId[] = [];

  for (const agent of AGENT_REGISTRY) {
    if (isAgentInstalled(agent, home)) {
      detected.push(agent.id);
    }
  }

  return detected;
}

function isAgentInstalled(agent: AgentConfig, home: string): boolean {
  const detectPath = resolveAgentDetectPath(agent, home);
  if (existsSync(detectPath)) {
    return true;
  }

  if (agent.detectBinary) {
    return isBinaryInPath(agent.detectBinary);
  }

  return false;
}

function isBinaryInPath(binary: string): boolean {
  const command = process.platform === "win32" ? "where.exe" : "which";
  try {
    execFileSync(command, [binary], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
