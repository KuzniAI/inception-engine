import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { AGENT_REGISTRY } from "../config/agents.ts";
import type { AgentConfig, AgentId } from "../types.ts";
import { resolveAgentDetectPath } from "./resolve.ts";

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

async function isAgentInstalled(
  agent: AgentConfig,
  home: string,
): Promise<boolean> {
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
  if (process.platform === "win32") {
    try {
      await execFileAsync("where.exe", [binary]);
      return true;
    } catch {
      return false;
    }
  }

  try {
    await execFileAsync("which", [binary]);
    return true;
  } catch (err: unknown) {
    // `which` itself is not installed — fall back to the POSIX shell built-in
    if (isENOENT(err)) {
      return isBinaryViaCommandV(binary);
    }
    return false;
  }
}

// Used only when `which` is absent (e.g. minimal Alpine containers).
// `command -v` is a POSIX shell built-in available wherever /bin/sh is.
async function isBinaryViaCommandV(binary: string): Promise<boolean> {
  try {
    // Pass binary as a positional arg ($1) to avoid any shell-injection risk.
    await execFileAsync("sh", ["-c", 'command -v "$1"', "--", binary]);
    return true;
  } catch {
    return false;
  }
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}
