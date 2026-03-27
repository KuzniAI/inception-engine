#!/usr/bin/env node

import path from "node:path";
import { parseArgs } from "node:util";
import { AGENT_REGISTRY } from "./config/agents.ts";
import { loadManifest } from "./config/manifest.ts";
import { executeDeploy, planDeploy } from "./core/deploy.ts";
import { detectInstalledAgents } from "./core/detect.ts";
import { resolveHome } from "./core/resolve.ts";
import { executeRevert, planRevert, planRevertAll } from "./core/revert.ts";
import type { ErrorCode } from "./errors.ts";
import { UserError } from "./errors.ts";
import { dryRunPrefix, logger } from "./logger.ts";
import { AGENT_IDS, AgentIdSchema } from "./schemas/manifest.ts";
import type { AgentId, CliOptions, Manifest } from "./types.ts";

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

function parseCLI(argv: string[]): CliOptions {
  const args = argv.slice(2);

  if (args.length === 0) {
    return {
      command: "help",
      directory: "",
      dryRun: false,
      agents: null,
      verbose: false,
      debug: false,
    };
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        "dry-run": { type: "boolean", default: false },
        verbose: { type: "boolean", default: false },
        debug: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
        agents: { type: "string" },
      },
    });
  } catch (err) {
    throw new UserError("INVALID_ARGS", (err as Error).message);
  }

  const { values, positionals } = parsed;

  if (values.help) {
    return {
      command: "help",
      directory: "",
      dryRun: false,
      agents: null,
      verbose: false,
      debug: false,
    };
  }

  let command: "deploy" | "revert" = "deploy";
  let pos = positionals;
  if (pos[0] === "revert") {
    command = "revert";
    pos = pos.slice(1);
  }

  if (pos.length > 1) {
    throw new UserError("INVALID_ARGS", `Unexpected argument: ${pos[1]}`);
  }
  const rawDir = pos[0];
  if (!rawDir) {
    throw new UserError(
      "INVALID_ARGS",
      "Missing required <directory> argument",
    );
  }

  let agents: AgentId[] | null = null;
  if (typeof values.agents === "string") {
    agents = values.agents
      .split(",")
      .map((s) => s.trim())
      .map((id) => {
        const r = AgentIdSchema.safeParse(id);
        if (!r.success) {
          throw new UserError(
            "INVALID_ARGS",
            `Unknown agent: "${id}". Valid agents: ${AGENT_IDS.join(", ")}`,
          );
        }
        return r.data;
      });
  }

  return {
    command,
    directory: path.resolve(rawDir),
    dryRun: values["dry-run"] as boolean,
    agents,
    verbose: values.verbose as boolean,
    debug: values.debug as boolean,
  };
}

async function main(): Promise<number> {
  const options = parseCLI(process.argv);

  if (options.command === "help") {
    console.log(USAGE);
    return 0;
  }

  const manifest = await loadManifest(options.directory);
  const home = resolveHome();

  if (options.command === "deploy") {
    return runDeploy(options, manifest, home);
  }
  return runRevert(options, manifest, home);
}

async function runDeploy(
  options: CliOptions,
  manifest: Manifest,
  home: string,
): Promise<number> {
  let detectedAgents: AgentId[];
  if (options.agents) {
    detectedAgents = options.agents;
    if (options.verbose) {
      logger.info(`Using specified agents: ${detectedAgents.join(", ")}`);
    }
  } else {
    detectedAgents = await detectInstalledAgents(home);
    if (detectedAgents.length === 0) {
      logger.info("No supported AI agents detected on this system.");
      logger.info(
        `Install one of: ${AGENT_REGISTRY.map((a) => a.displayName).join(", ")}`,
      );
      return 0;
    }
    if (options.verbose) {
      logger.info(`Detected agents: ${detectedAgents.join(", ")}`);
    }
  }

  const actions = await planDeploy(
    manifest,
    options.directory,
    detectedAgents,
    home,
  );
  if (actions.length === 0) {
    logger.info("No skills to deploy for detected agents.");
    return 0;
  }

  logger.info(
    `${dryRunPrefix(options.dryRun)}Deploying ${actions.length} skill(s):`,
  );
  const { succeeded, failed } = await executeDeploy(
    actions,
    options.dryRun,
    options.verbose,
    home,
  );

  logger.info("");
  if (failed.length > 0) {
    logger.info(`${succeeded} succeeded, ${failed.length} failed`);
    return 1;
  }
  logger.info(
    `${succeeded} skill(s) deployed${options.dryRun ? " (dry-run)" : ""}`,
  );
  return 0;
}

async function runRevert(
  options: CliOptions,
  manifest: Manifest,
  home: string,
): Promise<number> {
  const actions = options.agents
    ? planRevert(manifest, options.agents, home)
    : planRevertAll(manifest, home);
  if (actions.length === 0) {
    logger.info("No skills to revert.");
    return 0;
  }

  logger.info(
    `${dryRunPrefix(options.dryRun)}Reverting ${actions.length} skill(s):`,
  );
  const { succeeded, skipped } = await executeRevert(
    actions,
    options.dryRun,
    options.verbose,
    home,
  );

  logger.info("");
  const parts = [`${succeeded} removed`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  logger.info(`${parts.join(", ")}${options.dryRun ? " (dry-run)" : ""}`);
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
    logger.error(`Error: ${err.message}`);
    if (debugMode) {
      logger.errorRaw(err);
    }
    process.exit(USER_ERROR_EXIT[err.code]);
  } else {
    logger.error("Unexpected error. Run with --debug for details.");
    if (debugMode) {
      logger.errorRaw(err);
    }
    process.exit(1);
  }
}
