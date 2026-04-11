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

async function compileAll<T>(
  entries: T[],
  fn: (entry: T) => Promise<AdapterResult> | AdapterResult,
): Promise<AdapterResult> {
  const results = await Promise.all(entries.map(fn));
  return {
    actions: results.flatMap((r) => r.actions),
    warnings: results.flatMap((r) => r.warnings),
  };
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

  const [mcp, rules, perms, defs] = await Promise.all([
    compileAll(mcpServers, (entry) =>
      compileMcpServerActions(entry, detectedAgents, home, repo, workspace),
    ),
    compileAll(agentRules, (entry) =>
      compileAgentRuleActions(
        entry,
        sourceDir,
        resolvedSourceDir,
        realRoot,
        detectedAgents,
        home,
        repo,
        workspace,
      ),
    ),
    compileAll(permissions, (entry) =>
      compilePermissionsActions(entry, detectedAgents, home),
    ),
    compileAll(agentDefinitions ?? [], (entry) =>
      compileAgentDefinitionActions(
        entry,
        sourceDir,
        resolvedSourceDir,
        realRoot,
        detectedAgents,
        home,
        repo,
        workspace,
      ),
    ),
  ]);

  actions.push(
    ...mcp.actions,
    ...rules.actions,
    ...perms.actions,
    ...defs.actions,
  );
  warnings.push(
    ...mcp.warnings,
    ...rules.warnings,
    ...perms.warnings,
    ...defs.warnings,
  );

  return { actions, warnings };
}
