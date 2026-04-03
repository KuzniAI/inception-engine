import assert from "node:assert/strict";
import { realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { compileMcpServerActions } from "../../src/core/adapters/mcp.ts";
import { compilePermissionsActions } from "../../src/core/adapters/permissions.ts";
import { compileAgentRuleActions } from "../../src/core/adapters/rules.ts";
import type {
  ConfigPatchDeployAction,
  FileWriteDeployAction,
  TomlPatchDeployAction,
} from "../../src/types.ts";
import { makeTmpDir } from "../helpers/fs.ts";

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
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
      normalizeSlashes(action.target).endsWith(".gemini/settings.json"),
      `expected target under .gemini/settings.json, got: ${action.target}`,
    );
  });

  it("returns a schema-aware warning and no action for github-copilot MCP", () => {
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
    assert.match(warnings[0]?.message ?? "", /repo-scoped MCP surfaces/);
    assert.match(warnings[0]?.message ?? "", /github-copilot/);
  });

  it("returns a frontmatter-emit action for antigravity MCP", () => {
    const home = "/home/test";
    const { actions, warnings } = compileMcpServerActions(
      { name: "my-mcp", agents: ["antigravity"], config: { command: "s" } },
      ["antigravity"],
      home,
      "/repo/test",
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    assert.equal(actions[0]?.kind, "frontmatter-emit");
    assert.equal(actions[0]?.agent, "antigravity");
    assert.ok(
      normalizeSlashes(actions[0]?.target ?? "").endsWith(
        ".agents/rules/my-mcp.md",
      ),
      `expected target to end with .agents/rules/my-mcp.md, got ${actions[0]?.target}`,
    );
  });

  it("throws when a supported MCP target is missing both command and url", () => {
    assert.throws(
      () =>
        compileMcpServerActions(
          {
            name: "my-mcp",
            agents: ["claude-code"],
            config: { args: ["--verbose"] },
          },
          ["claude-code"],
          "/home/test",
        ),
      /must define either a non-empty "command" or "url"/,
    );
  });

  it("produces actions for each detected agent that has supported MCP config", () => {
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
    const dir = await makeTmpDir();
    try {
      const rulesFile = path.join(dir, "CLAUDE.md");
      await writeFile(rulesFile, "# Rules");
      const realRoot = await realpath(dir);
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
      await rm(dir, { recursive: true });
    }
  });

  it("does not validate the rules source when no targeted agents overlap", async () => {
    const dir = await makeTmpDir();
    try {
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["claude-code"],
          path: "missing.md",
        },
        dir,
        dir,
        dir,
        ["codex"],
        "/home/test",
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns a file-write action for claude-code with correct source and target", async () => {
    const dir = await makeTmpDir();
    try {
      const rulesFile = path.join(dir, "CLAUDE.md");
      await writeFile(rulesFile, "# Rules");
      const home = "/home/test";
      const realRoot = await realpath(dir);
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
        normalizeSlashes(action.target).endsWith(".claude/CLAUDE.md"),
        `expected target under .claude/CLAUDE.md, got: ${action.target}`,
      );
      assert.equal(action.confidence, "documented");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns a schema-aware warning and no action for github-copilot rules", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "rules.md"), "# Rules");
      const realRoot = await realpath(dir);
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
        /Claude-native shared instructions/,
      );
      assert.match(
        warnings[0]?.message ?? "",
        /deploy via the "claude-code" agentRules target/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns a file-write action for antigravity rules", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "rules.md"), "# Rules");
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        { name: "my-rule", agents: ["antigravity"], path: "rules.md" },
        dir,
        dir,
        realRoot,
        ["antigravity"],
        "/home/test",
        "/repo/test",
      );
      assert.equal(actions.length, 1);
      assert.equal(warnings.length, 0);
      assert.equal(actions[0]?.kind, "file-write");
      assert.equal(actions[0]?.agent, "antigravity");
      assert.match(actions[0]?.target, /\.agents\/rules\/my-rule\.md$/);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when a supported rules target is given a non-Markdown source path", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "rules.txt"), "plain text");
      const realRoot = await realpath(dir);
      await assert.rejects(
        compileAgentRuleActions(
          { name: "my-rule", agents: ["codex"], path: "rules.txt" },
          dir,
          dir,
          realRoot,
          ["codex"],
          "/home/test",
        ),
        /must point to a Markdown source file/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when rules source file does not exist", async () => {
    const dir = await makeTmpDir();
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
      await rm(dir, { recursive: true });
    }
  });

  it("produces actions for each detected agent that has supported rules config", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "rules.md"), "# Rules");
      const realRoot = await realpath(dir);
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
      await rm(dir, { recursive: true });
    }
  });
});

