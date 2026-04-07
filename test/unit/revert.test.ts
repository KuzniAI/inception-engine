import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  lookupDeployment,
  registerDeployment,
} from "../../src/core/ownership.ts";
import {
  executeRevert,
  planRevert,
  planRevertAll,
} from "../../src/core/revert.ts";
import { logger } from "../../src/logger.ts";
import type {
  ConfigPatchRevertAction,
  FileWriteRevertAction,
  FrontmatterEmitRevertAction,
  Manifest,
} from "../../src/types.ts";
import { exists, makeTmpDir } from "../helpers/fs.ts";

logger.silence();

const testManifest: Manifest = {
  skills: [
    { name: "test-skill", path: "skills/test-skill", agents: ["claude-code"] },
  ],
  files: [],
  configs: [],
  mcpServers: [],
  agentRules: [],
  permissions: [],
  agentDefinitions: [],
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
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
    };
    const actions = planRevertAll(multiAgentManifest, "/home/test");
    assert.equal(actions.length, 3);
    const agentIds = actions.map((a) => a.agent);
    assert.ok(agentIds.includes("claude-code"));
    assert.ok(agentIds.includes("codex"));
    assert.ok(agentIds.includes("gemini-cli"));
  });

  it("keeps skill-dir revert coverage for current agent-definition surfaces", () => {
    const manifest: Manifest = {
      skills: [
        {
          name: "test-skill",
          path: "skills/test-skill",
          agents: [
            "claude-code",
            "codex",
            "gemini-cli",
            "antigravity",
            "opencode",
          ],
        },
      ],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
    };
    const actions = planRevertAll(manifest, "/home/test");
    assert.equal(actions.length, 5);
    const targets = new Map(
      actions.map((action) => [action.agent, action.target]),
    );
    assert.match(
      targets.get("claude-code") ?? "",
      /\.claude[\\/]skills[\\/]test-skill$/,
    );
    assert.match(
      targets.get("codex") ?? "",
      /\.codex[\\/]skills[\\/]test-skill$/,
    );
    assert.match(
      targets.get("gemini-cli") ?? "",
      /\.gemini[\\/]skills[\\/]test-skill$/,
    );
    assert.match(
      targets.get("antigravity") ?? "",
      /\.gemini[\\/]antigravity[\\/]skills[\\/]test-skill$/,
    );
    assert.match(
      targets.get("opencode") ?? "",
      /opencode[\\/]skills[\\/]test-skill$/,
    );
  });
});

describe("executeRevert", { skip: process.platform === "win32" }, () => {
  it("removes a symlink registered in the deployment registry", async () => {
    const home = await makeTmpDir();
    const sourceDir = await makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      // Create symlink and register in registry
      await mkdir(path.dirname(target), { recursive: true });
      await symlink(sourceDir, target, "dir");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: sourceDir,
        skill: "test-skill",
        agent: "claude-code",
        method: "symlink",
      });
      assert.ok(await exists(target));

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(skipped, 0);
      assert.ok(!(await exists(target)));

      // Registry entry should be removed
      const entry = await lookupDeployment(home, target);
      assert.equal(entry, null);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true });
    }
  });

  it("removes a copied directory registered in the deployment registry", async () => {
    const home = await makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), "test");
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
      assert.ok(!(await exists(target)));

      // Registry entry should be removed
      const entry = await lookupDeployment(home, target);
      assert.equal(entry, null);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips missing targets", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true });
    }
  });

  it("records a failure when removal is blocked by permissions", async () => {
    const home = await makeTmpDir();
    const sourceDir = await makeTmpDir();
    const actions = planRevert(testManifest, ["claude-code"], home);
    const target = actions[0]?.target ?? "";
    const targetParent = path.dirname(target);
    try {
      // Create the target directory and register it
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), "test");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: sourceDir,
        skill: "test-skill",
        agent: "claude-code",
        method: "copy",
      });

      // Make the parent directory non-writable so rm() fails
      await chmod(targetParent, 0o555);

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
      await chmod(targetParent, 0o755);
      await rm(home, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("does not remove in dry-run mode", async () => {
    const home = await makeTmpDir();
    const sourceDir = await makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      await mkdir(path.dirname(target), { recursive: true });
      await symlink(sourceDir, target, "dir");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: sourceDir,
        skill: "test-skill",
        agent: "claude-code",
        method: "symlink",
      });

      const { succeeded } = await executeRevert(actions, true, false, home);
      assert.equal(succeeded, 1);
      assert.ok(
        await exists(target),
        "symlink should still exist after dry-run",
      );

      // Registry entry should still exist after dry-run
      const entry = await lookupDeployment(home, target);
      assert.ok(entry, "registry entry should still exist after dry-run");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true });
    }
  });

  it("skips target that exists but is not in registry", async () => {
    const home = await makeTmpDir();
    const sourceDir = await makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      // Create symlink but do NOT register — should be treated as unmanaged
      await writeFile(path.join(sourceDir, "SKILL.md"), "---");
      await mkdir(path.dirname(target), { recursive: true });
      await symlink(sourceDir, target, "dir");

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.ok(
        await exists(target),
        "symlink should still exist — not managed",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true });
    }
  });

  it("skips directory that exists but is not in registry", async () => {
    const home = await makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), "user content");

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.ok(
        await exists(target),
        "directory should still exist — not in registry",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips target whose registry entry has mismatched skill or agent", async () => {
    const home = await makeTmpDir();
    const sourceDir = await makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;

      // Create symlink and register under a different skill/agent
      await mkdir(path.dirname(target), { recursive: true });
      await symlink(sourceDir, target, "dir");
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
        await exists(target),
        "symlink should still exist — registry entry does not match",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true });
    }
  });
});

