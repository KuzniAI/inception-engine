import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../config/agents.ts";
import type { AgentId, CliOptions, Manifest } from "../types.ts";
import {
  describeCapabilityConfidence,
  planCapabilityForDeploy,
} from "./capabilities.ts";
import { resolveRuntimePaths } from "./runtime-paths.ts";

export interface PreflightWarning {
  kind: "policy" | "config-authority" | "info" | "precedence" | "budget";
  message: string;
}

const BUDGET_WARN_BYTES = 50 * 1024; // 50 KB

async function detectEnterpriseManagement(
  agentId: AgentId,
  home: string,
): Promise<string | null> {
  if (!AGENT_REGISTRY_BY_ID[agentId]?.enterprisePolicyDetection) return null;

  // Check for common GitHub Enterprise environment variables
  if (
    process.env.GITHUB_ENTERPRISE_URL ||
    process.env.GH_ENTERPRISE_TOKEN ||
    process.env.GITHUB_TOKEN_TYPE === "enterprise"
  ) {
    return "GitHub Enterprise environment variables detected. Enterprise policies may override local configurations.";
  }

  const { xdgConfig, localAppdata } = resolveRuntimePaths(home);
  const configPath =
    process.platform === "win32"
      ? path.join(localAppdata, "github-copilot", "hosts.json")
      : path.join(xdgConfig, "github-copilot", "hosts.json");

  try {
    const content = await readFile(configPath, "utf8");
    const hosts = JSON.parse(content);
    const hostNames = Object.keys(hosts);

    const enterpriseHosts = hostNames.filter(
      (h) => h !== "github.com" && h !== "localhost",
    );

    if (enterpriseHosts.length > 0) {
      return `GitHub Copilot is authenticated against enterprise host(s): ${enterpriseHosts.join(", ")}. Enterprise policies may override local configurations.`;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code !== "ENOENT" &&
      code !== "EACCES" &&
      code !== "EPERM" &&
      code !== undefined
    ) {
      throw err;
    }
  }

  return null;
}

/**
 * Reads ~/.gemini/settings.json and warns when `instructionFilename` is set
 * to a value other than "GEMINI.md". If the override is in effect, inception-
 * engine's agentRules deployment to GEMINI.md will be silently ignored by the
 * agent at runtime.
 */
async function detectGeminiCustomInstructionFilename(
  home: string,
): Promise<PreflightWarning | null> {
  const settingsPath = path.join(home, ".gemini", "settings.json");
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).instructionFilename ===
        "string"
    ) {
      const configured = (parsed as Record<string, unknown>)
        .instructionFilename as string;
      if (configured !== "GEMINI.md") {
        return {
          kind: "config-authority",
          message: `Agent "gemini-cli": settings.json sets instructionFilename to "${configured}" but inception-engine deploys agentRules to "GEMINI.md". The deployed rules file may not be loaded by the agent. Remove the override or align the deploy target.`,
        };
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "EACCES" && code !== "EPERM") {
      throw err;
    }
  }
  return null;
}

function groupRulesByPath(rulesForAgent: Manifest["agentRules"]) {
  const entriesByPath = new Map<
    string,
    Array<{ name: string; scope: string }>
  >();
  for (const entry of rulesForAgent ?? []) {
    const list = entriesByPath.get(entry.path) ?? [];
    list.push({ name: entry.name, scope: entry.scope });
    entriesByPath.set(entry.path, list);
  }
  return entriesByPath;
}

function detectScopeOverlaps(
  agentId: AgentId,
  rulesForAgent: Manifest["agentRules"],
): PreflightWarning[] {
  const warnings: PreflightWarning[] = [];
  const entriesByPath = groupRulesByPath(rulesForAgent);

  for (const [path, list] of entriesByPath) {
    const scopes = new Set(list.map((l) => l.scope));
    if (scopes.size < 2) continue;

    const scopeList = Array.from(scopes).sort();
    for (let i = 0; i < scopeList.length; i++) {
      for (let j = i + 1; j < scopeList.length; j++) {
        const entryB = list.find((l) => l.scope === scopeList[j]);
        if (entryB) {
          warnings.push({
            kind: "precedence",
            message: `Agent "${agentId}" has agentRules entry "${entryB.name}" deployed to both ${scopeList[i]} and ${scopeList[j]} scope from the same source path "${path}". The file will be written to two distinct targets — verify this is intentional and not a copy-paste mistake.`,
          });
        }
      }
    }
  }
  return warnings;
}

