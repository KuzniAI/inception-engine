import type { CliOptions, Manifest } from "../types.ts";

export interface PreflightWarning {
  kind: "policy" | "config-authority" | "info";
  message: string;
}

export async function runPreflight(
  _options: CliOptions,
  _manifest: Manifest,
  _home: string,
): Promise<PreflightWarning[]> {
  // Extension point for future enterprise policy checks.
  // Future additions: check for local-config overrides, policy files,
  // agent version constraints, etc.
  return [];
}
