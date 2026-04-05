import path from "node:path";
import type { AgentDefinitionEntry } from "../../schemas/manifest.ts";
import type {
  AgentId,
  FileWriteDeployAction,
  FileWriteRevertAction,
  PlanWarning,
} from "../../types.ts";
import {
  planCapabilityForDeploy,
  resolveCapabilitySurface,
} from "../capabilities.ts";
import { getPlatformKey, resolvePlaceholders } from "../resolve.ts";
import {
  validateAgentRuleMarkdownPath,
  validateInstructionFileRequirements,
  validateSourceFile,
  validateSourcePath,
} from "../validation.ts";

export interface AgentDefinitionsAdapterResult {
  actions: FileWriteDeployAction[];
  warnings: PlanWarning[];
}

/**
 * Compiles deploy actions for agentDefinitions manifest entries.
 *
 * Agent definition files are Markdown files (typically with YAML frontmatter)
 * that define custom agents or subagents for a given platform. Unlike
 * agentRules (which target a single shared global file per agent), each
 * definition entry produces a separate file named after the entry in the
 * agent's dedicated agent-definitions directory (repo-local).
 *
 * Target paths use the `{repo}` placeholder so definitions land in the
 * repository being deployed, not the user's home directory.
 */
export async function compileAgentDefinitionActions(
  entry: AgentDefinitionEntry,
  sourceDir: string,
  resolvedSourceDir: string,
  realRoot: string,
  detectedAgents: AgentId[],
  home: string,
  repo?: string,
  workspace?: string,
): Promise<AgentDefinitionsAdapterResult> {
  const actions: FileWriteDeployAction[] = [];
  const warnings: PlanWarning[] = [];
  const platform = getPlatformKey();
  const targetAgents = entry.agents.filter((agentId) =>
    detectedAgents.includes(agentId),
  );
  const supportedTargets: Array<{
    agentId: AgentId;
    confidence: FileWriteDeployAction["confidence"];
    target: string;
  }> = [];

  if (targetAgents.length === 0) {
    return { actions, warnings };
  }

  for (const agentId of targetAgents) {
    const plan = planCapabilityForDeploy({
      agentId,
      capability: "agentDefinitions",
      entryName: entry.name,
      targetAgentIds: targetAgents,
    });
    if (plan.outcome === "warn") {
      warnings.push(plan.warning);
      continue;
    }
    if (plan.outcome === "native" || plan.outcome === "redundant") continue;

    const support = resolveCapabilitySurface(
      agentId,
      "agentDefinitions",
    ).support;
    if (!support) continue;

    supportedTargets.push({
      agentId,
      confidence: plan.confidence ?? "provisional",
      target: resolvePlaceholders(
        support.path[platform],
        entry.name,
        home,
        repo,
        workspace,
      ),
    });
  }

  if (supportedTargets.length === 0) {
    return { actions, warnings };
  }

  // Validate the shared source file only when at least one target is active.
  const source = path.resolve(sourceDir, entry.path);
  await validateSourcePath(source, entry.path, resolvedSourceDir, realRoot);
  await validateSourceFile(source, entry.path);

  for (const target of supportedTargets) {
    validateAgentRuleMarkdownPath(entry.path, target.agentId);
    await validateInstructionFileRequirements(
      source,
      entry.path,
      target.agentId,
    );
    actions.push({
      kind: "file-write",
      skill: entry.name,
      agent: target.agentId,
      source,
      target: target.target,
      confidence: target.confidence,
    });
  }

  return { actions, warnings };
}

export function compileAgentDefinitionReverts(
  entry: AgentDefinitionEntry,
  agentFilter: AgentId[] | null,
  home: string,
  repo?: string,
  workspace?: string,
): FileWriteRevertAction[] {
  const actions: FileWriteRevertAction[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (agentFilter && !agentFilter.includes(agentId)) continue;
    const support = resolveCapabilitySurface(
      agentId,
      "agentDefinitions",
    ).support;
    if (!support) continue;
    const target = resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
      repo,
      workspace,
    );
    actions.push({
      kind: "file-write",
      skill: entry.name,
      agent: agentId,
      target,
    });
  }
  return actions;
}
