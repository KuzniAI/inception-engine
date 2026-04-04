import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../../config/agents.ts";
import type { AgentDefinitionEntry } from "../../schemas/manifest.ts";
import type {
  AgentId,
  FileWriteDeployAction,
  FileWriteRevertAction,
  PlanWarning,
} from "../../types.ts";
import { getPlatformKey, resolvePlaceholders } from "../resolve.ts";
import {
  validateAgentRuleMarkdownPath,
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
    const agent = AGENT_REGISTRY_BY_ID[agentId];
    const support = agent?.agentDefinitionsSupport;
    if (!support || support.status === "unsupported") {
      warnings.push({
        kind: "confidence",
        message: `agentDefinitions: agent "${agentId}" uses ${support?.schemaLabel ?? "an unsupported agent-definition schema"} and ${support?.status === "unsupported" ? support.reason : "does not expose a supported agent-definitions adapter"} — skipping "${entry.name}"`,
      });
      continue;
    }
    if (support.status === "planned") {
      warnings.push({
        kind: "confidence",
        message: `agentDefinitions: agent "${agentId}" agent-definitions support is planned via ${support.plannedSurface} — skipping "${entry.name}" until that surface is implemented`,
      });
      continue;
    }

    supportedTargets.push({
      agentId,
      confidence: agent.provenance.agentDefinitions ?? "provisional",
      target: resolvePlaceholders(
        support.path[platform],
        entry.name,
        home,
        repo,
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
): FileWriteRevertAction[] {
  const actions: FileWriteRevertAction[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (agentFilter && !agentFilter.includes(agentId)) continue;
    const agent = AGENT_REGISTRY_BY_ID[agentId];
    const support = agent?.agentDefinitionsSupport;
    if (
      !support ||
      support.status === "unsupported" ||
      support.status === "planned"
    )
      continue;
    const target = resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
      repo,
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
