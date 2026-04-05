import path from "node:path";
import type { McpServerEntry } from "../../schemas/manifest.ts";
import type {
  AgentId,
  ConfigPatchDeployAction,
  ConfigPatchRevertAction,
  FrontmatterEmitDeployAction,
  FrontmatterEmitRevertAction,
  PlanWarning,
  TomlPatchDeployAction,
  TomlPatchRevertAction,
} from "../../types.ts";
import {
  planCapabilityForDeploy,
  resolveCapabilitySurface,
} from "../capabilities.ts";
import { getPlatformKey, resolvePlaceholders } from "../resolve.ts";
import { validateMcpServerConfigShape } from "../validation.ts";

export interface McpAdapterResult {
  actions: Array<
    | ConfigPatchDeployAction
    | TomlPatchDeployAction
    | FrontmatterEmitDeployAction
  >;
  warnings: PlanWarning[];
}

/**
 * Determines whether a resolved config path targets a TOML file.
 */
function isTomlTarget(targetPath: string): boolean {
  return path.extname(targetPath).toLowerCase() === ".toml";
}

/**
 * Determines whether a resolved config path targets a Markdown file
 * (indicates a frontmatter-emit surface, e.g. Antigravity's .agents/rules/).
 */
function isMarkdownTarget(targetPath: string): boolean {
  const ext = path.extname(targetPath).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

type McpDeployAction =
  | ConfigPatchDeployAction
  | TomlPatchDeployAction
  | FrontmatterEmitDeployAction;

function buildMcpDeployAction(
  entry: McpServerEntry,
  agentId: AgentId,
  resolvedTarget: string,
  confidence: import("../../types.ts").Confidence,
  mcpPatchKey: string,
): McpDeployAction {
  if (isMarkdownTarget(resolvedTarget)) {
    return {
      kind: "frontmatter-emit",
      skill: entry.name,
      agent: agentId,
      target: resolvedTarget,
      frontmatter: { "mcp-servers": { [entry.name]: entry.config } },
      confidence,
    } satisfies FrontmatterEmitDeployAction;
  }
  if (isTomlTarget(resolvedTarget)) {
    return {
      kind: "toml-patch",
      skill: entry.name,
      agent: agentId,
      target: resolvedTarget,
      config: entry.config,
      confidence,
    } satisfies TomlPatchDeployAction;
  }
  return {
    kind: "config-patch",
    skill: entry.name,
    agent: agentId,
    target: resolvedTarget,
    patch: { [mcpPatchKey]: { [entry.name]: entry.config } },
    confidence,
  } satisfies ConfigPatchDeployAction;
}

export function compileMcpServerActions(
  entry: McpServerEntry,
  detectedAgents: AgentId[],
  home: string,
  repo?: string,
  workspace?: string,
): McpAdapterResult {
  const actions: McpAdapterResult["actions"] = [];
  const warnings: PlanWarning[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (!detectedAgents.includes(agentId)) continue;
    const plan = planCapabilityForDeploy({
      agentId,
      capability: "mcpServers",
      entryName: entry.name,
      targetAgentIds: entry.agents,
    });
    if (plan.outcome === "warn") {
      warnings.push(plan.warning);
      continue;
    }
    if (plan.outcome === "native" || plan.outcome === "redundant") continue;

    const support = resolveCapabilitySurface(agentId, "mcpServers").support;
    if (!support) continue;

    validateMcpServerConfigShape(entry.config, entry.name, agentId);

    const rawTarget = resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
      repo,
      workspace,
    );
    const resolvedTarget = path.resolve(rawTarget);
    const confidence = plan.confidence ?? "provisional";
    const mcpPatchKey = support.mcpPatchKey ?? "mcpServers";

    actions.push(
      buildMcpDeployAction(
        entry,
        agentId,
        resolvedTarget,
        confidence,
        mcpPatchKey,
      ),
    );
  }

  return { actions, warnings };
}

export function compileMcpServerReverts(
  entry: McpServerEntry,
  agentFilter: AgentId[] | null,
  home: string,
  repo?: string,
  workspace?: string,
): Array<
  ConfigPatchRevertAction | TomlPatchRevertAction | FrontmatterEmitRevertAction
> {
  const actions: Array<
    | ConfigPatchRevertAction
    | TomlPatchRevertAction
    | FrontmatterEmitRevertAction
  > = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (agentFilter && !agentFilter.includes(agentId)) continue;
    const support = resolveCapabilitySurface(agentId, "mcpServers").support;
    if (!support) continue;

    const rawTarget = resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
      repo,
      workspace,
    );
    const target = path.resolve(rawTarget);

    if (isMarkdownTarget(target)) {
      actions.push({
        kind: "frontmatter-emit",
        skill: entry.name,
        agent: agentId,
        target,
      });
    } else if (isTomlTarget(target)) {
      actions.push({
        kind: "toml-patch",
        skill: entry.name,
        agent: agentId,
        target,
      });
    } else {
      actions.push({
        kind: "config-patch",
        skill: entry.name,
        agent: agentId,
        target,
      });
    }
  }
  return actions;
}
