import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
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

describe("instruction precedence warnings", () => {
  it("emits duplicate-content precedence warning when same source used in both global and repo scope for an agent", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "CLAUDE.md"), "# Rules");
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          {
            name: "global-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "global",
          },
          {
            name: "repo-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      const precedenceWarnings = warnings.filter(
        (w) => w.kind === "precedence",
      );
      assert.ok(precedenceWarnings.length > 0, "expected a precedence warning");
      assert.ok(
        precedenceWarnings.some(
          (w) =>
            w.message.includes("claude-code") &&
            w.message.includes("CLAUDE.md"),
        ),
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits stacking advisory when different source files in global and repo scope for an agent", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "global.md"), "# Global");
      await writeFile(path.join(sourceDir, "repo.md"), "# Repo");
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          {
            name: "global-rules",
            path: "global.md",
            agents: ["claude-code"],
            scope: "global",
          },
          {
            name: "repo-rules",
            path: "repo.md",
            agents: ["claude-code"],
            scope: "repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      const precedenceWarnings = warnings.filter(
        (w) => w.kind === "precedence",
      );
      assert.ok(precedenceWarnings.length > 0, "expected a precedence warning");
      assert.ok(
        precedenceWarnings.some(
          (w) =>
            w.message.includes("claude-code") &&
            w.message.includes("simultaneously"),
        ),
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no precedence warning when agent only has global entries", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "CLAUDE.md"), "# Rules");
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          {
            name: "global-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "precedence").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no precedence warning when agent only has repo entries", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "CLAUDE.md"), "# Rules");
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          {
            name: "repo-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "precedence").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no precedence warning for agents not in detectedAgents", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "CLAUDE.md"), "# Rules");
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          {
            name: "global-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "global",
          },
          {
            name: "repo-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["codex"],
      );
      assert.equal(warnings.filter((w) => w.kind === "precedence").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });
});

describe("instruction budget warnings", () => {
  it("emits budget warning for agentRules source file exceeding 50 KB", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(
        path.join(sourceDir, "big.md"),
        Buffer.alloc(51 * 1024, "x"),
      );
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          {
            name: "big-rules",
            path: "big.md",
            agents: ["claude-code"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      const budgetWarnings = warnings.filter((w) => w.kind === "budget");
      assert.ok(budgetWarnings.length > 0, "expected a budget warning");
      assert.ok(
        budgetWarnings.some(
          (w) => w.message.includes("big.md") && w.message.includes("KB"),
        ),
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits budget warning for agentDefinitions source file exceeding 50 KB", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await mkdir(path.join(sourceDir, "agents"), { recursive: true });
      await writeFile(
        path.join(sourceDir, "agents", "big-agent.md"),
        Buffer.alloc(51 * 1024, "x"),
      );
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [],
        agentDefinitions: [
          {
            name: "big-agent",
            path: "agents/big-agent.md",
            agents: ["claude-code"],
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      const budgetWarnings = warnings.filter((w) => w.kind === "budget");
      assert.ok(budgetWarnings.length > 0, "expected a budget warning");
      assert.ok(
        budgetWarnings.some((w) => w.message.includes("agents/big-agent.md")),
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no budget warning for files at or below 50 KB", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(
        path.join(sourceDir, "small.md"),
        Buffer.alloc(49 * 1024, "x"),
      );
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          {
            name: "small-rules",
            path: "small.md",
            agents: ["claude-code"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "budget").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no budget warning when entry's agents are not in detectedAgents", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(
        path.join(sourceDir, "big.md"),
        Buffer.alloc(51 * 1024, "x"),
      );
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          {
            name: "big-rules",
            path: "big.md",
            agents: ["codex"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "budget").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("deduplicates budget warnings when the same source path appears in two entries", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(
        path.join(sourceDir, "big.md"),
        Buffer.alloc(51 * 1024, "x"),
      );
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          {
            name: "rules-a",
            path: "big.md",
            agents: ["claude-code"],
            scope: "global",
          },
          {
            name: "rules-b",
            path: "big.md",
            agents: ["claude-code"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "budget").length, 1);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("silently skips missing source files without emitting a budget warning", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          {
            name: "missing-rules",
            path: "does-not-exist.md",
            agents: ["claude-code"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "budget").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });
});