// Copy-method revert does not rely on symlinks and works identically on all
// platforms. This suite has no Windows guard intentionally.
describe("executeRevert — copy method (cross-platform)", () => {
  it("removes a copy-deployed skill registered in the deployment registry", async () => {
    const home = await makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;
      assert.ok(target, "planRevert should produce an action");

      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), "---\nname: test-skill\n");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/original/source/skills/test-skill",
        skill: "test-skill",
        agent: "claude-code",
        method: "copy",
      });
      assert.ok(await exists(target));

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(skipped, 0);
      assert.ok(!(await exists(target)), "copy directory should be removed");

      const entry = await lookupDeployment(home, target);
      assert.equal(entry, null, "registry entry should be cleared");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips an unmanaged directory that is not in the registry", async () => {
    const home = await makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]?.target;
      assert.ok(target);

      // Create the directory but do NOT register it
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), "---\nname: test-skill\n");

      const { succeeded, skipped } = await executeRevert(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.ok(
        await exists(target),
        "unmanaged directory should be untouched",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips when the target does not exist at all", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("records a failure when unregistering is blocked by permissions on Windows", {
    skip: process.platform !== "win32",
  }, async () => {
    const home = await makeTmpDir();
    const sourceDir = await makeTmpDir();
    const actions = planRevert(testManifest, ["claude-code"], home);
    const target = actions[0]?.target ?? "";
    try {
      await mkdir(target, { recursive: true });
      const blockedFile = path.join(target, "SKILL.md");
      await writeFile(blockedFile, "test");
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
      await chmod(registryFile, 0o444);

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
        await chmod(
          path.join(home, ".inception-engine", "registry.json"),
          0o666,
        );
      } catch {
        /* best effort */
      }
      await rm(home, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });
});

