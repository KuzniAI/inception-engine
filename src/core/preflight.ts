import { stat } from "node:fs/promises";
import path from "node:path";
import { AGENT_REGISTRY_BY_ID } from "../config/agents.ts";
import type { AgentId, CliOptions, Manifest } from "../types.ts";

export interface PreflightWarning {
  kind: "policy" | "config-authority" | "info" | "precedence" | "budget";
  message: string;
}

const BUDGET_WARN_BYTES = 50 * 1024; // 50 KB

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

  for (const entry of manifest.agentRules ?? []) {
    await checkEntry(entry.path, "agentRules", entry.agents);
  }
  for (const entry of manifest.agentDefinitions ?? []) {
    await checkEntry(entry.path, "agentDefinitions", entry.agents);
  }

  return warnings;
}

export async function runPreflight(
  options: CliOptions,
  manifest: Manifest,
  _home: string,
  detectedAgents: AgentId[],
): Promise<PreflightWarning[]> {
  const warnings: PreflightWarning[] = [];

  for (const agentId of detectedAgents) {
    const agent = AGENT_REGISTRY_BY_ID[agentId];
    if (!agent) continue;
    if (agent.provenance.skills === "implementation-only") {
      warnings.push({
        kind: "config-authority",
        message: `Agent "${agentId}" skill support is implementation-only: paths are derived from source inspection, not published documentation.`,
      });
    } else if (agent.provenance.skills === "provisional") {
      warnings.push({
        kind: "config-authority",
        message: `Agent "${agentId}" skill support is provisional: behavior has not been independently verified.`,
      });
    }
    if (agent.policyNote) {
      warnings.push({
        kind: "policy",
        message: `Agent "${agentId}": ${agent.policyNote}`,
      });
    }
  }

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
