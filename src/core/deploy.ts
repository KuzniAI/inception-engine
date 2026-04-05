import { constants } from "node:fs";
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { AGENT_REGISTRY, AGENT_REGISTRY_BY_ID } from "../config/agents.ts";
import { UserError } from "../errors.ts";
import { logger } from "../logger.ts";
import type {
  AgentId,
  ConfigPatchDeployAction,
  DeployAction,
  FileWriteDeployAction,
  FrontmatterEmitDeployAction,
  Manifest,
  PlannedChange,
  PlanWarning,
  SkillDirDeployAction,
  TomlPatchDeployAction,
} from "../types.ts";
import { compileAdapterActions } from "./adapters/index.ts";
import { planCapabilityForDeploy } from "./capabilities.ts";
import {
  applyMergePatch,
  computeUndoPatch,
  isPlainObject,
} from "./merge-patch.ts";
import {
  lookupDeployment,
  type RegistryPersistence,
  registerDeployment,
  verifyDeployment,
} from "./ownership.ts";
import { getDeployMethod, resolveAgentSkillPath } from "./resolve.ts";
import { resolveTargetTemplate } from "./runtime-paths.ts";
import {
  sourceAccessError,
  validateSkillDefinitionFile,
  validateSourceFile,
  validateSourcePath,
} from "./validation.ts";

