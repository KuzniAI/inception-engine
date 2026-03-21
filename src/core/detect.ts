import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AGENT_REGISTRY } from "../config/agents.ts";
import { resolveAgentDetectPath } from "./resolve.ts";
import type { AgentId, AgentConfig } from "../types.ts";

const execFileAsync = promisify(execFile);

export async function detectInstalledAgents(home: string): Promise<AgentId[]> {
  const detected: AgentId[] = [];

  for (const agent of AGENT_REGISTRY) {
    if (await isAgentInstalled(agent, home)) {
      detected.push(agent.id);
    }
  }

  return detected;
}

async function isAgentInstalled(agent: AgentConfig, home: string): Promise<boolean> {
  const detectPath = resolveAgentDetectPath(agent, home);
  try {
    await access(detectPath);
    return true;
  } catch {}

  if (agent.detectBinary) {
    return isBinaryInPath(agent.detectBinary);
  }

  return false;
}

async function isBinaryInPath(binary: string): Promise<boolean> {
  const command = process.platform === "win32" ? "where.exe" : "which";
  try {
    await execFileAsync(command, [binary], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
