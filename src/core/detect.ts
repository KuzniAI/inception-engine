import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { AGENT_REGISTRY } from "../config/agents.ts";
import type { AgentConfig, AgentId } from "../types.ts";
import { resolveAgentDetectPath } from "./resolve.ts";

const execFileAsync = promisify(execFile);

// Injectable executor for testing: receives a command and its arguments and
// must throw on non-zero exit (same contract as the promisified execFile).
export type ExecFn = (cmd: string, args: readonly string[]) => Promise<void>;

const defaultExecFn: ExecFn = async (cmd, args) => {
  await execFileAsync(cmd, args as string[]);
};

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
  } catch {
    // path does not exist — fall through to binary detection
  }

  if (agent.detectBinary) {
    return isBinaryInPath(agent.detectBinary);
  }

  return false;
}

export async function isBinaryInPath(
  binary: string,
  execFn: ExecFn = defaultExecFn,
): Promise<boolean> {
  if (process.platform === "win32") {
    return isBinaryViaWhereExe(binary, execFn);
  }

  try {
    await execFn("which", [binary]);
    return true;
  } catch (err: unknown) {
    // `which` itself is not installed — fall back to the POSIX shell built-in
    if (isENOENT(err)) {
      return isBinaryViaCommandV(binary);
    }
    return false;
  }
}

// Windows-only: use where.exe to check if a binary is in PATH.
export async function isBinaryViaWhereExe(
  binary: string,
  execFn: ExecFn = defaultExecFn,
): Promise<boolean> {
  try {
    await execFn("where.exe", [binary]);
    return true;
  } catch {
    return false;
  }
}

// Used only when `which` is absent (e.g. minimal Alpine containers).
// `command -v` is a POSIX shell built-in available wherever /bin/sh is.
export async function isBinaryViaCommandV(binary: string): Promise<boolean> {
  try {
    // Pass binary as a positional arg ($1) to avoid any shell-injection risk.
    await execFileAsync("sh", ["-c", 'command -v "$1"', "--", binary]);
    return true;
  } catch {
    return false;
  }
}

// POSIX: use `which` to check if a binary is in PATH.
export async function isBinaryViaWhich(
  binary: string,
  execFn: ExecFn = defaultExecFn,
): Promise<boolean> {
  try {
    await execFn("which", [binary]);
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
