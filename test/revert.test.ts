import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { planRevert, executeRevert } from "../src/core/revert.ts";
import type { Manifest } from "../src/types.ts";

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `ie-test-revert-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    assert.equal(actions[0]!.skill, "test-skill");
    assert.equal(actions[0]!.agent, "claude-code");
  });

  it("skips agents not detected", () => {
    const actions = planRevert(testManifest, ["codex"], "/home/test");
    assert.equal(actions.length, 0);
  });
});

describe("executeRevert", () => {
  if (process.platform === "win32") return;

  it("removes a symlink", async () => {
    const home = makeTmpDir();
    const sourceDir = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]!.target;

      // Create the symlink to remove
      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(sourceDir, target, "dir");
      assert.ok(existsSync(target));

      const { succeeded, skipped } = await executeRevert(actions, false, false);
      assert.equal(succeeded, 1);
      assert.equal(skipped, 0);
      assert.ok(!existsSync(target));
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("removes a copied directory", async () => {
    const home = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]!.target;

      // Create a real directory (as Windows copy would)
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "SKILL.md"), "test");

      const { succeeded, skipped } = await executeRevert(actions, false, false);
      assert.equal(succeeded, 1);
      assert.equal(skipped, 0);
      assert.ok(!existsSync(target));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("skips missing targets", async () => {
    const home = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const { succeeded, skipped } = await executeRevert(actions, false, false);
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("does not remove in dry-run mode", async () => {
    const home = makeTmpDir();
    const sourceDir = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]!.target;

      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(sourceDir, target, "dir");

      const { succeeded } = await executeRevert(actions, true, false);
      assert.equal(succeeded, 1);
      assert.ok(existsSync(target), "symlink should still exist after dry-run");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true });
    }
  });
});
