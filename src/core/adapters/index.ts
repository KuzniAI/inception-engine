import type {
  AgentDefinitionEntry,
  AgentRuleEntry,
  ExecutionConfigEntry,
  HookEntry,
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
import type { SourcePathValidator } from "../validation.ts";
import {
  compileAgentDefinitionActions,
  compileAgentDefinitionReverts,
} from "./agent-definitions.ts";
import {
  compileExecutionConfigActions,
  compileExecutionConfigReverts,
} from "./execution-config.ts";
import { compileHookActions, compileHookReverts } from "./hooks.ts";
import { compileMcpServerActions, compileMcpServerReverts } from "./mcp.ts";
import {
  compilePermissionsActions,
  compilePermissionsReverts,
} from "./permissions.ts";
import { compileAgentRuleActions, compileAgentRuleReverts } from "./rules.ts";

export {
  compileAgentDefinitionReverts,
  compileAgentRuleReverts,
  compileExecutionConfigReverts,
  compileHookReverts,
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
  validateSource: SourcePathValidator,
  detectedAgents: AgentId[],
  home: string,
  repo?: string,
  agentDefinitions?: AgentDefinitionEntry[],
  workspace?: string,
  hooks: HookEntry[] = [],
  executionConfigs: ExecutionConfigEntry[] = [],
): Promise<AdapterResult> {
  const actions: AdapterAction[] = [];
  const warnings: PlanWarning[] = [];

  const [mcp, rules, perms, defs, hookResults, execResults] = await Promise.all(
    [
      compileAll(mcpServers, (entry) =>
        compileMcpServerActions(entry, detectedAgents, home, repo, workspace),
      ),
      compileAll(agentRules, (entry) =>
        compileAgentRuleActions(
          entry,
          sourceDir,
          resolvedSourceDir,
          validateSource,
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
          validateSource,
          detectedAgents,
          home,
          repo,
          workspace,
        ),
      ),
      compileAll(hooks, (entry) =>
        compileHookActions(entry, detectedAgents, home),
      ),
      compileAll(executionConfigs, (entry) =>
        compileExecutionConfigActions(entry, detectedAgents, home),
      ),
    ],
  );

  actions.push(
    ...mcp.actions,
    ...rules.actions,
    ...perms.actions,
    ...defs.actions,
    ...hookResults.actions,
    ...execResults.actions,
  );
  warnings.push(
    ...mcp.warnings,
    ...rules.warnings,
    ...perms.warnings,
    ...defs.warnings,
    ...hookResults.warnings,
    ...execResults.warnings,
  );

  return { actions, warnings };
}
