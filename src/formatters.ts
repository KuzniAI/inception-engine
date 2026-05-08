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
  const lines = [`  ${icon} ${change.verb} ${styleText("bold", change.skill)}`];

  if (change.source !== undefined) {
    lines.push(`    source: ${styleText("dim", change.source)}`);
  }
  lines.push(`    target: ${styleText("dim", change.target)}`);

  const detailLines = formatChangeDetail(change);
  if (detailLines) {
    lines.push(...detailLines.map((line) => `    ${line}`));
  }

  return lines.join("\n");
}

function formatChangeDetail(change: PlannedChange): string[] | null {
  if (change.verb === "patch-config" && change.patch !== undefined) {
    return formatJsonDetail("patch", change.patch);
  }
  if (change.verb === "unapply-patch" && change.patch !== undefined) {
    return formatJsonDetail("undo", change.patch);
  }
  if (change.verb === "patch-toml" && change.patch !== undefined) {
    return formatJsonDetail("patch", change.patch);
  }
  if (change.verb === "emit-frontmatter" && change.frontmatter !== undefined) {
    return formatJsonDetail("frontmatter", change.frontmatter);
  }
  return null;
}

function formatJsonDetail(label: string, value: unknown): string[] {
  const jsonLines = JSON.stringify(value, null, 2)
    .split("\n")
    .map((line) => styleText("dim", line));
  return [`${label}:`, ...jsonLines.map((line) => `  ${line}`)];
}
