import type { Stats } from "node:fs";
import { access, chmod, readFile, readlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId } from "../types.ts";

const TOTEM_FILE = ".inception-totem";
const TOTEM_HEADER = "inception-engine";

export interface TotemData {
  source: string;
  skill: string;
  agent: AgentId;
}

export function formatTotem(data: TotemData): string {
  const lines = [
    TOTEM_HEADER,
    `source=${data.source}`,
    `skill=${data.skill}`,
    `agent=${data.agent}`,
    `deployed=${new Date().toISOString()}`,
  ];
  return `${lines.join("\n")}\n`;
}

export async function writeTotem(
  directory: string,
  data: TotemData,
): Promise<void> {
  const totemPath = path.join(directory, TOTEM_FILE);
  await writeFile(totemPath, formatTotem(data));
  await chmod(totemPath, 0o644);
}

export async function isOwnedByInceptionEngine(
  targetPath: string,
  stat: Stats,
): Promise<boolean> {
  const totemLocation = stat.isSymbolicLink()
    ? await resolveSymlinkTotemPath(targetPath)
    : path.join(targetPath, TOTEM_FILE);

  if (!totemLocation) return false;

  try {
    const content = await readFile(totemLocation, "utf-8");
    return content.startsWith(TOTEM_HEADER);
  } catch {
    return false;
  }
}

async function resolveSymlinkTotemPath(
  targetPath: string,
): Promise<string | null> {
  try {
    const linkTarget = await readlink(targetPath);
    const resolved = path.resolve(path.dirname(targetPath), linkTarget);
    await access(resolved);
    return path.join(resolved, TOTEM_FILE);
  } catch {
    return null;
  }
}
