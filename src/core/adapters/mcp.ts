import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../../config/agents.ts";
import type { McpServerEntry } from "../../schemas/manifest.ts";
import type {
  AgentId,
  ConfigPatchDeployAction,
  ConfigPatchRevertAction,
  PlanWarning,
} from "../../types.ts";
import { getPlatformKey, resolvePlaceholders } from "../resolve.ts";

export interface McpAdapterResult {
  actions: ConfigPatchDeployAction[];
  warnings: PlanWarning[];
}

export function compileMcpServerActions(
  entry: McpServerEntry,
  detectedAgents: AgentId[],
  home: string,
): McpAdapterResult {
  const actions: ConfigPatchDeployAction[] = [];
  const warnings: PlanWarning[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (!detectedAgents.includes(agentId)) continue;
    const agent = AGENT_REGISTRY_BY_ID[agentId];
    if (!agent?.mcpConfigPath) {
      warnings.push({
        kind: "confidence",
        message: `mcpServers: agent "${agentId}" does not have a documented MCP config path — skipping "${entry.name}"`,
      });
      continue;
    }

    const target = resolvePlaceholders(agent.mcpConfigPath[platform], "", home);
    // Ensure no stray empty segments collapse the path unexpectedly
    const resolvedTarget = path.resolve(target);

    actions.push({
      kind: "config-patch",
      skill: entry.name,
      agent: agentId,
      target: resolvedTarget,
      patch: { mcpServers: { [entry.name]: entry.config } },
      confidence: agent.provenance.mcpConfig ?? "provisional",
    });
  }

  return { actions, warnings };
}

export function compileMcpServerReverts(
  entry: McpServerEntry,
  agentFilter: AgentId[] | null,
  home: string,
): ConfigPatchRevertAction[] {
  const actions: ConfigPatchRevertAction[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (agentFilter && !agentFilter.includes(agentId)) continue;
    const agent = AGENT_REGISTRY_BY_ID[agentId];
    if (!agent?.mcpConfigPath) continue;
    const target = path.resolve(
      resolvePlaceholders(agent.mcpConfigPath[platform], "", home),
    );
    actions.push({
      kind: "config-patch",
      skill: entry.name,
      agent: agentId,
      target,
    });
  }
  return actions;
}
