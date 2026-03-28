import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { executeDeploy, planDeploy } from "../src/core/deploy.ts";
import { lookupDeployment, registerDeployment } from "../src/core/ownership.ts";
import { executeRevert, planRevert } from "../src/core/revert.ts";
import { UserError } from "../src/errors.ts";
import { logger } from "../src/logger.ts";
import type { DeployAction, Manifest } from "../src/types.ts";

logger.silence();

function makeTmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ie-test-deploy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createSkillSource(baseDir: string, skillPath: string): string {
  const fullPath = path.join(baseDir, skillPath);
  mkdirSync(fullPath, { recursive: true });
  writeFileSync(
    path.join(fullPath, "SKILL.md"),
    "---\nname: test\n---\n# Test",
  );
  return fullPath;
}

const testManifest: Manifest = {
  skills: [
    {
      name: "test-skill",
      path: "skills/test-skill",
      agents: ["claude-code", "codex"],
    },
  ],
  mcpServers: [],
  agentRules: [],
};

describe("planDeploy", () => {
  it("creates actions for detected agents only", async () => {
    const sourceDir = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        "/home/test",
      );
      assert.equal(actions.length, 1);
      assert.equal(actions[0]?.agent, "claude-code");
      assert.equal(actions[0]?.skill, "test-skill");
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("creates actions for multiple agents", async () => {
    const sourceDir = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code", "codex"],
        "/home/test",
      );
      assert.equal(actions.length, 2);
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("skips agents not in detected list", async () => {
    const sourceDir = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["gemini-cli"],
        "/home/test",
      );
      assert.equal(actions.length, 0);
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("throws when skill source path does not exist", async () => {
    const sourceDir = makeTmpDir();
    try {
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /source not found/);
          return true;
        },
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("throws when skill source path is a file, not a directory", async () => {
    const sourceDir = makeTmpDir();
    try {
      mkdirSync(path.join(sourceDir, "skills"), { recursive: true });
      writeFileSync(path.join(sourceDir, "skills", "test-skill"), "not a dir");
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /not a directory/);
          return true;
        },
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("throws when skill source directory is missing SKILL.md", async () => {
    const sourceDir = makeTmpDir();
    try {
      mkdirSync(path.join(sourceDir, "skills", "test-skill"), {
        recursive: true,
      });
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /missing SKILL\.md/);
          return true;
        },
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });
});

describe("executeDeploy", { skip: process.platform === "win32" }, () => {
  it("creates symlinks on POSIX", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );

      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);

      const target = actions[0]?.target;
      assert.ok(existsSync(target));
      assert.ok(lstatSync(target).isSymbolicLink());
      assert.equal(readlinkSync(target), actions[0]?.source);
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("registers deployment in registry on POSIX symlink deploy", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      const skillSource = createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      await executeDeploy(actions, false, false, home);

      const target = actions[0]?.target;

      // Registry should have the entry
      const entry = await lookupDeployment(home, target);
      assert.ok(entry);
      assert.equal(entry.skill, "test-skill");
      assert.equal(entry.agent, "claude-code");
      assert.equal(entry.source, skillSource);
      assert.equal(entry.method, "symlink");

      // No .inception-totem should exist in source
      assert.ok(
        !existsSync(path.join(skillSource, ".inception-totem")),
        "no .inception-totem should be written to source directory",
      );
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
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const { succeeded, failed } = await executeDeploy(
        actions,
        true,
        false,
        home,
      );

      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);

      const target = actions[0]?.target;
      assert.ok(!existsSync(target));
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("overwrites existing symlink (with registry entry)", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );

      // Deploy twice - second should overwrite (first creates registry entry)
      await executeDeploy(actions, false, false, home);
      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );

      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports error for missing source (caught at planning)", async () => {
    const home = makeTmpDir();
    try {
      await assert.rejects(
        planDeploy(testManifest, "/nonexistent/source", ["claude-code"], home),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /source not found/);
          return true;
        },
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports permission denied when source is unreadable (caught at planning)", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    // Chmod the parent so traversal into the skill source dir fails with EACCES
    const skillsDir = path.join(sourceDir, "skills");
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      chmodSync(skillsDir, 0o000);
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], home),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /Permission denied/);
          return true;
        },
      );
    } finally {
      chmodSync(skillsDir, 0o755);
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite unmanaged target", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;

      // Create an unmanaged directory at the target (no registry entry)
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "something.txt"), "user content");

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(failed[0]?.error.includes("not managed by inception-engine"));

      // Original content should still be there
      assert.ok(existsSync(path.join(target, "something.txt")));
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite target with mismatched registry entry", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;

      // Create a directory at the target and register it under a different source/skill
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "SKILL.md"), "other content");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/completely/different/source",
        skill: "different-skill",
        agent: "codex",
        method: "symlink",
      });

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(failed[0]?.error.includes("not managed by inception-engine"));

      // Original content should still be there
      assert.ok(existsSync(path.join(target, "SKILL.md")));
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
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      await executeDeploy(actions, false, false, home);
      await executeDeploy(actions, false, false, home);

      assert.ok(
        !existsSync(backupPath),
        "backup should not exist after successful redeploy",
      );
      assert.ok(existsSync(target), "target should exist after redeploy");
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("atomic redeploy behavior", {
  skip: process.platform === "win32",
}, () => {
  it("cleans up stale .inception-backup from a previous failed attempt", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      // First deploy to establish managed target
      await executeDeploy(actions, false, false, home);

      // Simulate a stale backup left by a previous crash
      mkdirSync(backupPath, { recursive: true });
      writeFileSync(path.join(backupPath, "stale.txt"), "leftover");

      // Redeploy should clean up the stale backup and succeed
      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
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
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      const { succeeded } = await executeDeploy(actions, false, false, home);
      assert.equal(succeeded, 1);
      assert.ok(existsSync(target));
      assert.ok(
        !existsSync(backupPath),
        "no backup should be created when there was no prior target",
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("restores backup when registry write fails (registry file read-only)", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    const registryFile = path.join(home, ".inception-engine", "registry.json");
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      // First deploy: establishes managed symlink and registry entry
      const { succeeded: firstSucceeded } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(firstSucceeded, 1);
      const originalLink = readlinkSync(target);

      // Make registry file read-only so registerDeployment fails on the next attempt.
      // The lookupDeployment (read) still works; only the write will throw EACCES.
      chmodSync(registryFile, 0o444);

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );

      // Deploy must report failure
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);

      // Backup must be cleaned up (restored back to target)
      assert.ok(
        !existsSync(backupPath),
        "backup should be gone after rollback",
      );

      // Original managed symlink must be restored at the target path
      assert.ok(existsSync(target), "original symlink must be restored");
      assert.ok(
        lstatSync(target).isSymbolicLink(),
        "restored target must be a symlink",
      );
      assert.equal(
        readlinkSync(target),
        originalLink,
        "restored symlink must point to original source",
      );
    } finally {
      try {
        chmodSync(registryFile, 0o644);
      } catch {
        /* best effort */
      }
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
        kind: "skill-dir",
        skill: "test-skill",
        agent: "claude-code",
        source: skillSource,
        target,
        method: "copy",
      };
      const { succeeded: firstSucceeded } = await executeDeploy(
        [firstAction],
        false,
        false,
        home,
      );
      assert.equal(firstSucceeded, 1);
      assert.ok(existsSync(target));

      // Create an unreadable source directory for the next deploy attempt
      // access() (F_OK) passes — the dir exists — but cp() fails reading its contents
      const unreadableSource = path.join(sourceDir, "unreadable-source");
      mkdirSync(unreadableSource, { recursive: true });
      writeFileSync(path.join(unreadableSource, "SKILL.md"), "---");
      chmodSync(unreadableSource, 0o000);

      const backupPath = `${target}.inception-backup`;
      const failAction: import("../src/types.ts").DeployAction = {
        kind: "skill-dir",
        skill: "test-skill",
        agent: "claude-code",
        source: unreadableSource,
        target,
        method: "copy",
      };

      const { succeeded, failed } = await executeDeploy(
        [failAction],
        false,
        false,
        home,
      );

      // Deploy must report failure
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);

      // Backup must be cleaned up (restored back to target)
      assert.ok(
        !existsSync(backupPath),
        "backup should be gone after rollback",
      );

      // Original managed directory must be restored with its content intact
      assert.ok(existsSync(target), "original target must be restored");
      assert.ok(
        existsSync(path.join(target, "SKILL.md")),
        "restored target must have original content",
      );
    } finally {
      try {
        chmodSync(path.join(sourceDir, "unreadable-source"), 0o755);
      } catch {
        /* best effort */
      }
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("planDeploy path traversal", () => {
  it("throws when skill.path resolves to the repository root itself (.)", async () => {
    const sourceDir = makeTmpDir();
    try {
      const rootManifest: Manifest = {
        skills: [{ name: "root-skill", path: ".", agents: ["claude-code"] }],
        mcpServers: [],
        agentRules: [],
      };
      await assert.rejects(
        () =>
          planDeploy(rootManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /resolves outside the repository root/);
          return true;
        },
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("throws when skill.path escapes sourceDir via traversal (../../outside)", async () => {
    const sourceDir = makeTmpDir();
    try {
      const traversalManifest: Manifest = {
        skills: [
          { name: "evil", path: "../../outside", agents: ["claude-code"] },
        ],
        mcpServers: [],
        agentRules: [],
      };
      await assert.rejects(
        () =>
          planDeploy(
            traversalManifest,
            sourceDir,
            ["claude-code"],
            "/home/test",
          ),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /resolves outside the repository root/);
          return true;
        },
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
      symlinkSync(
        outsideDir,
        symlinkPath,
        process.platform === "win32" ? "junction" : "dir",
      );

      const escapeManifest: Manifest = {
        skills: [
          { name: "evil", path: "skills/escape", agents: ["claude-code"] },
        ],
        mcpServers: [],
        agentRules: [],
      };
      await assert.rejects(
        () =>
          planDeploy(escapeManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(
            err.message,
            /resolves outside the repository root via symlink/,
          );
          return true;
        },
      );
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true });
    }
  });
});

async function snapshotDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries.sort();
}

