import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { lookupDeployment, registerDeployment } from "../../../src/core/ownership.ts";
import { executeRevert } from "../../../src/core/revert.ts";
import type {
  ConfigPatchRevertAction,
  FileWriteRevertAction,
} from "../../../src/types.ts";
import { makeTmpDir } from "../../helpers/skill-dir.ts";

describe("revert integration (Windows)", {
  skip: process.platform !== "win32",
}, () => {
  it("reverts a deployed mcpServer config-patch and unregisters it", async () => {
    const home = makeTmpDir("ie-revert-home");
    try {
      const configFile = path.join(home, ".claude.json");
      writeFileSync(
        configFile,
        JSON.stringify({
          other: "value",
          mcpServers: { "my-mcp": { command: "npx" } },
        }),
      );

      await registerDeployment(home, configFile, {
        kind: "config-patch",
        patch: { mcpServers: { "my-mcp": { command: "npx" } } },
        undoPatch: { mcpServers: null },
        skill: "my-mcp",
        agent: "claude-code",
      });

      const action: ConfigPatchRevertAction = {
        kind: "config-patch",
        skill: "my-mcp",
        agent: "claude-code",
        target: configFile,
      };

      const { succeeded, failed } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.deepEqual(JSON.parse(readFileSync(configFile, "utf-8")), {
        other: "value",
      });
      assert.equal(await lookupDeployment(home, configFile), null);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reverts a deployed agentRule file-write and unregisters it", async () => {
    const home = makeTmpDir("ie-revert-home");
    try {
      const rulesFile = path.join(home, ".claude", "CLAUDE.md");
      mkdirSync(path.dirname(rulesFile), { recursive: true });
      writeFileSync(rulesFile, "# My Rules\n");

      await registerDeployment(home, rulesFile, {
        kind: "file-write",
        source: "/some/source/CLAUDE.md",
        skill: "my-rules",
        agent: "claude-code",
      });

      const action: FileWriteRevertAction = {
        kind: "file-write",
        skill: "my-rules",
        agent: "claude-code",
        target: rulesFile,
      };

      const { succeeded, failed } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(!existsSync(rulesFile));
      assert.equal(await lookupDeployment(home, rulesFile), null);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
