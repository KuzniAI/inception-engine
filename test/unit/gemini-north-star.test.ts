import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { compileAgentDefinitionActions } from "../../src/core/adapters/agent-definitions.ts";
import { runPreflight } from "../../src/core/preflight.ts";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { makeTmpDir } from "../helpers/fs.ts";
import { assertPathEndsWith } from "../helpers/path.ts";

describe("Gemini CLI North Star", () => {
  it("compiles a global file-write action for gemini-cli when scope is global (.md)", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "my-agent.md"),
        "---\nname: test-agent\ndescription: test\ntools: []\n---\n# Agent",
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentDefinitionActions(
        {
          name: "my-agent",
          agents: ["gemini-cli"],
          path: "my-agent.md",
          scope: "global",
        },
        dir,
        dir,
        realRoot,
        ["gemini-cli"],
        "/home/test",
        "/repo/test",
      );

      assert.equal(warnings.length, 0);
      assert.equal(actions.length, 1);
      const action = actions[0];
      assert.equal(action.agent, "gemini-cli");
      assertPathEndsWith(
        action.target,
        ".gemini/agents/my-agent.md",
        `expected target under .gemini/agents/my-agent.md, got: ${action.target}`,
      );
      assert.ok(
        action.target.startsWith("/home/test"),
        `expected target to start with /home/test, got: ${action.target}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("deploys .toml source to .gemini/agents/{name}.toml for gemini-cli (global scope)", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "my-agent.toml"),
        '[agent]\nname = "my-agent"\ndescription = "test"\n',
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentDefinitionActions(
        {
          name: "my-agent",
          agents: ["gemini-cli"],
          path: "my-agent.toml",
          scope: "global",
        },
        dir,
        dir,
        realRoot,
        ["gemini-cli"],
        "/home/test",
        "/repo/test",
      );

      assert.equal(warnings.length, 0);
      assert.equal(actions.length, 1);
      const action = actions[0];
      assert.equal(action.agent, "gemini-cli");
      assertPathEndsWith(
        action.target,
        ".gemini/agents/my-agent.toml",
        `expected target under .gemini/agents/my-agent.toml, got: ${action.target}`,
      );
      assert.ok(
        action.target.startsWith("/home/test"),
        `expected target to start with /home/test, got: ${action.target}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("deploys .toml source to .gemini/agents/{name}.toml for gemini-cli (repo scope)", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "my-agent.toml"),
        '[agent]\nname = "my-agent"\ndescription = "test"\n',
      );
      const realRoot = await realpath(dir);
      const { actions, warnings } = await compileAgentDefinitionActions(
        {
          name: "my-agent",
          agents: ["gemini-cli"],
          path: "my-agent.toml",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["gemini-cli"],
        "/home/test",
        "/repo/test",
      );

      assert.equal(warnings.length, 0);
      assert.equal(actions.length, 1);
      const action = actions[0];
      assert.equal(action.agent, "gemini-cli");
      assertPathEndsWith(
        action.target,
        ".gemini/agents/my-agent.toml",
        `expected target under .gemini/agents/my-agent.toml, got: ${action.target}`,
      );
      assert.ok(
        action.target.startsWith("/repo/test"),
        `expected target to start with /repo/test, got: ${action.target}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("produces no action for .toml agentDefinition targeting an agent without a TOML surface", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "my-agent.toml"),
        '[agent]\nname = "my-agent"\ndescription = "test"\n',
      );
      const realRoot = await realpath(dir);
      // claude-code has no TOML surface — should silently produce no action
      const { actions, warnings } = await compileAgentDefinitionActions(
        {
          name: "my-agent",
          agents: ["claude-code"],
          path: "my-agent.toml",
          scope: "repo",
        },
        dir,
        dir,
        realRoot,
        ["claude-code"],
        "/home/test",
        "/repo/test",
      );

      assert.equal(
        actions.length,
        0,
        "expected no action for agent without TOML surface",
      );
      assert.equal(warnings.length, 0, "expected no warnings");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("emits no planned-surface warnings for Gemini CLI after alignment", async () => {
    const warnings = await runPreflight(
      {
        directory: "/test",
        command: "deploy",
        dryRun: false,
        agents: ["gemini-cli"],
        verbose: false,
        debug: false,
        force: false,
      },
      {
        skills: [],
        mcpServers: [],
        agentRules: [
          {
            name: "rules",
            agents: ["gemini-cli"],
            path: "rules.md",
            scope: "global",
          },
        ],
        agentDefinitions: [
          {
            name: "agent",
            agents: ["gemini-cli"],
            path: "agent.md",
            scope: "global",
          },
        ],
        files: [],
        configs: [],
      },
      "/home/test",
      ["gemini-cli"],
    );

    // None of the old "planned" surface messages should appear after alignment
    assert.ok(
      !warnings.some((w) =>
        w.message.includes("TOML subagent definitions are documented"),
      ),
      "unexpected warning for TOML subagent definitions",
    );
    assert.ok(
      !warnings.some((w) =>
        w.message.includes("Instruction filename overrides are documented"),
      ),
      "unexpected warning for configurable instruction filenames",
    );
    assert.ok(
      !warnings.some((w) =>
        w.message.includes("Gemini CLI loads AGENTS.md natively"),
      ),
      "unexpected warning for AGENTS.md instructions fallback",
    );
  });

  it("emits config-authority warning when settings.json sets a non-default instructionFilename", async () => {
    const home = await makeTmpDir();
    try {
      await mkdir(path.join(home, ".gemini"), { recursive: true });
      await writeFile(
        path.join(home, ".gemini", "settings.json"),
        JSON.stringify({ instructionFilename: "CUSTOM.md" }),
      );

      const warnings = await runPreflight(
        {
          directory: "/test",
          command: "deploy",
          dryRun: false,
          agents: ["gemini-cli"],
          verbose: false,
          debug: false,
          force: false,
        },
        {
          skills: [],
          mcpServers: [],
          agentRules: [
            {
              name: "rules",
              agents: ["gemini-cli"],
              path: "rules.md",
              scope: "global",
            },
          ],
          agentDefinitions: [],
          files: [],
          configs: [],
        },
        home,
        ["gemini-cli"],
      );

      const filenameWarning = warnings.find(
        (w) => w.kind === "config-authority" && w.message.includes("CUSTOM.md"),
      );
      assert.ok(
        filenameWarning,
        `expected config-authority warning about CUSTOM.md, got: ${JSON.stringify(warnings)}`,
      );
      assert.match(filenameWarning.message, /instructionFilename/);
      assert.match(filenameWarning.message, /GEMINI\.md/);
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("emits no warning when settings.json sets instructionFilename to GEMINI.md", async () => {
    const home = await makeTmpDir();
    try {
      await mkdir(path.join(home, ".gemini"), { recursive: true });
      await writeFile(
        path.join(home, ".gemini", "settings.json"),
        JSON.stringify({ instructionFilename: "GEMINI.md" }),
      );

      const warnings = await runPreflight(
        {
          directory: "/test",
          command: "deploy",
          dryRun: false,
          agents: ["gemini-cli"],
          verbose: false,
          debug: false,
          force: false,
        },
        {
          skills: [],
          mcpServers: [],
          agentRules: [
            {
              name: "rules",
              agents: ["gemini-cli"],
              path: "rules.md",
              scope: "global",
            },
          ],
          agentDefinitions: [],
          files: [],
          configs: [],
        },
        home,
        ["gemini-cli"],
      );

      const filenameWarning = warnings.find(
        (w) =>
          w.kind === "config-authority" &&
          w.message.includes("instructionFilename"),
      );
      assert.equal(
        filenameWarning,
        undefined,
        `expected no filename warning when override matches deploy target, got: ${filenameWarning?.message}`,
      );
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("emits no warning when settings.json is absent", async () => {
    const home = await makeTmpDir();
    try {
      // No .gemini/settings.json file — detection should silently return null
      const warnings = await runPreflight(
        {
          directory: "/test",
          command: "deploy",
          dryRun: false,
          agents: ["gemini-cli"],
          verbose: false,
          debug: false,
          force: false,
        },
        {
          skills: [],
          mcpServers: [],
          agentRules: [
            {
              name: "rules",
              agents: ["gemini-cli"],
              path: "rules.md",
              scope: "global",
            },
          ],
          agentDefinitions: [],
          files: [],
          configs: [],
        },
        home,
        ["gemini-cli"],
      );

      const filenameWarning = warnings.find(
        (w) =>
          w.kind === "config-authority" &&
          w.message.includes("instructionFilename"),
      );
      assert.equal(
        filenameWarning,
        undefined,
        `expected no filename warning when settings.json is absent, got: ${filenameWarning?.message}`,
      );
    } finally {
      await rm(home, { recursive: true });
    }
  });
});
