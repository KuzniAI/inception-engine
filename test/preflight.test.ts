import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPreflight } from "../src/core/preflight.ts";
import { logger } from "../src/logger.ts";
import type { CliOptions, Manifest } from "../src/types.ts";

logger.silence();

const baseOptions: CliOptions = {
  command: "deploy",
  directory: "/tmp",
  dryRun: false,
  agents: null,
  verbose: false,
  debug: false,
};

const emptyManifest: Manifest = {
  skills: [],
  mcpServers: [],
  agentRules: [],
};

describe("runPreflight", () => {
  it("returns empty for empty detected agents list", async () => {
    const warnings = await runPreflight(
      baseOptions,
      emptyManifest,
      "/home/test",
      [],
    );
    assert.equal(warnings.length, 0);
  });

  it("returns empty for documented agents without policy notes", async () => {
    const warnings = await runPreflight(
      baseOptions,
      emptyManifest,
      "/home/test",
      ["claude-code", "codex", "gemini-cli", "opencode"],
    );
    assert.equal(warnings.length, 0);
  });

  it("emits policy warning for github-copilot", async () => {
    const warnings = await runPreflight(
      baseOptions,
      emptyManifest,
      "/home/test",
      ["github-copilot"],
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.kind, "policy");
    assert.match(warnings[0]?.message ?? "", /github-copilot/);
    assert.match(warnings[0]?.message ?? "", /[Oo]rganization/);
  });

  it("emits config-authority warning for antigravity (implementation-only skills)", async () => {
    const warnings = await runPreflight(
      baseOptions,
      emptyManifest,
      "/home/test",
      ["antigravity"],
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.kind, "config-authority");
    assert.match(warnings[0]?.message ?? "", /antigravity/);
    assert.match(warnings[0]?.message ?? "", /implementation-only/);
  });

  it("emits one warning per non-documented agent", async () => {
    const warnings = await runPreflight(
      baseOptions,
      emptyManifest,
      "/home/test",
      ["claude-code", "antigravity"],
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.kind, "config-authority");
    assert.match(warnings[0]?.message ?? "", /antigravity/);
  });
});
