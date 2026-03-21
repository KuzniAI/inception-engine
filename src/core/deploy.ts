import { access, lstat, mkdir, symlink, cp, unlink, rm } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { AGENT_REGISTRY } from "../config/agents.ts";
import { resolveAgentSkillPath, getDeployMethod } from "./resolve.ts";
import { UserError } from "../errors.ts";
import type { AgentId, DeployAction, Manifest } from "../types.ts";

export function planDeploy(
  manifest: Manifest,
  sourceDir: string,
  detectedAgents: AgentId[],
  home: string
): DeployAction[] {
  const method = getDeployMethod();
  const actions: DeployAction[] = [];
  const resolvedSourceDir = path.resolve(sourceDir);

  for (const skill of manifest.skills) {
    const source = path.resolve(sourceDir, skill.path);

    if (source !== resolvedSourceDir && !source.startsWith(resolvedSourceDir + path.sep)) {
      throw new UserError(
        `Skill path "${skill.path}" resolves outside the repository root: ${source}`
      );
    }

    for (const agentId of skill.agents) {
      if (!detectedAgents.includes(agentId)) continue;

      const agent = AGENT_REGISTRY.find((a) => a.id === agentId);
      if (!agent) continue;

      const target = resolveAgentSkillPath(agent, skill.name, home);

      actions.push({ skill: skill.name, agent: agentId, source, target, method });
    }
  }

  return actions;
}

export async function executeDeploy(
  actions: DeployAction[],
  dryRun: boolean,
  verbose: boolean
): Promise<{ succeeded: number; failed: Array<{ action: DeployAction; error: string }> }> {
  let succeeded = 0;
  const failed: Array<{ action: DeployAction; error: string }> = [];

  for (const action of actions) {
    const label = `${action.skill} -> ${action.agent}`;

    try {
      await access(action.source);
    } catch {
      const msg = `Source not found: ${action.source}`;
      failed.push({ action, error: msg });
      console.error(`  \x1b[31m✗\x1b[0m ${label}: ${msg}`);
      continue;
    }

    if (dryRun) {
      console.log(`  \x1b[36m○\x1b[0m ${label}`);
      if (verbose) {
        console.log(`    ${action.method}: ${action.source} -> ${action.target}`);
      }
      succeeded++;
      continue;
    }

    try {
      await removeExisting(action.target, verbose);
      await mkdir(path.dirname(action.target), { recursive: true });

      if (action.method === "symlink") {
        await symlink(action.source, action.target, "dir");
      } else {
        await cp(action.source, action.target, { recursive: true });
      }

      console.log(`  \x1b[32m✓\x1b[0m ${label}`);
      if (verbose) {
        console.log(`    ${action.method}: ${action.source} -> ${action.target}`);
      }
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ action, error: msg });
      console.error(`  \x1b[31m✗\x1b[0m ${label}: ${msg}`);
    }
  }

  return { succeeded, failed };
}

async function removeExisting(targetPath: string, verbose: boolean): Promise<void> {
  let stat: Stats;
  try {
    stat = await lstat(targetPath);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) {
    if (verbose) {
      console.log(`    removing existing symlink: ${targetPath}`);
    }
    await unlink(targetPath);
  } else {
    if (verbose) {
      console.log(`    \x1b[33m!\x1b[0m replacing existing directory: ${targetPath}`);
    }
    await rm(targetPath, { recursive: true });
  }
}
