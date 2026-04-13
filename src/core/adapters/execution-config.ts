import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../../config/agents.ts";
import type { ExecutionConfigEntry } from "../../schemas/manifest.ts";
import type {
  AgentId,
  ConfigPatchDeployAction,
  ConfigPatchRevertAction,
  PlanWarning,
} from "../../types.ts";
import { getPlatformKey, resolvePlaceholders } from "../resolve.ts";

export interface ExecutionConfigAdapterResult {
  actions: ConfigPatchDeployAction[];
  warnings: PlanWarning[];
}

/**
 * Compiles deploy actions for executionConfigs manifest entries.
 *
 * Execution configuration settings (like Gemini CLI's safeMode) are patched
 * directly into the agent's primary settings file using config-patch actions.
 */
export function compileExecutionConfigActions(
  entry: ExecutionConfigEntry,
  detectedAgents: AgentId[],
  home: string,
): ExecutionConfigAdapterResult {
  const actions: ConfigPatchDeployAction[] = [];
  const warnings: PlanWarning[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (!detectedAgents.includes(agentId)) continue;

    const agent = AGENT_REGISTRY_BY_ID[agentId];
    if (
      !agent?.executionConfigSupport ||
      agent.executionConfigSupport.status !== "supported"
    ) {
      warnings.push({
        kind: "confidence",
        message: `Agent "${agentId}" does not support modeled execution configuration surfaces — skipping "${entry.name}"`,
      });
      continue;
    }

    const rawTarget = resolvePlaceholders(
      agent.executionConfigSupport.path[platform],
      entry.name,
      home,
    );
    const target = path.resolve(rawTarget);

    actions.push({
      kind: "config-patch",
      skill: entry.name,
      agent: agentId,
      target,
      patch: entry.config,
      confidence: "provisional",
    });
  }

  return { actions, warnings };
}

export function compileExecutionConfigReverts(
  entry: ExecutionConfigEntry,
  agentFilter: AgentId[] | null,
  home: string,
): ConfigPatchRevertAction[] {
  const actions: ConfigPatchRevertAction[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (agentFilter && !agentFilter.includes(agentId)) continue;

    const agent = AGENT_REGISTRY_BY_ID[agentId];
    if (
      !agent?.executionConfigSupport ||
      agent.executionConfigSupport.status !== "supported"
    ) {
      continue;
    }

    const rawTarget = resolvePlaceholders(
      agent.executionConfigSupport.path[platform],
      entry.name,
      home,
    );
    const target = path.resolve(rawTarget);

    actions.push({
      kind: "config-patch",
      skill: entry.name,
      agent: agentId,
      target,
    });
  }

  return actions;
}
