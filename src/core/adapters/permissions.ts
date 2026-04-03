import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../../config/agents.ts";
import type { PermissionsEntry } from "../../schemas/manifest.ts";
import type {
  AgentId,
  ConfigPatchDeployAction,
  ConfigPatchRevertAction,
  PlanWarning,
  TomlPatchDeployAction,
  TomlPatchRevertAction,
} from "../../types.ts";
import { getPlatformKey, resolvePlaceholders } from "../resolve.ts";
import { validatePermissionsConfigShape } from "../validation.ts";

export interface PermissionsAdapterResult {
  actions: Array<ConfigPatchDeployAction | TomlPatchDeployAction>;
  warnings: PlanWarning[];
}

function isTomlTarget(targetPath: string): boolean {
  return path.extname(targetPath).toLowerCase() === ".toml";
}

export function compilePermissionsActions(
  entry: PermissionsEntry,
  detectedAgents: AgentId[],
  home: string,
): PermissionsAdapterResult {
  const actions: PermissionsAdapterResult["actions"] = [];
  const warnings: PlanWarning[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (!detectedAgents.includes(agentId)) continue;
    const agent = AGENT_REGISTRY_BY_ID[agentId];
    const support = agent?.permissionsSupport;
    if (!support || support.status === "unsupported") {
      warnings.push({
        kind: "confidence",
        message: `permissions: agent "${agentId}" ${support?.status === "unsupported" ? support.reason : "does not expose a supported permissions adapter"} — skipping "${entry.name}"`,
      });
      continue;
    }

    validatePermissionsConfigShape(entry.config, entry.name, agentId);

    const rawTarget = resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
    );
    const resolvedTarget = path.resolve(rawTarget);
    const confidence = agent.provenance.permissions ?? "provisional";

    if (isTomlTarget(resolvedTarget)) {
      actions.push({
        kind: "toml-patch",
        skill: entry.name,
        agent: agentId,
        target: resolvedTarget,
        config: entry.config,
        confidence,
      } satisfies TomlPatchDeployAction);
    } else {
      actions.push({
        kind: "config-patch",
        skill: entry.name,
        agent: agentId,
        target: resolvedTarget,
        patch: entry.config,
        confidence,
      } satisfies ConfigPatchDeployAction);
    }
  }

  return { actions, warnings };
}

export function compilePermissionsReverts(
  entry: PermissionsEntry,
  agentFilter: AgentId[] | null,
  home: string,
): Array<ConfigPatchRevertAction | TomlPatchRevertAction> {
  const actions: Array<ConfigPatchRevertAction | TomlPatchRevertAction> = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (agentFilter && !agentFilter.includes(agentId)) continue;
    const agent = AGENT_REGISTRY_BY_ID[agentId];
    const support = agent?.permissionsSupport;
    if (!support || support.status === "unsupported") continue;

    const rawTarget = resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
    );
    const target = path.resolve(rawTarget);

    if (isTomlTarget(target)) {
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
