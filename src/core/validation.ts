import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { UserError } from "../errors.ts";
import { parseFrontmatterDocument } from "./adapters/frontmatter.ts";
import type { AgentId } from "../schemas/manifest.ts";

export function sourceAccessError(err: unknown, sourcePath: string): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return `Source not found: ${sourcePath}`;
  if (code === "EACCES" || code === "EPERM")
    return `Permission denied accessing source: ${sourcePath}`;
  const detail = err instanceof Error ? err.message : String(err);
  return `Failed to access source ${sourcePath}: ${detail}`;
}

function normalizePathForComparison(candidate: string): string {
  const normalized = path.normalize(candidate);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isSameOrDescendantPath(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePathForComparison(candidate);
  const normalizedRoot = normalizePathForComparison(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + path.sep)
  );
}

async function isSameFileSystemLocation(
  a: string,
  b: string,
): Promise<boolean> {
  const [aStat, bStat] = await Promise.all([stat(a), stat(b)]);
  return aStat.dev === bStat.dev && aStat.ino === bStat.ino;
}

async function isWithinRootByIdentity(
  candidate: string,
  root: string,
): Promise<boolean> {
  let current = candidate;
  while (true) {
    if (await isSameFileSystemLocation(current, root)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export async function validateSourcePath(
  source: string,
  skillPath: string,
  resolvedSourceDir: string,
  realRoot: string,
): Promise<void> {
  if (!source.startsWith(resolvedSourceDir + path.sep)) {
    throw new UserError(
      "DEPLOY_FAILED",
      `Skill path "${skillPath}" resolves outside the repository root: ${source}`,
    );
  }

  try {
    const realSource = await realpath(source);
    if (
      !(
        isSameOrDescendantPath(realSource, realRoot) ||
        (await isWithinRootByIdentity(realSource, realRoot))
      )
    ) {
      throw new UserError(
        "DEPLOY_FAILED",
        `Skill path "${skillPath}" resolves outside the repository root via symlink: ${source} -> ${realSource}`,
      );
    }
  } catch (err) {
    if (err instanceof UserError) throw err;
    // Source doesn't exist yet — will be caught during execute
  }
}

export async function validateSourceFile(
  sourcePath: string,
  manifestPath: string,
): Promise<void> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(sourcePath);
  } catch (err) {
    throw new UserError("DEPLOY_FAILED", sourceAccessError(err, manifestPath));
  }
  if (!stat.isFile()) {
    throw new UserError(
      "DEPLOY_FAILED",
      `Source is not a file: ${manifestPath}`,
    );
  }
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function validateNonEmptyStringField(
  value: unknown,
  field: string,
  entryName: string,
  agentId: string,
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new UserError(
      "DEPLOY_FAILED",
      `mcpServers entry "${entryName}" for agent "${agentId}" must define "${field}" as a non-empty string`,
    );
  }
}

export function validateMcpServerConfigShape(
  config: Record<string, unknown>,
  entryName: string,
  agentId: string,
): void {
  const hasCommand = Object.hasOwn(config, "command");
  const hasUrl = Object.hasOwn(config, "url");

  if (!(hasCommand || hasUrl)) {
    throw new UserError(
      "DEPLOY_FAILED",
      `mcpServers entry "${entryName}" for agent "${agentId}" must define either a non-empty "command" or "url"`,
    );
  }

  if (hasCommand) {
    validateNonEmptyStringField(config.command, "command", entryName, agentId);
  }
  if (hasUrl) {
    validateNonEmptyStringField(config.url, "url", entryName, agentId);
  }

  if (
    Object.hasOwn(config, "args") &&
    (!Array.isArray(config.args) ||
      config.args.some((arg) => typeof arg !== "string"))
  ) {
    throw new UserError(
      "DEPLOY_FAILED",
      `mcpServers entry "${entryName}" for agent "${agentId}" must define "args" as an array of strings when present`,
    );
  }

  if (Object.hasOwn(config, "env") && !isRecordOfStrings(config.env)) {
    throw new UserError(
      "DEPLOY_FAILED",
      `mcpServers entry "${entryName}" for agent "${agentId}" must define "env" as an object of string values when present`,
    );
  }
}

const CODEX_APPROVAL_POLICY_VALUES = [
  "auto",
  "manual",
  "suggest",
  "on-failure",
] as const;

function rejectUnknownKeys(
  config: Record<string, unknown>,
  allowed: string[],
  entryName: string,
  agentId: string,
): void {
  const unknownKeys = Object.keys(config).filter((k) => !allowed.includes(k));
  if (unknownKeys.length > 0) {
    throw new UserError(
      "DEPLOY_FAILED",
      `permissions entry "${entryName}" for agent "${agentId}" contains unrecognized keys: ${unknownKeys.join(", ")}. Only ${allowed.map((k) => `"${k}"`).join(", ")} is allowed.`,
    );
  }
}

function validateClaudeCodePermissions(
  config: Record<string, unknown>,
  entryName: string,
): void {
  rejectUnknownKeys(config, ["permissions"], entryName, "claude-code");
  const perms = config.permissions;
  if (perms === undefined) return;
  if (typeof perms !== "object" || perms === null || Array.isArray(perms)) {
    throw new UserError(
      "DEPLOY_FAILED",
      `permissions entry "${entryName}" for agent "claude-code" must define "permissions" as an object`,
    );
  }
  const permsObj = perms as Record<string, unknown>;
  for (const key of ["allow", "deny"] as const) {
    const val = permsObj[key];
    if (
      val !== undefined &&
      (!Array.isArray(val) || val.some((item) => typeof item !== "string"))
    ) {
      throw new UserError(
        "DEPLOY_FAILED",
        `permissions entry "${entryName}" for agent "claude-code" must define "permissions.${key}" as an array of strings when present`,
      );
    }
  }
}

function validateCodexPermissions(
  config: Record<string, unknown>,
  entryName: string,
): void {
  rejectUnknownKeys(config, ["approval_policy"], entryName, "codex");
  const policy = config.approval_policy;
  if (
    policy !== undefined &&
    !(CODEX_APPROVAL_POLICY_VALUES as readonly unknown[]).includes(policy)
  ) {
    throw new UserError(
      "DEPLOY_FAILED",
      `permissions entry "${entryName}" for agent "codex" must define "approval_policy" as one of: ${CODEX_APPROVAL_POLICY_VALUES.join(", ")}`,
    );
  }
}

export function validatePermissionsConfigShape(
  config: Record<string, unknown>,
  entryName: string,
  agentId: string,
): void {
  if (agentId === "claude-code") {
    validateClaudeCodePermissions(config, entryName);
  } else if (agentId === "codex") {
    validateCodexPermissions(config, entryName);
  }
}

export function validateAgentRuleMarkdownPath(
  manifestPath: string,
  agentId: string,
): void {
  const extension = path.extname(manifestPath).toLowerCase();
  if (extension !== ".md" && extension !== ".markdown") {
    throw new UserError(
      "DEPLOY_FAILED",
      `agentRules entry "${manifestPath}" for agent "${agentId}" must point to a Markdown source file`,
    );
  }
}

export async function validateSkillDefinitionFile(
  sourcePath: string,
  manifestPath: string,
): Promise<void> {
  await validateSourceFile(sourcePath, `${manifestPath}/SKILL.md`);

  let raw: string;
  try {
    raw = await readFile(sourcePath, "utf-8");
  } catch (err) {
    throw new UserError(
      "DEPLOY_FAILED",
      sourceAccessError(err, `${manifestPath}/SKILL.md`),
    );
  }

  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new UserError(
      "DEPLOY_FAILED",
      `Skill "${manifestPath}" SKILL.md must start with YAML frontmatter delimited by ---`,
    );
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (closingIndex === -1) {
    throw new UserError(
      "DEPLOY_FAILED",
      `Skill "${manifestPath}" SKILL.md is missing the closing --- frontmatter delimiter`,
    );
  }

  let attributes: Record<string, unknown>;
  try {
    const parsed = parseFrontmatterDocument(raw);
    attributes = parsed.attributes;
  } catch (err) {
    throw new UserError(
      "DEPLOY_FAILED",
      `Skill "${manifestPath}" SKILL.md has malformed YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validateField = (field: "name" | "description") => {
    const value = attributes[field];
    if (value === undefined || value === null) {
      throw new UserError(
        "DEPLOY_FAILED",
        `Skill "${manifestPath}" SKILL.md frontmatter must include a non-empty "${field}" field`,
      );
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new UserError(
        "DEPLOY_FAILED",
        `Skill "${manifestPath}" SKILL.md frontmatter field "${field}" must be a non-empty string`,
      );
    }
    if (value.includes("\n") || value.includes("\r")) {
      throw new UserError(
        "DEPLOY_FAILED",
        `Skill "${manifestPath}" SKILL.md frontmatter field "${field}" must be a single-line string`,
      );
    }
  };

  validateField("name");
  validateField("description");
}

/**
 * Validates that an instruction file (agentRules or agentDefinitions) meets
 * the structural requirements of the target agent.
 */
export async function validateInstructionFileRequirements(
  sourcePath: string,
  manifestPath: string,
  agentId: AgentId,
): Promise<void> {
  // Currently, github-copilot and antigravity require valid frontmatter
  // with name and description (similar to SKILL.md).
  const requiresFrontmatter =
    agentId === "github-copilot" || agentId === "antigravity";

  if (requiresFrontmatter) {
    try {
      await validateSkillDefinitionFile(sourcePath, manifestPath);
    } catch (err) {
      if (err instanceof UserError) {
        // Re-wrap to make it clear this is an instruction file validation error
        throw new UserError(
          "DEPLOY_FAILED",
          `Instruction file "${manifestPath}" for agent "${agentId}" failed validation: ${err.message}`,
        );
      }
      throw err;
    }
  }

  // Future validation for specific fields (tools, instructions, etc.) can be
  // added here per agent requirements.
}
