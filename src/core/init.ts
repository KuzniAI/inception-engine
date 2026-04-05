import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_REGISTRY } from "../config/agents.ts";
import { dryRunPrefix, logger } from "../logger.ts";
import type {
  AgentDefinitionEntry,
  AgentId,
  AgentRuleEntry,
  ConfigEntry,
  FileEntry,
  McpServerEntry,
  SkillEntry,
} from "../schemas/manifest.ts";
import {
  AGENT_IDS,
  AgentDefinitionEntrySchema,
  ConfigEntrySchema,
  FileEntrySchema,
  McpServerEntrySchema,
} from "../schemas/manifest.ts";
import { parseFrontmatterDocument } from "./adapters/frontmatter.ts";
import { shouldInitIncludeAgent } from "./capabilities.ts";

const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

// Ordered list: first match wins. Catch-all is applied at call site.
// Derived from the registry: group agents by the filename of their global
// agentRulesSupport path. Agents with requiresPrimary (e.g. github-copilot)
// are excluded because they cannot be deployed independently. The
// copilot-instructions.md convention mapping is appended explicitly since it
// is a well-known filename convention, not derivable from a path template.
const AGENT_RULES_FILE_PATTERNS: Array<{
  fileNames: string[];
  agents: AgentId[];
}> = (() => {
  const filenameToAgents = new Map<string, AgentId[]>();
  for (const agent of AGENT_REGISTRY) {
    if (!shouldInitIncludeAgent(agent.id, "agentRules", "global")) continue;
    const support = agent.agentRulesSupport;
    if (support?.status !== "supported") continue;
    const filename =
      support.path.posix[support.path.posix.length - 1]?.toLowerCase();
    if (!filename) continue;
    const list = filenameToAgents.get(filename) ?? [];
    list.push(agent.id);
    filenameToAgents.set(filename, list);
  }
  return [
    ...Array.from(filenameToAgents.entries()).map(([filename, agents]) => ({
      fileNames: [filename, filename.replace(".md", "-instructions.md")],
      agents,
    })),
    // Convention mapping: copilot-instructions.md → claude-code. Copilot reads
    // CLAUDE.md natively; this filename is a well-known convention that cannot
    // be derived from any agent path template.
    {
      fileNames: ["copilot-instructions.md"],
      agents: ["claude-code"] as AgentId[],
    },
  ];
})();

// Conventional subdirectory names to scan one level deep for .md files.
const AGENT_RULES_SUBDIRS = ["rules", "instructions", ".github"];

// Conventional subdirectories that contain agent definition files.
// Derived from the registry: for each agent with a supported agentDefinitions
// surface, extract the directory prefix from its posix path template.
// Includes the legacy ".github/agents" path for backward compatibility.
const AGENT_DEFINITION_SUBDIRS: string[] = (() => {
  const subdirs = new Set<string>();
  for (const agent of AGENT_REGISTRY) {
    const support = agent.agentDefinitionsSupport;
    if (support?.status !== "supported") continue;
    const tmpl = support.path.posix;
    const repoIdx = tmpl.indexOf("{repo}");
    const nameIdx = tmpl.findIndex((s) => s.includes("{name}"));
    if (repoIdx === -1 || nameIdx === -1 || nameIdx <= repoIdx) continue;
    const dirSegs = tmpl.slice(repoIdx + 1, nameIdx);
    if (dirSegs.length > 0) subdirs.add(dirSegs.join("/"));
  }
  subdirs.add(".github/agents");
  return Array.from(subdirs);
})();

async function hasAntigravityMcpFrontmatter(absPath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(absPath, "utf-8");
  } catch {
    return false;
  }
  const { attributes } = parseFrontmatterDocument(raw);
  return (
    Object.hasOwn(attributes, "mcp-servers") ||
    Object.hasOwn(attributes, "mcpServers")
  );
}

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
  const initAgents = agents.filter((agentId) =>
    shouldInitIncludeAgent(agentId, "skills"),
  );
  const namesSeen = new Set<string>();
  const skills: SkillEntry[] = [];
  for (const { relPath, name } of found) {
    const skillName = resolveSkillName(relPath, name, namesSeen);
    if (skillName === null) continue;
    namesSeen.add(skillName);
    skills.push({ name: skillName, path: relPath, agents: initAgents });
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

    // Skip if no capable agents remain (e.g. --agents github-copilot only)
    if (agents.length === 0) continue;

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
    rules.push({ name, path: relPath, agents, scope: "global" });
  }

  return rules;
}