async function readJsonConfigFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  let rawContent: string;
  try {
    rawContent = await readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT")
      throw new Error(`Config file not found: ${filePath}`);
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`Config file is not valid JSON: ${filePath}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`Config file is not a JSON object: ${filePath}`);
  }

  return parsed;
}

function detectCollisions(actions: DeployAction[]): PlanWarning[] {
  const seen = new Map<string, { skill: string; agent: AgentId }>();
  const warnings: PlanWarning[] = [];
  for (const action of actions) {
    const prev = seen.get(action.target);
    if (prev) {
      warnings.push({
        kind: "collision",
        message: `Skill "${action.skill}" for agent "${action.agent}" and skill "${prev.skill}" for agent "${prev.agent}" both resolve to the same target: ${action.target}`,
      });
    } else {
      seen.set(action.target, { skill: action.skill, agent: action.agent });
    }
  }
  return warnings;
}

/**
 * Finds all (primary, rider) pairs among detected agents where the rider has
 * at least one surface annotated as `shared-via` the primary and the primary
 * is also detected. Used to drive ambiguity warnings without hardcoding agent
 * IDs.
 */
function findSharedSurfacePairs(
  detectedAgents: AgentId[],
): Array<{ primary: AgentId; rider: AgentId }> {
  const pairs: Array<{ primary: AgentId; rider: AgentId }> = [];
  for (const agent of AGENT_REGISTRY) {
    if (!detectedAgents.includes(agent.id)) continue;
    const surfaces = [
      agent.agentRulesSupport,
      agent.agentRulesRepoSupport,
      agent.agentRulesWorkspaceSupport,
      agent.mcpSupport,
      agent.agentDefinitionsSupport,
    ];
    for (const surface of surfaces) {
      if (
        surface?.status === "supported" &&
        surface.surfaceKind?.kind === "shared-via"
      ) {
        const via = surface.surfaceKind.via;
        if (
          detectedAgents.includes(via) &&
          !pairs.some((p) => p.primary === via && p.rider === agent.id)
        ) {
          pairs.push({ primary: via, rider: agent.id });
        }
      }
    }
  }
  return pairs;
}

function resolveAgentRulesSupportForScope(
  agentId: AgentId,
  scope: "global" | "repo" | "workspace",
) {
  const agent = AGENT_REGISTRY_BY_ID[agentId];
  if (scope === "repo")
    return agent?.agentRulesRepoSupport ?? agent?.agentRulesSupport;
  if (scope === "workspace") {
    return (
      agent?.agentRulesWorkspaceSupport ??
      agent?.agentRulesRepoSupport ??
      agent?.agentRulesSupport
    );
  }
  return agent?.agentRulesSupport;
}

function checkPairAgentRuleAmbiguities(
  manifest: Manifest,
  primary: AgentId,
  rider: AgentId,
): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  for (const entry of manifest.agentRules ?? []) {
    if (!(entry.agents.includes(primary) && entry.agents.includes(rider)))
      continue;
    const primarySupport = resolveAgentRulesSupportForScope(
      primary,
      entry.scope,
    );
    const riderSupport = resolveAgentRulesSupportForScope(rider, entry.scope);
    if (
      primarySupport?.status === "supported" &&
      riderSupport?.status === "supported" &&
      JSON.stringify(primarySupport.path) === JSON.stringify(riderSupport.path)
    ) {
      warnings.push({
        kind: "ambiguity",
        message: `Both "${primary}" and "${rider}" are listed in agentRules entry "${entry.name}". Both target the same surface — listing both is redundant but harmless; deduplication ensures only one write action is emitted.`,
      });
    }
  }
  return warnings;
}

function checkPairMcpAmbiguities(
  manifest: Manifest,
  primary: AgentId,
  rider: AgentId,
): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const primaryMcp = AGENT_REGISTRY_BY_ID[primary]?.mcpSupport;
  const riderMcp = AGENT_REGISTRY_BY_ID[rider]?.mcpSupport;
  if (primaryMcp?.status !== "supported" || riderMcp?.status !== "supported")
    return warnings;
  for (const entry of manifest.mcpServers ?? []) {
    if (!(entry.agents.includes(primary) && entry.agents.includes(rider)))
      continue;
    warnings.push({
      kind: "ambiguity",
      message: `Both "${primary}" and "${rider}" are listed in mcpServers entry "${entry.name}". "${primary}" writes to a shared MCP surface — verify that deploying to both does not produce conflicting MCP server behavior.`,
    });
  }
  return warnings;
}

function checkPairAgentDefinitionAmbiguities(
  manifest: Manifest,
  primary: AgentId,
  rider: AgentId,
): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  for (const entry of manifest.agentDefinitions ?? []) {
    if (!(entry.agents.includes(primary) && entry.agents.includes(rider)))
      continue;
    warnings.push({
      kind: "ambiguity",
      message: `Both "${primary}" and "${rider}" are listed in agentDefinitions entry "${entry.name}". They write to distinct surfaces — verify that this behavioral divergence is intended.`,
    });
  }
  return warnings;
}

function detectAmbiguities(
  detectedAgents: AgentId[],
  manifest: Manifest,
): PlanWarning[] {
  const pairs = findSharedSurfacePairs(detectedAgents);
  if (pairs.length === 0) return [];

  const warnings: PlanWarning[] = [];
  for (const { primary, rider } of pairs) {
    warnings.push(...checkPairAgentRuleAmbiguities(manifest, primary, rider));
    warnings.push(...checkPairMcpAmbiguities(manifest, primary, rider));
    warnings.push(
      ...checkPairAgentDefinitionAmbiguities(manifest, primary, rider),
    );
  }
  return warnings;
}

function checkAntigravityPathCollisions(manifest: Manifest): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const defNames = new Set<string>(
    (manifest.agentDefinitions ?? [])
      .filter((e) => e.agents.includes("antigravity"))
      .map((e) => e.name),
  );
  for (const entry of manifest.mcpServers ?? []) {
    if (!entry.agents.includes("antigravity")) continue;
    if (defNames.has(entry.name)) {
      warnings.push({
        kind: "collision",
        message: `agentDefinitions entry "${entry.name}" and mcpServers entry "${entry.name}" for agent "antigravity" both resolve to {repo}/.agents/rules/${entry.name}.md — one will silently overwrite the other; use different names or remove one entry`,
      });
    }
  }
  return warnings;
}

function assertNoAntigravityPathCollisions(manifest: Manifest): void {
  const collisions = checkAntigravityPathCollisions(manifest);
  if (collisions.length === 0) return;
  throw new UserError(
    "MANIFEST_INVALID",
    collisions.map((warning) => warning.message).join("; "),
  );
}

async function planSkillDirActions(
  manifest: Manifest,
  sourceDir: string,
  resolvedSourceDir: string,
  realRoot: string,
  detectedAgents: AgentId[],
  home: string,
): Promise<{ actions: SkillDirDeployAction[]; warnings: PlanWarning[] }> {
  const method = getDeployMethod();
  const actions: SkillDirDeployAction[] = [];
  const warnings: PlanWarning[] = [];

  async function planSkillEntry(
    skill: Manifest["skills"][number],
  ): Promise<void> {
    const targetAgents = skill.agents.filter((agentId) =>
      detectedAgents.includes(agentId),
    );
    if (targetAgents.length === 0) return;

    const source = path.resolve(sourceDir, skill.path);
    await validateSourcePath(source, skill.path, resolvedSourceDir, realRoot);
    await validateSkillContract(source, skill.path);

    for (const agentId of targetAgents) {
      const plan = planCapabilityForDeploy({
        agentId,
        capability: "skills",
        entryName: skill.name,
        targetAgentIds: targetAgents,
      });
      if (plan.outcome === "warn") {
        warnings.push(plan.warning);
        continue;
      }
      if (plan.outcome === "native" || plan.outcome === "redundant") continue;

      const agent = AGENT_REGISTRY_BY_ID[agentId];
      if (!agent) continue;
      actions.push({
        kind: "skill-dir",
        skill: skill.name,
        agent: agentId,
        source,
        target: resolveAgentSkillPath(agent, skill.name, home),
        method,
        confidence: plan.confidence ?? "provisional",
      });
    }
  }

  for (const skill of manifest.skills) {
    await planSkillEntry(skill);
  }
  return { actions, warnings };
}

async function planFileWriteActions(
  manifest: Manifest,
  sourceDir: string,
  resolvedSourceDir: string,
  realRoot: string,
  detectedAgents: AgentId[],
  home: string,
  repo: string,
  workspace?: string,
): Promise<FileWriteDeployAction[]> {
  const actions: FileWriteDeployAction[] = [];
  for (const fileEntry of manifest.files ?? []) {
    const targetAgents = fileEntry.agents.filter((agentId) =>
      detectedAgents.includes(agentId),
    );
    if (targetAgents.length === 0) continue;

    const source = path.resolve(sourceDir, fileEntry.path);
    await validateSourcePath(
      source,
      fileEntry.path,
      resolvedSourceDir,
      realRoot,
    );
    await validateSourceFile(source, fileEntry.path);
    for (const agentId of targetAgents) {
      const agent = AGENT_REGISTRY_BY_ID[agentId];
      if (!agent) continue;
      actions.push({
        kind: "file-write",
        skill: fileEntry.name,
        agent: agentId,
        source,
        target: resolveTargetTemplate(fileEntry.target, home, repo, workspace),
        confidence: agent.provenance.skills,
      });
    }
  }
  return actions;
}

function planConfigPatchActions(
  manifest: Manifest,
  detectedAgents: AgentId[],
  home: string,
  repo: string,
  workspace?: string,
): ConfigPatchDeployAction[] {
  const actions: ConfigPatchDeployAction[] = [];
  for (const configEntry of manifest.configs ?? []) {
    for (const agentId of configEntry.agents) {
      if (!detectedAgents.includes(agentId)) continue;
      const agent = AGENT_REGISTRY_BY_ID[agentId];
      if (!agent) continue;
      actions.push({
        kind: "config-patch",
        skill: configEntry.name,
        agent: agentId,
        target: resolveTargetTemplate(
          configEntry.target,
          home,
          repo,
          workspace,
        ),
        patch: configEntry.patch,
        confidence: agent.provenance.skills,
      });
    }
  }
  return actions;
}

export async function planDeploy(
  manifest: Manifest,
  sourceDir: string,
  detectedAgents: AgentId[],
  home: string,
  repo?: string,
  workspace?: string,
): Promise<{ actions: DeployAction[]; warnings: PlanWarning[] }> {
  assertNoAntigravityPathCollisions(manifest);

  const resolvedSourceDir = path.resolve(sourceDir);
  let realRoot: string;
  try {
    realRoot = await realpath(resolvedSourceDir);
  } catch {
    realRoot = resolvedSourceDir;
  }

  const repoDir = repo ?? realRoot;
  const skillPlan = await planSkillDirActions(
    manifest,
    sourceDir,
    resolvedSourceDir,
    realRoot,
    detectedAgents,
    home,
  );

  const actions: DeployAction[] = [
    ...skillPlan.actions,
    ...(await planFileWriteActions(
      manifest,
      sourceDir,
      resolvedSourceDir,
      realRoot,
      detectedAgents,
      home,
      repoDir,
      workspace,
    )),
    ...planConfigPatchActions(
      manifest,
      detectedAgents,
      home,
      repoDir,
      workspace,
    ),
  ];

  const adapterResult = await compileAdapterActions(
    manifest.mcpServers,
    manifest.agentRules,
    manifest.permissions ?? [],
    sourceDir,
    resolvedSourceDir,
    realRoot,
    detectedAgents,
    home,
    repoDir,
    manifest.agentDefinitions ?? [],
    workspace,
  );
  actions.push(...adapterResult.actions);

  const warnings: PlanWarning[] = [
    ...skillPlan.warnings,
    ...detectAmbiguities(detectedAgents, manifest),
    ...checkAntigravityPathCollisions(manifest),
    ...detectCollisions(actions),
    ...adapterResult.warnings,
  ];

  return { actions, warnings };
}

export async function executeDeploy(
  actions: DeployAction[],
  dryRun: boolean,
  verbose: boolean,
  home: string,
  deps: DeployDependencies = {},
): Promise<{
  succeeded: number;
  failed: Array<{ action: DeployAction; error: string }>;
  planned: PlannedChange[];
}> {
  let succeeded = 0;
  const failed: Array<{ action: DeployAction; error: string }> = [];
  const planned: PlannedChange[] = [];

  for (const action of actions) {
    const result = await dispatchDeployAction(
      action,
      dryRun,
      verbose,
      home,
      planned,
      deps,
    );
    if (result.error === null) {
      succeeded++;
    } else {
      failed.push({ action, error: result.error });
    }
  }

  return { succeeded, failed, planned };
}

async function dispatchDeployAction(
  action: DeployAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
  deps: DeployDependencies,
): Promise<{ error: string | null }> {
  switch (action.kind) {
    case "skill-dir":
      return deploySkillDir(action, dryRun, verbose, home, planned, deps);
    case "file-write":
      return deployFileWrite(action, dryRun, verbose, home, planned, deps);
    case "config-patch":
      return deployConfigPatch(action, dryRun, verbose, home, planned, deps);
    case "toml-patch":
      return deployTomlPatch(action, dryRun, verbose, home, planned, deps);
    case "frontmatter-emit":
      return deployFrontmatterEmit(
        action,
        dryRun,
        verbose,
        home,
        planned,
        deps,
      );
    default:
      throw new Error(
        `Unhandled deploy action kind: ${(action as DeployAction).kind}`,
      );
  }
}
interface SkillDirOps {
  createTarget(action: SkillDirDeployAction): Promise<void>;
  removeTarget(targetPath: string): Promise<void>;
}

interface DeployFileOps {
  copyFile(source: string, target: string): Promise<void>;
  rename(source: string, target: string): Promise<void>;
  rm(
    targetPath: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>;
  writeFile(
    filePath: string,
    content: string,
    encoding: BufferEncoding,
  ): Promise<void>;
}

interface DeployDependencies {
  registry?: RegistryPersistence;
  skillDirOps?: SkillDirOps;
  fileOps?: DeployFileOps;
}

const defaultSkillDirOps: SkillDirOps = {
  async createTarget(action) {
    if (action.method === "symlink") {
      await symlink(action.source, action.target, "dir");
    } else {
      await cp(action.source, action.target, { recursive: true });
    }
  },
  async removeTarget(targetPath) {
    const stat = await lstat(targetPath);
    if (stat.isSymbolicLink()) {
      await unlink(targetPath);
    } else {
      await rm(targetPath, { recursive: true });
    }
  },
};

const defaultDeployFileOps: DeployFileOps = {
  copyFile,
  rename,
  rm,
  writeFile,
};

async function removeFileSystemTarget(targetPath: string): Promise<void> {
  const stat = await lstat(targetPath);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    await rm(targetPath, { recursive: true });
  } else {
    await unlink(targetPath);
  }
}

async function backupManagedFileWriteTarget(
  action: FileWriteDeployAction,
  home: string,
  deps: DeployDependencies,
): Promise<string | null> {
  try {
    await lstat(action.target);
  } catch {
    return null;
  }

  const isOwned = await verifyDeployment(
    home,
    action.target,
    {
      kind: "file-write",
      source: action.source,
      skill: action.skill,
      agent: action.agent,
    },
    deps.registry,
  );
  if (!isOwned) {
    throw new Error(
      `Target "${action.target}" exists but is not managed by inception-engine — refusing to overwrite`,
    );
  }

  const backupPath = `${action.target}.inception-backup`;
  await (deps.fileOps ?? defaultDeployFileOps).rm(backupPath, {
    recursive: true,
    force: true,
  });
  await (deps.fileOps ?? defaultDeployFileOps).rename(
    action.target,
    backupPath,
  );
  return backupPath;
}

function createAtomicTempPath(targetPath: string): string {
  return `${targetPath}.inception-tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

async function replaceFileAtomically(
  targetPath: string,
  deps: DeployDependencies,
  stageTempFile: (tempPath: string, fileOps: DeployFileOps) => Promise<void>,
  prepareBackup: () => Promise<string | null>,
  commit: () => Promise<void>,
): Promise<void> {
  const fileOps = deps.fileOps ?? defaultDeployFileOps;
  const tempPath = createAtomicTempPath(targetPath);
  let backupPath: string | null = null;
  let replacedTarget = false;

  try {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await stageTempFile(tempPath, fileOps);
    backupPath = await prepareBackup();
    await fileOps.rename(tempPath, targetPath);
    replacedTarget = true;
    await commit();
  } catch (writeErr) {
    if (replacedTarget) {
      try {
        await removeFileSystemTarget(targetPath);
      } catch {
        /* best-effort cleanup */
      }
    } else {
      try {
        await fileOps.rm(tempPath, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }

    if (backupPath) {
      try {
        await fileOps.rename(backupPath, targetPath);
      } catch {
        /* best-effort rollback */
      }
    }

    throw writeErr;
  }

  if (backupPath) {
    await fileOps.rm(backupPath, { recursive: true, force: true });
  }
}

async function deploySkillDir(
  action: SkillDirDeployAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
  deps: DeployDependencies,
): Promise<{ error: string | null }> {
  const label = `${action.skill} -> ${action.agent}`;

  try {
    await access(action.source);
  } catch (err) {
    const msg = sourceAccessError(err, action.source);
    logger.fail(label, msg);
    return { error: msg };
  }

  if (dryRun) {
    planned.push({
      verb: action.method === "symlink" ? "create-symlink" : "copy-dir",
      kind: "skill-dir",
      skill: action.skill,
      agent: action.agent,
      source: action.source,
      target: action.target,
      method: action.method,
      confidence: action.confidence,
    });
    return { error: null };
  }

  try {
    await executeDeployAction(action, verbose, home, deps);
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { error: msg };
  }
}

async function deployFileWrite(
  action: FileWriteDeployAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
  deps: DeployDependencies,
): Promise<{ error: string | null }> {
  const label = `${action.skill} -> ${action.agent}`;

  try {
    await access(action.source);
  } catch (err) {
    const msg = sourceAccessError(err, action.source);
    logger.fail(label, msg);
    return { error: msg };
  }

  if (dryRun) {
    planned.push({
      verb: "write-file",
      kind: "file-write",
      skill: action.skill,
      agent: action.agent,
      source: action.source,
      target: action.target,
    });
    return { error: null };
  }

  try {
    await replaceFileAtomically(
      action.target,
      deps,
      (tempPath, fileOps) => fileOps.copyFile(action.source, tempPath),
      () => backupManagedFileWriteTarget(action, home, deps),
      () =>
        registerDeployment(
          home,
          action.target,
          {
            kind: "file-write",
            source: action.source,
            skill: action.skill,
            agent: action.agent,
            migratedFrom: action.migratedFrom,
          },
          deps.registry,
        ),
    );
    logger.ok(label);
    if (verbose) {
      logger.detail(`write-file: ${action.source} -> ${action.target}`);
    }
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { error: msg };
  }
}

async function deployConfigPatch(
  action: ConfigPatchDeployAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
  deps: DeployDependencies,
): Promise<{ error: string | null }> {
  const label = `${action.skill} -> ${action.agent}`;

  if (!isPlainObject(action.patch)) {
    const msg = `Config patch for skill "${action.skill}" must be a plain object`;
    logger.fail(label, msg);
    return { error: msg };
  }

  const patch = action.patch;

  if (dryRun) {
    planned.push({
      verb: "patch-config",
      kind: "config-patch",
      skill: action.skill,
      agent: action.agent,
      target: action.target,
      patch,
    });
    return { error: null };
  }

  try {
    // Guard against double-patching by a different skill/agent
    const existingEntry = await lookupDeployment(
      home,
      action.target,
      deps.registry,
    );
    if (
      existingEntry &&
      (existingEntry.skill !== action.skill ||
        existingEntry.agent !== action.agent)
    ) {
      throw new Error(
        `Config "${action.target}" is already patched by skill "${existingEntry.skill}" for agent "${existingEntry.agent}" — refusing to double-patch`,
      );
    }

    const original = await readJsonConfigFile(action.target);
    const undoPatch = computeUndoPatch(original, patch);
    const patched = applyMergePatch(original, patch);

    await replaceFileAtomically(
      action.target,
      deps,
      (tempPath, fileOps) =>
        fileOps.writeFile(
          tempPath,
          `${JSON.stringify(patched, null, 2)}\n`,
          "utf-8",
        ),
      async () => {
        const backupPath = `${action.target}.inception-backup`;
        await (deps.fileOps ?? defaultDeployFileOps).rm(backupPath, {
          recursive: true,
          force: true,
        });
        await (deps.fileOps ?? defaultDeployFileOps).rename(
          action.target,
          backupPath,
        );
        return backupPath;
      },
      () =>
        registerDeployment(
          home,
          action.target,
          {
            kind: "config-patch",
            patch,
            undoPatch,
            skill: action.skill,
            agent: action.agent,
          },
          deps.registry,
        ),
    );

    logger.ok(label);
    if (verbose) {
      logger.detail(
        `patch-config: applied ${Object.keys(patch).length} key(s) to ${action.target}`,
      );
    }
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { error: msg };
  }
}
async function deployTomlPatch(
  action: TomlPatchDeployAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
  deps: DeployDependencies,
): Promise<{ error: string | null }> {
  const label = `${action.skill} -> ${action.agent}`;

  if (dryRun) {
    planned.push({
      verb: "patch-toml",
      kind: "toml-patch",
      skill: action.skill,
      agent: action.agent,
      target: action.target,
      patch: action.config,
    });
    return { error: null };
  }

  try {
    const { previousValue } = await (deps.registry
      ? Promise.resolve({ previousValue: null })
      : (await import("./adapters/toml.ts")).applyTomlMcpPatch(
          action.target,
          action.skill,
          action.config,
        ));
    // Note: To truly support custom deps here we'd need to refactor toml adapter to accept deps.
    // For now we assume standard adapter for TOML.

    await registerDeployment(
      home,
      action.target,
      {
        kind: "config-patch",
        patch: action.config,
        undoPatch: { mcpServers: { [action.skill]: previousValue } },
        skill: action.skill,
        agent: action.agent,
      },
      deps.registry,
    );

    logger.ok(label);
    if (verbose) {
      logger.detail(`patch-toml: ${action.target}`);
    }
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { error: msg };
  }
}

async function deployFrontmatterEmit(
  action: FrontmatterEmitDeployAction,
  dryRun: boolean,
  verbose: boolean,
  home: string,
  planned: PlannedChange[],
  deps: DeployDependencies,
): Promise<{ error: string | null }> {
  const label = `${action.skill} -> ${action.agent}`;

  if (!isPlainObject(action.frontmatter)) {
    const msg = `Frontmatter patch for skill "${action.skill}" must be a plain object`;
    logger.fail(label, msg);
    return { error: msg };
  }

  if (dryRun) {
    planned.push({
      verb: "emit-frontmatter",
      kind: "frontmatter-emit",
      skill: action.skill,
      agent: action.agent,
      target: action.target,
      frontmatter: action.frontmatter,
    });
    return { error: null };
  }

  try {
    const existingEntry = await lookupDeployment(
      home,
      action.target,
      deps.registry,
    );
    if (
      existingEntry &&
      (existingEntry.kind !== "frontmatter-emit" ||
        existingEntry.skill !== action.skill ||
        existingEntry.agent !== action.agent)
    ) {
      throw new Error(
        `Frontmatter target "${action.target}" is already patched by skill "${existingEntry.skill}" for agent "${existingEntry.agent}" — refusing to double-patch`,
      );
    }

    const frontmatterAdapter = await import("./adapters/frontmatter.ts");
    const existing = await frontmatterAdapter.readFrontmatterDocumentFile(
      action.target,
    );
    const undoPatch = computeUndoPatch(existing.attributes, action.frontmatter);
    const patchedFrontmatter = applyMergePatch(
      existing.attributes,
      action.frontmatter,
    );
    const content = frontmatterAdapter.buildMarkdownDocument(
      patchedFrontmatter,
      existing.body,
      { hasFrontmatter: true },
    );

    await replaceFileAtomically(
      action.target,
      deps,
      (tempPath, fileOps) => fileOps.writeFile(tempPath, content, "utf-8"),
      async () => {
        try {
          await lstat(action.target);
        } catch {
          return null;
        }
        const backupPath = `${action.target}.inception-backup`;
        await (deps.fileOps ?? defaultDeployFileOps).rm(backupPath, {
          recursive: true,
          force: true,
        });
        await (deps.fileOps ?? defaultDeployFileOps).rename(
          action.target,
          backupPath,
        );
        return backupPath;
      },
      () =>
        registerDeployment(
          home,
          action.target,
          {
            kind: "frontmatter-emit",
            patch: action.frontmatter,
            undoPatch,
            created: !existing.exists,
            hadFrontmatter: existing.hasFrontmatter,
            skill: action.skill,
            agent: action.agent,
          },
          deps.registry,
        ),
    );

    logger.ok(label);
    if (verbose) {
      logger.detail(`emit-frontmatter: ${action.target}`);
    }
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fail(label, msg);
    return { error: msg };
  }
}

async function validateSkillContract(
  source: string,
  skillPath: string,
): Promise<void> {
  let stat: import("node:fs").Stats;
  try {
    stat = await lstat(source);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new UserError(
        "DEPLOY_FAILED",
        `Skill "${skillPath}" source not found: ${source}`,
      );
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new UserError(
        "DEPLOY_FAILED",
        `Permission denied accessing skill "${skillPath}" source: ${source}`,
      );
    }
    throw new UserError(
      "DEPLOY_FAILED",
      `Cannot access skill "${skillPath}" source: ${source}`,
    );
  }
  if (!stat.isDirectory()) {
    throw new UserError(
      "DEPLOY_FAILED",
      `Skill "${skillPath}" source is not a directory: ${source}`,
    );
  }
  try {
    await access(source, constants.R_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new UserError(
        "DEPLOY_FAILED",
        `Permission denied reading skill directory "${skillPath}": ${source}`,
      );
    }
    throw new UserError(
      "DEPLOY_FAILED",
      `Cannot read skill directory "${skillPath}": ${source}`,
    );
  }
  try {
    await access(path.join(source, "SKILL.md"), constants.R_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new UserError(
        "DEPLOY_FAILED",
        `Permission denied reading SKILL.md in skill "${skillPath}": ${source}`,
      );
    }
    throw new UserError(
      "DEPLOY_FAILED",
      `Skill "${skillPath}" source is missing SKILL.md: ${source}`,
    );
  }
  await validateSkillDefinitionFile(path.join(source, "SKILL.md"), skillPath);
}

async function assertTargetAbsent(targetPath: string): Promise<void> {
  try {
    await lstat(targetPath);
    throw new Error(
      `Target path appeared unexpectedly after backup: ${targetPath}`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Target path appeared"))
      throw err;
    // ENOENT is expected — target should not exist after backup
  }
}

async function createDeployTarget(
  action: SkillDirDeployAction,
  home: string,
  deps: DeployDependencies,
): Promise<void> {
  await (deps.skillDirOps ?? defaultSkillDirOps).createTarget(action);
  await registerDeployment(
    home,
    action.target,
    {
      kind: action.kind,
      source: action.source,
      skill: action.skill,
      agent: action.agent,
      method: action.method,
    },
    deps.registry,
  );
}

async function executeDeployAction(
  action: SkillDirDeployAction,
  verbose: boolean,
  home: string,
  deps: DeployDependencies,
): Promise<void> {
  const label = `${action.skill} -> ${action.agent}`;
  const backupPath = await backupExisting(
    action.target,
    verbose,
    home,
    {
      kind: action.kind,
      source: action.source,
      skill: action.skill,
      agent: action.agent,
    },
    deps,
  );
  await mkdir(path.dirname(action.target), { recursive: true });

  try {
    await assertTargetAbsent(action.target);
    await createDeployTarget(action, home, deps);
  } catch (createErr) {
    if (backupPath) {
      try {
        await (deps.skillDirOps ?? defaultSkillDirOps)
          .removeTarget(action.target)
          .catch(() => {
            /* best-effort cleanup */
          });
        await rename(backupPath, action.target);
      } catch {
        // Best-effort rollback
      }
    }
    throw createErr;
  }

  if (backupPath) {
    await (deps.skillDirOps ?? defaultSkillDirOps).removeTarget(backupPath);
  }

  logger.ok(label);
  if (verbose) {
    logger.detail(`${action.method}: ${action.source} -> ${action.target}`);
  }
}

async function backupExisting(
  targetPath: string,
  verbose: boolean,
  home: string,
  expected: { kind: string; source: string; skill: string; agent: AgentId },
  deps: DeployDependencies,
): Promise<string | null> {
  try {
    await lstat(targetPath);
  } catch {
    return null;
  }

  if (
    !(await verifyDeployment(
      home,
      targetPath,
      {
        kind: "skill-dir",
        source: expected.source,
        skill: expected.skill,
        agent: expected.agent,
      },
      deps.registry,
    ))
  ) {
    throw new Error(
      `Target "${targetPath}" exists but is not managed by inception-engine — refusing to overwrite`,
    );
  }

  const backupPath = `${targetPath}.inception-backup`;

  if (verbose) {
    logger.detail(`backing up existing target: ${targetPath}`);
  }

  // Remove any stale backup from a previous failed attempt. Using rm with
  // { force: true } avoids a separate lstat existence check and handles
  // the case where the stale backup is a directory (which rename cannot
  // atomically replace on POSIX). This reduces the window between the
  // stale-backup removal and the rename to a single step.
  await rm(backupPath, { recursive: true, force: true });
  await rename(targetPath, backupPath);
  return backupPath;
}
