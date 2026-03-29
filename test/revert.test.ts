import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { lookupDeployment, registerDeployment } from "../src/core/ownership.ts";
import {
  executeRevert,
  planRevert,
  planRevertAll,
} from "../src/core/revert.ts";
import { logger } from "../src/logger.ts";
import type {
  ConfigPatchRevertAction,
  FileWriteRevertAction,
  Manifest,
} from "../src/types.ts";

logger.silence();

function makeTmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ie-test-revert-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

const testManifest: Manifest = {
  skills: [
    { name: "test-skill", path: "skills/test-skill", agents: ["claude-code"] },
  ],
  mcpServers: [],
  agentRules: [],
};

describe("planRevert", () => {
  it("creates revert actions for detected agents", () => {
    const actions = planRevert(testManifest, ["claude-code"], "/home/test");
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.skill, "test-skill");
    assert.equal(actions[0]?.agent, "claude-code");
  });

  it("skips agents not detected", () => {
    const actions = planRevert(testManifest, ["codex"], "/home/test");
    assert.equal(actions.length, 0);
  });
});

describe("planRevertAll", () => {
  it("creates revert actions for all agents in manifest regardless of detection", () => {
    const multiAgentManifest: Manifest = {
      skills: [
        {
          name: "test-skill",
          path: "skills/test-skill",
          agents: ["claude-code", "codex", "gemini-cli"],
        },
      ],
      mcpServers: [],
      agentRules: [],
    };
    const actions = planRevertAll(multiAgentManifest, "/home/test");
    assert.equal(actions.length, 3);
    const agentIds = actions.map((a) => a.agent);
    assert.ok(agentIds.includes("claude-code"));
    assert.ok(agentIds.includes("codex"));
    assert.ok(agentIds.includes("gemini-cli"));
  });
});

describe("executeRevert", { skip: process.platform === "win32" }, () => {
  it("removes a symlink registered in the deployment registry", async () => {
    const home = makeTmpDir();
    const sourceDir = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      // Create symlink and register in registry
      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(sourceDir, target, "dir");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: sourceDir,
        skill: "test-skill",
        agent: "claude-code",
        method: "symlink",
      });
      assert.ok(existsSync(target));

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(skipped, 0);
      assert.ok(!existsSync(target));

      // Registry entry should be removed
      const entry = await lookupDeployment(home, target);
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("removes a copied directory registered in the deployment registry", async () => {
    const home = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "SKILL.md"), "test");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/original/source",
        skill: "test-skill",
        agent: "claude-code",
        method: "copy",
      });

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(skipped, 0);
      assert.ok(!existsSync(target));

      // Registry entry should be removed
      const entry = await lookupDeployment(home, target);
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("skips missing targets", async () => {
    const home = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("records a failure when removal is blocked by permissions", async () => {
    const home = makeTmpDir();
    const sourceDir = makeTmpDir();
    const actions = planRevert(testManifest, ["claude-code"], home);
    const target = actions[0]?.target ?? "";
    const targetParent = path.dirname(target);
    try {
      // Create the target directory and register it
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "SKILL.md"), "test");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: sourceDir,
        skill: "test-skill",
        agent: "claude-code",
        method: "copy",
      });

      // Make the parent directory non-writable so rm() fails
      chmodSync(targetParent, 0o555);

      const { succeeded, skipped, failed } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 0);
      assert.equal(failed.length, 1);
    } finally {
      chmodSync(targetParent, 0o755);
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("does not remove in dry-run mode", async () => {
    const home = makeTmpDir();
    const sourceDir = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(sourceDir, target, "dir");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: sourceDir,
        skill: "test-skill",
        agent: "claude-code",
        method: "symlink",
      });

      const { succeeded } = await executeRevert(actions, true, false, home);
      assert.equal(succeeded, 1);
      assert.ok(existsSync(target), "symlink should still exist after dry-run");

      // Registry entry should still exist after dry-run
      const entry = await lookupDeployment(home, target);
      assert.ok(entry, "registry entry should still exist after dry-run");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("skips target that exists but is not in registry", async () => {
    const home = makeTmpDir();
    const sourceDir = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      // Create symlink but do NOT register — should be treated as unmanaged
      writeFileSync(path.join(sourceDir, "SKILL.md"), "---");
      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(sourceDir, target, "dir");

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.ok(existsSync(target), "symlink should still exist — not managed");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("skips directory that exists but is not in registry", async () => {
    const home = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "SKILL.md"), "user content");

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.ok(
        existsSync(target),
        "directory should still exist — not in registry",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("skips target whose registry entry has mismatched skill or agent", async () => {
    const home = makeTmpDir();
    const sourceDir = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      // Create symlink and register under a different skill/agent
      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(sourceDir, target, "dir");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: sourceDir,
        skill: "different-skill",
        agent: "codex",
        method: "symlink",
      });

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.ok(
        existsSync(target),
        "symlink should still exist — registry entry does not match",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true });
    }
  });
});

