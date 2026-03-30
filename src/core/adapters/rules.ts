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
import { validateSourceFile, validateSourcePath } from "../validation.ts";

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

  if (targetAgents.length === 0) {
    return { actions, warnings };
  }

  // Validate the source file once (before iterating agents) since it is shared.
  const source = path.resolve(sourceDir, entry.path);
  await validateSourcePath(source, entry.path, resolvedSourceDir, realRoot);
  await validateSourceFile(source, entry.path);

  for (const agentId of targetAgents) {
    const agent = AGENT_REGISTRY_BY_ID[agentId];

    if (agent?.claudeNativeInstruction) {
      warnings.push({
        kind: "confidence",
        message: `agentRules: agent "${agentId}" reads CLAUDE.md natively — deploy via "claude-code" target to reach Copilot automatically; no separate deployment needed`,
      });
      continue;
    }

    if (!agent?.agentRulesPath) {
      warnings.push({
        kind: "confidence",
        message: `agentRules: agent "${agentId}" does not have a documented rules file path — skipping "${entry.name}"`,
      });
      continue;
    }

    const target = resolvePlaceholders(
      agent.agentRulesPath[platform],
      "",
      home,
    );

    actions.push({
      kind: "file-write",
      skill: entry.name,
      agent: agentId,
      source,
      target,
      confidence: agent.provenance.agentRules ?? "provisional",
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
    if (!agent?.agentRulesPath) continue;
    const target = resolvePlaceholders(
      agent.agentRulesPath[platform],
      "",
      home,
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
