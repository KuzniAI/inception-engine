import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../../config/agents.ts";
import type { AgentRuleEntry } from "../../schemas/manifest.ts";
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

export interface RulesAdapterResult {
  actions: FileWriteDeployAction[];
  warnings: PlanWarning[];
}

export async function compileAgentRuleActions(
  entry: AgentRuleEntry,
  sourceDir: string,
  resolvedSourceDir: string,
  realRoot: string,
  detectedAgents: AgentId[],
  home: string,
): Promise<RulesAdapterResult> {
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
    const support = agent?.agentRulesSupport;
    if (!support || support.status === "unsupported") {
      warnings.push({
        kind: "confidence",
        message: `agentRules: agent "${agentId}" uses ${support?.schemaLabel ?? "an unsupported instruction schema"} and ${support?.reason ?? "does not expose a supported rules adapter"} — skipping "${entry.name}"`,
      });
      continue;
    }

    supportedTargets.push({
      agentId,
      confidence: agent.provenance.agentRules ?? "provisional",
      target: resolvePlaceholders(support.path[platform], "", home),
    });
  }

  if (supportedTargets.length === 0) {
    return { actions, warnings };
  }

  // Validate the shared source file only when at least one target uses the
  // current global-Markdown adapter surface.
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

export function compileAgentRuleReverts(
  entry: AgentRuleEntry,
  agentFilter: AgentId[] | null,
  home: string,
): FileWriteRevertAction[] {
  const actions: FileWriteRevertAction[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (agentFilter && !agentFilter.includes(agentId)) continue;
    const agent = AGENT_REGISTRY_BY_ID[agentId];
    const support = agent?.agentRulesSupport;
    if (!support || support.status === "unsupported") continue;
    const target = resolvePlaceholders(support.path[platform], "", home);
    actions.push({
      kind: "file-write",
      skill: entry.name,
      agent: agentId,
      target,
    });
  }
  return actions;
}
