import { access, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dryRunPrefix, logger } from "../logger.ts";
import type {
  AgentId,
  AgentRuleEntry,
  SkillEntry,
} from "../schemas/manifest.ts";
import { AGENT_IDS } from "../schemas/manifest.ts";

const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

// Ordered list: first match wins. Catch-all is applied at call site.
const AGENT_RULES_FILE_PATTERNS: Array<{
  fileNames: string[];
  agents: AgentId[];
}> = [
  {
    fileNames: ["claude.md", "claude-instructions.md"],
    agents: ["claude-code"],
  },
  {
    fileNames: ["agents.md", "agents-instructions.md"],
    agents: ["codex", "opencode"],
  },
  {
    fileNames: ["gemini.md", "gemini-instructions.md"],
    agents: ["gemini-cli", "antigravity"],
  },
  { fileNames: ["copilot-instructions.md"], agents: ["github-copilot"] },
];

// Conventional subdirectory names to scan one level deep for .md files.
const AGENT_RULES_SUBDIRS = [
  "rules",
  "instructions",
  ".github",
  ".agents/rules",
];

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

function defaultAgentsForFile(
  fileName: string,
  fallback: AgentId[],
): AgentId[] {
  const lower = fileName.toLowerCase();
  for (const { fileNames, agents } of AGENT_RULES_FILE_PATTERNS) {
    if (fileNames.includes(lower)) return agents;
  }
  return fallback;
}

function isInsideSkillDir(
  relPath: string,
  skillDirRelPaths: Set<string>,
): boolean {
  const parentRelPath = path.dirname(relPath).split(path.sep).join("/");
  if (skillDirRelPaths.has(parentRelPath)) return true;
  return [...skillDirRelPaths].some(
    (sp) => parentRelPath === sp || parentRelPath.startsWith(`${sp}/`),
  );
}

function deriveAgentRulesName(
  relPath: string,
  fileName: string,
): string | null {
  const ext = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, ext);
  const rawName = baseName.toLowerCase().replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!SAFE_NAME_RE.test(rawName)) {
    logger.warn(
      "init",
      `Skipping "${relPath}": could not derive a valid agentRules name`,
    );
    return null;
  }
  return rawName;
}

async function scanDirForMarkdown(
  dir: string,
  baseDir: string,
  skillDirRelPaths: Set<string>,
  seen: Set<string>,
  candidates: Array<{
    relPath: string;
    name: string;
    defaultAgents: AgentId[];
  }>,
): Promise<void> {
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== ".md" && ext !== ".markdown") continue;
    const absPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, absPath).split(path.sep).join("/");
    if (seen.has(relPath) || isInsideSkillDir(relPath, skillDirRelPaths))
      continue;
    const name = deriveAgentRulesName(relPath, entry.name);
    if (name === null) continue;
    seen.add(relPath);
    candidates.push({ relPath, name, defaultAgents: [] });
  }
}

async function findAgentRulesCandidates(
  baseDir: string,
  skillDirRelPaths: Set<string>,
): Promise<Array<{ relPath: string; name: string; defaultAgents: AgentId[] }>> {
  const candidates: Array<{
    relPath: string;
    name: string;
    defaultAgents: AgentId[];
  }> = [];
  const seen = new Set<string>();

  await scanDirForMarkdown(
    baseDir,
    baseDir,
    skillDirRelPaths,
    seen,
    candidates,
  );
  for (const subdir of AGENT_RULES_SUBDIRS) {
    await scanDirForMarkdown(
      path.join(baseDir, subdir),
      baseDir,
      skillDirRelPaths,
      seen,
      candidates,
    );
  }

  return candidates;
}

function buildAgentRules(
  candidates: Array<{
    relPath: string;
    name: string;
    defaultAgents: AgentId[];
  }>,
  activeAgents: AgentId[],
  skillNamesSeen: Set<string>,
): AgentRuleEntry[] {
  const rules: AgentRuleEntry[] = [];
  const namesSeen = new Set<string>(skillNamesSeen);

  for (const { relPath, name: rawName } of candidates) {
    const fileName = path.basename(relPath);
    const defaultAgents = defaultAgentsForFile(fileName, activeAgents);

    // Intersect with active agents; fall back to full active list if empty
    const intersection = defaultAgents.filter((a) => activeAgents.includes(a));
    const agents = intersection.length > 0 ? intersection : activeAgents;

    // Resolve name collision with skill names
    let name = rawName;
    if (namesSeen.has(name)) {
      const candidate = `${name}-rules`;
      if (SAFE_NAME_RE.test(candidate)) {
        logger.warn(
          "init",
          `agentRules name "${name}" collides with a skill name; using "${candidate}"`,
        );
        name = candidate;
      } else {
        logger.warn(
          "init",
          `Skipping "${relPath}": name "${name}" collides with a skill name and fallback is invalid`,
        );
        continue;
      }
    }

    namesSeen.add(name);
    rules.push({ name, path: relPath, agents });
  }

  return rules;
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
  }

  const skills = buildSkills(found, agents);
  const skillNamesSeen = new Set(skills.map((s) => s.name));
  const skillDirRelPaths = new Set(found.map((f) => f.relPath));

  const agentRulesCandidates = await findAgentRulesCandidates(
    directory,
    skillDirRelPaths,
  );
  const agentRules = buildAgentRules(
    agentRulesCandidates,
    agents,
    skillNamesSeen,
  );

  const manifest = {
    skills,
    files: [],
    configs: [],
    mcpServers: [],
    agentRules,
  };
  const json = `${JSON.stringify(manifest, null, 2)}\n`;

  if (dryRun) {
    logger.info(
      `${dryRunPrefix(true)}Would write ${manifestPath} with ${skills.length} skill(s) and ${agentRules.length} agentRule(s):`,
    );
    logger.info("");
    logger.info(json);
    return 0;
  }

  await writeFile(manifestPath, json, "utf-8");

  logger.info(
    `Generated ${manifestPath} with ${skills.length} skill(s) and ${agentRules.length} agentRule(s).`,
  );
  if (verbose) {
    for (const s of skills) {
      logger.detail(`${s.name}  →  ${s.path}`);
    }
    if (agentRules.length > 0) {
      logger.detail("agentRules:");
      for (const r of agentRules) {
        logger.detail(`  ${r.name}  →  ${r.path}  [${r.agents.join(", ")}]`);
      }
    }
  }
  return 0;
}
