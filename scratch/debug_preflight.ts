import { runPreflight } from "../src/core/preflight.ts";
import type { Manifest, AgentId } from "../src/types.ts";

const manifest: Manifest = {
  skills: [{ name: "test-skill", agents: ["github-copilot"] as AgentId[] }],
  files: [],
  configs: [],
  mcpServers: [],
  agentRules: [],
  permissions: [],
  agentDefinitions: [],
};

const warnings = await runPreflight(
  {
    command: "deploy",
    directory: ".",
    dryRun: false,
    agents: null,
    verbose: false,
    debug: false,
    force: false,
  },
  manifest,
  process.env.HOME || "/home/test",
  ["github-copilot"],
);

console.log(JSON.stringify(warnings, null, 2));