/**
 * Derives the name for an agent definition entry from its file name.
 * For GitHub Copilot's legacy `{name}.agent.md` naming convention, strips the
 * `.agent` infix in addition to the `.md` extension.
 */
function deriveAgentDefinitionName(
  relPath: string,
  fileName: string,
): string | null {
  const ext = path.extname(fileName).toLowerCase();
  // Strip the extension to get the base name, then strip any trailing ".agent"
  // suffix (GitHub Copilot convention: foo.agent.md → foo).
  let baseName = path.basename(fileName, ext);
  if (baseName.endsWith(".agent")) {
    baseName = baseName.slice(0, -".agent".length);
  }
  const rawName = baseName.toLowerCase().replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!SAFE_NAME_RE.test(rawName)) {
    logger.warn(
      "init",
      `Skipping "${relPath}": could not derive a valid agentDefinitions name`,
    );
    return null;
  }
  return rawName;
}

/**
 * Maps a known agent-definition subdirectory to the agent IDs that own it.
 * Derived from the registry by matching each agent's agentDefinitionsSupport
 * path prefix. Includes legacy mapping for ".github/agents".
 * Returns null when the subdir is not recognized.
 */
function agentsForDefinitionSubdir(subdir: string): AgentId[] | null {
  if (subdir === ".github/agents") return ["github-copilot"];
  const matching: AgentId[] = [];
  for (const agent of AGENT_REGISTRY) {
    const support = agent.agentDefinitionsSupport;
    if (support?.status !== "supported") continue;
    const tmpl = support.path.posix;
    const repoIdx = tmpl.indexOf("{repo}");
    const nameIdx = tmpl.findIndex((s) => s.includes("{name}"));
    if (repoIdx === -1 || nameIdx === -1 || nameIdx <= repoIdx) continue;
    const agentSubdir = tmpl.slice(repoIdx + 1, nameIdx).join("/");
    if (agentSubdir === subdir) matching.push(agent.id);
  }
  return matching.length > 0 ? matching : null;
}

/**
 * Returns true when a file in a definition subdir contains MCP-specific
 * frontmatter and should be excluded from agentDefinitions discovery. Detects
 * this by checking whether any registered agent uses the same directory as
 * both its definition surface and its MCP surface (currently: Antigravity's
 * .agents/rules/).
 */
async function isSkippedMcpFile(
  subdir: string,
  absPath: string,
  relPath: string,
): Promise<boolean> {
  const hasMcpSurfaceHere = AGENT_REGISTRY.some((agent) => {
    const support = agent.mcpSupport;
    if (support?.status !== "supported") return false;
    const tmpl = support.path.posix;
    const repoIdx = tmpl.indexOf("{repo}");
    const nameIdx = tmpl.findIndex((s) => s.includes("{name}"));
    if (repoIdx === -1 || nameIdx === -1 || nameIdx <= repoIdx) return false;
    const prefix = tmpl.slice(repoIdx + 1, nameIdx).join("/");
    return prefix === subdir;
  });
  if (!hasMcpSurfaceHere) return false;
  const isMcp = await hasAntigravityMcpFrontmatter(absPath);
  if (isMcp) {
    logger.warn(
      "init",
      `Skipping "${relPath}" as agentDefinitions: frontmatter contains "mcp-servers" — file is an MCP surface, not an agent definition`,
    );
  }
  return isMcp;
}

async function scanDefinitionSubdir(
  subdir: string,
  baseDir: string,
  seen: Set<string>,
  skillDirRelPaths: Set<string>,
  agentRulesRelPaths: Set<string>,
  candidates: Array<{
    relPath: string;
    name: string;
    suggestedAgents: AgentId[];
  }>,
): Promise<void> {
  const suggestedAgents = agentsForDefinitionSubdir(subdir) ?? [];
  const dir = path.join(baseDir, subdir);
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
    if (
      seen.has(relPath) ||
      isInsideSkillDir(relPath, skillDirRelPaths) ||
      agentRulesRelPaths.has(relPath)
    )
      continue;
    if (await isSkippedMcpFile(subdir, absPath, relPath)) continue;
    const name = deriveAgentDefinitionName(relPath, entry.name);
    if (name === null) continue;
    seen.add(relPath);
    candidates.push({ relPath, name, suggestedAgents });
  }
}

async function findAgentDefinitionCandidates(
  baseDir: string,
  skillDirRelPaths: Set<string>,
  agentRulesRelPaths: Set<string>,
): Promise<
  Array<{ relPath: string; name: string; suggestedAgents: AgentId[] }>
