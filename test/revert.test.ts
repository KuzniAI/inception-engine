import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
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
import type { Manifest } from "../src/types.ts";

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
});
