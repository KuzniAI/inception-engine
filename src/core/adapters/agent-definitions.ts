import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../../config/agents.ts";
import type { AgentDefinitionEntry } from "../../schemas/manifest.ts";
import type {
  AgentId,
  FileWriteDeployAction,
  FileWriteRevertAction,
  PlanWarning,
  SupportedAgentSurface,
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
 * Agent definition files are Markdown (typically with YAML frontmatter) or
 * TOML files that define custom agents or subagents for a given platform.
 * Unlike agentRules (which target a single shared global file per agent),
 * each definition entry produces a separate file named after the entry in
 * the agent's dedicated agent-definitions directory.
 *
 * Target paths use the `{repo}` placeholder so definitions land in the
 * repository being deployed, not the user's home directory.
 *
 * TOML source files (e.g. Gemini CLI `.gemini/agents/*.toml`) bypass
 * Markdown-specific validation and are deployed verbatim.
 */

/**
 * Returns the TOML-specific surface for an agent (global or repo-local),
 * or undefined when the agent has no TOML definition surface.
 */
function resolveTomlDefinitionsSurface(
  agentId: AgentId,
  scope: AgentDefinitionEntry["scope"],
): SupportedAgentSurface | undefined {
  const agent = AGENT_REGISTRY_BY_ID[agentId];
  if (!agent) return undefined;
  const tomlSupport =
    scope === "repo"
      ? (agent.agentDefinitionsTomlRepoSupport ??
        agent.agentDefinitionsTomlSupport)
      : agent.agentDefinitionsTomlSupport;
  if (!tomlSupport || tomlSupport.status !== "supported") return undefined;
  return tomlSupport;
}

interface SupportedTarget {
  agentId: AgentId;
  confidence: FileWriteDeployAction["confidence"];
  target: string;
}

/** Returns a warning when the requested scope cannot be resolved, or null when it is fine. */
function scopeAvailabilityWarning(
  entry: AgentDefinitionEntry,
  agentId: AgentId,
  repo?: string,
  workspace?: string,
): PlanWarning | null {
  if (entry.scope === "repo" && !repo) {
    return {
      kind: "confidence",
      message: `agentDefinitions: scope "repo" requires a repository path but none was resolved — skipping "${entry.name}" for agent "${agentId}"`,
    };
  }
  if (entry.scope === "workspace" && !workspace && !repo) {
    return {
      kind: "confidence",
      message: `agentDefinitions: scope "workspace" requires a workspace or repository path but none was resolved — skipping "${entry.name}" for agent "${agentId}"`,
    };
  }
  return null;
}

function resolveSupportedTargets(
  entry: AgentDefinitionEntry,
  targetAgents: AgentId[],
  home: string,
  repo?: string,
  workspace?: string,
): { targets: SupportedTarget[]; warnings: PlanWarning[] } {
  const targets: SupportedTarget[] = [];
  const warnings: PlanWarning[] = [];
  const platform = getPlatformKey();
  const isToml = path.extname(entry.path).toLowerCase() === ".toml";

  for (const agentId of targetAgents) {
    const plan = planCapabilityForDeploy({
      agentId,
      capability: "agentDefinitions",
      entryName: entry.name,
      targetAgentIds: targetAgents,
      scope: entry.scope,
    });
    if (plan.outcome === "warn") {
      warnings.push(plan.warning);
      continue;
    }
    if (plan.outcome === "native" || plan.outcome === "redundant") continue;

    // For TOML sources, use the agent's TOML-specific surface instead of the
    // default Markdown surface. Agents without a TOML surface are skipped.
    const support = isToml
      ? resolveTomlDefinitionsSurface(agentId, entry.scope)
      : resolveCapabilitySurface(agentId, "agentDefinitions", entry.scope)
          .support;
    if (!support) continue;

    const scopeWarning = scopeAvailabilityWarning(
      entry,
      agentId,
      repo,
      workspace,
    );
    if (scopeWarning) {
      warnings.push(scopeWarning);
      continue;
    }

    targets.push({
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

  return { targets, warnings };
}

async function createAgentDefinitionActions(
  entry: AgentDefinitionEntry,
  source: string,
  supportedTargets: SupportedTarget[],
  home: string,
  repo?: string,
  workspace?: string,
): Promise<FileWriteDeployAction[]> {
  const actions: FileWriteDeployAction[] = [];
  const isToml = path.extname(entry.path).toLowerCase() === ".toml";

  for (const target of supportedTargets) {
    // TOML definition files have no YAML frontmatter — skip Markdown validation.
    if (!isToml) {
      validateAgentRuleMarkdownPath(entry.path, target.agentId);
      await validateInstructionFileRequirements(
        source,
        entry.path,
        target.agentId,
      );
    }

    let migratedFrom: string[] | undefined;
    if (target.agentId === "github-copilot") {
      migratedFrom = [
        resolvePlaceholders(
          ["{repo}", ".github", "agents", "{name}.agent.md"],
          entry.name,
          home,
          repo,
          workspace,
        ),
      ];
    }

    actions.push({
      kind: "file-write",
      skill: entry.name,
      agent: target.agentId,
      source,
      target: target.target,
      confidence: target.confidence,
      migratedFrom,
    });
  }

  return actions;
}

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
  const targetAgents = entry.agents.filter((agentId) =>
    detectedAgents.includes(agentId),
  );

  if (targetAgents.length === 0) {
    return { actions: [], warnings: [] };
  }

  const { targets: supportedTargets, warnings } = resolveSupportedTargets(
    entry,
    targetAgents,
    home,
    repo,
    workspace,
  );

  if (supportedTargets.length === 0) {
    return { actions: [], warnings };
  }

  // Validate the shared source file only when at least one target is active.
  const source = path.resolve(sourceDir, entry.path);
  await validateSourcePath(source, entry.path, resolvedSourceDir, realRoot);
  await validateSourceFile(source, entry.path);

  const actions = await createAgentDefinitionActions(
    entry,
    source,
    supportedTargets,
    home,
    repo,
    workspace,
  );

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
  const isToml = path.extname(entry.path).toLowerCase() === ".toml";

  for (const agentId of entry.agents) {
    if (agentFilter && !agentFilter.includes(agentId)) continue;

    const support = isToml
      ? resolveTomlDefinitionsSurface(agentId, entry.scope)
      : resolveCapabilitySurface(agentId, "agentDefinitions", entry.scope)
          .support;
    if (!support) continue;

    if (entry.scope === "repo" && !repo) continue;
    if (entry.scope === "workspace" && !workspace && !repo) continue;

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