// Copy-method revert does not rely on symlinks and works identically on all
// platforms. This suite has no Windows guard intentionally.
describe("executeRevert — copy method (cross-platform)", () => {
  it("removes a copy-deployed skill registered in the deployment registry", async () => {
    const home = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;
      assert.ok(target, "planRevert should produce an action");

      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "SKILL.md"), "---\nname: test-skill\n");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/original/source/skills/test-skill",
        skill: "test-skill",
        agent: "claude-code",
        method: "copy",
      });
      assert.ok(existsSync(target));

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(skipped, 0);
      assert.ok(!existsSync(target), "copy directory should be removed");

      const entry = await lookupDeployment(home, target);
      assert.equal(entry, null, "registry entry should be cleared");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("skips an unmanaged directory that is not in the registry", async () => {
    const home = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;
      assert.ok(target);

      // Create the directory but do NOT register it
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "SKILL.md"), "---\nname: test-skill\n");

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.ok(existsSync(target), "unmanaged directory should be untouched");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("skips when the target does not exist at all", async () => {
    const home = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("records a failure when unregistering is blocked by permissions on Windows", {
    skip: process.platform !== "win32",
  }, async () => {
    const home = makeTmpDir();
    const sourceDir = makeTmpDir();
    const actions = planRevert(testManifest, ["claude-code"], home);
    const target = actions[0]?.target ?? "";
    try {
      mkdirSync(target, { recursive: true });
      const blockedFile = path.join(target, "SKILL.md");
      writeFileSync(blockedFile, "test");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: sourceDir,
        skill: "test-skill",
        agent: "claude-code",
        method: "copy",
      });

      const registryFile = path.join(
        home,
        ".inception-engine",
        "registry.json",
      );
      chmodSync(registryFile, 0o444);

      const { succeeded, skipped, failed } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 0);
      assert.equal(failed.length, 1);
    } finally {
      try {
        chmodSync(path.join(home, ".inception-engine", "registry.json"), 0o666);
      } catch {
        /* best effort */
      }
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });
});

