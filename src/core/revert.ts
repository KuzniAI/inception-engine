import { existsSync, lstatSync, unlinkSync, rmSync } from "node:fs";
import { AGENT_REGISTRY } from "../config/agents.ts";
import { resolveAgentSkillPath } from "./resolve.ts";
import type { AgentId, Manifest, RevertAction } from "../types.ts";

export function planRevert(
  manifest: Manifest,
  detectedAgents: AgentId[],
  home: string
): RevertAction[] {
  const actions: RevertAction[] = [];

  for (const skill of manifest.skills) {
    for (const agentId of skill.agents) {
      if (!detectedAgents.includes(agentId)) continue;

      const agent = AGENT_REGISTRY.find((a) => a.id === agentId);
      if (!agent) continue;

      const target = resolveAgentSkillPath(agent, skill.name, home);
      actions.push({ skill: skill.name, agent: agentId, target });
    }
  }

  return actions;
}

export function executeRevert(
  actions: RevertAction[],
  dryRun: boolean,
  verbose: boolean
): { succeeded: number; skipped: number } {
  let succeeded = 0;
  let skipped = 0;

  for (const action of actions) {
    const label = `${action.skill} -> ${action.agent}`;

    if (!existsSync(action.target) && !isSymlink(action.target)) {
      console.log(`  \x1b[33m-\x1b[0m ${label} (not found, skipping)`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  \x1b[36m○\x1b[0m ${label}`);
      if (verbose) {
        console.log(`    would remove: ${action.target}`);
      }
      succeeded++;
      continue;
    }

    try {
      if (isSymlink(action.target)) {
        unlinkSync(action.target);
      } else {
        rmSync(action.target, { recursive: true });
      }
      console.log(`  \x1b[32m✓\x1b[0m ${label}`);
      if (verbose) {
        console.log(`    removed: ${action.target}`);
      }
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  \x1b[31m✗\x1b[0m ${label}: ${msg}`);
    }
  }

  return { succeeded, skipped };
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