function detectMultipleActiveInstructionScopes(
  agentId: AgentId,
  rulesForAgent: Manifest["agentRules"],
): PreflightWarning[] {
  const activeScopes = Array.from(
    new Set((rulesForAgent ?? []).map((e) => e.scope)),
  ).sort();

  if (activeScopes.length <= 1) return [];

  const scopeDescriptions = activeScopes
    .map((s) => {
      const entries = (rulesForAgent ?? []).filter((e) => e.scope === s);
      return `${s} [${entries.map((e) => `"${e.name}"`).join(", ")}]`;
    })
    .join(" and ");

  return [
    {
      kind: "precedence",
      message: `Agent "${agentId}" will have multiple instruction files active simultaneously across ${activeScopes.length} scopes: ${scopeDescriptions}. All will be loaded by the agent — ensure the content is intended to stack and does not conflict.`,
    },
  ];
}

function detectInstructionPrecedence(
  detectedAgents: AgentId[],
  manifest: Manifest,
): PreflightWarning[] {
  const warnings: PreflightWarning[] = [];

  for (const agentId of detectedAgents) {
    const rulesForAgent = (manifest.agentRules ?? []).filter((e) =>
      e.agents.includes(agentId),
    );

    warnings.push(...detectScopeOverlaps(agentId, rulesForAgent));
    warnings.push(
      ...detectMultipleActiveInstructionScopes(agentId, rulesForAgent),
    );
  }

  return warnings;
}

