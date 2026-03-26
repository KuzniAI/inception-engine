import { lstat, rm, unlink } from "node:fs/promises";
import { AGENT_REGISTRY_BY_ID } from "../config/agents.ts";
import { logger } from "../logger.ts";
import type { AgentId, Manifest, RevertAction } from "../types.ts";
import { lookupDeployment, unregisterDeployment } from "./ownership.ts";
import { resolveAgentSkillPath } from "./resolve.ts";

export function planRevert(
  manifest: Manifest,
  detectedAgents: AgentId[],
  home: string,
): RevertAction[] {
  const actions: RevertAction[] = [];

  for (const skill of manifest.skills) {
    for (const agentId of skill.agents) {
      if (!detectedAgents.includes(agentId)) continue;

      const agent = AGENT_REGISTRY_BY_ID[agentId];
      if (!agent) continue;

      const target = resolveAgentSkillPath(agent, skill.name, home);
      actions.push({ skill: skill.name, agent: agentId, target });
    }
  }

  return actions;
}

export function planRevertAll(
  manifest: Manifest,
  home: string,
): RevertAction[] {
  const actions: RevertAction[] = [];

  for (const skill of manifest.skills) {
    for (const agentId of skill.agents) {
      const agent = AGENT_REGISTRY_BY_ID[agentId];
      if (!agent) continue;

      const target = resolveAgentSkillPath(agent, skill.name, home);
      actions.push({ skill: skill.name, agent: agentId, target });
    }
  }

  return actions;
}

export async function executeRevert(
  actions: RevertAction[],
  dryRun: boolean,
  verbose: boolean,
  home: string,
): Promise<{ succeeded: number; skipped: number }> {
  let succeeded = 0;
  let skipped = 0;

  for (const action of actions) {
    const result = await executeRevertAction(action, dryRun, verbose, home);
    if (result === "skip") {
      skipped++;
    } else {
      succeeded++;
    }
  }

  return { succeeded, skipped };
}

async function executeRevertAction(
  action: RevertAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
): Promise<"ok" | "skip"> {
  const label = `${action.skill} -> ${action.agent}`;

  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(action.target);
  } catch {
    logger.skip(label, "(not found, skipping)");
    return "skip";
  }

  if (!(await lookupDeployment(home, action.target))) {
    logger.warn(
      label,
      `skipping: ${action.target} is not in the deployment registry — not managed by inception-engine`,
    );
    return "skip";
  }

  if (dryRun) {
    logger.plan(label);
    if (verbose) {
      logger.detail(`would remove: ${action.target}`);
    }
    return "ok";
  }

  try {
    if (stat.isSymbolicLink()) {
      await unlink(action.target);
    } else {
      await rm(action.target, { recursive: true });
    }
    await unregisterDeployment(home, action.target);
    logger.ok(label);
    if (verbose) {
      logger.detail(`removed: ${action.target}`);
    }
    return "ok";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return "skip";
  }
}
