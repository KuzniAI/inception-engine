import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { planRevert, planRevertAll, executeRevert } from "../src/core/revert.ts";
import type { Manifest } from "../src/types.ts";
import { logger } from "../src/logger.ts";
logger.silence();

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

describe("planRevertAll", () => {
  it("creates revert actions for all agents in manifest regardless of detection", () => {
    const multiAgentManifest: Manifest = {
      skills: [
        { name: "test-skill", path: "skills/test-skill", agents: ["claude-code", "codex", "gemini-cli"] },
      ],
      mcpServers: [],
      agentRules: [],
    };
    const actions = planRevertAll(multiAgentManifest, "/home/test");
    assert.equal(actions.length, 3);
    const agentIds = actions.map(a => a.agent);
    assert.ok(agentIds.includes("claude-code"));
    assert.ok(agentIds.includes("codex"));
    assert.ok(agentIds.includes("gemini-cli"));
  });
});

describe("executeRevert", () => {
  if (process.platform === "win32") return;

  it("removes a symlink with valid .inception-totem", async () => {
    const home = makeTmpDir();
    const sourceDir = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]!.target;

      // Source must contain .inception-totem for ownership check
      writeFileSync(path.join(sourceDir, ".inception-totem"), "inception-engine\nsource=/x\n");
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

  it("removes a copied directory with valid .inception-totem", async () => {
    const home = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]!.target;

      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "SKILL.md"), "test");
      writeFileSync(path.join(target, ".inception-totem"), "inception-engine\nsource=/x\n");

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

      writeFileSync(path.join(sourceDir, ".inception-totem"), "inception-engine\nsource=/x\n");
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

  it("skips symlink whose target has SKILL.md but no .inception-totem", async () => {
    const home = makeTmpDir();
    const sourceDir = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]!.target;

      // Only SKILL.md, no .inception-totem — should be treated as unmanaged
      writeFileSync(path.join(sourceDir, "SKILL.md"), "---");
      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(sourceDir, target, "dir");

      const { succeeded, skipped } = await executeRevert(actions, false, false);
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.ok(existsSync(target), "symlink should still exist — not managed");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("skips directory with invalid .inception-totem content", async () => {
    const home = makeTmpDir();
    try {
      const actions = planRevert(testManifest, ["claude-code"], home);
      const target = actions[0]!.target;

      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, ".inception-totem"), "not-inception-engine\n");

      const { succeeded, skipped } = await executeRevert(actions, false, false);
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.ok(existsSync(target), "directory should still exist — invalid totem");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