describe("compilePermissionsActions", () => {
  it("returns zero actions and warnings when no detected agents overlap", () => {
    const { actions, warnings } = compilePermissionsActions(
      {
        name: "safety",
        agents: ["claude-code"],
        config: { permissions: { allow: ["Read"] } },
      },
      ["codex"],
      "/home/test",
    );
    assert.equal(actions.length, 0);
    assert.equal(warnings.length, 0);
  });

  it("returns a config-patch action for claude-code targeting settings.json", () => {
    const home = "/home/test";
    const { actions, warnings } = compilePermissionsActions(
      {
        name: "safety",
        agents: ["claude-code"],
        config: {
          permissions: { allow: ["Read", "Glob"], deny: ["Bash(rm:*)"] },
        },
      },
      ["claude-code"],
      home,
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    const action = actions[0] as ConfigPatchDeployAction;
    assert.equal(action.kind, "config-patch");
    assert.equal(action.skill, "safety");
    assert.equal(action.agent, "claude-code");
    assert.ok(
      normalizeSlashes(action.target).endsWith(".claude/settings.json"),
      `expected target to end with .claude/settings.json, got: ${action.target}`,
    );
    assert.deepEqual(action.patch, {
      permissions: { allow: ["Read", "Glob"], deny: ["Bash(rm:*)"] },
    });
    assert.equal(action.confidence, "documented");
  });

  it("returns a toml-patch action for codex targeting config.toml", () => {
    const home = "/home/test";
    const { actions, warnings } = compilePermissionsActions(
      {
        name: "codex-approval",
        agents: ["codex"],
        config: { approval_policy: "suggest" },
      },
      ["codex"],
      home,
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    const action = actions[0] as TomlPatchDeployAction;
    assert.equal(action.kind, "toml-patch");
    assert.equal(action.skill, "codex-approval");
    assert.equal(action.agent, "codex");
    assert.ok(
      normalizeSlashes(action.target).endsWith(".codex/config.toml"),
      `expected target to end with .codex/config.toml, got: ${action.target}`,
    );
    assert.deepEqual(action.config, { approval_policy: "suggest" });
    assert.equal(action.confidence, "documented");
  });

  it("emits a warning and skips for agents without a permissions surface", () => {
    for (const agentId of ["gemini-cli", "opencode", "antigravity"] as const) {
      const { actions, warnings } = compilePermissionsActions(
        { name: "safety", agents: [agentId], config: {} },
        [agentId],
        "/home/test",
      );
      assert.equal(actions.length, 0, `expected no actions for ${agentId}`);
      assert.equal(warnings.length, 1, `expected one warning for ${agentId}`);
      assert.equal(warnings[0]?.kind, "confidence");
    }
  });

  it("throws for claude-code config with unrecognized top-level keys", () => {
    assert.throws(
      () =>
        compilePermissionsActions(
          {
            name: "bad",
            agents: ["claude-code"],
            config: { unknown_key: true },
          },
          ["claude-code"],
          "/home/test",
        ),
      /unrecognized keys/,
    );
  });

  it("throws for claude-code config with non-array allow field", () => {
    assert.throws(
      () =>
        compilePermissionsActions(
          {
            name: "bad",
            agents: ["claude-code"],
            config: { permissions: { allow: "Read" } },
          },
          ["claude-code"],
          "/home/test",
        ),
      /array of strings/,
    );
  });

  it("throws for codex config with unrecognized keys", () => {
    assert.throws(
      () =>
        compilePermissionsActions(
          {
            name: "bad",
            agents: ["codex"],
            config: { unknown_policy: "auto" },
          },
          ["codex"],
          "/home/test",
        ),
      /unrecognized keys/,
    );
  });

  it("throws for codex config with invalid approval_policy value", () => {
    assert.throws(
      () =>
        compilePermissionsActions(
          {
            name: "bad",
            agents: ["codex"],
            config: { approval_policy: "always" },
          },
          ["codex"],
          "/home/test",
        ),
      /approval_policy/,
    );
  });

  it("produces actions for both claude-code and codex when both are detected", () => {
    const home = "/home/test";
    const { actions, warnings } = compilePermissionsActions(
      {
        name: "multi",
        agents: ["claude-code", "codex"],
        config: {},
      },
      ["claude-code", "codex"],
      home,
    );
    assert.equal(warnings.length, 0);
    assert.equal(actions.length, 2);
    const agents = actions.map((a) => a.agent);
    assert.ok(agents.includes("claude-code"));
    assert.ok(agents.includes("codex"));
  });
});
