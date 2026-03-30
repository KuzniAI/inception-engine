import { access, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { dryRunPrefix, logger } from "../logger.ts";
import { AGENT_IDS } from "../schemas/manifest.ts";
import type { AgentId, SkillEntry } from "../schemas/manifest.ts";

const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

async function findSkillDirs(
  baseDir: string,
  dir: string,
  found: Array<{ relPath: string; name: string }>,
): Promise<void> {
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return;
  }

  const hasSkillMd = entries.some((e) => e.isFile() && e.name === "SKILL.md");
  if (hasSkillMd) {
    const relPath = path.relative(baseDir, dir).split(path.sep).join("/");
    const name = path.basename(dir);
    if (SAFE_NAME_RE.test(name)) {
      found.push({ relPath, name });
    } else {
      logger.warn(
        "init",
        `Skipping "${relPath}": directory name "${name}" is not a valid skill name`,
      );
    }
    // Don't recurse into a skill directory
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      await findSkillDirs(baseDir, path.join(dir, entry.name), found);
    }
  }
}

function resolveSkillName(
  relPath: string,
  name: string,
  namesSeen: Set<string>,
): string | null {
  if (!namesSeen.has(name)) return name;
  // Collision: derive unique name from path by replacing separators with hyphens
  const derived = relPath.replace(/\//g, "-");
  if (SAFE_NAME_RE.test(derived)) return derived;
  logger.warn(
    "init",
    `Skipping "${relPath}": could not generate a unique valid name (collision with "${name}")`,
  );
  return null;
}

function buildSkills(
  found: Array<{ relPath: string; name: string }>,
  agents: AgentId[],
): SkillEntry[] {
  const namesSeen = new Set<string>();
  const skills: SkillEntry[] = [];
  for (const { relPath, name } of found) {
    const skillName = resolveSkillName(relPath, name, namesSeen);
    if (skillName === null) continue;
    namesSeen.add(skillName);
    skills.push({ name: skillName, path: relPath, agents });
  }
  return skills;
}

async function manifestExists(manifestPath: string): Promise<boolean> {
  try {
    await access(manifestPath);
    return true;
  } catch {
    return false;
  }
}

export interface InitOptions {
  directory: string;
  agents: AgentId[] | null;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
}

export async function runInit(options: InitOptions): Promise<number> {
  const { directory, dryRun, force, verbose } = options;
  const agents: AgentId[] = options.agents ?? ([...AGENT_IDS] as AgentId[]);

  const manifestPath = path.join(directory, "inception.json");

  if (!dryRun && (await manifestExists(manifestPath)) && !force) {
    logger.error(
      `Error: ${manifestPath} already exists. Use --force to overwrite.`,
    );
    return 2;
  }

  const found: Array<{ relPath: string; name: string }> = [];
  await findSkillDirs(directory, directory, found);

  if (found.length === 0) {
    logger.info(
      "No skill directories found (looking for directories containing SKILL.md).",
    );
    return 0;
  }

  const skills = buildSkills(found, agents);

  if (skills.length === 0) {
    logger.info("No skills could be added to the manifest.");
    return 0;
  }

  const manifest = { skills, mcpServers: [], agentRules: [] };
  const json = `${JSON.stringify(manifest, null, 2)}\n`;

  if (dryRun) {
    logger.info(
      `${dryRunPrefix(true)}Would write ${manifestPath} with ${skills.length} skill(s):`,
    );
    logger.info("");
    logger.info(json);
    return 0;
  }

  await writeFile(manifestPath, json, "utf-8");

  logger.info(`Generated ${manifestPath} with ${skills.length} skill(s).`);
  if (verbose) {
    for (const s of skills) {
      logger.detail(`${s.name}  →  ${s.path}`);
    }
  }
  return 0;
}
