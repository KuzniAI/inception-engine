import { lstat, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { AGENT_REGISTRY_BY_ID } from "../config/agents.ts";
import { logger } from "../logger.ts";
import type { ConfigPatchRegistryEntry } from "../schemas/registry.ts";
import type {
  AgentId,
  ConfigPatchRevertAction,
  FileWriteRevertAction,
  Manifest,
  PlannedChange,
  RevertAction,
  SkillDirRevertAction,
} from "../types.ts";
import {
  compileAgentRuleReverts,
  compileMcpServerReverts,
} from "./adapters/index.ts";
import {
  lookupDeployment,
  type RegistryPersistence,
  unregisterDeployment,
} from "./ownership.ts";
import { resolveAgentSkillPath } from "./resolve.ts";
import { resolveTargetTemplate } from "./runtime-paths.ts";

function buildSkillDirReverts(
  manifest: Manifest,
  home: string,
  agentFilter: AgentId[] | null,
): SkillDirRevertAction[] {
  const actions: SkillDirRevertAction[] = [];
  for (const skill of manifest.skills) {
    for (const agentId of skill.agents) {
      if (agentFilter && !agentFilter.includes(agentId)) continue;
      const agent = AGENT_REGISTRY_BY_ID[agentId];
      if (!agent) continue;
      actions.push({
        kind: "skill-dir",
        skill: skill.name,
        agent: agentId,
        target: resolveAgentSkillPath(agent, skill.name, home),
      });
    }
  }
  return actions;
}

function buildFileWriteReverts(
  manifest: Manifest,
  home: string,
  agentFilter: AgentId[] | null,
): FileWriteRevertAction[] {
  const actions: FileWriteRevertAction[] = [];
  for (const fileEntry of manifest.files ?? []) {
    for (const agentId of fileEntry.agents) {
      if (agentFilter && !agentFilter.includes(agentId)) continue;
      const agent = AGENT_REGISTRY_BY_ID[agentId];
      if (!agent) continue;
      actions.push({
        kind: "file-write",
        skill: fileEntry.name,
        agent: agentId,
        target: resolveTargetTemplate(fileEntry.target, home),
      });
    }
  }
  return actions;
}

function buildConfigPatchReverts(
  manifest: Manifest,
  home: string,
  agentFilter: AgentId[] | null,
): ConfigPatchRevertAction[] {
  const actions: ConfigPatchRevertAction[] = [];
  for (const configEntry of manifest.configs ?? []) {
    for (const agentId of configEntry.agents) {
      if (agentFilter && !agentFilter.includes(agentId)) continue;
      const agent = AGENT_REGISTRY_BY_ID[agentId];
      if (!agent) continue;
      actions.push({
        kind: "config-patch",
        skill: configEntry.name,
        agent: agentId,
        target: resolveTargetTemplate(configEntry.target, home),
      });
    }
  }
  return actions;
}

export function planRevert(
  manifest: Manifest,
  detectedAgents: AgentId[],
  home: string,
): RevertAction[] {
  return [
    ...buildSkillDirReverts(manifest, home, detectedAgents),
    ...buildFileWriteReverts(manifest, home, detectedAgents),
    ...buildConfigPatchReverts(manifest, home, detectedAgents),
    ...(manifest.mcpServers ?? []).flatMap((e) =>
      compileMcpServerReverts(e, detectedAgents, home),
    ),
    ...(manifest.agentRules ?? []).flatMap((e) =>
      compileAgentRuleReverts(e, detectedAgents, home),
    ),
  ];
}

export function planRevertAll(
  manifest: Manifest,
  home: string,
): RevertAction[] {
  return [
    ...buildSkillDirReverts(manifest, home, null),
    ...buildFileWriteReverts(manifest, home, null),
    ...buildConfigPatchReverts(manifest, home, null),
    ...(manifest.mcpServers ?? []).flatMap((e) =>
      compileMcpServerReverts(e, null, home),
    ),
    ...(manifest.agentRules ?? []).flatMap((e) =>
      compileAgentRuleReverts(e, null, home),
    ),
  ];
}

type RevertOutcome =
  | { outcome: "ok" }
  | { outcome: "skip" }
  | { outcome: "fail"; error: string };

function recordOutcome(
  result: RevertOutcome,
  action: RevertAction,
  counts: { succeeded: number; skipped: number },
  failed: Array<{ action: RevertAction; error: string }>,
): void {
  if (result.outcome === "fail") {
    failed.push({ action, error: result.error });
  } else if (result.outcome === "skip") {
    counts.skipped++;
  } else {
    counts.succeeded++;
  }
}

async function readJsonConfig(
  filePath: string,
): Promise<Record<string, unknown>> {
  const rawContent = await readFile(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`Config file is not valid JSON: ${filePath}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config file is not a JSON object: ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function applyUndoPatch(
  current: Record<string, unknown>,
  undoPatch: Record<string, unknown>,
): Record<string, unknown> {
  const restored: Record<string, unknown> = { ...current };
  for (const [key, originalValue] of Object.entries(undoPatch)) {
    if (originalValue === null) {
      delete restored[key];
    } else if (isPlainObject(originalValue) && isPlainObject(restored[key])) {
      restored[key] = applyUndoPatch(
        restored[key] as Record<string, unknown>,
        originalValue as Record<string, unknown>,
      );
    } else {
      restored[key] = originalValue;
    }
  }
  return restored;
}

function lstatOutcome(
  err: unknown,
): { outcome: "skip" } | { outcome: "fail"; error: string } {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") {
    return { outcome: "skip" };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { outcome: "fail", error: msg };
}

export async function executeRevert(
  actions: RevertAction[],
  dryRun: boolean,
  verbose: boolean,
  home: string,
  deps: RevertDependencies = {},
): Promise<{
  succeeded: number;
  skipped: number;
  failed: Array<{ action: RevertAction; error: string }>;
  planned: PlannedChange[];
}> {
  let succeeded = 0;
  let skipped = 0;
  const failed: Array<{ action: RevertAction; error: string }> = [];
  const planned: PlannedChange[] = [];
  const counts = { succeeded, skipped };

  for (const action of actions) {
    let result: RevertOutcome;
    switch (action.kind) {
      case "skill-dir":
        result = await executeRevertAction(
          action,
          dryRun,
          verbose,
          home,
          planned,
          deps,
        );
        break;
      case "file-write":
        result = await revertFileWrite(
          action,
          dryRun,
          verbose,
          home,
          planned,
          deps,
        );
        break;
      case "config-patch":
        result = await revertConfigPatch(
          action,
          dryRun,
          verbose,
          home,
          planned,
          deps,
        );
        break;
      default:
        throw new Error(`Unhandled revert action kind: ${action}`);
    }
    recordOutcome(result, action, counts, failed);
  }

  succeeded = counts.succeeded;
  skipped = counts.skipped;

  return { succeeded, skipped, failed, planned };
}

interface RevertDependencies {
  registry?: RegistryPersistence;
}

async function executeRevertAction(
  action: RevertAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
  deps: RevertDependencies,
): Promise<RevertOutcome> {
  const label = `${action.skill} -> ${action.agent}`;

  try {
    await lstat(action.target);
  } catch (err) {
    const result = lstatOutcome(err);
    if (result.outcome === "skip") {
      logger.skip(label, "(not found, skipping)");
      return result;
    }
    logger.fail(label, result.error);
    return result;
  }

  const entry = await lookupDeployment(home, action.target, deps.registry);
  if (!entry || entry.skill !== action.skill || entry.agent !== action.agent) {
    logger.warn(
      label,
      `skipping: ${action.target} is not in the deployment registry — not managed by inception-engine`,
    );
    return { outcome: "skip" };
  }

  if (dryRun) {
    planned.push({
      verb: "remove",
      kind: "skill-dir",
      skill: action.skill,
      agent: action.agent,
      target: action.target,
    });
    return { outcome: "ok" };
  }

  try {
    // Re-stat immediately before deletion to minimise the window between the
    // type-check and the removal syscall.
    const currentStat = await lstat(action.target);
    if (currentStat.isSymbolicLink()) {
      await unlink(action.target);
    } else {
      await rm(action.target, { recursive: true });
    }
    await unregisterDeployment(home, action.target, deps.registry);
    logger.ok(label);
    if (verbose) {
      logger.detail(`removed: ${action.target}`);
    }
    return { outcome: "ok" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Target disappeared between ownership check and removal — treat as skip.
      logger.skip(label, "(disappeared before removal, skipping)");
      return { outcome: "skip" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { outcome: "fail", error: msg };
  }
}

async function revertFileWrite(
  action: RevertAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
  deps: RevertDependencies,
): Promise<RevertOutcome> {
  const label = `${action.skill} -> ${action.agent}`;

  try {
    await lstat(action.target);
  } catch (err) {
    const result = lstatOutcome(err);
    if (result.outcome === "skip") {
      logger.skip(label, "(not found, skipping)");
      return result;
    }
    logger.fail(label, result.error);
    return result;
  }

  const entry = await lookupDeployment(home, action.target, deps.registry);
  if (!entry || entry.skill !== action.skill || entry.agent !== action.agent) {
    logger.warn(
      label,
      `skipping: ${action.target} is not in the deployment registry — not managed by inception-engine`,
    );
    return { outcome: "skip" };
  }

  if (dryRun) {
    planned.push({
      verb: "remove",
      kind: "file-write",
      skill: action.skill,
      agent: action.agent,
      target: action.target,
    });
    return { outcome: "ok" };
  }

  try {
    // Re-stat immediately before deletion to minimise the type-check to
    // removal window; handle the case where the file has since disappeared.
    await lstat(action.target);
    await unlink(action.target);
    await unregisterDeployment(home, action.target, deps.registry);
    logger.ok(label);
    if (verbose) {
      logger.detail(`removed: ${action.target}`);
    }
    return { outcome: "ok" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.skip(label, "(disappeared before removal, skipping)");
      return { outcome: "skip" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { outcome: "fail", error: msg };
  }
}

async function revertConfigPatch(
  action: RevertAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
  deps: RevertDependencies,
): Promise<RevertOutcome> {
  const label = `${action.skill} -> ${action.agent}`;

  try {
    await lstat(action.target);
  } catch (err) {
    const result = lstatOutcome(err);
    if (result.outcome === "skip") {
      logger.skip(label, "(not found, skipping)");
      return result;
    }
    logger.fail(label, result.error);
    return result;
  }

  const entry = await lookupDeployment(home, action.target, deps.registry);
  if (
    !entry ||
    entry.kind !== "config-patch" ||
    entry.skill !== action.skill ||
    entry.agent !== action.agent
  ) {
    logger.warn(
      label,
      `skipping: ${action.target} is not in the deployment registry — not managed by inception-engine`,
    );
    return { outcome: "skip" };
  }

  const configPatchEntry = entry as ConfigPatchRegistryEntry;

  if (dryRun) {
    planned.push({
      verb: "unapply-patch",
      kind: "config-patch",
      skill: action.skill,
      agent: action.agent,
      target: action.target,
      patch: configPatchEntry.undoPatch,
    });
    return { outcome: "ok" };
  }

  try {
    const current = await readJsonConfig(action.target);
    const restored = applyUndoPatch(current, configPatchEntry.undoPatch);

    await writeFile(
      action.target,
      `${JSON.stringify(restored, null, 2)}\n`,
      "utf-8",
    );
    await unregisterDeployment(home, action.target, deps.registry);
    logger.ok(label);
    if (verbose) {
      logger.detail(`unapplied patch from: ${action.target}`);
    }
    return { outcome: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { outcome: "fail", error: msg };
  }
}