describe("executeRevert — file-write", () => {
  it("deletes the written file and unregisters", async () => {
    const home = await makeTmpDir();
    try {
      const targetFile = path.join(home, "written-file.txt");
      await writeFile(targetFile, "managed content");

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
      assert.ok(!(await exists(targetFile)), "file should be deleted");

      const entry = await lookupDeployment(home, targetFile);
      assert.equal(entry, null, "registry entry should be removed");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips missing target", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips unmanaged file not in registry", async () => {
    const home = await makeTmpDir();
    try {
      const targetFile = path.join(home, "unmanaged.txt");
      await writeFile(targetFile, "user content");

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
      assert.ok(
        await exists(targetFile),
        "unmanaged file should not be deleted",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("dry-run does not delete file and returns planned change", async () => {
    const home = await makeTmpDir();
    try {
      const targetFile = path.join(home, "file.txt");
      await writeFile(targetFile, "content");

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
        await exists(targetFile),
        "file should still exist after dry-run",
      );
      assert.equal(planned.length, 1);
      assert.equal(planned[0]?.verb, "remove");
      assert.equal(planned[0]?.kind, "file-write");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("executeRevert — config-patch", () => {
  it("restores original values from undoPatch", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      // Current state after patching: b was changed to 99, c was added
      await writeFile(configFile, JSON.stringify({ a: 1, b: 99, c: 3 }));

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

      const restored = JSON.parse(await readFile(configFile, "utf-8"));
      assert.equal(restored.a, 1);
      assert.equal(restored.b, 2); // restored to original
      assert.equal("c" in restored, false); // deleted (was absent before)

      const entry = await lookupDeployment(home, configFile);
      assert.equal(entry, null);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("deletes keys that were added by the patch (undoPatch value null)", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ a: 1, newKey: "added" }));

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
      const restored = JSON.parse(await readFile(configFile, "utf-8"));
      assert.equal(restored.a, 1);
      assert.equal("newKey" in restored, false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips when config file is gone", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips when no registry entry exists", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ a: 1 }));

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
      const content = JSON.parse(await readFile(configFile, "utf-8"));
      assert.equal(content.a, 1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("dry-run does not modify config and returns planned change", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ a: 1, b: 99 }));

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

      const after = JSON.parse(await readFile(configFile, "utf-8"));
      assert.equal(after.b, 99, "config should be unchanged after dry-run");

      assert.equal(planned.length, 1);
      assert.equal(planned[0]?.verb, "unapply-patch");
      assert.equal(planned[0]?.kind, "config-patch");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("executeRevert — frontmatter-emit", () => {
  it("removes only engine-owned frontmatter and preserves unrelated content", async () => {
    const home = await makeTmpDir();
    try {
      const targetFile = path.join(home, ".agents", "rules", "my-mcp.md");
      await mkdir(path.dirname(targetFile), { recursive: true });
      await writeFile(
        targetFile,
        "---\nname: Existing Agent\ndescription: Keep me\nmcp-servers:\n  my-mcp:\n    command: npx\n---\n\n# Body\n",
      );

      await registerDeployment(home, targetFile, {
        kind: "frontmatter-emit",
        patch: { "mcp-servers": { "my-mcp": { command: "npx" } } },
        undoPatch: { "mcp-servers": null },
        created: false,
        hadFrontmatter: true,
        skill: "my-mcp",
        agent: "antigravity",
      });

      const action: FrontmatterEmitRevertAction = {
        kind: "frontmatter-emit",
        skill: "my-mcp",
        agent: "antigravity",
        target: targetFile,
      };

      const { succeeded, failed } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);

      const content = await readFile(targetFile, "utf-8");
      assert.match(content, /name: Existing Agent/);
      assert.match(content, /description: Keep me/);
      assert.doesNotMatch(content, /mcp-servers:/);
      assert.match(content, /# Body/);
      assert.equal(await lookupDeployment(home, targetFile), null);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("removes a frontmatter-only file that inception created", async () => {
    const home = await makeTmpDir();
    try {
      const targetFile = path.join(home, ".agents", "rules", "my-mcp.md");
      await mkdir(path.dirname(targetFile), { recursive: true });
      await writeFile(
        targetFile,
        "---\nmcp-servers:\n  my-mcp:\n    command: npx\n---\n",
      );

      await registerDeployment(home, targetFile, {
        kind: "frontmatter-emit",
        patch: { "mcp-servers": { "my-mcp": { command: "npx" } } },
        undoPatch: { "mcp-servers": null },
        created: true,
        hadFrontmatter: false,
        skill: "my-mcp",
        agent: "antigravity",
      });

      const action: FrontmatterEmitRevertAction = {
        kind: "frontmatter-emit",
        skill: "my-mcp",
        agent: "antigravity",
        target: targetFile,
      };

      const { succeeded, failed } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(!(await exists(targetFile)));
      assert.equal(await lookupDeployment(home, targetFile), null);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores a body-only markdown file by removing the injected frontmatter", async () => {
    const home = await makeTmpDir();
    try {
      const targetFile = path.join(home, ".agents", "rules", "my-mcp.md");
      await mkdir(path.dirname(targetFile), { recursive: true });
      await writeFile(
        targetFile,
        "---\nmcp-servers:\n  my-mcp:\n    command: npx\n---\n\n# Body\n",
      );

      await registerDeployment(home, targetFile, {
        kind: "frontmatter-emit",
        patch: { "mcp-servers": { "my-mcp": { command: "npx" } } },
        undoPatch: { "mcp-servers": null },
        created: false,
        hadFrontmatter: false,
        skill: "my-mcp",
        agent: "antigravity",
      });

      const action: FrontmatterEmitRevertAction = {
        kind: "frontmatter-emit",
        skill: "my-mcp",
        agent: "antigravity",
        target: targetFile,
      };

      await executeRevert([action], false, false, home);
      assert.equal(await readFile(targetFile, "utf-8"), "# Body\n");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("planRevert — mcpServers and agentRules", () => {
  const home = "/home/test";

  it("produces a config-patch action for an mcpServer matched to a detected agent", () => {
    const manifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [
        {
          name: "my-mcp",
          agents: ["claude-code"],
          config: { command: "npx", args: ["-y", "my-mcp"] },
          scope: "global",
        },
      ],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
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
      files: [],
      configs: [],
      mcpServers: [
        {
          name: "my-mcp",
          agents: ["claude-code"],
          config: { command: "npx" },
          scope: "global",
        },
      ],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
    };
    const actions = planRevert(manifest, ["codex"], home);
    assert.equal(actions.length, 0);
  });

  it("produces a file-write action for an agentRule matched to a detected agent", () => {
    const manifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [
        {
          name: "my-rules",
          path: "rules/CLAUDE.md",
          agents: ["claude-code"],
          scope: "global",
        },
      ],
      permissions: [],
      agentDefinitions: [],
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
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [
        {
          name: "my-rules",
          path: "rules/CLAUDE.md",
          agents: ["claude-code"],
          scope: "global",
        },
      ],
      permissions: [],
      agentDefinitions: [],
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
      files: [],
      configs: [],
      mcpServers: [
        {
          name: "my-mcp",
          agents: ["claude-code", "gemini-cli"],
          config: { command: "npx" },
          scope: "global",
        },
      ],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
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
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [
        {
          name: "my-rules",
          path: "rules/CLAUDE.md",
          agents: ["claude-code", "codex"],
          scope: "global",
        },
      ],
      permissions: [],
      agentDefinitions: [],
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
    const home = await makeTmpDir();
    try {
      // Simulate a deployed mcpServer: config file with mcpServers key patched in
      const configFile = path.join(home, ".claude.json");
      const original = { other: "value" };
      const patched = {
        other: "value",
        mcpServers: { "my-mcp": { command: "npx" } },
      };
      await writeFile(configFile, JSON.stringify(patched));

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

      const restored = JSON.parse(await readFile(configFile, "utf-8"));
      assert.deepEqual(restored, original);

      const entry = await lookupDeployment(home, configFile);
      assert.equal(
        entry,
        null,
        "registry entry should be removed after revert",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reverts nested config-patch, preserving sibling MCP server", async () => {
    const home = await makeTmpDir();
    try {
      // Original config already has one MCP server; we deployed a second one
      const configFile = path.join(home, ".claude.json");
      const patched = {
        mcpServers: {
          "existing-server": { command: "existing" },
          "new-server": { command: "new" },
        },
      };
      await writeFile(configFile, JSON.stringify(patched));

      // Deep undo patch: only remove "new-server" under mcpServers
      await registerDeployment(home, configFile, {
        kind: "config-patch",
        patch: { mcpServers: { "new-server": { command: "new" } } },
        undoPatch: { mcpServers: { "new-server": null } },
        skill: "new-server",
        agent: "claude-code",
      });

      const action: ConfigPatchRevertAction = {
        kind: "config-patch",
        skill: "new-server",
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

      const restored = JSON.parse(await readFile(configFile, "utf-8"));
      // "new-server" should be gone, "existing-server" should be preserved
      assert.equal("new-server" in restored.mcpServers, false);
      assert.deepEqual(restored.mcpServers["existing-server"], {
        command: "existing",
      });

      const entry = await lookupDeployment(home, configFile);
      assert.equal(
        entry,
        null,
        "registry entry should be removed after revert",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reverts a deployed agentRule file-write and unregisters it", async () => {
    const home = await makeTmpDir();
    try {
      const rulesFile = path.join(home, ".claude", "CLAUDE.md");
      await mkdir(path.dirname(rulesFile), { recursive: true });
      await writeFile(rulesFile, "# My Rules\n");

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
        !(await exists(rulesFile)),
        "rules file should be removed after revert",
      );

      const entry = await lookupDeployment(home, rulesFile);
      assert.equal(
        entry,
        null,
        "registry entry should be removed after revert",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("dry-run for mcpServer revert returns planned change without modifying config", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, ".claude.json");
      const patched = { mcpServers: { "my-mcp": { command: "npx" } } };
      await writeFile(configFile, JSON.stringify(patched));

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

      const unchanged = JSON.parse(await readFile(configFile, "utf-8"));
      assert.deepEqual(
        unchanged,
        patched,
        "config should be unchanged during dry-run",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("dry-run for agentRule revert returns planned change without deleting file", async () => {
    const home = await makeTmpDir();
    try {
      const rulesFile = path.join(home, ".claude", "CLAUDE.md");
      await mkdir(path.dirname(rulesFile), { recursive: true });
      await writeFile(rulesFile, "# My Rules\n");

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
        await exists(rulesFile),
        "rules file should still exist after dry-run",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
