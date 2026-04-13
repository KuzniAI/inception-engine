import path from "node:path";
import type { AgentRuleEntry } from "../../schemas/manifest.ts";
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

export interface RulesAdapterResult {
  actions: FileWriteDeployAction[];
  warnings: PlanWarning[];
}

type ResolvedTarget = {
  agentId: AgentId;
  confidence: FileWriteDeployAction["confidence"];
  target: string;
};

function requiresRepoPath(scope: AgentRuleEntry["scope"]): boolean {
  return (
    scope === "repo" || scope === "copilot-repo" || scope === "copilot-scoped"
  );
}

function deduplicateTargets(
  supportedTargets: ResolvedTarget[],
  scope: AgentRuleEntry["scope"],
): ResolvedTarget[] {
  const seenTargetPaths = new Set<string>();
  const dedupedTargets: ResolvedTarget[] = [];
  for (const t of supportedTargets) {
    const surface = resolveCapabilitySurface(t.agentId, "agentRules", scope);
    if (
      surface.surfaceKind === "shared-via" &&
      surface.sharedVia &&
      supportedTargets.some(
        (o) => o.agentId === surface.sharedVia && o.target === t.target,
      )
    ) {
      continue;
    }
    if (!seenTargetPaths.has(t.target)) {
      seenTargetPaths.add(t.target);
      dedupedTargets.push(t);
    }
  }
  return dedupedTargets;
}

function resolveAgentTarget(
  agentId: AgentId,
  entry: AgentRuleEntry,
  home: string,
  repo: string | undefined,
  platform: "posix" | "windows",
  workspace?: string,
  allTargetAgentIds?: AgentId[],
): ResolvedTarget | PlanWarning | null {
  const plan = planCapabilityForDeploy({
    agentId,
    capability: "agentRules",
    entryName: entry.name,
    targetAgentIds: allTargetAgentIds ?? [agentId],
    scope: entry.scope,
  });
  if (plan.outcome === "warn") return plan.warning;
  if (plan.outcome === "native" || plan.outcome === "redundant") return null;

  const surface = resolveCapabilitySurface(agentId, "agentRules", entry.scope);
  const support = surface.support;
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
  if (
    (entry.scope === "copilot-repo" || entry.scope === "copilot-scoped") &&
    !repo
  ) {
    return {
      kind: "confidence",
      message: `agentRules: scope "${entry.scope}" requires a repository path but none was resolved — skipping "${entry.name}" for agent "${agentId}"`,
    };
  }
  return {
    agentId,
    confidence: plan.confidence,
    target: resolvePlaceholders(
      support?.path[platform] ?? [],
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
    if (result === null) {
      continue;
    }
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
  const dedupedTargets = deduplicateTargets(supportedTargets, entry.scope);

  // Validate the shared source file only when at least one target uses the
  // current rules adapter surface.
  const source = path.resolve(sourceDir, entry.path);
  await validateSourcePath(source, entry.path, resolvedSourceDir, realRoot);
  await validateSourceFile(source, entry.path);

  // Native Copilot instruction files (.github/copilot-instructions.md and
  // .github/instructions/*.instructions.md) are plain markdown and do not
  // require agent-definition-style frontmatter (tools/instructions keys).
  // Skip the instructionFrontmatterRequired check for these scopes.
  const skipFrontmatterValidation =
    entry.scope === "copilot-repo" || entry.scope === "copilot-scoped";

  for (const target of dedupedTargets) {
    validateAgentRuleMarkdownPath(entry.path, target.agentId);
    if (!skipFrontmatterValidation) {
      await validateInstructionFileRequirements(
        source,
        entry.path,
        target.agentId,
      );
    }
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
    const surface = resolveCapabilitySurface(
      agentId,
      "agentRules",
      entry.scope,
    );
    const support = surface.support;

    if (surface.supportStatus !== "supported" || !support) {
      continue;
    }

    if (requiresRepoPath(entry.scope) && !repo) continue;
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
