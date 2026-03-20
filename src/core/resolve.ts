import os from "node:os";
import path from "node:path";
import type { AgentConfig } from "../types.ts";

export function resolveHome(): string {
  if (process.platform === "win32") {
    return os.homedir();
  }

  const sudoUser = process.env["SUDO_USER"];
  if (sudoUser) {
    const base = process.platform === "darwin" ? "/Users" : "/home";
    return path.join(base, sudoUser);
  }

  return os.homedir();
}

export function getPlatformKey(): "posix" | "windows" {
  return process.platform === "win32" ? "windows" : "posix";
}

export function getDeployMethod(): "symlink" | "copy" {
  return process.platform === "win32" ? "copy" : "symlink";
}

export function resolveAgentSkillPath(
  agent: AgentConfig,
  skillName: string,
  home: string
): string {
  const platform = getPlatformKey();
  const template = agent.skills[platform];
  return resolvePlaceholders(template, skillName, home);
}

export function resolveAgentDetectPath(
  agent: AgentConfig,
  home: string
): string {
  const platform = getPlatformKey();
  const template = agent.detectPaths[platform];
  return resolvePlaceholders(template, "", home);
}

function resolvePlaceholders(
  template: string,
  skillName: string,
  home: string
): string {
  let result = template.replace("{home}", home);
  result = result.replace("{name}", skillName);

  if (result.includes("{appdata}")) {
    const appdata = process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming");
    result = result.replace("{appdata}", appdata);
  }

  return result;
}
