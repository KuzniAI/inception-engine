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

export function lookupHomeForUserWith(
  username: string,
  platform: NodeJS.Platform,
  execFileFn: typeof execFileSync,
  readFileFn: typeof readFileSync,
): string {
  // Method 1: getent passwd (Linux/POSIX — handles LDAP, NIS, local via NSS)
  if (platform !== "darwin") {
    try {
      const out = execFileFn("getent", ["passwd", username], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const home = (out as string).split(":")[5];
      if (typeof home === "string" && home.startsWith("/")) return home;
    } catch {
      // getent unavailable or user not found — try next method
    }
  }

  // Method 2: dscl (macOS directory services)
  if (platform === "darwin") {
    try {
      const out = execFileFn(
        "dscl",
        [".", "-read", `/Users/${username}`, "NFSHomeDirectory"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      const home = (out as string).replace(/^NFSHomeDirectory:\s*/, "").trim();
      if (home.startsWith("/")) return home;
    } catch {
      // dscl unavailable or user record not found — try next method
    }
  }

  // Method 3: parse /etc/passwd directly (universal POSIX fallback)
  try {
    const passwd = readFileFn("/etc/passwd", "utf8") as string;
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
    "RESOLVE_FAILED",
    `Cannot determine home directory for user "${username}". ` +
      `Tried getent, dscl, and /etc/passwd. ` +
      `Run without sudo, or set HOME to the correct path before invoking with sudo.`,
  );
}

function lookupHomeForUser(username: string): string {
  return lookupHomeForUserWith(
    username,
    process.platform,
    execFileSync,
    readFileSync,
  );
}

export function getPlatformKey(): "posix" | "windows" {
  return process.platform === "win32" ? "windows" : "posix";
}

export function getDeployMethod(): "symlink" | "copy" {
  return process.platform === "win32" ? "copy" : "symlink";
}

export function resolveAgentSkillPathFor(
  agent: AgentConfig,
  skillName: string,
  home: string,
  platform: "posix" | "windows",
): string {
  return resolvePlaceholders(agent.skills[platform], skillName, home);
}

export function resolveAgentDetectPathFor(
  agent: AgentConfig,
  home: string,
  platform: "posix" | "windows",
): string {
  return resolvePlaceholders(agent.detectPaths[platform], "", home);
}

export function resolveAgentSkillPath(
  agent: AgentConfig,
  skillName: string,
  home: string,
): string {
  return resolveAgentSkillPathFor(agent, skillName, home, getPlatformKey());
}

export function resolveAgentDetectPath(
  agent: AgentConfig,
  home: string,
): string {
  return resolveAgentDetectPathFor(agent, home, getPlatformKey());
}

function resolvePlaceholders(
  segments: string[],
  skillName: string,
  home: string,
): string {
  const appdata =
    process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming");
  const resolved = segments.map((seg) =>
    seg
      .replace("{home}", home)
      .replace("{name}", skillName)
      .replace("{appdata}", appdata),
  );
  return path.join(...resolved);
}
