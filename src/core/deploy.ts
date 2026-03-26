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
import type { AgentId, DeployAction, Manifest } from "../types.ts";
import { registerDeployment, verifyDeployment } from "./ownership.ts";
import { getDeployMethod, resolveAgentSkillPath } from "./resolve.ts";

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

    for (const agentId of skill.agents) {
      if (!detectedAgents.includes(agentId)) continue;

      const agent = AGENT_REGISTRY_BY_ID[agentId];
      if (!agent) continue;

      const target = resolveAgentSkillPath(agent, skill.name, home);

      actions.push({
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
    const label = `${action.skill} -> ${action.agent}`;

    try {
      await access(action.source);
    } catch {
      const msg = `Source not found: ${action.source}`;
      failed.push({ action, error: msg });
      logger.fail(label, msg);
      continue;
    }

    if (dryRun) {
      logger.plan(label);
      if (verbose) {
        logger.detail(`${action.method}: ${action.source} -> ${action.target}`);
      }
      succeeded++;
      continue;
    }

    try {
      await executeDeployAction(action, verbose, home);
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ action, error: msg });
      logger.fail(label, msg);
    }
  }

  return { succeeded, failed };
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