async function detectInstructionBudgetRisk(
  detectedAgents: AgentId[],
  manifest: Manifest,
  sourceDir: string,
): Promise<PreflightWarning[]> {
  const warnings: PreflightWarning[] = [];
  const checkedPaths = new Set<string>();

  async function checkEntry(
    entryPath: string,
    label: string,
    agentIds: AgentId[],
  ): Promise<void> {
    if (!agentIds.some((id) => detectedAgents.includes(id))) return;
    const sourcePath = path.resolve(sourceDir, entryPath);
    if (checkedPaths.has(sourcePath)) return;
    checkedPaths.add(sourcePath);
    try {
      const fileStat = await stat(sourcePath);
      if (fileStat.size > BUDGET_WARN_BYTES) {
        const sizeKb = (fileStat.size / 1024).toFixed(1);
        warnings.push({
          kind: "budget",
          message: `${label} source "${entryPath}" is ${sizeKb} KB — large instruction files risk crowding out code context in the agent's context window. Consider splitting into smaller focused files.`,
        });
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EACCES" && code !== "EPERM") throw err;
      // Missing/unreadable files are silently skipped; compileAgentRuleActions
      // will produce the proper UserError during action compilation.
    }
  }

  const entries: Array<{ path: string; label: string; agents: AgentId[] }> = [];
  for (const entry of manifest.agentRules ?? []) {
    entries.push({
      path: entry.path,
      label: "agentRules",
      agents: entry.agents,
    });
  }
  for (const entry of manifest.agentDefinitions ?? []) {
    entries.push({
      path: entry.path,
      label: "agentDefinitions",
      agents: entry.agents,
    });
  }

  await Promise.all(entries.map((e) => checkEntry(e.path, e.label, e.agents)));

  return warnings;
}

type CapabilityWarningAccumulator = {
  warnings: PreflightWarning[];
  seen: Set<string>;
};

function pushCapabilityWarning(
  acc: CapabilityWarningAccumulator,
  kind: PreflightWarning["kind"],
  message: string,
): void {
  if (acc.seen.has(`${kind}:${message}`)) return;
  acc.seen.add(`${kind}:${message}`);
  acc.warnings.push({ kind, message });
}

function collectCapabilityWarningsForAgent(
  acc: CapabilityWarningAccumulator,
  agentId: AgentId,
  capability:
    | "skills"
    | "mcpServers"
    | "agentRules"
    | "permissions"
    | "agentDefinitions",
  entryName: string,
  targetAgents: AgentId[],
  scope?: "global" | "repo" | "workspace",
): void {
  const plan = planCapabilityForDeploy({
    agentId,
    capability,
    entryName,
    targetAgentIds: targetAgents,
    scope,
  });
  if (plan.outcome === "warn") {
    pushCapabilityWarning(acc, "info", plan.warning.message);
    return;
  }

  // Evaluate undocumented/planned surfaces warning
  const agent = AGENT_REGISTRY_BY_ID[agentId];
  if (agent?.unsupportedSurfaces) {
    for (const surface of agent.unsupportedSurfaces) {
      if (surface.status === "planned") {
        pushCapabilityWarning(
          acc,
          "info",
          `Agent "${agentId}": ${surface.reason ?? surface.plannedSurface}`,
        );
      } else if (surface.status === "unsupported") {
        pushCapabilityWarning(
          acc,
          "config-authority",
          `Agent "${agentId}": ${surface.reason ?? surface.schemaLabel}`,
        );
      }
    }
  }

  if (capability === "skills") return;

  const confidence = describeCapabilityConfidence(agentId, capability, scope);
  if (confidence.message) {
    pushCapabilityWarning(acc, "config-authority", confidence.message);
  }
}

function collectCapabilityWarningsForTargets(
  acc: CapabilityWarningAccumulator,
  targetAgents: AgentId[],
  capability:
    | "skills"
    | "mcpServers"
    | "agentRules"
    | "permissions"
    | "agentDefinitions",
  entryName: string,
  scope?: "global" | "repo" | "workspace",
): void {
  for (const agentId of targetAgents) {
    collectCapabilityWarningsForAgent(
      acc,
      agentId,
      capability,
      entryName,
      targetAgents,
      scope,
    );
  }
}

function collectManifestCapabilityWarnings(
  manifest: Manifest,
  detectedAgents: AgentId[],
): PreflightWarning[] {
  const acc: CapabilityWarningAccumulator = {
    warnings: [],
    seen: new Set<string>(),
  };

  for (const entry of manifest.skills) {
    collectCapabilityWarningsForTargets(
      acc,
      entry.agents.filter((agentId) => detectedAgents.includes(agentId)),
      "skills",
      entry.name,
    );
  }
  for (const entry of manifest.mcpServers ?? []) {
    collectCapabilityWarningsForTargets(
      acc,
      entry.agents.filter((agentId) => detectedAgents.includes(agentId)),
      "mcpServers",
      entry.name,
      entry.scope,
    );
  }
  for (const entry of manifest.agentRules ?? []) {
    collectCapabilityWarningsForTargets(
      acc,
      entry.agents.filter((agentId) => detectedAgents.includes(agentId)),
      "agentRules",
      entry.name,
      entry.scope,
    );
  }
  for (const entry of manifest.permissions ?? []) {
    collectCapabilityWarningsForTargets(
      acc,
      entry.agents.filter((agentId) => detectedAgents.includes(agentId)),
      "permissions",
      entry.name,
    );
  }
  for (const entry of manifest.agentDefinitions ?? []) {
    collectCapabilityWarningsForTargets(
      acc,
      entry.agents.filter((agentId) => detectedAgents.includes(agentId)),
      "agentDefinitions",
      entry.name,
      entry.scope,
    );
  }

  return acc.warnings;
}

function detectCapabilityPlanningWarnings(
  manifest: Manifest,
  detectedAgents: AgentId[],
): PreflightWarning[] {
  return collectManifestCapabilityWarnings(manifest, detectedAgents);
}

async function collectAgentWarnings(
  agentId: AgentId,
  manifest: Manifest,
  home: string,
): Promise<PreflightWarning[]> {
  const agent = AGENT_REGISTRY_BY_ID[agentId];
  if (!agent) return [];

  const warnings: PreflightWarning[] = [];

  const skillConfidence = describeCapabilityConfidence(agentId, "skills");
  if (
    skillConfidence.confidence === "implementation-only" ||
    skillConfidence.confidence === "provisional"
  ) {
    warnings.push({
      kind: "config-authority",
      message:
        skillConfidence.message ??
        `Agent "${agentId}" skill support is ${skillConfidence.confidence}.`,
    });
  }

  const enterpriseWarning = await detectEnterpriseManagement(agentId, home);
  if (enterpriseWarning) {
    warnings.push({
      kind: "policy",
      message: `Agent "${agentId}": ${enterpriseWarning}`,
    });
  } else if (
    agent.policyNote &&
    !agent.policyNote.includes("Organization policies may override")
  ) {
    warnings.push({
      kind: "policy",
      message: `Agent "${agentId}": ${agent.policyNote}`,
    });
  }

  if (agentId === "gemini-cli") {
    const hasGeminiRules = (manifest.agentRules ?? []).some((e) =>
      e.agents.includes("gemini-cli"),
    );
    if (hasGeminiRules) {
      const filenameWarning = await detectGeminiCustomInstructionFilename(home);
      if (filenameWarning) warnings.push(filenameWarning);
    }
  }

  return warnings;
}

export async function runPreflight(
  options: CliOptions,
  manifest: Manifest,
  home: string,
  detectedAgents: AgentId[],
): Promise<PreflightWarning[]> {
  const warnings: PreflightWarning[] = [];

  for (const agentId of detectedAgents) {
    warnings.push(...(await collectAgentWarnings(agentId, manifest, home)));
  }

  warnings.push(...detectCapabilityPlanningWarnings(manifest, detectedAgents));

  warnings.push(...detectInstructionPrecedence(detectedAgents, manifest));
  warnings.push(
    ...(await detectInstructionBudgetRisk(
      detectedAgents,
      manifest,
      options.directory,
    )),
  );

  return warnings;
}
