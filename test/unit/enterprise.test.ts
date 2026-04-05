import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { runPreflight } from "../../src/core/preflight.ts";
import { logger } from "../../src/logger.ts";
import type { CliOptions, Manifest } from "../../src/types.ts";
import { makeTmpDir } from "../helpers/fs.ts";

logger.silence();

const baseOptions: CliOptions = {
  command: "deploy",
  directory: "/tmp",
  dryRun: false,
  agents: null,
  verbose: false,
  debug: false,
  force: false,
};

const emptyManifest: Manifest = {
  skills: [],
  files: [],
  configs: [],
  mcpServers: [],
  agentRules: [],
  permissions: [],
  agentDefinitions: [],
};

describe("enterprise detection", () => {
  let tmpHome: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tmpHome = await makeTmpDir();
    // Reset environment variables that might interfere
    delete process.env.GITHUB_ENTERPRISE_URL;
    delete process.env.GH_ENTERPRISE_TOKEN;
    delete process.env.GITHUB_TOKEN_TYPE;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.LOCALAPPDATA;
    delete process.env.APPDATA;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await rm(tmpHome, { recursive: true });
  });

  it("detects enterprise via environment variables", async () => {
    process.env.GITHUB_ENTERPRISE_URL = "https://github.enterprise.com";

    const warnings = await runPreflight(baseOptions, emptyManifest, tmpHome, [
      "github-copilot",
    ]);

    const policy = warnings.find((w) => w.kind === "policy");
    assert.ok(policy, "Expected a policy warning");
    assert.match(policy.message, /Enterprise environment variables detected/);
  });

  it("detects enterprise via hosts.json", async () => {
    const configDir =
      process.platform === "win32"
        ? path.join(tmpHome, "AppData", "Local", "github-copilot")
        : path.join(tmpHome, ".config", "github-copilot");

    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "hosts.json"),
      JSON.stringify({
        "github.com": { user: "alice" },
        "ghe.acme.com": { user: "bob" },
      }),
    );

    // Ensure we're using the mock home for config resolution
    if (process.platform === "win32") {
      process.env.LOCALAPPDATA = path.join(tmpHome, "AppData", "Local");
    } else {
      process.env.XDG_CONFIG_HOME = path.join(tmpHome, ".config");
    }

    const warnings = await runPreflight(baseOptions, emptyManifest, tmpHome, [
      "github-copilot",
    ]);

    const policy = warnings.find((w) => w.kind === "policy");
    assert.ok(policy, "Expected a policy warning");
    assert.match(
      policy.message,
      /authenticated against enterprise host\(s\): ghe.acme.com/,
    );
  });

  it("emits no warning for standard github.com hosts.json", async () => {
    const configDir =
      process.platform === "win32"
        ? path.join(tmpHome, "AppData", "Local", "github-copilot")
        : path.join(tmpHome, ".config", "github-copilot");

    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "hosts.json"),
      JSON.stringify({
        "github.com": { user: "alice" },
      }),
    );

    if (process.platform === "win32") {
      process.env.LOCALAPPDATA = path.join(tmpHome, "AppData", "Local");
    } else {
      process.env.XDG_CONFIG_HOME = path.join(tmpHome, ".config");
    }

    const warnings = await runPreflight(baseOptions, emptyManifest, tmpHome, [
      "github-copilot",
    ]);

    const policy = warnings.find((w) => w.kind === "policy");
    assert.ok(!policy, "Expected no policy warning for standard host");
  });

  it("falls back to generic warning if no enterprise detected but policyNote exists and is not redundant", async () => {
    // We already have a "p provisional" warning for antigravity in the registry,
    // but Let's just use github-copilot and ensure it DOES NOT emit the
    // redundant note if no enterprise host is found.

    const warnings = await runPreflight(baseOptions, emptyManifest, tmpHome, [
      "github-copilot",
    ]);

    const policy = warnings.find((w) => w.kind === "policy");
    assert.ok(
      !policy,
      "Expected no policy warning for standard user with redundant note",
    );
  });
});
