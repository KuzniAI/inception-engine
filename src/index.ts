#!/usr/bin/env node

import path from "node:path";
import { AGENT_IDS } from "./types.ts";
import type { AgentId, CliOptions } from "./types.ts";
import { loadManifest } from "./config/manifest.ts";
import { AGENT_REGISTRY } from "./config/agents.ts";
import { resolveHome } from "./core/resolve.ts";
import { detectInstalledAgents } from "./core/detect.ts";
import { planDeploy, executeDeploy } from "./core/deploy.ts";
import { planRevert, executeRevert } from "./core/revert.ts";
import { UserError } from "./errors.ts";
import type { ErrorCode } from "./errors.ts";

const USAGE = `
inception-engine - Deploy AI agent skills

Usage:
  inception-engine <directory> [options]
  inception-engine revert <directory> [options]

Options:
  --dry-run        Show what would be done without doing it
  --agents <list>  Comma-separated list of agent IDs to target
  --verbose        Show detailed output
  --debug          Show full error stack traces
  --help           Show this help message

Supported agents:
  ${AGENT_REGISTRY.map((a) => `${a.id} (${a.displayName})`).join(", ")}
`.trim();

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    return { command: "help", directory: "", dryRun: false, agents: null, verbose: false, debug: false };
  }

  let command: "deploy" | "revert" = "deploy";
  let directory = "";
  let dryRun = false;
  let agents: AgentId[] | null = null;
  let verbose = false;
  let debug = false;

  let i = 0;
  if (args[0] === "revert") {
    command = "revert";
    i = 1;
  }

  while (i < args.length) {
    const arg = args[i]!;

    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg === "--agents") {
      i++;
      const next = args[i];
      if (!next) {
        throw new UserError("INVALID_ARGS", "--agents requires a comma-separated list");
      }
      const ids = next.split(",").map((s) => s.trim());
      for (const id of ids) {
        if (!AGENT_IDS.includes(id as AgentId)) {
          throw new UserError("INVALID_ARGS", `Unknown agent: "${id}". Valid agents: ${AGENT_IDS.join(", ")}`);
        }
      }
      agents = ids as AgentId[];
    } else if (arg.startsWith("--")) {
      throw new UserError("INVALID_ARGS", `Unknown option: ${arg}`);
    } else if (!directory) {
      directory = arg;
    } else {
      throw new UserError("INVALID_ARGS", `Unexpected argument: ${arg}`);
    }
    i++;
  }

  if (!directory) {
    throw new UserError("INVALID_ARGS", "Missing required <directory> argument");
  }

  return { command, directory: path.resolve(directory), dryRun, agents, verbose, debug };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv);

  if (options.command === "help") {
    console.log(USAGE);
    return 0;
  }

  const manifest = await loadManifest(options.directory);
  const home = resolveHome();

  let detectedAgents: AgentId[];
  if (options.agents) {
    detectedAgents = options.agents;
    if (options.verbose) {
      console.log(`Using specified agents: ${detectedAgents.join(", ")}`);
    }
  } else {
    detectedAgents = await detectInstalledAgents(home);
    if (detectedAgents.length === 0) {
      console.log("No supported AI agents detected on this system.");
      console.log(`Install one of: ${AGENT_REGISTRY.map((a) => a.displayName).join(", ")}`);
      return 0;
    }
    if (options.verbose) {
      console.log(`Detected agents: ${detectedAgents.join(", ")}`);
    }
  }

  const prefix = options.dryRun ? "\x1b[36m[dry-run]\x1b[0m " : "";

  if (options.command === "deploy") {
    const actions = planDeploy(manifest, options.directory, detectedAgents, home);
    if (actions.length === 0) {
      console.log("No skills to deploy for detected agents.");
      return 0;
    }

    console.log(`${prefix}Deploying ${actions.length} skill(s):`);
    const { succeeded, failed } = await executeDeploy(actions, options.dryRun, options.verbose);

    console.log();
    if (failed.length > 0) {
      console.log(`${succeeded} succeeded, ${failed.length} failed`);
      return 1;
    } else {
      console.log(`${succeeded} skill(s) deployed${options.dryRun ? " (dry-run)" : ""}`);
    }
  } else {
    const actions = planRevert(manifest, detectedAgents, home);
    if (actions.length === 0) {
      console.log("No skills to revert for detected agents.");
      return 0;
    }

    console.log(`${prefix}Reverting ${actions.length} skill(s):`);
    const { succeeded, skipped } = await executeRevert(actions, options.dryRun, options.verbose);

    console.log();
    const parts = [`${succeeded} removed`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    console.log(`${parts.join(", ")}${options.dryRun ? " (dry-run)" : ""}`);
  }

  return 0;
}

const USER_ERROR_EXIT: Record<ErrorCode, number> = {
  INVALID_ARGS: 2,
  MANIFEST_INVALID: 3,
  DEPLOY_FAILED: 1,
  RESOLVE_FAILED: 1,
};

const debugMode = process.argv.includes("--debug");

try {
  process.exit(await main());
} catch (err) {
  if (err instanceof UserError) {
    console.error(`Error: ${err.message}`);
    if (debugMode) {
      console.error(err);
    }
    process.exit(USER_ERROR_EXIT[err.code]);
  } else {
    console.error("Unexpected error. Run with --debug for details.");
    if (debugMode) {
      console.error(err);
    }
    process.exit(1);
  }
}
