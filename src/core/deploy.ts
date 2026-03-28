import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../config/agents.ts";
import { UserError } from "../errors.ts";
import { logger } from "../logger.ts";
import type {
  AgentId,
  ConfigPatchDeployAction,
  DeployAction,
  FileWriteDeployAction,
  Manifest,
  PlannedChange,
  SkillDirDeployAction,
} from "../types.ts";
import {
  lookupDeployment,
  registerDeployment,
  verifyDeployment,
} from "./ownership.ts";
import { getDeployMethod, resolveAgentSkillPath } from "./resolve.ts";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readJsonConfig(
  filePath: string,
): Promise<Record<string, unknown>> {
  let rawContent: string;
  try {
    rawContent = await readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT")
      throw new Error(`Config file not found: ${filePath}`);
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`Config file is not valid JSON: ${filePath}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Config file is not a JSON object: ${filePath}`);
  }
  return parsed;
}

function computeUndoPatch(
  original: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const undoPatch: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    undoPatch[key] = key in original ? original[key] : null;
  }
  return undoPatch;
}

function applyMergePatch(
  original: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const patched: Record<string, unknown> = { ...original };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete patched[key];
    } else {
      patched[key] = value;
    }
  }
  return patched;
}

function sourceAccessError(err: unknown, sourcePath: string): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return `Source not found: ${sourcePath}`;
  if (code === "EACCES" || code === "EPERM")
    return `Permission denied accessing source: ${sourcePath}`;
  const detail = err instanceof Error ? err.message : String(err);
  return `Failed to access source ${sourcePath}: ${detail}`;
}

export async function planDeploy(
  manifest: Manifest,
  sourceDir: string,
  detectedAgents: AgentId[],
  home: string,
): Promise<DeployAction[]> {
  const method = getDeployMethod();
  const actions: DeployAction[] = [];
  const resolvedSourceDir = path.resolve(sourceDir);

  let realRoot: string;
  try {
    realRoot = await realpath(resolvedSourceDir);
  } catch {
    realRoot = resolvedSourceDir;
  }

  for (const skill of manifest.skills) {
    const source = path.resolve(sourceDir, skill.path);
    await validateSourcePath(source, skill.path, resolvedSourceDir, realRoot);

    await validateSkillContract(source, skill.path);

    for (const agentId of skill.agents) {
      if (!detectedAgents.includes(agentId)) continue;

      const agent = AGENT_REGISTRY_BY_ID[agentId];
      if (!agent) continue;

      const target = resolveAgentSkillPath(agent, skill.name, home);

      actions.push({
        kind: "skill-dir",
        skill: skill.name,
        agent: agentId,
        source,
        target,
        method,
      });
    }
  }

  return actions;
}

export async function executeDeploy(
  actions: DeployAction[],
  dryRun: boolean,
  verbose: boolean,
  home: string,
): Promise<{
  succeeded: number;
  failed: Array<{ action: DeployAction; error: string }>;
  planned: PlannedChange[];
}> {
  let succeeded = 0;
  const failed: Array<{ action: DeployAction; error: string }> = [];
  const planned: PlannedChange[] = [];

  for (const action of actions) {
    switch (action.kind) {
      case "skill-dir": {
        const result = await deploySkillDir(
          action,
          dryRun,
          verbose,
          home,
          planned,
        );
        if (result.error === null) {
          succeeded++;
        } else {
          failed.push({ action, error: result.error });
        }
        break;
      }
      case "file-write": {
        const result = await deployFileWrite(
          action,
          dryRun,
          verbose,
          home,
          planned,
        );
        if (result.error === null) {
          succeeded++;
        } else {
          failed.push({ action, error: result.error });
        }
        break;
      }
      case "config-patch": {
        const result = await deployConfigPatch(
          action,
          dryRun,
          verbose,
          home,
          planned,
        );
        if (result.error === null) {
          succeeded++;
        } else {
          failed.push({ action, error: result.error });
        }
        break;
      }
      default: {
        throw new Error(`Unhandled deploy action kind: ${action}`);
      }
    }
  }

  return { succeeded, failed, planned };
}