> {
  const candidates: Array<{
    relPath: string;
    name: string;
    suggestedAgents: AgentId[];
  }> = [];
  const seen = new Set<string>();

  for (const subdir of AGENT_DEFINITION_SUBDIRS) {
    await scanDefinitionSubdir(
      subdir,
      baseDir,
      seen,
      skillDirRelPaths,
      agentRulesRelPaths,
      candidates,
    );
  }

  return candidates;
}

function buildAgentDefinitions(
  candidates: Array<{
    relPath: string;
    name: string;
    suggestedAgents: AgentId[];
  }>,
  activeAgents: AgentId[],
  namesSeen: Set<string>,
): AgentDefinitionEntry[] {
  const definitions: AgentDefinitionEntry[] = [];
  const localNamesSeen = new Set<string>(namesSeen);
  const definitionsCapableAgents = activeAgents.filter((id) =>
    shouldInitIncludeAgent(id, "agentDefinitions"),
  );

  for (const { relPath, name: rawName, suggestedAgents } of candidates) {
    // Use suggested agents (from the dir that was scanned), intersected with
    // active agents that support agentDefinitions. Fall back to all capable
    // agents if the intersection is empty.
    const intersection =
      suggestedAgents.length > 0
        ? suggestedAgents.filter((a) => definitionsCapableAgents.includes(a))
        : [];
    const agents =
      intersection.length > 0 ? intersection : definitionsCapableAgents;

    if (agents.length === 0) continue;

    // Resolve name collision
    let name = rawName;
    if (localNamesSeen.has(name)) {
      const candidate = `${name}-agent`;
      if (SAFE_NAME_RE.test(candidate)) {
        logger.warn(
          "init",
          `agentDefinitions name "${name}" collides with an existing name; using "${candidate}"`,
        );
        name = candidate;
      } else {
        logger.warn(
          "init",
          `Skipping "${relPath}": name "${name}" collides and fallback is invalid`,
        );
        continue;
      }
    }

    localNamesSeen.add(name);
    definitions.push({ name, path: relPath, agents });
  }

  return definitions;
}

async function loadMcpServers(baseDir: string): Promise<McpServerEntry[]> {
  const filePath = path.join(baseDir, "mcp-servers.json");
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn("init", "mcp-servers.json: invalid JSON, skipping");
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.warn("init", "mcp-servers.json: expected a JSON array, skipping");
    return [];
  }

  const results: McpServerEntry[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const result = McpServerEntrySchema.safeParse(parsed[i]);
    if (result.success) {
      results.push(result.data);
    } else {
      logger.warn("init", `mcp-servers.json: entry[${i}] invalid, skipping`);
    }
  }
  return results;
}

async function loadFilesManifest(baseDir: string): Promise<FileEntry[]> {
  const filePath = path.join(baseDir, "files-manifest.json");
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn("init", "files-manifest.json: invalid JSON, skipping");
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.warn("init", "files-manifest.json: expected a JSON array, skipping");
    return [];
  }

  const results: FileEntry[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const result = FileEntrySchema.safeParse(parsed[i]);
    if (result.success) {
      results.push(result.data);
    } else {
      logger.warn("init", `files-manifest.json: entry[${i}] invalid, skipping`);
    }
  }
  return results;
}

async function loadConfigsManifest(baseDir: string): Promise<ConfigEntry[]> {
  const filePath = path.join(baseDir, "configs-manifest.json");
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn("init", "configs-manifest.json: invalid JSON, skipping");
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.warn(
      "init",
      "configs-manifest.json: expected a JSON array, skipping",
    );
    return [];
  }

  const results: ConfigEntry[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const result = ConfigEntrySchema.safeParse(parsed[i]);
    if (result.success) {
      results.push(result.data);
    } else {
      logger.warn(
        "init",
        `configs-manifest.json: entry[${i}] invalid, skipping`,
      );
    }
  }
  return results;
}

async function loadAgentDefinitionsManifest(
  baseDir: string,
): Promise<AgentDefinitionEntry[]> {
  const filePath = path.join(baseDir, "agent-definitions-manifest.json");
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(
      "init",
      "agent-definitions-manifest.json: invalid JSON, skipping",
    );
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.warn(
      "init",
      "agent-definitions-manifest.json: expected a JSON array, skipping",
    );
    return [];
  }

  const results: AgentDefinitionEntry[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const result = AgentDefinitionEntrySchema.safeParse(parsed[i]);
    if (result.success) {
      results.push(result.data);
    } else {
      logger.warn(
        "init",
        `agent-definitions-manifest.json: entry[${i}] invalid, skipping`,
      );
    }
  }
  return results;
}

