import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  cpSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { AGENT_REGISTRY } from "../config/agents.ts";
import { resolveAgentSkillPath, getDeployMethod } from "./resolve.ts";
import type { AgentId, DeployAction, Manifest } from "../types.ts";

export function planDeploy(
  manifest: Manifest,
  sourceDir: string,
  detectedAgents: AgentId[],
  home: string
): DeployAction[] {
  const method = getDeployMethod();
  const actions: DeployAction[] = [];

  for (const skill of manifest.skills) {
    const source = path.resolve(sourceDir, skill.path);

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

export function executeDeploy(
  actions: DeployAction[],
  dryRun: boolean,
  verbose: boolean
): { succeeded: number; failed: Array<{ action: DeployAction; error: string }> } {
  let succeeded = 0;
  const failed: Array<{ action: DeployAction; error: string }> = [];

  for (const action of actions) {
    const label = `${action.skill} -> ${action.agent}`;

    if (!existsSync(action.source)) {
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
      removeExisting(action.target, verbose);
      mkdirSync(path.dirname(action.target), { recursive: true });

      if (action.method === "symlink") {
        symlinkSync(action.source, action.target, "dir");
      } else {
        cpSync(action.source, action.target, { recursive: true });
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

function removeExisting(targetPath: string, verbose: boolean): void {
  if (!existsSync(targetPath) && !isSymlink(targetPath)) return;

  if (isSymlink(targetPath)) {
    if (verbose) {
      console.log(`    removing existing symlink: ${targetPath}`);
    }
    unlinkSync(targetPath);
  } else {
    if (verbose) {
      console.log(`    \x1b[33m!\x1b[0m replacing existing directory: ${targetPath}`);
    }
    rmSync(targetPath, { recursive: true });
  }
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