async function deploySkillDir(
  action: SkillDirDeployAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
): Promise<{ error: string | null }> {
  const label = `${action.skill} -> ${action.agent}`;

  try {
    await access(action.source);
  } catch (err) {
    const msg = sourceAccessError(err, action.source);
    logger.fail(label, msg);
    return { error: msg };
  }

  if (dryRun) {
    logger.plan(label);
    logger.detail(`${action.method}: ${action.source} -> ${action.target}`);
    planned.push({
      verb: action.method === "symlink" ? "create-symlink" : "copy-dir",
      kind: "skill-dir",
      skill: action.skill,
      agent: action.agent,
      source: action.source,
      target: action.target,
      method: action.method,
    });
    return { error: null };
  }

  try {
    await executeDeployAction(action, verbose, home);
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { error: msg };
  }
}

async function deployFileWrite(
  action: FileWriteDeployAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
): Promise<{ error: string | null }> {
  const label = `${action.skill} -> ${action.agent}`;

  try {
    await access(action.source);
  } catch (err) {
    const msg = sourceAccessError(err, action.source);
    logger.fail(label, msg);
    return { error: msg };
  }

  if (dryRun) {
    logger.plan(label);
    logger.detail(`write-file: ${action.source} -> ${action.target}`);
    planned.push({
      verb: "write-file",
      kind: "file-write",
      skill: action.skill,
      agent: action.agent,
      source: action.source,
      target: action.target,
    });
    return { error: null };
  }

  try {
    // Check if target exists — only allow overwrite if we own it
    try {
      await lstat(action.target);
      const isOwned = await verifyDeployment(home, action.target, {
        kind: "file-write",
        source: action.source,
        skill: action.skill,
        agent: action.agent,
      });
      if (!isOwned) {
        throw new Error(
          `Target "${action.target}" exists but is not managed by inception-engine — refusing to overwrite`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("refusing to overwrite"))
        throw err;
      // ENOENT — target doesn't exist, fine to create
    }

    await mkdir(path.dirname(action.target), { recursive: true });
    await copyFile(action.source, action.target);
    await registerDeployment(home, action.target, {
      kind: "file-write",
      source: action.source,
      skill: action.skill,
      agent: action.agent,
    });
    logger.ok(label);
    if (verbose) {
      logger.detail(`write-file: ${action.source} -> ${action.target}`);
    }
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { error: msg };
  }
}

async function deployConfigPatch(
  action: ConfigPatchDeployAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
): Promise<{ error: string | null }> {
  const label = `${action.skill} -> ${action.agent}`;

  if (!isPlainObject(action.patch)) {
    const msg = `Config patch for skill "${action.skill}" must be a plain object`;
    logger.fail(label, msg);
    return { error: msg };
  }

  const patch = action.patch;

  if (dryRun) {
    logger.plan(label);
    logger.detail(`patch-config: ${JSON.stringify(patch)} -> ${action.target}`);
    planned.push({
      verb: "patch-config",
      kind: "config-patch",
      skill: action.skill,
      agent: action.agent,
      target: action.target,
      patch,
    });
    return { error: null };
  }

  try {
    // Guard against double-patching by a different skill/agent
    const existingEntry = await lookupDeployment(home, action.target);
    if (
      existingEntry &&
      (existingEntry.skill !== action.skill ||
        existingEntry.agent !== action.agent)
    ) {
      throw new Error(
        `Config "${action.target}" is already patched by skill "${existingEntry.skill}" for agent "${existingEntry.agent}" — refusing to double-patch`,
      );
    }

    const original = await readJsonConfig(action.target);
    const undoPatch = computeUndoPatch(original, patch);
    const patched = applyMergePatch(original, patch);

    await writeFile(
      action.target,
      `${JSON.stringify(patched, null, 2)}\n`,
      "utf-8",
    );
    await registerDeployment(home, action.target, {
      kind: "config-patch",
      patch,
      undoPatch,
      skill: action.skill,
      agent: action.agent,
    });
    logger.ok(label);
    if (verbose) {
      logger.detail(
        `patch-config: applied ${Object.keys(patch).length} key(s) to ${action.target}`,
      );
    }
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { error: msg };
  }
}

async function validateSourcePath(
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
      realSource !== realRoot &&
      !realSource.startsWith(realRoot + path.sep)
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

async function validateSkillContract(
  source: string,
  skillPath: string,
): Promise<void> {
  let stat: import("node:fs").Stats;
  try {
    stat = await lstat(source);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new UserError(
        "DEPLOY_FAILED",
        `Skill "${skillPath}" source not found: ${source}`,
      );
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new UserError(
        "DEPLOY_FAILED",
        `Permission denied accessing skill "${skillPath}" source: ${source}`,
      );
    }
    throw new UserError(
      "DEPLOY_FAILED",
      `Cannot access skill "${skillPath}" source: ${source}`,
    );
  }
  if (!stat.isDirectory()) {
    throw new UserError(
      "DEPLOY_FAILED",
      `Skill "${skillPath}" source is not a directory: ${source}`,
    );
  }
  try {
    await access(path.join(source, "SKILL.md"));
  } catch {
    throw new UserError(
      "DEPLOY_FAILED",
      `Skill "${skillPath}" source is missing SKILL.md: ${source}`,
    );
  }
}

async function assertTargetAbsent(targetPath: string): Promise<void> {
  try {
    await lstat(targetPath);
    throw new Error(
      `Target path appeared unexpectedly after backup: ${targetPath}`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Target path appeared"))
      throw err;
    // ENOENT is expected — target should not exist after backup
  }
}

async function createDeployTarget(
  action: SkillDirDeployAction,
  home: string,
): Promise<void> {
  if (action.method === "symlink") {
    await symlink(action.source, action.target, "dir");
  } else {
    await cp(action.source, action.target, { recursive: true });
  }
  await registerDeployment(home, action.target, {
    kind: action.kind,
    source: action.source,
    skill: action.skill,
    agent: action.agent,
    method: action.method,
  });
}

async function executeDeployAction(
  action: SkillDirDeployAction,
  verbose: boolean,
  home: string,
): Promise<void> {
  const label = `${action.skill} -> ${action.agent}`;
  const backupPath = await backupExisting(action.target, verbose, home, {
    kind: action.kind,
    source: action.source,
    skill: action.skill,
    agent: action.agent,
  });
  await mkdir(path.dirname(action.target), { recursive: true });

  try {
    await assertTargetAbsent(action.target);
    await createDeployTarget(action, home);
  } catch (createErr) {
    if (backupPath) {
      try {
        await removeTarget(action.target).catch(() => {
          /* best-effort cleanup */
        });
        await rename(backupPath, action.target);
      } catch {
        // Best-effort rollback
      }
    }
    throw createErr;
  }

  if (backupPath) {
    await removeTarget(backupPath);
  }

  logger.ok(label);
  if (verbose) {
    logger.detail(`${action.method}: ${action.source} -> ${action.target}`);
  }
}

async function backupExisting(
  targetPath: string,
  verbose: boolean,
  home: string,
  expected: { kind: string; source: string; skill: string; agent: AgentId },
): Promise<string | null> {
  try {
    await lstat(targetPath);
  } catch {
    return null;
  }

  if (
    !(await verifyDeployment(home, targetPath, {
      kind: "skill-dir",
      source: expected.source,
      skill: expected.skill,
      agent: expected.agent,
    }))
  ) {
    throw new Error(
      `Target "${targetPath}" exists but is not managed by inception-engine — refusing to overwrite`,
    );
  }

  const backupPath = `${targetPath}.inception-backup`;

  // Clean up any stale backup from a previous failed attempt
  try {
    await lstat(backupPath);
    await removeTarget(backupPath);
  } catch {
    // No stale backup — expected
  }

  if (verbose) {
    logger.detail(`backing up existing target: ${targetPath}`);
  }

  await rename(targetPath, backupPath);
  return backupPath;
}

async function removeTarget(targetPath: string): Promise<void> {
  const stat = await lstat(targetPath);
  if (stat.isSymbolicLink()) {
    await unlink(targetPath);
  } else {
    await rm(targetPath, { recursive: true });
  }
}
