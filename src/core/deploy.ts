import {
  access,
  cp,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../config/agents.ts";
import { UserError } from "../errors.ts";
import { logger } from "../logger.ts";
import type {
  AgentId,
  DeployAction,
  Manifest,
  SkillDirDeployAction,
} from "../types.ts";
import { registerDeployment, verifyDeployment } from "./ownership.ts";
import { getDeployMethod, resolveAgentSkillPath } from "./resolve.ts";

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
}> {
  let succeeded = 0;
  const failed: Array<{ action: DeployAction; error: string }> = [];

  for (const action of actions) {
    switch (action.kind) {
      case "skill-dir": {
        const result = await deploySkillDir(action, dryRun, verbose, home);
        if (result.error === null) {
          succeeded++;
        } else {
          failed.push({ action, error: result.error });
        }
        break;
      }
      default: {
        const _: never = action.kind;
        throw new Error(`Unhandled deploy action kind: ${_}`);
      }
    }
  }

  return { succeeded, failed };
}

async function deploySkillDir(
  action: SkillDirDeployAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
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
    if (verbose) {
      logger.detail(`${action.method}: ${action.source} -> ${action.target}`);
    }
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
  action: DeployAction,
  home: string,
): Promise<void> {
  if (action.method === "symlink") {
    await symlink(action.source, action.target, "dir");
  } else {
    await cp(action.source, action.target, { recursive: true });
  }
  await registerDeployment(home, action.target, {
    source: action.source,
    skill: action.skill,
    agent: action.agent,
    method: action.method,
  });
}

async function executeDeployAction(
  action: DeployAction,
  verbose: boolean,
  home: string,
): Promise<void> {
  const label = `${action.skill} -> ${action.agent}`;
  const backupPath = await backupExisting(action.target, verbose, home, {
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
  expected: { source: string; skill: string; agent: AgentId },
): Promise<string | null> {
  try {
    await lstat(targetPath);
  } catch {
    return null;
  }

  if (!(await verifyDeployment(home, targetPath, expected))) {
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
