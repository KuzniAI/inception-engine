import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../../config/agents.ts";
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
): McpAdapterResult {
  const actions: McpAdapterResult["actions"] = [];
  const warnings: PlanWarning[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (!detectedAgents.includes(agentId)) continue;
    const agent = AGENT_REGISTRY_BY_ID[agentId];
    const support = agent?.mcpSupport;
    if (!support || support.status === "unsupported") {
      warnings.push({
        kind: "confidence",
        message: `mcpServers: agent "${agentId}" uses ${support?.schemaLabel ?? "an unsupported MCP schema"} and ${support?.status === "unsupported" ? support.reason : "does not expose a supported MCP adapter"} — skipping "${entry.name}"`,
      });
      continue;
    }

    validateMcpServerConfigShape(entry.config, entry.name, agentId);

    const rawTarget = resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
      repo,
    );
    const resolvedTarget = path.resolve(rawTarget);
    const confidence = agent.provenance.mcpConfig ?? "provisional";
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
    const agent = AGENT_REGISTRY_BY_ID[agentId];
    const support = agent?.mcpSupport;
    if (!support || support.status === "unsupported") continue;

    const rawTarget = resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
      repo,
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
