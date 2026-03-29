import type { McpServerEntry, AgentRuleEntry } from "../../schemas/manifest.ts";
import type {
  AgentId,
  ConfigPatchDeployAction,
  FileWriteDeployAction,
  PlanWarning,
} from "../../types.ts";
import { compileMcpServerActions } from "./mcp.ts";
import { compileAgentRuleActions } from "./rules.ts";

export type AdapterAction = ConfigPatchDeployAction | FileWriteDeployAction;

export interface AdapterResult {
  actions: AdapterAction[];
  warnings: PlanWarning[];
}

export async function compileAdapterActions(
  mcpServers: McpServerEntry[],
  agentRules: AgentRuleEntry[],
  sourceDir: string,
  resolvedSourceDir: string,
  realRoot: string,
  detectedAgents: AgentId[],
  home: string,
): Promise<AdapterResult> {
  const actions: AdapterAction[] = [];
  const warnings: PlanWarning[] = [];

  for (const entry of mcpServers) {
    const r = compileMcpServerActions(entry, detectedAgents, home);
    actions.push(...r.actions);
    warnings.push(...r.warnings);
  }

  for (const entry of agentRules) {
    const r = await compileAgentRuleActions(
      entry,
      sourceDir,
      resolvedSourceDir,
      realRoot,
      detectedAgents,
      home,
    );
    actions.push(...r.actions);
    warnings.push(...r.warnings);
  }

  return { actions, warnings };
}
