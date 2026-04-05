import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../../config/agents.ts";
import type { AgentRuleEntry } from "../../schemas/manifest.ts";
import type {
  AgentId,
  AgentSurfaceSupport,
  FileWriteDeployAction,
  FileWriteRevertAction,
  PlanWarning,
} from "../../types.ts";
import { getPlatformKey, resolvePlaceholders } from "../resolve.ts";
import {
  validateAgentRuleMarkdownPath,
  validateInstructionFileRequirements,
  validateSourceFile,
  validateSourcePath,
} from "../validation.ts";

export interface RulesAdapterResult {
  actions: FileWriteDeployAction[];
  warnings: PlanWarning[];
}

function resolveRulesSupport(
  agentId: AgentId,
  scope: AgentRuleEntry["scope"],
): AgentSurfaceSupport | undefined {
  const agent = AGENT_REGISTRY_BY_ID[agentId];
  if (scope === "repo") {
    return agent?.agentRulesRepoSupport ?? agent?.agentRulesSupport;
  }
  if (scope === "workspace") {
    return (
      agent?.agentRulesWorkspaceSupport ??
      agent?.agentRulesRepoSupport ??
      agent?.agentRulesSupport
    );
  }
  return agent?.agentRulesSupport;
}

type ResolvedTarget = {
  agentId: AgentId;
  confidence: FileWriteDeployAction["confidence"];
  target: string;
};

function resolveAgentTarget(
  agentId: AgentId,
  entry: AgentRuleEntry,
  home: string,
  repo: string | undefined,
  platform: "posix" | "windows",
  workspace?: string,
  allTargetAgentIds?: AgentId[],
): ResolvedTarget | PlanWarning {
  const support = resolveRulesSupport(agentId, entry.scope);
  if (!support || support.status === "unsupported") {
    return {
      kind: "confidence",
      message: `agentRules: agent "${agentId}" uses ${support?.schemaLabel ?? "an unsupported instruction schema"} (unsupported) and ${support?.status === "unsupported" ? support.reason : "does not expose a supported rules adapter"} — skipping "${entry.name}"`,
    };
  }
  if (support.status === "planned") {
    return {
      kind: "confidence",
      message: `agentRules: agent "${agentId}" rules support is planned via ${support.plannedSurface} — skipping "${entry.name}" until that surface is implemented`,
    };
  }
  // shared-via: when requiresPrimary is set and the primary agent is absent
  // from the target list, emit a guidance warning instead of deploying.
  if (
    support.surfaceKind?.kind === "shared-via" &&
    support.surfaceKind.requiresPrimary &&
    allTargetAgentIds &&
    !allTargetAgentIds.includes(support.surfaceKind.via)
  ) {
    return {
      kind: "confidence",
      message: `agentRules: agent "${agentId}" reads this surface via "${support.surfaceKind.via}" — add "${support.surfaceKind.via}" to the entry's agents list to deploy to this surface, or deploy via the "${support.surfaceKind.via}" agentRules target instead`,
    };
  }
  if (entry.scope === "repo" && !repo) {
    return {
      kind: "confidence",
      message: `agentRules: scope "repo" requires a repository path but none was resolved — skipping "${entry.name}" for agent "${agentId}"`,
    };
  }
  if (entry.scope === "workspace" && !workspace && !repo) {
    return {
      kind: "confidence",
      message: `agentRules: scope "workspace" requires a workspace or repository path but none was resolved — skipping "${entry.name}" for agent "${agentId}"`,
    };
  }
  const agent = AGENT_REGISTRY_BY_ID[agentId];
  return {
    agentId,
    confidence: agent?.provenance.agentRules ?? "provisional",
    target: resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
      repo,
      workspace,
    ),
  };
}

export async function compileAgentRuleActions(
  entry: AgentRuleEntry,
  sourceDir: string,
  resolvedSourceDir: string,
  realRoot: string,
  detectedAgents: AgentId[],
  home: string,
  repo?: string,
  workspace?: string,
): Promise<RulesAdapterResult> {
  const actions: FileWriteDeployAction[] = [];
  const warnings: PlanWarning[] = [];
  const platform = getPlatformKey();
  const targetAgents = entry.agents.filter((agentId) =>
    detectedAgents.includes(agentId),
  );
  const supportedTargets: ResolvedTarget[] = [];

  if (targetAgents.length === 0) {
    return { actions, warnings };
  }

  for (const agentId of targetAgents) {
    const result = resolveAgentTarget(
      agentId,
      entry,
      home,
      repo,
      platform,
      workspace,
      targetAgents,
    );
    if ("kind" in result) {
      warnings.push(result);
    } else {
      supportedTargets.push(result);
    }
  }

  if (supportedTargets.length === 0) {
    return { actions, warnings };
  }

  // Deduplicate: when a shared-via rider's primary is also in supportedTargets,
  // skip the rider — the primary agent writes the shared surface. As a fallback,
  // also dedup by resolved path so no target file is written twice.
  const seenTargetPaths = new Set<string>();
  const dedupedTargets: ResolvedTarget[] = [];
  for (const t of supportedTargets) {
    const sup = resolveRulesSupport(t.agentId, entry.scope);
    if (
      sup?.status === "supported" &&
      sup.surfaceKind?.kind === "shared-via" &&
      supportedTargets.some(
        (o) =>
          o.agentId ===
            (sup.surfaceKind as { kind: "shared-via"; via: AgentId }).via &&
          o.target === t.target,
      )
    ) {
      // Primary agent is present and writes the same target — skip rider.
      continue;
    }
    if (!seenTargetPaths.has(t.target)) {
      seenTargetPaths.add(t.target);
      dedupedTargets.push(t);
    }
  }

  // Validate the shared source file only when at least one target uses the
  // current rules adapter surface.
  const source = path.resolve(sourceDir, entry.path);
  await validateSourcePath(source, entry.path, resolvedSourceDir, realRoot);
  await validateSourceFile(source, entry.path);

  for (const target of dedupedTargets) {
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

export function compileAgentRuleReverts(
  entry: AgentRuleEntry,
  agentFilter: AgentId[] | null,
  home: string,
  repo?: string,
  workspace?: string,
): FileWriteRevertAction[] {
  const actions: FileWriteRevertAction[] = [];
  const platform = getPlatformKey();
  const seenRevertTargets = new Set<string>();

  for (const agentId of entry.agents) {
    if (agentFilter && !agentFilter.includes(agentId)) continue;
    const support = resolveRulesSupport(agentId, entry.scope);

    if (
      !support ||
      support.status === "unsupported" ||
      support.status === "planned"
    ) {
      continue;
    }

    if (entry.scope === "repo" && !repo) continue;
    if (entry.scope === "workspace" && !workspace && !repo) continue;

    const target = resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
      repo,
      workspace,
    );
    if (seenRevertTargets.has(target)) continue;
    seenRevertTargets.add(target);

    actions.push({
      kind: "file-write",
      skill: entry.name,
      agent: agentId,
      target,
    });
  }

  return actions;
}
