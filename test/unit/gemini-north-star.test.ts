import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { compileAgentDefinitionActions } from "../../src/core/adapters/agent-definitions.ts";
import { runPreflight } from "../../src/core/preflight.ts";
import { realpath, rm, writeFile } from "node:fs/promises";
import { makeTmpDir } from "../helpers/fs.ts";
import { normalizeSlashes } from "../helpers/path.ts";

describe("Gemini CLI North Star", () => {
  it("compiles a global file-write action for gemini-cli when scope is global", async () => {
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
      assert.ok(
        normalizeSlashes(action.target).endsWith(".gemini/agents/my-agent.md"),
        `expected target under .gemini/agents/my-agent.md, got: ${action.target}`,
      );
      // Verify it targets home directory
      assert.ok(
        action.target.startsWith("/home/test"),
        `expected target to start with /home/test, got: ${action.target}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("emits planned-surface warnings for Gemini CLI when using agentRules or agentDefinitions", async () => {
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

    assert.ok(
      warnings.some((w) =>
        w.message.includes("TOML subagent definitions are documented"),
      ),
      "expected warning for TOML subagent definitions",
    );
    assert.ok(
      warnings.some((w) =>
        w.message.includes("Instruction filename overrides are documented"),
      ),
      "expected warning for configurable instruction filenames",
    );
    assert.ok(
      warnings.some((w) =>
        w.message.includes("Gemini CLI loads AGENTS.md natively"),
      ),
      "expected warning for AGENTS.md instructions fallback",
    );
  });
});
