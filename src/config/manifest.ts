import { readFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_IDS } from "../types.ts";
import type { AgentId, Manifest, SkillEntry } from "../types.ts";
import { UserError } from "../errors.ts";

export async function loadManifest(directory: string): Promise<Manifest> {
  const manifestPath = path.join(directory, "inception.json");

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch {
    throw new UserError(
      "MANIFEST_INVALID",
      `No inception.json found in ${directory}. Are you pointing to the right repo?`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UserError("MANIFEST_INVALID", `Invalid JSON in ${manifestPath}`);
  }

  return validateManifest(parsed, manifestPath);
}

function validateManifest(data: unknown, filePath: string): Manifest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new UserError(
      "MANIFEST_INVALID",
      `${filePath}: manifest must be a JSON object`,
    );
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.skills)) {
    throw new UserError(
      "MANIFEST_INVALID",
      `${filePath}: "skills" must be an array`,
    );
  }

  const skills: SkillEntry[] = obj.skills.map((entry: unknown, i: number) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new UserError(
        "MANIFEST_INVALID",
        `${filePath}: skills[${i}] must be an object`,
      );
    }

    const skill = entry as Record<string, unknown>;

    if (typeof skill.name !== "string" || skill.name.length === 0) {
      throw new UserError(
        "MANIFEST_INVALID",
        `${filePath}: skills[${i}].name must be a non-empty string`,
      );
    }

    const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
    if (!SAFE_NAME_RE.test(skill.name as string)) {
      throw new UserError(
        "MANIFEST_INVALID",
        `${filePath}: skills[${i}].name must contain only letters, digits, hyphens, underscores, and dots, and must not start with a dot`,
      );
    }

    if (typeof skill.path !== "string" || skill.path.length === 0) {
      throw new UserError(
        "MANIFEST_INVALID",
        `${filePath}: skills[${i}].path must be a non-empty string`,
      );
    }

    if (path.isAbsolute(skill.path as string)) {
      throw new UserError(
        "MANIFEST_INVALID",
        `${filePath}: skills[${i}].path must be a relative path`,
      );
    }

    if (path.normalize(skill.path as string).startsWith("..")) {
      throw new UserError(
        "MANIFEST_INVALID",
        `${filePath}: skills[${i}].path must not escape the repository root`,
      );
    }

    if (!Array.isArray(skill.agents) || skill.agents.length === 0) {
      throw new UserError(
        "MANIFEST_INVALID",
        `${filePath}: skills[${i}].agents must be a non-empty array`,
      );
    }

    for (const agent of skill.agents) {
      if (!AGENT_IDS.includes(agent as AgentId)) {
        throw new UserError(
          "MANIFEST_INVALID",
          `${filePath}: skills[${i}].agents contains unknown agent "${agent}". Valid agents: ${AGENT_IDS.join(", ")}`,
        );
      }
    }

    return {
      name: skill.name,
      path: skill.path,
      agents: skill.agents as AgentId[],
    };
  });

  return {
    skills,
    mcpServers: Array.isArray(obj.mcpServers) ? obj.mcpServers : [],
    agentRules: Array.isArray(obj.agentRules) ? obj.agentRules : [],
  };
}
