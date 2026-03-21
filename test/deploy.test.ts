import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, existsSync, lstatSync, readlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { planDeploy, executeDeploy } from "../src/core/deploy.ts";
import type { Manifest } from "../src/types.ts";

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `ie-test-deploy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createSkillSource(baseDir: string, skillPath: string): string {
  const fullPath = path.join(baseDir, skillPath);
  mkdirSync(fullPath, { recursive: true });
  writeFileSync(path.join(fullPath, "SKILL.md"), "---\nname: test\n---\n# Test");
  return fullPath;
}

const testManifest: Manifest = {
  skills: [
    { name: "test-skill", path: "skills/test-skill", agents: ["claude-code", "codex"] },
  ],
  mcpServers: [],
  agentRules: [],
};

describe("planDeploy", () => {
  it("creates actions for detected agents only", () => {
    const sourceDir = makeTmpDir();
    try {
      const actions = planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test");
      assert.equal(actions.length, 1);
      assert.equal(actions[0]!.agent, "claude-code");
      assert.equal(actions[0]!.skill, "test-skill");
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("creates actions for multiple agents", () => {
    const sourceDir = makeTmpDir();
    try {
      const actions = planDeploy(testManifest, sourceDir, ["claude-code", "codex"], "/home/test");
      assert.equal(actions.length, 2);
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("skips agents not in detected list", () => {
    const sourceDir = makeTmpDir();
    try {
      const actions = planDeploy(testManifest, sourceDir, ["gemini-cli"], "/home/test");
      assert.equal(actions.length, 0);
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });
});

describe("executeDeploy", () => {
  if (process.platform === "win32") return;

  it("creates symlinks on POSIX", () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = planDeploy(testManifest, sourceDir, ["claude-code"], home);
      const { succeeded, failed } = executeDeploy(actions, false, false);

      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);

      const target = actions[0]!.target;
      assert.ok(existsSync(target));
      assert.ok(lstatSync(target).isSymbolicLink());
      assert.equal(readlinkSync(target), actions[0]!.source);
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not create symlinks in dry-run mode", () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = planDeploy(testManifest, sourceDir, ["claude-code"], home);
      const { succeeded, failed } = executeDeploy(actions, true, false);

      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);

      const target = actions[0]!.target;
      assert.ok(!existsSync(target));
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("overwrites existing symlink", () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = planDeploy(testManifest, sourceDir, ["claude-code"], home);

      // Deploy twice - second should overwrite
      executeDeploy(actions, false, false);
      const { succeeded, failed } = executeDeploy(actions, false, false);

      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports error for missing source", () => {
    const home = makeTmpDir();
    try {
      const actions = planDeploy(testManifest, "/nonexistent/source", ["claude-code"], home);
      const { succeeded, failed } = executeDeploy(actions, false, false);

      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(failed[0]!.error.includes("Source not found"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("planDeploy path traversal", () => {
  it("throws when skill.path escapes sourceDir via traversal (../../outside)", () => {
    const sourceDir = makeTmpDir();
    try {
      const traversalManifest: Manifest = {
        skills: [{ name: "evil", path: "../../outside", agents: ["claude-code"] }],
        mcpServers: [],
        agentRules: [],
      };
      assert.throws(
        () => planDeploy(traversalManifest, sourceDir, ["claude-code"], "/home/test"),
        /resolves outside the repository root/
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });
});
