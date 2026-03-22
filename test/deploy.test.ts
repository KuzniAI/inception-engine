import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, existsSync, lstatSync, readlinkSync, readFileSync, symlinkSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { planDeploy, executeDeploy } from "../src/core/deploy.ts";
import type { Manifest } from "../src/types.ts";
import { UserError } from "../src/errors.ts";
import { logger } from "../src/logger.ts";
logger.silence();

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
  it("creates actions for detected agents only", async () => {
    const sourceDir = makeTmpDir();
    try {
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test");
      assert.equal(actions.length, 1);
      assert.equal(actions[0]!.agent, "claude-code");
      assert.equal(actions[0]!.skill, "test-skill");
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("creates actions for multiple agents", async () => {
    const sourceDir = makeTmpDir();
    try {
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code", "codex"], "/home/test");
      assert.equal(actions.length, 2);
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("skips agents not in detected list", async () => {
    const sourceDir = makeTmpDir();
    try {
      const actions = await planDeploy(testManifest, sourceDir, ["gemini-cli"], "/home/test");
      assert.equal(actions.length, 0);
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });
});

describe("executeDeploy", () => {
  if (process.platform === "win32") return;

  it("creates symlinks on POSIX", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code"], home);
      const { succeeded, failed } = await executeDeploy(actions, false, false);

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

  it("writes structured .inception-totem in source on POSIX symlink deploy", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      const skillSource = createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code"], home);
      await executeDeploy(actions, false, false);

      const totemPath = path.join(skillSource, ".inception-totem");
      assert.ok(existsSync(totemPath));
      const content = readFileSync(totemPath, "utf-8");
      assert.ok(content.startsWith("inception-engine\n"));
      assert.ok(content.includes("skill=test-skill"));
      assert.ok(content.includes("agent=claude-code"));
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not create symlinks in dry-run mode", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code"], home);
      const { succeeded, failed } = await executeDeploy(actions, true, false);

      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);

      const target = actions[0]!.target;
      assert.ok(!existsSync(target));
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("overwrites existing symlink (with ownership proof)", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code"], home);

      // Deploy twice - second should overwrite (first creates .inception-totem)
      await executeDeploy(actions, false, false);
      const { succeeded, failed } = await executeDeploy(actions, false, false);

      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports error for missing source", async () => {
    const home = makeTmpDir();
    try {
      const actions = await planDeploy(testManifest, "/nonexistent/source", ["claude-code"], home);
      const { succeeded, failed } = await executeDeploy(actions, false, false);

      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(failed[0]!.error.includes("Source not found"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite unmanaged target", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code"], home);
      const target = actions[0]!.target;

      // Create an unmanaged directory at the target (no .inception-totem)
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "something.txt"), "user content");

      const { succeeded, failed } = await executeDeploy(actions, false, false);
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(failed[0]!.error.includes("not managed by inception-engine"));

      // Original content should still be there
      assert.ok(existsSync(path.join(target, "something.txt")));
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("backup is removed after successful redeploy", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code"], home);
      const target = actions[0]!.target;
      const backupPath = target + ".inception-backup";

      await executeDeploy(actions, false, false);
      await executeDeploy(actions, false, false);

      assert.ok(!existsSync(backupPath), "backup should not exist after successful redeploy");
      assert.ok(existsSync(target), "target should exist after redeploy");
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("atomic redeploy behavior", () => {
  if (process.platform === "win32") return;

  it("cleans up stale .inception-backup from a previous failed attempt", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code"], home);
      const target = actions[0]!.target;
      const backupPath = target + ".inception-backup";

      // First deploy to establish managed target
      await executeDeploy(actions, false, false);

      // Simulate a stale backup left by a previous crash
      mkdirSync(backupPath, { recursive: true });
      writeFileSync(path.join(backupPath, "stale.txt"), "leftover");

      // Redeploy should clean up the stale backup and succeed
      const { succeeded, failed } = await executeDeploy(actions, false, false);
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(!existsSync(backupPath), "stale backup should be cleaned up");
      assert.ok(existsSync(target), "target should exist after redeploy");
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("no backup is created on first deploy (no prior target)", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code"], home);
      const target = actions[0]!.target;
      const backupPath = target + ".inception-backup";

      const { succeeded } = await executeDeploy(actions, false, false);
      assert.equal(succeeded, 1);
      assert.ok(existsSync(target));
      assert.ok(!existsSync(backupPath), "no backup should be created when there was no prior target");
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("restores backup when totem write fails (totem file read-only)", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    const totemPath = path.join(sourceDir, "skills/test-skill", ".inception-totem");
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(testManifest, sourceDir, ["claude-code"], home);
      const target = actions[0]!.target;
      const backupPath = target + ".inception-backup";
      const skillSource = actions[0]!.source;

      // First deploy: establishes managed symlink and writes .inception-totem into source
      const { succeeded: firstSucceeded } = await executeDeploy(actions, false, false);
      assert.equal(firstSucceeded, 1);
      const originalLink = readlinkSync(target);

      // Make .inception-totem read-only so writeTotem fails on the next attempt.
      // The ownership check (readFile) still passes since the file remains readable;
      // only the write (writeFile) will throw EACCES.
      chmodSync(totemPath, 0o444);

      const { succeeded, failed } = await executeDeploy(actions, false, false);

      // Deploy must report failure
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);

      // Backup must be cleaned up (restored back to target)
      assert.ok(!existsSync(backupPath), "backup should be gone after rollback");

      // Original managed symlink must be restored at the target path
      assert.ok(existsSync(target), "original symlink must be restored");
      assert.ok(lstatSync(target).isSymbolicLink(), "restored target must be a symlink");
      assert.equal(readlinkSync(target), originalLink, "restored symlink must point to original source");
    } finally {
      try { chmodSync(totemPath, 0o644); } catch { /* best effort */ }
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("restores backup when cp fails (source not readable)", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      // First deploy using copy method to establish a managed target directory
      const skillSource = createSkillSource(sourceDir, "skills/test-skill");
      const target = path.join(home, ".claude", "skills", "test-skill");
      mkdirSync(path.dirname(target), { recursive: true });

      const firstAction: import("../src/types.ts").DeployAction = {
        skill: "test-skill",
        agent: "claude-code",
        source: skillSource,
        target,
        method: "copy",
      };
      const { succeeded: firstSucceeded } = await executeDeploy([firstAction], false, false);
      assert.equal(firstSucceeded, 1);
      assert.ok(existsSync(target));

      // Create an unreadable source directory for the next deploy attempt
      // access() (F_OK) passes — the dir exists — but cp() fails reading its contents
      const unreadableSource = path.join(sourceDir, "unreadable-source");
      mkdirSync(unreadableSource, { recursive: true });
      writeFileSync(path.join(unreadableSource, "SKILL.md"), "---");
      chmodSync(unreadableSource, 0o000);

      const backupPath = target + ".inception-backup";
      const failAction: import("../src/types.ts").DeployAction = {
        skill: "test-skill",
        agent: "claude-code",
        source: unreadableSource,
        target,
        method: "copy",
      };

      const { succeeded, failed } = await executeDeploy([failAction], false, false);

      // Deploy must report failure
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);

      // Backup must be cleaned up (restored back to target)
      assert.ok(!existsSync(backupPath), "backup should be gone after rollback");

      // Original managed directory must be restored with its content intact
      assert.ok(existsSync(target), "original target must be restored");
      assert.ok(
        existsSync(path.join(target, ".inception-totem")),
        "restored target must have original .inception-totem"
      );
    } finally {
      try { chmodSync(path.join(sourceDir, "unreadable-source"), 0o755); } catch { /* best effort */ }
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("planDeploy path traversal", () => {
  it("throws when skill.path escapes sourceDir via traversal (../../outside)", async () => {
    const sourceDir = makeTmpDir();
    try {
      const traversalManifest: Manifest = {
        skills: [{ name: "evil", path: "../../outside", agents: ["claude-code"] }],
        mcpServers: [],
        agentRules: [],
      };
      await assert.rejects(
        () => planDeploy(traversalManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /resolves outside the repository root/);
          return true;
        }
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("throws when skill.path escapes via symlink", async () => {
    const sourceDir = makeTmpDir();
    const outsideDir = makeTmpDir();
    try {
      // Create a symlink inside the repo that points outside
      const symlinkPath = path.join(sourceDir, "skills", "escape");
      mkdirSync(path.join(sourceDir, "skills"), { recursive: true });
      symlinkSync(outsideDir, symlinkPath, "dir");

      const escapeManifest: Manifest = {
        skills: [{ name: "evil", path: "skills/escape", agents: ["claude-code"] }],
        mcpServers: [],
        agentRules: [],
      };
      await assert.rejects(
        () => planDeploy(escapeManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /resolves outside the repository root via symlink/);
          return true;
        }
      );
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true });
    }
  });
});
