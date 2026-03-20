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

const USAGE = `
inception-engine - Deploy AI agent skills

Usage:
  inception-engine <directory> [options]
  inception-engine revert <directory> [options]

Options:
  --dry-run        Show what would be done without doing it
  --agents <list>  Comma-separated list of agent IDs to target
  --verbose        Show detailed output
  --help           Show this help message

Supported agents:
  ${AGENT_REGISTRY.map((a) => `${a.id} (${a.displayName})`).join(", ")}
`.trim();

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    return { command: "help", directory: "", dryRun: false, agents: null, verbose: false };
  }

  let command: "deploy" | "revert" = "deploy";
  let directory = "";
  let dryRun = false;
  let agents: AgentId[] | null = null;
  let verbose = false;

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
    } else if (arg === "--agents") {
      i++;
      const next = args[i];
      if (!next) {
        console.error("--agents requires a comma-separated list");
        process.exit(1);
      }
      const ids = next.split(",").map((s) => s.trim());
      for (const id of ids) {
        if (!AGENT_IDS.includes(id as AgentId)) {
          console.error(`Unknown agent: "${id}". Valid agents: ${AGENT_IDS.join(", ")}`);
          process.exit(1);
        }
      }
      agents = ids as AgentId[];
    } else if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else if (!directory) {
      directory = arg;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
    i++;
  }

  if (!directory) {
    console.error("Missing required <directory> argument");
    process.exit(1);
  }

  return { command, directory: path.resolve(directory), dryRun, agents, verbose };
}

function main(): void {
  const options = parseArgs(process.argv);

  if (options.command === "help") {
    console.log(USAGE);
    process.exit(0);
  }

  const manifest = loadManifest(options.directory);
  const home = resolveHome();

  let detectedAgents: AgentId[];
  if (options.agents) {
    detectedAgents = options.agents;
    if (options.verbose) {
      console.log(`Using specified agents: ${detectedAgents.join(", ")}`);
    }
  } else {
    detectedAgents = detectInstalledAgents(home);
    if (detectedAgents.length === 0) {
      console.log("No supported AI agents detected on this system.");
      console.log(`Install one of: ${AGENT_REGISTRY.map((a) => a.displayName).join(", ")}`);
      process.exit(0);
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
      return;
    }

    console.log(`${prefix}Deploying ${actions.length} skill(s):`);
    const { succeeded, failed } = executeDeploy(actions, options.dryRun, options.verbose);

    console.log();
    if (failed.length > 0) {
      console.log(`${succeeded} succeeded, ${failed.length} failed`);
      process.exit(1);
    } else {
      console.log(`${succeeded} skill(s) deployed${options.dryRun ? " (dry-run)" : ""}`);
    }
  } else {
    const actions = planRevert(manifest, detectedAgents, home);
    if (actions.length === 0) {
      console.log("No skills to revert for detected agents.");
      return;
    }

    console.log(`${prefix}Reverting ${actions.length} skill(s):`);
    const { succeeded, skipped } = executeRevert(actions, options.dryRun, options.verbose);

    console.log();
    const parts = [`${succeeded} removed`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    console.log(`${parts.join(", ")}${options.dryRun ? " (dry-run)" : ""}`);
  }
}

main();