describe("executeRevert — file-write", () => {
  it("deletes the written file and unregisters", async () => {
    const home = makeTmpDir();
    try {
      const targetFile = path.join(home, "written-file.txt");
      writeFileSync(targetFile, "managed content");

      await registerDeployment(home, targetFile, {
        kind: "file-write",
        source: "/some/source.txt",
        skill: "test-skill",
        agent: "claude-code",
      });

      const action: FileWriteRevertAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        target: targetFile,
      };

      const { succeeded, skipped } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(skipped, 0);
      assert.ok(!existsSync(targetFile), "file should be deleted");

      const entry = await lookupDeployment(home, targetFile);
      assert.equal(entry, null, "registry entry should be removed");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("skips missing target", async () => {
    const home = makeTmpDir();
    try {
      const action: FileWriteRevertAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        target: path.join(home, "nonexistent.txt"),
      };

      const { succeeded, skipped } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("skips unmanaged file not in registry", async () => {
    const home = makeTmpDir();
    try {
      const targetFile = path.join(home, "unmanaged.txt");
      writeFileSync(targetFile, "user content");

      const action: FileWriteRevertAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        target: targetFile,
      };

      const { succeeded, skipped } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.ok(existsSync(targetFile), "unmanaged file should not be deleted");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dry-run does not delete file and returns planned change", async () => {
    const home = makeTmpDir();
    try {
      const targetFile = path.join(home, "file.txt");
      writeFileSync(targetFile, "content");

      await registerDeployment(home, targetFile, {
        kind: "file-write",
        source: "/src/file.txt",
        skill: "test-skill",
        agent: "claude-code",
      });

      const action: FileWriteRevertAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        target: targetFile,
      };

      const { succeeded, planned } = await executeRevert(
        [action],
        true,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.ok(
        existsSync(targetFile),
        "file should still exist after dry-run",
      );
      assert.equal(planned.length, 1);
      assert.equal(planned[0]?.verb, "remove");
      assert.equal(planned[0]?.kind, "file-write");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("executeRevert — config-patch", () => {
  it("restores original values from undoPatch", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      // Current state after patching: b was changed to 99, c was added
      writeFileSync(configFile, JSON.stringify({ a: 1, b: 99, c: 3 }));

      await registerDeployment(home, configFile, {
        kind: "config-patch",
        patch: { b: 99, c: 3 },
        undoPatch: { b: 2, c: null }, // b was 2, c was absent
        skill: "test-skill",
        agent: "claude-code",
      });

      const action: ConfigPatchRevertAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
      };

      const { succeeded, skipped } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(skipped, 0);

      const restored = JSON.parse(readFileSync(configFile, "utf-8"));
      assert.equal(restored.a, 1);
      assert.equal(restored.b, 2); // restored to original
      assert.equal("c" in restored, false); // deleted (was absent before)

      const entry = await lookupDeployment(home, configFile);
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("deletes keys that were added by the patch (undoPatch value null)", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      writeFileSync(configFile, JSON.stringify({ a: 1, newKey: "added" }));

      await registerDeployment(home, configFile, {
        kind: "config-patch",
        patch: { newKey: "added" },
        undoPatch: { newKey: null },
        skill: "test-skill",
        agent: "claude-code",
      });

      const action: ConfigPatchRevertAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
      };

      await executeRevert([action], false, false, home);
      const restored = JSON.parse(readFileSync(configFile, "utf-8"));
      assert.equal(restored.a, 1);
      assert.equal("newKey" in restored, false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("skips when config file is gone", async () => {
    const home = makeTmpDir();
    try {
      const action: ConfigPatchRevertAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: path.join(home, "gone.json"),
      };

      const { succeeded, skipped } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("skips when no registry entry exists", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      writeFileSync(configFile, JSON.stringify({ a: 1 }));

      const action: ConfigPatchRevertAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
      };

      const { succeeded, skipped } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      // File should be untouched
      const content = JSON.parse(readFileSync(configFile, "utf-8"));
      assert.equal(content.a, 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dry-run does not modify config and returns planned change", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      writeFileSync(configFile, JSON.stringify({ a: 1, b: 99 }));

      await registerDeployment(home, configFile, {
        kind: "config-patch",
        patch: { b: 99 },
        undoPatch: { b: 2 },
        skill: "test-skill",
        agent: "claude-code",
      });

      const action: ConfigPatchRevertAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
      };

      const { succeeded, planned } = await executeRevert(
        [action],
        true,
        false,
        home,
      );
      assert.equal(succeeded, 1);

      const after = JSON.parse(readFileSync(configFile, "utf-8"));
      assert.equal(after.b, 99, "config should be unchanged after dry-run");

      assert.equal(planned.length, 1);
      assert.equal(planned[0]?.verb, "unapply-patch");
      assert.equal(planned[0]?.kind, "config-patch");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("planRevert — mcpServers and agentRules", () => {
  const home = "/home/test";

  it("produces a config-patch action for an mcpServer matched to a detected agent", () => {
    const manifest: Manifest = {
      skills: [],
      mcpServers: [
        {
          name: "my-mcp",
          agents: ["claude-code"],
          config: { command: "npx", args: ["-y", "my-mcp"] },
        },
      ],
      agentRules: [],
    };
    const actions = planRevert(manifest, ["claude-code"], home);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.kind, "config-patch");
    assert.equal(actions[0]?.skill, "my-mcp");
    assert.equal(actions[0]?.agent, "claude-code");
  });

  it("skips mcpServer agents not in detectedAgents", () => {
    const manifest: Manifest = {
      skills: [],
      mcpServers: [
        {
          name: "my-mcp",
          agents: ["claude-code"],
          config: { command: "npx" },
        },
      ],
      agentRules: [],
    };
    const actions = planRevert(manifest, ["codex"], home);
    assert.equal(actions.length, 0);
  });

  it("produces a file-write action for an agentRule matched to a detected agent", () => {
    const manifest: Manifest = {
      skills: [],
      mcpServers: [],
      agentRules: [
        { name: "my-rules", path: "rules/CLAUDE.md", agents: ["claude-code"] },
      ],
    };
    const actions = planRevert(manifest, ["claude-code"], home);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.kind, "file-write");
    assert.equal(actions[0]?.skill, "my-rules");
    assert.equal(actions[0]?.agent, "claude-code");
  });

  it("skips agentRule agents not in detectedAgents", () => {
    const manifest: Manifest = {
      skills: [],
      mcpServers: [],
      agentRules: [
        { name: "my-rules", path: "rules/CLAUDE.md", agents: ["claude-code"] },
      ],
    };
    const actions = planRevert(manifest, ["codex"], home);
    assert.equal(actions.length, 0);
  });
});

describe("planRevertAll — mcpServers and agentRules", () => {
  const home = "/home/test";

  it("includes mcpServer actions for all listed agents regardless of detection", () => {
    const manifest: Manifest = {
      skills: [],
      mcpServers: [
        {
          name: "my-mcp",
          agents: ["claude-code", "gemini-cli"],
          config: { command: "npx" },
        },
      ],
      agentRules: [],
    };
    const actions = planRevertAll(manifest, home);
    assert.equal(actions.length, 2);
    const agents = actions.map((a) => a.agent);
    assert.ok(agents.includes("claude-code"));
    assert.ok(agents.includes("gemini-cli"));
  });

  it("includes agentRule actions for all listed agents regardless of detection", () => {
    const manifest: Manifest = {
      skills: [],
      mcpServers: [],
      agentRules: [
        {
          name: "my-rules",
          path: "rules/CLAUDE.md",
          agents: ["claude-code", "codex"],
        },
      ],
    };
    const actions = planRevertAll(manifest, home);
    assert.equal(actions.length, 2);
    const agents = actions.map((a) => a.agent);
    assert.ok(agents.includes("claude-code"));
    assert.ok(agents.includes("codex"));
  });
});

describe("executeRevert — mcpServer and agentRule integration", {
  skip: process.platform === "win32",
}, () => {
  it("reverts a deployed mcpServer config-patch and unregisters it", async () => {
    const home = makeTmpDir();
    try {
      // Simulate a deployed mcpServer: config file with mcpServers key patched in
      const configFile = path.join(home, ".claude.json");
      const original = { other: "value" };
      const patched = {
        other: "value",
        mcpServers: { "my-mcp": { command: "npx" } },
      };
      writeFileSync(configFile, JSON.stringify(patched));

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

      const restored = JSON.parse(readFileSync(configFile, "utf-8"));
      assert.deepEqual(restored, original);

      const entry = await lookupDeployment(home, configFile);
      assert.equal(
        entry,
        null,
        "registry entry should be removed after revert",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reverts a deployed agentRule file-write and unregisters it", async () => {
    const home = makeTmpDir();
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

      assert.ok(
        !existsSync(rulesFile),
        "rules file should be removed after revert",
      );

      const entry = await lookupDeployment(home, rulesFile);
      assert.equal(
        entry,
        null,
        "registry entry should be removed after revert",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dry-run for mcpServer revert returns planned change without modifying config", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, ".claude.json");
      const patched = { mcpServers: { "my-mcp": { command: "npx" } } };
      writeFileSync(configFile, JSON.stringify(patched));

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

      const { succeeded, planned } = await executeRevert(
        [action],
        true,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(planned.length, 1);
      assert.equal(planned[0]?.verb, "unapply-patch");

      const unchanged = JSON.parse(readFileSync(configFile, "utf-8"));
      assert.deepEqual(
        unchanged,
        patched,
        "config should be unchanged during dry-run",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dry-run for agentRule revert returns planned change without deleting file", async () => {
    const home = makeTmpDir();
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

      const { succeeded, planned } = await executeRevert(
        [action],
        true,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(planned.length, 1);
      assert.equal(planned[0]?.verb, "remove");
      assert.equal(planned[0]?.kind, "file-write");

      assert.ok(
        existsSync(rulesFile),
        "rules file should still exist after dry-run",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
