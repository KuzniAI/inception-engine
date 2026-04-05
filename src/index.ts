#!/usr/bin/env node

import path from "node:path";
import { parseArgs } from "node:util";
import { AGENT_REGISTRY } from "./config/agents.ts";
import { loadManifest } from "./config/manifest.ts";
import { executeDeploy, planDeploy } from "./core/deploy.ts";
import { detectInstalledAgents } from "./core/detect.ts";
import { runInit } from "./core/init.ts";
import { runPreflight } from "./core/preflight.ts";
import { resolveHome } from "./core/resolve.ts";
import { executeRevert, planRevert, planRevertAll } from "./core/revert.ts";
import type { ErrorCode } from "./errors.ts";
import { UserError } from "./errors.ts";
import { formatDryRunPlan } from "./formatters.ts";
import { dryRunPrefix, logger } from "./logger.ts";
import { AgentListSchema } from "./schemas/manifest.ts";
import type { AgentId, CliOptions, Manifest } from "./types.ts";

const USAGE = `
inception-engine - Deploy AI agent skills

Usage:
  inception-engine <directory> [options]
  inception-engine revert <directory> [options]
  inception-engine init <directory> [options]

Commands:
  <directory>         Deploy skills from the manifest in the given directory
  revert <directory>  Remove previously deployed skills
  init <directory>    Scan a directory for skill folders and generate inception.json

Options:
  --plan           Show what would be done without doing it
  --agents <list>  Comma-separated list of agent IDs to target
  --force          (init only) Overwrite an existing inception.json
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
      force: false,
    };
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        plan: { type: "boolean", default: false },
        verbose: { type: "boolean", default: false },
        debug: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
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
      force: false,
    };
  }

  let command: "deploy" | "revert" | "init" = "deploy";
  let pos = positionals;
  if (pos[0] === "revert") {
    command = "revert";
    pos = pos.slice(1);
  } else if (pos[0] === "init") {
    command = "init";
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
    const r = AgentListSchema.safeParse(values.agents);
    if (!r.success) {
      throw new UserError("INVALID_ARGS", r.error.issues[0].message);
    }
    agents = r.data;
  }

  return {
    command,
    directory: path.resolve(rawDir),
    dryRun: (values.plan || values["dry-run"]) as boolean,
    agents,
    verbose: values.verbose as boolean,
    debug: values.debug as boolean,
    force: values.force as boolean,
  };
}

async function main(): Promise<number> {
  const options = parseCLI(process.argv);

  if (options.command === "help") {
    console.log(USAGE);
    return 0;
  }

  if (options.command === "init") {
    return runInit({
      directory: options.directory,
      agents: options.agents,
      dryRun: options.dryRun,
      force: options.force,
      verbose: options.verbose,
    });
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

  const preflightWarnings = await runPreflight(
    options,
    manifest,
    home,
    detectedAgents,
  );
  for (const w of preflightWarnings) {
    const label = w.kind === "policy" ? "policy" : "preflight";
    logger.warn(label, w.message);
  }

  const { actions, warnings: planWarnings } = await planDeploy(
    manifest,
    options.directory,
    detectedAgents,
    home,
  );
  for (const w of planWarnings) {
    logger.warn("plan", w.message);
  }
  if (actions.length === 0) {
    logger.info("No skills to deploy for detected agents.");
    return 0;
  }

  logger.info(
    `${dryRunPrefix(options.dryRun)}Deploying ${actions.length} action(s):`,
  );
  const { succeeded, failed, planned } = await executeDeploy(
    actions,
    options.dryRun,
    options.verbose,
    home,
  );

  if (options.dryRun) {
    logger.info("");
    logger.info(formatDryRunPlan(planned));
    logger.info(`${planned.length} action(s) would be applied (plan)`);
    return 0;
  }

  logger.info("");
  if (failed.length > 0) {
    logger.info(`${succeeded} succeeded, ${failed.length} failed`);
    return 1;
  }
  logger.info(`${succeeded} action(s) deployed`);
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
    `${dryRunPrefix(options.dryRun)}Reverting ${actions.length} action(s):`,
  );
  const { succeeded, skipped, failed, planned } = await executeRevert(
    actions,
    options.dryRun,
    options.verbose,
    home,
  );

  if (options.dryRun) {
    logger.info("");
    logger.info(formatDryRunPlan(planned));
    logger.info(`${planned.length} action(s) would be removed (plan)`);
    return 0;
  }

  logger.info("");
  if (failed.length > 0) {
    const parts = [`${succeeded} removed`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    parts.push(`${failed.length} failed`);
    logger.info(parts.join(", "));
    return 1;
  }
  const parts = [`${succeeded} removed`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  logger.info(parts.join(", "));
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