describe("source directory immutability", () => {
  it("source dir is unchanged after symlink deploy", {
    skip: process.platform === "win32",
  }, async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const before = await snapshotDir(sourceDir);
      const actions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      await executeDeploy(actions, false, false, home);
      const after = await snapshotDir(sourceDir);
      assert.deepEqual(
        after,
        before,
        "source directory must not be modified by deploy",
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("source dir is unchanged after copy deploy", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      const skillSource = createSkillSource(sourceDir, "skills/test-skill");
      const target = path.join(home, ".claude", "skills", "test-skill");
      mkdirSync(path.dirname(target), { recursive: true });
      const action: DeployAction = {
        kind: "skill-dir",
        skill: "test-skill",
        agent: "claude-code",
        source: skillSource,
        target,
        method: "copy",
      };
      const before = await snapshotDir(sourceDir);
      await executeDeploy([action], false, false, home);
      const after = await snapshotDir(sourceDir);
      assert.deepEqual(
        after,
        before,
        "source directory must not be modified by copy deploy",
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("source dir is unchanged after symlink revert", {
    skip: process.platform === "win32",
  }, async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const deployActions = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      await executeDeploy(deployActions, false, false, home);
      const before = await snapshotDir(sourceDir);
      const revertActions = planRevert(testManifest, ["claude-code"], home);
      await executeRevert(revertActions, false, false, home);
      const after = await snapshotDir(sourceDir);
      assert.deepEqual(
        after,
        before,
        "source directory must not be modified by revert",
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("source dir is unchanged after copy revert", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      const skillSource = createSkillSource(sourceDir, "skills/test-skill");
      const target = path.join(home, ".claude", "skills", "test-skill");
      mkdirSync(path.dirname(target), { recursive: true });
      const action: DeployAction = {
        kind: "skill-dir",
        skill: "test-skill",
        agent: "claude-code",
        source: skillSource,
        target,
        method: "copy",
      };
      await executeDeploy([action], false, false, home);
      const before = await snapshotDir(sourceDir);
      const revertActions = planRevert(testManifest, ["claude-code"], home);
      await executeRevert(revertActions, false, false, home);
      const after = await snapshotDir(sourceDir);
      assert.deepEqual(
        after,
        before,
        "source directory must not be modified by copy revert",
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
