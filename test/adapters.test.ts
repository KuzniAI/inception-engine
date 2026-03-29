import assert from "node:assert/strict";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { compileMcpServerActions } from "../src/core/adapters/mcp.ts";
import { compileAgentRuleActions } from "../src/core/adapters/rules.ts";
import type {
  ConfigPatchDeployAction,
  FileWriteDeployAction,
} from "../src/types.ts";

function makeTmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ie-test-adapters-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("compileMcpServerActions", () => {
  it("returns zero actions and warnings when no detectedAgents overlap", () => {
    const { actions, warnings } = compileMcpServerActions(
      { name: "my-mcp", agents: ["claude-code"], config: { command: "s" } },
      ["codex"],
      "/home/test",
    );
    assert.equal(actions.length, 0);
    assert.equal(warnings.length, 0);
  });

  it("returns a config-patch action for claude-code with correct target and patch", () => {
    const home = "/home/test";
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["claude-code"],
        config: { command: "my-server", args: ["--verbose"] },
      },
      ["claude-code"],
      home,
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    const action = actions[0] as ConfigPatchDeployAction;
    assert.equal(action.kind, "config-patch");
    assert.equal(action.skill, "my-mcp");
    assert.equal(action.agent, "claude-code");
    assert.ok(
      action.target.endsWith(".claude.json"),
      `expected target to end with .claude.json, got: ${action.target}`,
    );
    assert.deepEqual(action.patch, {
      mcpServers: { "my-mcp": { command: "my-server", args: ["--verbose"] } },
    });
    assert.equal(action.confidence, "documented");
  });

  it("returns a config-patch action for gemini-cli with correct target", () => {
    const home = "/home/test";
    const { actions } = compileMcpServerActions(
      { name: "my-mcp", agents: ["gemini-cli"], config: { url: "http://x" } },
      ["gemini-cli"],
      home,
    );
    assert.equal(actions.length, 1);
    const action = actions[0] as ConfigPatchDeployAction;
    assert.ok(
      action.target.endsWith(path.join(".gemini", "settings.json")),
      `expected target under .gemini/settings.json, got: ${action.target}`,
    );
  });

  it("returns a warning and no action when agent is detected but has no mcpConfigPath (github-copilot)", () => {
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["github-copilot"],
        config: { command: "s" },
      },
      ["github-copilot"],
      "/home/test",
    );
    assert.equal(actions.length, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.kind, "confidence");
    assert.match(
      warnings[0]?.message ?? "",
      /does not have a documented MCP config path/,
    );
    assert.match(warnings[0]?.message ?? "", /github-copilot/);
  });

  it("returns a warning and no action for antigravity (no mcpConfigPath)", () => {
    const { actions, warnings } = compileMcpServerActions(
      { name: "my-mcp", agents: ["antigravity"], config: { command: "s" } },
      ["antigravity"],
      "/home/test",
    );
    assert.equal(actions.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]?.message ?? "", /antigravity/);
  });

  it("produces actions for each detected agent that has a mcpConfigPath", () => {
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["claude-code", "gemini-cli"],
        config: { command: "s" },
      },
      ["claude-code", "gemini-cli"],
      "/home/test",
    );
    assert.equal(actions.length, 2);
    assert.equal(warnings.length, 0);
    const agents = actions.map((a) => a.agent);
    assert.ok(agents.includes("claude-code"));
    assert.ok(agents.includes("gemini-cli"));
  });
});

describe("compileAgentRuleActions", () => {
  it("returns zero actions and warnings when no detectedAgents overlap", async () => {
    const dir = makeTmpDir();
    try {
      const rulesFile = path.join(dir, "CLAUDE.md");
      writeFileSync(rulesFile, "# Rules");
      const realRoot = realpathSync(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["claude-code"],
          path: "CLAUDE.md",
        },
        dir,
        dir,
        realRoot,
        ["codex"],
        "/home/test",
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("returns a file-write action for claude-code with correct source and target", async () => {
    const dir = makeTmpDir();
    try {
      const rulesFile = path.join(dir, "CLAUDE.md");
      writeFileSync(rulesFile, "# Rules");
      const home = "/home/test";
      const realRoot = realpathSync(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        { name: "my-rule", agents: ["claude-code"], path: "CLAUDE.md" },
        dir,
        dir,
        realRoot,
        ["claude-code"],
        home,
      );
      assert.equal(actions.length, 1);
      assert.equal(warnings.length, 0);
      const action = actions[0] as FileWriteDeployAction;
      assert.equal(action.kind, "file-write");
      assert.equal(action.skill, "my-rule");
      assert.equal(action.agent, "claude-code");
      assert.equal(action.source, rulesFile);
      assert.ok(
        action.target.endsWith(path.join(".claude", "CLAUDE.md")),
        `expected target under .claude/CLAUDE.md, got: ${action.target}`,
      );
      assert.equal(action.confidence, "documented");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("returns a warning and no action when agent is detected but has no agentRulesPath (github-copilot)", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(path.join(dir, "rules.md"), "# Rules");
      const realRoot = realpathSync(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["github-copilot"],
          path: "rules.md",
        },
        dir,
        dir,
        realRoot,
        ["github-copilot"],
        "/home/test",
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0]?.kind, "confidence");
      assert.match(
        warnings[0]?.message ?? "",
        /does not have a documented rules file path/,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("returns a warning and no action for antigravity (no agentRulesPath)", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(path.join(dir, "rules.md"), "# Rules");
      const realRoot = realpathSync(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        { name: "my-rule", agents: ["antigravity"], path: "rules.md" },
        dir,
        dir,
        realRoot,
        ["antigravity"],
        "/home/test",
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]?.message ?? "", /antigravity/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws when rules source file does not exist", async () => {
    const dir = makeTmpDir();
    try {
      await assert.rejects(
        compileAgentRuleActions(
          {
            name: "my-rule",
            agents: ["claude-code"],
            path: "nonexistent.md",
          },
          dir,
          dir,
          dir,
          ["claude-code"],
          "/home/test",
        ),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /nonexistent\.md/);
          return true;
        },
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("produces actions for each detected agent that has agentRulesPath", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(path.join(dir, "rules.md"), "# Rules");
      const realRoot = realpathSync(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["claude-code", "codex"],
          path: "rules.md",
        },
        dir,
        dir,
        realRoot,
        ["claude-code", "codex"],
        "/home/test",
      );
      assert.equal(actions.length, 2);
      assert.equal(warnings.length, 0);
      const agents = actions.map((a) => a.agent);
      assert.ok(agents.includes("claude-code"));
      assert.ok(agents.includes("codex"));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
