import path from "node:path";
import type { HookEntry } from "../../schemas/manifest.ts";
import type {
  AgentId,
  ConfigPatchDeployAction,
  ConfigPatchRevertAction,
  PlanWarning,
  TomlPatchDeployAction,
  TomlPatchRevertAction,
} from "../../types.ts";
import {
  planCapabilityForDeploy,
  resolveCapabilitySurface,
} from "../capabilities.ts";
import { getPlatformKey, resolvePlaceholders } from "../resolve.ts";
import { validateHookConfigShape } from "../validation.ts";

export interface HooksAdapterResult {
  actions: Array<ConfigPatchDeployAction | TomlPatchDeployAction>;
  warnings: PlanWarning[];
}

function isTomlTarget(targetPath: string): boolean {
  return path.extname(targetPath).toLowerCase() === ".toml";
}

export function compileHookActions(
  entry: HookEntry,
  detectedAgents: AgentId[],
  home: string,
): HooksAdapterResult {
  const actions: HooksAdapterResult["actions"] = [];
  const warnings: PlanWarning[] = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (!detectedAgents.includes(agentId)) continue;
    const plan = planCapabilityForDeploy({
      agentId,
      capability: "hooks",
      entryName: entry.name,
      targetAgentIds: entry.agents,
    });
    if (plan.outcome === "warn") {
      warnings.push(plan.warning);
      continue;
    }
    if (plan.outcome === "native" || plan.outcome === "redundant") continue;

    const support = resolveCapabilitySurface(agentId, "hooks").support;
    if (!support) continue;

    validateHookConfigShape(entry.config, entry.name, agentId);

    const rawTarget = resolvePlaceholders(
      support.path[platform],
      entry.name,
      home,
    );
    const resolvedTarget = path.resolve(rawTarget);
    const confidence = plan.confidence ?? "provisional";

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

export function compileHookReverts(
  entry: HookEntry,
  agentFilter: AgentId[] | null,
  home: string,
): Array<ConfigPatchRevertAction | TomlPatchRevertAction> {
  const actions: Array<ConfigPatchRevertAction | TomlPatchRevertAction> = [];
  const platform = getPlatformKey();

  for (const agentId of entry.agents) {
    if (agentFilter && !agentFilter.includes(agentId)) continue;
    const support = resolveCapabilitySurface(agentId, "hooks").support;
    if (!support) continue;

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