async function emitDirectoryHints(
  baseDir: string,
  filesLoaded: number,
  configsLoaded: number,
): Promise<void> {
  for (const [dir, section, loaded, sidecar] of [
    ["files", "files", filesLoaded, "files-manifest.json"],
    ["configs", "configs", configsLoaded, "configs-manifest.json"],
  ] as const) {
    try {
      await access(path.join(baseDir, dir));
      if ((loaded as number) === 0) {
        logger.info(
          `Detected ${dir}/ directory — create ${sidecar} at the repo root to have init populate ${section} entries automatically.`,
        );
      }
    } catch {
      // directory does not exist — silent
    }
  }
}

async function manifestExists(manifestPath: string): Promise<boolean> {
  try {
    await access(manifestPath);
    return true;
  } catch {
    return false;
  }
}

function logPathAgentEntries(
  label: string,
  entries: Array<{ name: string; path: string; agents: AgentId[] }>,
): void {
  if (entries.length === 0) return;
  logger.detail(`${label}:`);
  for (const e of entries) {
    logger.detail(`  ${e.name}  →  ${e.path}  [${e.agents.join(", ")}]`);
  }
}

function logVerboseManifest(
  skills: SkillEntry[],
  agentRules: AgentRuleEntry[],
  mcpServers: McpServerEntry[],
  files: FileEntry[],
  configs: ConfigEntry[],
  agentDefinitions: AgentDefinitionEntry[],
): void {
  for (const s of skills) {
    logger.detail(`${s.name}  →  ${s.path}`);
  }
  logPathAgentEntries("agentRules", agentRules);
  logPathAgentEntries("agentDefinitions", agentDefinitions);
  if (mcpServers.length > 0) {
    logger.detail("mcpServers:");
    for (const m of mcpServers) {
      logger.detail(`  ${m.name}  [${m.agents.join(", ")}]`);
    }
  }
  if (files.length > 0) {
    logger.detail("files:");
    for (const f of files) {
      logger.detail(`  ${f.name}  →  ${f.target}  [${f.agents.join(", ")}]`);
    }
  }
  if (configs.length > 0) {
    logger.detail("configs:");
    for (const c of configs) {
      logger.detail(`  ${c.name}  →  ${c.target}  [${c.agents.join(", ")}]`);
    }
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
  const agentRulesCapableAgents = agents.filter((id) =>
    shouldInitIncludeAgent(id, "agentRules", "global"),
  );

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
    agentRulesCapableAgents,
    skillNamesSeen,
  );

  const allNamesSeen = new Set([
    ...skillNamesSeen,
    ...agentRules.map((r) => r.name),
  ]);
  const agentRulesRelPaths = new Set(agentRules.map((r) => r.path));

  const agentDefinitionCandidates = await findAgentDefinitionCandidates(
    directory,
    skillDirRelPaths,
    agentRulesRelPaths,
  );
  const discoveredDefinitions = buildAgentDefinitions(
    agentDefinitionCandidates,
    agents,
    allNamesSeen,
  );

  // Sidecar file overrides take precedence over auto-discovery
  const sidecarDefinitions = await loadAgentDefinitionsManifest(directory);
  const agentDefinitions =
    sidecarDefinitions.length > 0 ? sidecarDefinitions : discoveredDefinitions;

  const mcpServers = await loadMcpServers(directory);
  const files = await loadFilesManifest(directory);
  const configs = await loadConfigsManifest(directory);

  const manifest = {
    skills,
    files,
    configs,
    mcpServers,
    agentRules,
    agentDefinitions,
  };
  const json = `${JSON.stringify(manifest, null, 2)}\n`;

  function summarize(): string {
    const parts = [
      `${skills.length} skill(s)`,
      `${agentRules.length} agentRule(s)`,
      `${agentDefinitions.length} agentDefinition(s)`,
      `${mcpServers.length} mcpServer(s)`,
      `${files.length} file(s)`,
      `${configs.length} config(s)`,
    ];
    return parts.join(", ");
  }

  if (dryRun) {
    logger.info(
      `${dryRunPrefix(true)}Would write ${manifestPath} with ${summarize()}:`,
    );
    logger.info("");
    logger.info(json);
    await emitDirectoryHints(directory, files.length, configs.length);
    return 0;
  }

  await writeFile(manifestPath, json, "utf-8");

  logger.info(`Generated ${manifestPath} with ${summarize()}.`);
  if (verbose) {
    logVerboseManifest(
      skills,
      agentRules,
      mcpServers,
      files,
      configs,
      agentDefinitions,
    );
  }
  await emitDirectoryHints(directory, files.length, configs.length);
  return 0;
}
