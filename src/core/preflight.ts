import { AGENT_REGISTRY_BY_ID } from "../config/agents.ts";
import type { AgentId, CliOptions, Manifest } from "../types.ts";

export interface PreflightWarning {
  kind: "policy" | "config-authority" | "info";
  message: string;
}

export async function runPreflight(
  _options: CliOptions,
  _manifest: Manifest,
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

  return warnings;
}
