import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { UserError } from "../errors.ts";
import type { AgentConfig } from "../types.ts";

export function resolveHome(): string {
  if (process.platform === "win32") {
    return os.homedir();
  }

  const sudoUser = process.env["SUDO_USER"];
  if (sudoUser) {
    return lookupHomeForUser(sudoUser);
  }

  return os.homedir();
}

function lookupHomeForUser(username: string): string {
  // Method 1: getent passwd (Linux/POSIX — handles LDAP, NIS, local via NSS)
  if (process.platform !== "darwin") {
    try {
      const out = execFileSync("getent", ["passwd", username], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const home = out.split(":")[5];
      if (typeof home === "string" && home.startsWith("/")) return home;
    } catch {
      // getent unavailable or user not found — try next method
    }
  }

  // Method 2: dscl (macOS directory services)
  if (process.platform === "darwin") {
    try {
      const out = execFileSync(
        "dscl",
        [".", "-read", `/Users/${username}`, "NFSHomeDirectory"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
      const home = out.replace(/^NFSHomeDirectory:\s*/, "").trim();
      if (home.startsWith("/")) return home;
    } catch {
      // dscl unavailable or user record not found — try next method
    }
  }

  // Method 3: parse /etc/passwd directly (universal POSIX fallback)
  try {
    const passwd = readFileSync("/etc/passwd", "utf8");
    for (const line of passwd.split("\n")) {
      const parts = line.split(":");
      if (parts[0] === username) {
        const home = parts[5];
        if (typeof home === "string" && home.startsWith("/")) return home;
      }
    }
  } catch {
    // /etc/passwd unavailable — fall through to error
  }

  throw new UserError(
    `Cannot determine home directory for user "${username}". ` +
      `Tried getent, dscl, and /etc/passwd. ` +
      `Run without sudo, or set HOME to the correct path before invoking with sudo.`
  );
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
