import assert from "node:assert/strict";
import { realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { compileMcpServerActions } from "../../src/core/adapters/mcp.ts";
import { compileHookActions } from "../../src/core/adapters/hooks.ts";
import { compilePermissionsActions } from "../../src/core/adapters/permissions.ts";
import {
  compileAgentRuleActions,
  compileAgentRuleReverts,
} from "../../src/core/adapters/rules.ts";
import type {
  ConfigPatchDeployAction,
  FileWriteDeployAction,
  TomlPatchDeployAction,
} from "../../src/types.ts";
import { makeTmpDir } from "../helpers/fs.ts";
import { assertPathEndsWith, normalizeSlashes } from "../helpers/path.ts";

describe("compileMcpServerActions", () => {
  it("returns zero actions and warnings when no detectedAgents overlap", () => {
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["claude-code"],
        config: { command: "s" },
        scope: "global",
      },
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
        scope: "global",
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

  it("returns a config-patch action for claude-code MCP with scope: repo", () => {
    const repo = "/repo/test";
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["claude-code"],
        config: { command: "s" },
        scope: "repo",
      },
      ["claude-code"],
      "/home/test",
      repo,
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    const action = actions[0] as ConfigPatchDeployAction;
    assert.equal(action.kind, "config-patch");
    assert.equal(action.agent, "claude-code");
    assertPathEndsWith(
      action.target,
      ".claude/mcp.json",
      `expected target to end with .claude/mcp.json, got: ${action.target}`,
    );
    assert.deepEqual(action.patch, {
      mcpServers: { "my-mcp": { command: "s" } },
    });
    assert.equal(action.confidence, "documented");
  });

  it("returns a config-patch action for claude-code MCP with scope: workspace", () => {
    const workspace = "/workspace/test";
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["claude-code"],
        config: { command: "s" },
        scope: "workspace",
      },
      ["claude-code"],
      "/home/test",
      undefined,
      workspace,
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    const action = actions[0] as ConfigPatchDeployAction;
    assert.equal(action.kind, "config-patch");
    assert.equal(action.agent, "claude-code");
    assertPathEndsWith(
      action.target,
      ".claude/mcp.json",
      `expected target to end with .claude/mcp.json, got: ${action.target}`,
    );
    assert.deepEqual(action.patch, {
      mcpServers: { "my-mcp": { command: "s" } },
    });
  });

  it("returns a config-patch action for gemini-cli with correct target", () => {
    const home = "/home/test";
    const { actions } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["gemini-cli"],
        config: { url: "http://x" },
        scope: "global",
      },
      ["gemini-cli"],
      home,
    );
    assert.equal(actions.length, 1);
    const action = actions[0] as ConfigPatchDeployAction;
    assertPathEndsWith(
      action.target,
      ".gemini/settings.json",
      `expected target under .gemini/settings.json, got: ${action.target}`,
    );
  });

  it("returns an unsupported warning and no action for github-copilot MCP with default (global) scope", () => {
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["github-copilot"],
        config: { command: "s" },
        scope: "global",
      },
      ["github-copilot"],
      "/home/test",
    );
    assert.equal(actions.length, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.kind, "confidence");
    assert.match(warnings[0]?.message ?? "", /github-copilot/);
    assert.match(warnings[0]?.message ?? "", /unsupported/);
  });

  it("returns a config-patch action for github-copilot MCP with scope: repo", () => {
    const repo = "/repo/test";
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["github-copilot"],
        config: { command: "s" },
        scope: "repo",
      },
      ["github-copilot"],
      "/home/test",
      repo,
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    const action = actions[0] as ConfigPatchDeployAction;
    assert.equal(action.kind, "config-patch");
    assert.equal(action.agent, "github-copilot");
    assertPathEndsWith(
      action.target,
      ".vscode/mcp.json",
      `expected target to end with .vscode/mcp.json, got: ${action.target}`,
    );
    assert.deepEqual(action.patch, {
      servers: { "my-mcp": { command: "s" } },
    });
    assert.equal(action.confidence, "documented");
  });

  it("returns a config-patch action for github-copilot MCP with scope: workspace", () => {
    const workspace = "/workspace/test";
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["github-copilot"],
        config: { command: "s" },
        scope: "workspace",
      },
      ["github-copilot"],
      "/home/test",
      undefined,
      workspace,
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    const action = actions[0] as ConfigPatchDeployAction;
    assert.equal(action.kind, "config-patch");
    assert.equal(action.agent, "github-copilot");
    assertPathEndsWith(
      action.target,
      ".vscode/mcp.json",
      `expected target to end with .vscode/mcp.json, got: ${action.target}`,
    );
    assert.deepEqual(action.patch, {
      servers: { "my-mcp": { command: "s" } },
    });
  });

  it("returns a frontmatter-emit action for antigravity MCP with scope: repo", () => {
    const home = "/home/test";
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["antigravity"],
        config: { command: "s" },
        scope: "repo",
      },
      ["antigravity"],
      home,
      "/repo/test",
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    assert.equal(actions[0]?.kind, "frontmatter-emit");
    assert.equal(actions[0]?.agent, "antigravity");
    assertPathEndsWith(
      actions[0]?.target ?? "",
      ".agents/rules/my-mcp.md",
      `expected target to end with .agents/rules/my-mcp.md, got ${actions[0]?.target}`,
    );
  });

  it("returns a config-patch action for antigravity MCP with scope: global", () => {
    const home = "/home/test";
    const { actions, warnings } = compileMcpServerActions(
      {
        name: "my-mcp",
        agents: ["antigravity"],
        config: { command: "s" },
        scope: "global",
      },
      ["antigravity"],
      home,
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    assert.equal(actions[0]?.kind, "config-patch");
    assert.equal(actions[0]?.agent, "antigravity");
    assertPathEndsWith(
      actions[0]?.target ?? "",
      ".gemini/antigravity/mcp_config.json",
      `expected target to end with .gemini/antigravity/mcp_config.json, got ${actions[0]?.target}`,
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
            scope: "global",
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
        scope: "global",
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
          scope: "global",
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
          scope: "global",
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
        {
          name: "my-rule",
          agents: ["claude-code"],
          path: "CLAUDE.md",
          scope: "global",
        },
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
      assertPathEndsWith(
        action.target,
        ".claude/CLAUDE.md",
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
      await writeFile(
        path.join(dir, "rules.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["github-copilot"],
          path: "rules.md",
          scope: "global",
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
      // github-copilot is shared-via claude-code with requiresPrimary, so
      // when claude-code is absent a guidance warning is emitted
      assert.match(
        warnings[0]?.message ?? "",
        /reads this surface via "claude-code"/,
      );
      assert.match(
        warnings[0]?.message ?? "",
        /add "claude-code" to the entry's agents list/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns a file-write action for antigravity rules", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "rules.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["antigravity"],
          path: "rules.md",
          scope: "global",
        },
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
      assertPathEndsWith(
        actions[0]?.target ?? "",
        ".gemini/GEMINI.md",
        `expected target to end with .gemini/GEMINI.md, got ${actions[0]?.target}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("gemini-cli and antigravity in the same agentRules entry (global scope) produce ONE deduplicated action", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "rules.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["gemini-cli", "antigravity"],
          path: "rules.md",
          scope: "global",
        },
        dir,
        dir,
        realRoot,
        ["gemini-cli", "antigravity"],
        "/home/test",
        "/repo/test",
      );
      // Both agents target ~/.gemini/GEMINI.md — deduplication emits only one action.
      assert.equal(actions.length, 1, "expected one deduplicated action");
      assert.equal(warnings.length, 0);
      // First agent in list wins.
      assert.equal(actions[0]?.agent, "gemini-cli");
      assertPathEndsWith(
        actions[0]?.target ?? "",
        ".gemini/GEMINI.md",
        `expected target to end with .gemini/GEMINI.md, got: ${actions[0]?.target}`,
      );
      assert.equal(actions[0]?.confidence, "documented");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("gemini-cli and antigravity together (repo scope) emit ONE action targeting {repo}/GEMINI.md", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "rules.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const repo = "/repo/myproject";
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["gemini-cli", "antigravity"],
          path: "rules.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["gemini-cli", "antigravity"],
        "/home/test",
        repo,
      );
      assert.equal(actions.length, 1, "expected one deduplicated action");
      assert.equal(warnings.length, 0);
      assert.equal(actions[0]?.agent, "gemini-cli");
      assert.equal(
        normalizeSlashes(actions[0]?.target ?? ""),
        `${repo}/GEMINI.md`,
        "expected target to be {repo}/GEMINI.md",
      );
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
          {
            name: "my-rule",
            agents: ["codex"],
            path: "rules.txt",
            scope: "global",
          },
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

  it("scope copilot-repo: returns file-write action targeting {repo}/.github/copilot-instructions.md", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "copilot.md"), "# Copilot rules");
      const repo = "/repo/myproject";
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "copilot-main",
          agents: ["github-copilot"],
          path: "copilot.md",
          scope: "copilot-repo",
        },
        dir,
        dir,
        realRoot,
        ["github-copilot"],
        "/home/test",
        repo,
      );
      assert.equal(actions.length, 1);
      assert.equal(warnings.length, 0);
      const action = actions[0] as FileWriteDeployAction;
      assert.equal(action.kind, "file-write");
      assert.equal(action.agent, "github-copilot");
      assert.equal(
        normalizeSlashes(action.target),
        `${repo}/.github/copilot-instructions.md`,
        `expected target at {repo}/.github/copilot-instructions.md, got: ${action.target}`,
      );
      assert.equal(action.confidence, "documented");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("scope copilot-scoped: returns file-write action with {name} substituted in path", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "typescript.md"), "# TypeScript rules");
      const repo = "/repo/myproject";
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "typescript",
          agents: ["github-copilot"],
          path: "typescript.md",
          scope: "copilot-scoped",
        },
        dir,
        dir,
        realRoot,
        ["github-copilot"],
        "/home/test",
        repo,
      );
      assert.equal(actions.length, 1);
      assert.equal(warnings.length, 0);
      const action = actions[0] as FileWriteDeployAction;
      assert.equal(action.kind, "file-write");
      assert.equal(action.agent, "github-copilot");
      assert.equal(
        normalizeSlashes(action.target),
        `${repo}/.github/instructions/typescript.instructions.md`,
        `expected target at {repo}/.github/instructions/typescript.instructions.md, got: ${action.target}`,
      );
      assert.equal(action.confidence, "documented");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("scope copilot-repo: returns warning when no repo path provided", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "copilot.md"), "# Copilot rules");
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "copilot-main",
          agents: ["github-copilot"],
          path: "copilot.md",
          scope: "copilot-repo",
        },
        dir,
        dir,
        realRoot,
        ["github-copilot"],
        "/home/test",
        // no repo
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0]?.kind, "confidence");
      assert.match(warnings[0]?.message ?? "", /copilot-repo/);
      assert.match(warnings[0]?.message ?? "", /repository path/);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("scope copilot-repo: non-github-copilot agents get unsupported warning", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "copilot.md"), "# Copilot rules");
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "copilot-main",
          agents: ["claude-code"],
          path: "copilot.md",
          scope: "copilot-repo",
        },
        dir,
        dir,
        realRoot,
        ["claude-code"],
        "/home/test",
        "/repo/test",
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0]?.kind, "confidence");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("scope copilot-repo: plain markdown without frontmatter succeeds (no instructionFrontmatterRequired check)", async () => {
    const dir = await makeTmpDir();
    try {
      // Plain markdown with no frontmatter — should NOT throw despite github-copilot
      // having instructionFrontmatterRequired: true (native agentRules scopes skip that check)
      await writeFile(
        path.join(dir, "plain.md"),
        "# Plain rules\n\nNo frontmatter.",
      );
      const repo = "/repo/myproject";
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "plain-rules",
          agents: ["github-copilot"],
          path: "plain.md",
          scope: "copilot-repo",
        },
        dir,
        dir,
        realRoot,
        ["github-copilot"],
        "/home/test",
        repo,
      );
      assert.equal(actions.length, 1);
      assert.equal(warnings.length, 0);
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
            scope: "global",
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
      await writeFile(
        path.join(dir, "rules.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["claude-code", "codex"],
          path: "rules.md",
          scope: "global",
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

  it("scope repo: returns a file-write action targeting {repo}/CLAUDE.md for claude-code", async () => {
    const dir = await makeTmpDir();
    try {
      const rulesFile = path.join(dir, "CLAUDE.md");
      await writeFile(rulesFile, "# Rules");
      const repo = "/repo/myproject";
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["claude-code"],
          path: "CLAUDE.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["claude-code"],
        "/home/test",
        repo,
      );
      assert.equal(actions.length, 1);
      assert.equal(warnings.length, 0);
      const action = actions[0] as FileWriteDeployAction;
      assert.equal(action.kind, "file-write");
      assert.equal(action.agent, "claude-code");
      assert.equal(
        normalizeSlashes(action.target),
        `${repo}/CLAUDE.md`,
        `expected target at {repo}/CLAUDE.md, got: ${action.target}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("scope repo: target differs from scope global for claude-code", async () => {
    const dir = await makeTmpDir();
    try {
      const rulesFile = path.join(dir, "CLAUDE.md");
      await writeFile(rulesFile, "# Rules");
      const home = "/home/test";
      const repo = "/repo/myproject";
      const realRoot = await realpath(dir);
      const [globalResult, repoResult] = await Promise.all([
        compileAgentRuleActions(
          {
            name: "my-rule",
            agents: ["claude-code"],
            path: "CLAUDE.md",
            scope: "global",
          },
          dir,
          dir,
          realRoot,
          ["claude-code"],
          home,
          repo,
        ),
        compileAgentRuleActions(
          {
            name: "my-rule",
            agents: ["claude-code"],
            path: "CLAUDE.md",
            scope: "repo",
          },
          dir,
          dir,
          realRoot,
          ["claude-code"],
          home,
          repo,
        ),
      ]);
      assert.equal(globalResult.actions.length, 1);
      assert.equal(repoResult.actions.length, 1);
      assert.notEqual(
        globalResult.actions[0]?.target,
        repoResult.actions[0]?.target,
        "global and repo scopes must produce distinct targets",
      );
      assert.ok(
        normalizeSlashes(globalResult.actions[0]?.target ?? "").includes(
          ".claude/CLAUDE.md",
        ),
        "global scope must target ~/.claude/CLAUDE.md",
      );
      assert.equal(
        normalizeSlashes(repoResult.actions[0]?.target ?? ""),
        `${repo}/CLAUDE.md`,
        "repo scope must target {repo}/CLAUDE.md",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("scope repo: antigravity targets {repo}/GEMINI.md", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "rules.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const repo = "/repo/myproject";
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["antigravity"],
          path: "rules.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["antigravity"],
        "/home/test",
        repo,
      );
      assert.equal(actions.length, 1);
      assert.equal(warnings.length, 0);
      assert.equal(
        normalizeSlashes(actions[0]?.target ?? ""),
        `${repo}/GEMINI.md`,
        "expected target to be {repo}/GEMINI.md",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("scope repo with targetDir: injects targetDir into path for claude-code", async () => {
    const dir = await makeTmpDir();
    try {
      const rulesFile = path.join(dir, "CLAUDE.md");
      await writeFile(rulesFile, "# Rules");
      const repo = "/repo/myproject";
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["claude-code"],
          path: "CLAUDE.md",
          scope: "repo",
          targetDir: "apps/frontend",
        },
        dir,
        dir,
        realRoot,
        ["claude-code"],
        "/home/test",
        repo,
      );
      assert.equal(actions.length, 1);
      assert.equal(warnings.length, 0);
      const action = actions[0] as FileWriteDeployAction;
      assert.equal(
        normalizeSlashes(action.target),
        `${repo}/apps/frontend/CLAUDE.md`,
        `expected target at {repo}/apps/frontend/CLAUDE.md, got: ${action.target}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("scope repo: emits a warning and skips when repo path is not provided", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "rules.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["claude-code"],
          path: "rules.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["claude-code"],
        "/home/test",
        // no repo arg
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0]?.kind, "confidence");
      assert.match(
        warnings[0]?.message ?? "",
        /scope "repo" requires a repository path/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("scope repo: github-copilot emits unsupported warning", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "rules.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["github-copilot"],
          path: "rules.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["github-copilot"],
        "/home/test",
        "/repo/myproject",
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0]?.kind, "confidence");
      assert.match(warnings[0]?.message ?? "", /claude-code/);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("github-copilot + claude-code: emits ONE action for claude-code only (shared-via dedup)", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "rules.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["claude-code", "github-copilot"],
          path: "rules.md",
          scope: "global",
        },
        dir,
        dir,
        realRoot,
        ["claude-code", "github-copilot"],
        "/home/test",
      );
      // github-copilot rides claude-code's CLAUDE.md deployment; only one
      // action should be emitted for claude-code.
      assert.equal(actions.length, 1, "expected exactly one action");
      assert.equal(warnings.length, 0);
      assert.equal(actions[0]?.agent, "claude-code");
      assertPathEndsWith(
        actions[0]?.target ?? "",
        ".claude/CLAUDE.md",
        `expected target to end with .claude/CLAUDE.md, got: ${actions[0]?.target}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("github-copilot without claude-code: emits guidance confidence warning, no action", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "rules.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentRuleActions(
        {
          name: "my-rule",
          agents: ["github-copilot"],
          path: "rules.md",
          scope: "global",
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
        /reads this surface via "claude-code"/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("compileAgentRuleReverts", () => {
  it("injects targetDir into revert path", () => {
    const home = "/home/test";
    const repo = "/repo/test";
    const actions = compileAgentRuleReverts(
      {
        name: "my-rule",
        agents: ["claude-code"],
        path: "CLAUDE.md",
        scope: "repo",
        targetDir: "apps/frontend",
      },
      ["claude-code"],
      home,
      repo,
    );
    assert.equal(actions.length, 1);
    assert.equal(
      normalizeSlashes(actions[0]?.target ?? ""),
      `${repo}/apps/frontend/CLAUDE.md`,
    );
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
    assertPathEndsWith(
      action.target,
      ".claude/settings.json",
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
    assertPathEndsWith(
      action.target,
      ".codex/config.toml",
      `expected target to end with .codex/config.toml, got: ${action.target}`,
    );
    assert.deepEqual(action.config, { approval_policy: "suggest" });
    assert.equal(action.confidence, "documented");
  });

  it("emits a warning and skips for agents without a permissions surface", () => {
    for (const agentId of ["gemini-cli", "antigravity"] as const) {
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

  it("returns a config-patch action for opencode permissions", () => {
    const home = "/home/test";
    const { actions, warnings } = compilePermissionsActions(
      {
        name: "opencode-perms",
        agents: ["opencode"],
        config: { permissions: { allow: ["Read", "Glob"], ask: ["*"] } },
      },
      ["opencode"],
      home,
    );
    assert.equal(actions.length, 1);
    assert.equal(warnings.length, 0);
    const action = actions[0] as ConfigPatchDeployAction;
    assert.equal(action.kind, "config-patch");
    assert.equal(action.skill, "opencode-perms");
    assert.equal(action.agent, "opencode");
    assertPathEndsWith(
      action.target,
      "opencode/opencode.json",
      `expected target to end with opencode/opencode.json, got: ${action.target}`,
    );
    assert.deepEqual(action.patch, {
      permissions: { allow: ["Read", "Glob"], ask: ["*"] },
    });
    assert.equal(action.confidence, "documented");
  });

  it("throws for opencode config with unrecognized top-level keys", () => {
    assert.throws(
      () =>
        compilePermissionsActions(
          {
            name: "bad",
            agents: ["opencode"],
            config: { unknown_key: true },
          },
          ["opencode"],
          "/home/test",
        ),
      /unrecognized keys/,
    );
  });

  it("throws for opencode config with non-array deny field", () => {
    assert.throws(
      () =>
        compilePermissionsActions(
          {
            name: "bad",
            agents: ["opencode"],
            config: { permissions: { deny: "Rm" } },
          },
          ["opencode"],
          "/home/test",
        ),
      /array of strings/,
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

describe("compileHookActions", () => {
  const validClaudeHookConfig = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "scripts/check.sh" }],
        },
      ],
    },
  };

  it("returns zero actions and warnings when no detected agents overlap", () => {
    const { actions, warnings } = compileHookActions(
      { name: "check", agents: ["claude-code"], config: validClaudeHookConfig },
      ["codex"],
      "/home/test",
    );
    assert.equal(actions.length, 0);
    assert.equal(warnings.length, 0);
  });

  it("returns a config-patch action for claude-code targeting settings.json", () => {
    const home = "/home/test";
    const { actions, warnings } = compileHookActions(
      { name: "check", agents: ["claude-code"], config: validClaudeHookConfig },
      ["claude-code"],
      home,
    );
    assert.equal(warnings.length, 0);
    assert.equal(actions.length, 1);
    const action = actions[0];
    assert.equal(action.kind, "config-patch");
    assert.ok(
      action.target.endsWith(".claude/settings.json".replace("/", path.sep)),
    );
    assert.equal(action.agent, "claude-code");
    assert.equal(action.confidence, "documented");
  });

  it("accepts a hooks entry with no matcher property on the matcher object", () => {
    const { actions, warnings } = compileHookActions(
      {
        name: "check",
        agents: ["claude-code"],
        config: {
          hooks: {
            Stop: [{ hooks: [{ type: "command", command: "notify.sh" }] }],
          },
        },
      },
      ["claude-code"],
      "/home/test",
    );
    assert.equal(warnings.length, 0);
    assert.equal(actions.length, 1);
  });

  it("emits a warning and skips for agents without a hooks surface", () => {
    const { actions, warnings } = compileHookActions(
      { name: "check", agents: ["gemini-cli"], config: {} },
      ["gemini-cli"],
      "/home/test",
    );
    assert.equal(actions.length, 0);
    assert.equal(warnings.length, 1);
  });

  it("throws on unknown top-level key in config for claude-code", () => {
    assert.throws(
      () =>
        compileHookActions(
          { name: "bad", agents: ["claude-code"], config: { bad_key: {} } },
          ["claude-code"],
          "/home/test",
        ),
      /unrecognized keys/,
    );
  });

  it("throws when hooks value is not an object for claude-code", () => {
    assert.throws(
      () =>
        compileHookActions(
          { name: "bad", agents: ["claude-code"], config: { hooks: "string" } },
          ["claude-code"],
          "/home/test",
        ),
      /must define "hooks" as an object/,
    );
  });

  it("throws when an event value is not an array", () => {
    assert.throws(
      () =>
        compileHookActions(
          {
            name: "bad",
            agents: ["claude-code"],
            config: { hooks: { PreToolUse: "not-array" } },
          },
          ["claude-code"],
          "/home/test",
        ),
      /must be an array/,
    );
  });

  it("throws when a matcher element is not an object", () => {
    assert.throws(
      () =>
        compileHookActions(
          {
            name: "bad",
            agents: ["claude-code"],
            config: { hooks: { PreToolUse: ["string"] } },
          },
          ["claude-code"],
          "/home/test",
        ),
      /must be an object/,
    );
  });

  it("throws when matcher.hooks is missing", () => {
    assert.throws(
      () =>
        compileHookActions(
          {
            name: "bad",
            agents: ["claude-code"],
            config: { hooks: { PreToolUse: [{ matcher: "Bash" }] } },
          },
          ["claude-code"],
          "/home/test",
        ),
      /must be an array/,
    );
  });

  it("throws when a hook command type is not 'command'", () => {
    assert.throws(
      () =>
        compileHookActions(
          {
            name: "bad",
            agents: ["claude-code"],
            config: {
              hooks: {
                PreToolUse: [
                  {
                    hooks: [{ type: "script", command: "check.sh" }],
                  },
                ],
              },
            },
          },
          ["claude-code"],
          "/home/test",
        ),
      /must be "command"/,
    );
  });

  it("throws when a hook command is not a string", () => {
    assert.throws(
      () =>
        compileHookActions(
          {
            name: "bad",
            agents: ["claude-code"],
            config: {
              hooks: {
                PreToolUse: [{ hooks: [{ type: "command", command: 123 }] }],
              },
            },
          },
          ["claude-code"],
          "/home/test",
        ),
      /must be a string/,
    );
  });

  it("throws when matcher.matcher is not a string", () => {
    assert.throws(
      () =>
        compileHookActions(
          {
            name: "bad",
            agents: ["claude-code"],
            config: {
              hooks: {
                PreToolUse: [
                  {
                    matcher: 42,
                    hooks: [{ type: "command", command: "check.sh" }],
                  },
                ],
              },
            },
          },
          ["claude-code"],
          "/home/test",
        ),
      /must be a string when present/,
    );
  });
});

describe("compileAgentDefinitionActions", () => {
  // Import is added inline to avoid modifying the top-level imports block
  // (the function is async so we do a dynamic import once and reuse).
  async function getAdapter() {
    const { compileAgentDefinitionActions } = await import(
      "../../src/core/adapters/agent-definitions.ts"
    );
    return compileAgentDefinitionActions;
  }

  it("returns zero actions and warnings when no detectedAgents overlap", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "agent.md"),
        "---\nname: test-agent\ndescription: test\n---\n# Agent",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compile(
        {
          name: "my-agent",
          agents: ["claude-code"],
          path: "agent.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["codex"],
        "/home/test",
        "/repo/test",
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("does not validate source when no targeted agents overlap", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      // No file created — validation must not run
      const { actions, warnings } = await compile(
        {
          name: "my-agent",
          agents: ["claude-code"],
          path: "missing.md",
          scope: "repo",
        },
        dir,
        dir,
        dir,
        ["codex"],
        "/home/test",
        "/repo/test",
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns a file-write action for claude-code with correct target", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "my-agent.md"),
        "---\nname: test-agent\ndescription: test\ntools: []\n---\n# Agent",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compile(
        {
          name: "my-agent",
          agents: ["claude-code"],
          path: "my-agent.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["claude-code"],
        "/home/test",
        "/repo/test",
      );
      assert.equal(warnings.length, 0);
      assert.equal(actions.length, 1);
      const action = actions[0] as FileWriteDeployAction;
      assert.equal(action.kind, "file-write");
      assert.equal(action.skill, "my-agent");
      assert.equal(action.agent, "claude-code");
      assertPathEndsWith(
        action.target,
        ".claude/agents/my-agent.md",
        `expected target under .claude/agents/my-agent.md, got: ${action.target}`,
      );
      assert.equal(action.confidence, "documented");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns a file-write action for opencode with correct target", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "my-agent.md"),
        "---\nname: test-agent\ndescription: test\ntools: []\n---\n# Agent",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compile(
        {
          name: "my-agent",
          agents: ["opencode"],
          path: "my-agent.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["opencode"],
        "/home/test",
        "/repo/test",
      );
      assert.equal(warnings.length, 0);
      assert.equal(actions.length, 1);
      const action = actions[0] as FileWriteDeployAction;
      assert.equal(action.kind, "file-write");
      assert.equal(action.agent, "opencode");
      assertPathEndsWith(
        action.target,
        ".opencode/agents/my-agent.md",
        `expected target under .opencode/agents/my-agent.md, got: ${action.target}`,
      );
      assert.equal(action.confidence, "documented");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns a file-write action for github-copilot with the new documented target and migration path", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "my-agent.md"),
        "---\nname: test-agent\ndescription: test\ntools: []\n---\n# Agent",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compile(
        {
          name: "my-agent",
          agents: ["github-copilot"],
          path: "my-agent.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["github-copilot"],
        "/home/test",
        "/repo/test",
      );
      assert.equal(warnings.length, 0);
      assert.equal(actions.length, 1);
      const action = actions[0] as FileWriteDeployAction;
      assert.equal(action.kind, "file-write");
      assert.equal(action.agent, "github-copilot");
      assertPathEndsWith(
        action.target,
        ".github/copilot/agents/my-agent.md",
        `expected target under .github/copilot/agents/my-agent.md, got: ${action.target}`,
      );
      assert.deepEqual(action.migratedFrom, [
        "/repo/test/.github/agents/my-agent.agent.md",
      ]);
      assert.equal(action.confidence, "documented");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns a file-write action for antigravity with correct target", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "my-agent.md"),
        "---\nname: test-agent\ndescription: test\ntools: []\n---\n# Agent",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compile(
        {
          name: "my-agent",
          agents: ["antigravity"],
          path: "my-agent.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["antigravity"],
        "/home/test",
        "/repo/test",
      );
      assert.equal(warnings.length, 0);
      assert.equal(actions.length, 1);
      const action = actions[0] as FileWriteDeployAction;
      assert.equal(action.kind, "file-write");
      assert.equal(action.agent, "antigravity");
      assertPathEndsWith(
        action.target,
        ".agents/rules/my-agent.md",
        `expected target under .agents/rules/my-agent.md, got: ${action.target}`,
      );
      assert.equal(action.confidence, "documented");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("emits a warning and no action for codex (unsupported)", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "my-agent.md"),
        "---\nname: test-agent\ndescription: test\ntools: []\n---\n# Agent",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compile(
        {
          name: "my-agent",
          agents: ["codex"],
          path: "my-agent.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["codex"],
        "/home/test",
        "/repo/test",
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0]?.kind, "confidence");
      assert.match(warnings[0]?.message ?? "", /codex/);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when source is a non-Markdown path", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "agent.txt"), "plain text");
      const realRoot = await realpath(dir);
      await assert.rejects(
        compile(
          {
            name: "my-agent",
            agents: ["claude-code"],
            path: "agent.txt",
            scope: "repo",
          },
          dir,
          dir,
          realRoot,
          ["claude-code"],
          "/home/test",
          "/repo/test",
        ),
        /must point to a Markdown source file/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when source file does not exist", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await assert.rejects(
        compile(
          {
            name: "my-agent",
            agents: ["claude-code"],
            path: "nonexistent.md",
            scope: "repo",
          },
          dir,
          dir,
          dir,
          ["claude-code"],
          "/home/test",
          "/repo/test",
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

  it("produces actions for multiple detected agents", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "my-agent.md"),
        "---\nname: test-agent\ndescription: test\ntools: []\n---\n# Agent",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compile(
        {
          name: "my-agent",
          agents: ["claude-code", "opencode", "github-copilot"],
          path: "my-agent.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["claude-code", "opencode", "github-copilot"],
        "/home/test",
        "/repo/test",
      );
      assert.equal(warnings.length, 0);
      assert.equal(actions.length, 3);
      const agentIds = actions.map((a) => a.agent);
      assert.ok(agentIds.includes("claude-code"));
      assert.ok(agentIds.includes("opencode"));
      assert.ok(agentIds.includes("github-copilot"));
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws for github-copilot when missing both tools and instructions", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "bad-copilot.md"),
        "---\nname: test\ndescription: test\n---\n# Bad",
      );
      const realRoot = await realpath(dir);
      await assert.rejects(
        compile(
          {
            name: "bad",
            agents: ["github-copilot"],
            path: "bad-copilot.md",
            scope: "repo",
          },
          dir,
          dir,
          realRoot,
          ["github-copilot"],
          "/home/test",
          "/repo/test",
        ),
        /must define "tools" or "instructions" in frontmatter/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("accepts github-copilot tools as empty array", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "agent.md"),
        "---\nname: test\ndescription: test\ntools: []\n---\n# Agent",
      );
      const realRoot = await realpath(dir);
      const result = await compile(
        {
          name: "agent",
          agents: ["github-copilot"],
          path: "agent.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["github-copilot"],
        "/home/test",
        "/repo/test",
      );
      assert.ok(result.actions.length > 0, "expected at least one action");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("accepts github-copilot tools as array of strings", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "agent.md"),
        "---\nname: test\ndescription: test\ntools:\n  - github\n  - codebase\n---\n# Agent",
      );
      const realRoot = await realpath(dir);
      const result = await compile(
        {
          name: "agent",
          agents: ["github-copilot"],
          path: "agent.md",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["github-copilot"],
        "/home/test",
        "/repo/test",
      );
      assert.ok(result.actions.length > 0, "expected at least one action");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws for github-copilot when tools is not an array", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "bad-tools.md"),
        "---\nname: test\ndescription: test\ntools: not-an-array\n---\n# Bad",
      );
      const realRoot = await realpath(dir);
      await assert.rejects(
        compile(
          {
            name: "bad",
            agents: ["github-copilot"],
            path: "bad-tools.md",
            scope: "repo",
          },
          dir,
          dir,
          realRoot,
          ["github-copilot"],
          "/home/test",
          "/repo/test",
        ),
        /"tools" field that must be an array/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws for github-copilot when tools contains a non-string entry", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "bad-tools.md"),
        "---\nname: test\ndescription: test\ntools:\n  - github\n  - 123\n---\n# Bad",
      );
      const realRoot = await realpath(dir);
      await assert.rejects(
        compile(
          {
            name: "bad",
            agents: ["github-copilot"],
            path: "bad-tools.md",
            scope: "repo",
          },
          dir,
          dir,
          realRoot,
          ["github-copilot"],
          "/home/test",
          "/repo/test",
        ),
        /"tools" entry that must be a string/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws for antigravity when mcp-servers is malformed", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "bad-antigravity.md"),
        "---\nname: test\ndescription: test\nmcp-servers:\n  - not-an-object\n---\n# Bad",
      );
      const realRoot = await realpath(dir);
      await assert.rejects(
        compile(
          {
            name: "bad",
            agents: ["antigravity"],
            path: "bad-antigravity.md",
            scope: "repo",
          },
          dir,
          dir,
          realRoot,
          ["antigravity"],
          "/home/test",
          "/repo/test",
        ),
        /must define "mcp-servers" as an object/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws for antigravity when individual MCP config is missing required fields", async () => {
    const compile = await getAdapter();
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "bad-mcp-config.md"),
        "---\nname: test\ndescription: test\nmcp-servers:\n  my-server: { args: [] }\n---\n# Bad",
      );
      const realRoot = await realpath(dir);
      await assert.rejects(
        compile(
          {
            name: "bad",
            agents: ["antigravity"],
            path: "bad-mcp-config.md",
            scope: "repo",
          },
          dir,
          dir,
          realRoot,
          ["antigravity"],
          "/home/test",
          "/repo/test",
        ),
        /must define either a non-empty "command" or "url"/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
