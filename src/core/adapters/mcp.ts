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
import { validateMcpServerConfigShape } from "../validation.ts";

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
    const support = agent?.mcpSupport;
    if (!support || support.status === "unsupported") {
      warnings.push({
        kind: "confidence",
        message: `mcpServers: agent "${agentId}" uses ${support?.schemaLabel ?? "an unsupported MCP schema"} and ${support?.reason ?? "does not expose a supported MCP adapter"} — skipping "${entry.name}"`,
      });
      continue;
    }

    validateMcpServerConfigShape(entry.config, entry.name, agentId);

    const target = resolvePlaceholders(support.path[platform], "", home);
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
    const support = agent?.mcpSupport;
    if (!support || support.status === "unsupported") continue;
    const target = path.resolve(
      resolvePlaceholders(support.path[platform], "", home),
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
