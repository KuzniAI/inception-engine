import { styleText } from "node:util";
import type { AgentId, PlannedChange } from "./types.ts";

/**
 * Groups and formats the dry-run plan by agent.
 */
export function formatDryRunPlan(planned: PlannedChange[]): string {
  if (planned.length === 0) return "";

  const groups = new Map<AgentId, PlannedChange[]>();

  for (const change of planned) {
    const list = groups.get(change.agent) ?? [];
    list.push(change);
    groups.set(change.agent, list);
  }

  const sortedAgents = Array.from(groups.keys()).sort();
  const output: string[] = [];

  for (const agent of sortedAgents) {
    output.push(styleText(["bold", "yellow"], agent));

    const changes = groups.get(agent);
    if (!changes) continue;

    for (const change of changes) {
      output.push(formatPlannedChange(change));
    }
    output.push("");
  }

  return output.join("\n");
}

function formatPlannedChange(change: PlannedChange): string {
  const icon = styleText("cyan", "○");
  const kind = styleText("dim", `[${change.kind}]`);
  const lines = [
    `  ${icon} ${kind} ${change.verb} ${styleText("bold", change.skill)}`,
  ];

  if (change.source !== undefined) {
    lines.push(`    source: ${styleText("dim", change.source)}`);
  }
  lines.push(`    target: ${styleText("dim", change.target)}`);

  const detail = formatChangeDetail(change);
  if (detail) {
    lines.push(`    ${detail}`);
  }

  return lines.join("\n");
}

function formatChangeDetail(change: PlannedChange): string | null {
  if (change.verb === "patch-config" && change.patch !== undefined) {
    return `patch:  ${styleText("dim", JSON.stringify(change.patch))}`;
  }
  if (change.verb === "unapply-patch" && change.patch !== undefined) {
    return `undo:   ${styleText("dim", JSON.stringify(change.patch))}`;
  }
  if (change.verb === "patch-toml" && change.patch !== undefined) {
    return `patch:  ${styleText("dim", JSON.stringify(change.patch))}`;
  }
  if (change.verb === "emit-frontmatter" && change.frontmatter !== undefined) {
    return `frontmatter: ${styleText("dim", JSON.stringify(change.frontmatter))}`;
  }
  return null;
}
