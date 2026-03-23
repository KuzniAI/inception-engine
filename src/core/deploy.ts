import type { Stats } from "node:fs";
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
import { isOwnedByInceptionEngine, writeTotem } from "./ownership.ts";
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

    if (!source.startsWith(resolvedSourceDir + path.sep)) {
      throw new UserError(
        "DEPLOY_FAILED",
        `Skill path "${skill.path}" resolves outside the repository root: ${source}`,
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
          `Skill path "${skill.path}" resolves outside the repository root via symlink: ${source} -> ${realSource}`,
        );
      }
    } catch (err) {
      if (err instanceof UserError) throw err;
      // Source doesn't exist yet — will be caught during execute
    }

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
      const backupPath = await backupExisting(action.target, verbose);
      await mkdir(path.dirname(action.target), { recursive: true });

      try {
        // Final TOCTOU check: ensure nothing appeared at the target after backup
        try {
          await lstat(action.target);
          throw new Error(
            `Target path appeared unexpectedly after backup: ${action.target}`,
          );
        } catch (err) {
          if (
            err instanceof Error &&
            err.message.startsWith("Target path appeared")
          )
            throw err;
          // ENOENT is expected — target should not exist after backup
        }

        if (action.method === "symlink") {
          await symlink(action.source, action.target, "dir");
          await writeTotem(action.source, {
            source: action.source,
            skill: action.skill,
            agent: action.agent,
          });
        } else {
          await cp(action.source, action.target, { recursive: true });
          await writeTotem(action.target, {
            source: action.source,
            skill: action.skill,
            agent: action.agent,
          });
        }
      } catch (createErr) {
        // Rollback: restore backup if creation failed
        if (backupPath) {
          try {
            await rename(backupPath, action.target);
          } catch {
            // Best-effort rollback
          }
        }
        throw createErr;
      }

      // Success: remove backup
      if (backupPath) {
        await removeTarget(backupPath);
      }

      logger.ok(label);
      if (verbose) {
        logger.detail(`${action.method}: ${action.source} -> ${action.target}`);
      }
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ action, error: msg });
      logger.fail(label, msg);
    }
  }

  return { succeeded, failed };
}

async function backupExisting(
  targetPath: string,
  verbose: boolean,
): Promise<string | null> {
  let stat: Stats;
  try {
    stat = await lstat(targetPath);
  } catch {
    return null;
  }

  if (!(await isOwnedByInceptionEngine(targetPath, stat))) {
    throw new Error(
      `Target "${targetPath}" exists but is not managed by inception-engine — refusing to overwrite`,
    );
  }

  const backupPath = targetPath + ".inception-backup";

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
