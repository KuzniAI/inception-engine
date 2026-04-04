import type {
  AgentDefinitionEntry,
  AgentRuleEntry,
  McpServerEntry,
  PermissionsEntry,
} from "../../schemas/manifest.ts";
import type {
  AgentId,
  ConfigPatchDeployAction,
  FileWriteDeployAction,
  FrontmatterEmitDeployAction,
  PlanWarning,
  TomlPatchDeployAction,
} from "../../types.ts";
import {
  compileAgentDefinitionActions,
  compileAgentDefinitionReverts,
} from "./agent-definitions.ts";
import { compileMcpServerActions, compileMcpServerReverts } from "./mcp.ts";
import {
  compilePermissionsActions,
  compilePermissionsReverts,
} from "./permissions.ts";
import { compileAgentRuleActions, compileAgentRuleReverts } from "./rules.ts";

export {
  compileAgentDefinitionReverts,
  compileAgentRuleReverts,
  compileMcpServerReverts,
  compilePermissionsReverts,
};

export type AdapterAction =
  | ConfigPatchDeployAction
  | FileWriteDeployAction
  | TomlPatchDeployAction
  | FrontmatterEmitDeployAction;

export interface AdapterResult {
  actions: AdapterAction[];
  warnings: PlanWarning[];
}

export async function compileAdapterActions(
  mcpServers: McpServerEntry[],
  agentRules: AgentRuleEntry[],
  permissions: PermissionsEntry[],
  sourceDir: string,
  resolvedSourceDir: string,
  realRoot: string,
  detectedAgents: AgentId[],
  home: string,
  repo?: string,
  agentDefinitions?: AgentDefinitionEntry[],
  workspace?: string,
): Promise<AdapterResult> {
  const actions: AdapterAction[] = [];
  const warnings: PlanWarning[] = [];

  for (const entry of mcpServers) {
    const r = compileMcpServerActions(
      entry,
      detectedAgents,
      home,
      repo,
      workspace,
    );
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
      repo,
      workspace,
    );
    actions.push(...r.actions);
    warnings.push(...r.warnings);
  }

  for (const entry of permissions) {
    const r = compilePermissionsActions(entry, detectedAgents, home);
    actions.push(...r.actions);
    warnings.push(...r.warnings);
  }

  for (const entry of agentDefinitions ?? []) {
    const r = await compileAgentDefinitionActions(
      entry,
      sourceDir,
      resolvedSourceDir,
      realRoot,
      detectedAgents,
      home,
      repo,
      workspace,
    );
    actions.push(...r.actions);
    warnings.push(...r.warnings);
  }

  return { actions, warnings };
}
