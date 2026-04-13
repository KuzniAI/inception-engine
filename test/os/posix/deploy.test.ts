import assert from "node:assert/strict";
import { chmod, lstat, mkdir, readlink, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { executeDeploy, planDeploy } from "../../../src/core/deploy.ts";
import {
  lookupDeployment,
  registerDeployment,
} from "../../../src/core/ownership.ts";
import { UserError } from "../../../src/errors.ts";
import type { DeployAction } from "../../../src/types.ts";
import { exists, makeTmpDir } from "../../helpers/fs.ts";
import {
  createSkillSource,
  testSkillManifest,
} from "../../helpers/skill-dir.ts";

describe("executeDeploy (POSIX)", {
  skip: process.platform === "win32",
}, () => {
  it("creates symlinks", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testSkillManifest,
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
      assert.ok(await exists(target));
      assert.ok((await lstat(target)).isSymbolicLink());
      const action = actions[0];
      if (action?.kind !== "skill-dir") {
        assert.fail("Expected skill-dir action");
      }
      assert.equal(await readlink(target), action.source);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("registers deployment in registry on symlink deploy", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const skillSource = await createSkillSource(
        sourceDir,
        "skills/test-skill",
      );
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      await executeDeploy(actions, false, false, home);

      const target = actions[0]?.target;
      const entry = await lookupDeployment(home, target);
      assert.ok(entry);
      if (entry.kind !== "skill-dir") {
        assert.fail("Expected skill-dir");
      }
      assert.equal(entry.skill, "test-skill");
      assert.equal(entry.agent, "claude-code");
      assert.equal(entry.source, skillSource);
      assert.equal(entry.method, "symlink");
      assert.ok(
        !(await exists(path.join(skillSource, ".inception-totem"))),
        "no .inception-totem should be written to source directory",
      );
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not create symlinks in dry-run mode", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testSkillManifest,
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
      assert.ok(!(await exists(actions[0]?.target)));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("overwrites existing symlink with a matching registry entry", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );

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
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports missing source during planning", async () => {
    const home = await makeTmpDir();
    try {
      await assert.rejects(
        planDeploy(
          testSkillManifest,
          "/nonexistent/source",
          ["claude-code"],
          home,
        ),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /source not found/);
          return true;
        },
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports permission denied when the source tree is unreadable", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    const skillsDir = path.join(sourceDir, "skills");
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      await chmod(skillsDir, 0o000);
      await assert.rejects(
        planDeploy(testSkillManifest, sourceDir, ["claude-code"], home),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /Permission denied/);
          return true;
        },
      );
    } finally {
      await chmod(skillsDir, 0o755);
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports permission denied when the skill directory is execute-only", {
    skip: process.getuid?.() === 0,
  }, async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    const skillDir = path.join(sourceDir, "skills", "test-skill");
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      await chmod(skillDir, 0o111);
      await assert.rejects(
        planDeploy(testSkillManifest, sourceDir, ["claude-code"], home),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(
            err.message,
            /Permission denied reading skill directory/,
          );
          return true;
        },
      );
    } finally {
      try {
        await chmod(skillDir, 0o755);
      } catch {
        // best effort
      }
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports permission denied when SKILL.md is unreadable", {
    skip: process.getuid?.() === 0,
  }, async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    const skillMdPath = path.join(
      sourceDir,
      "skills",
      "test-skill",
      "SKILL.md",
    );
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      await chmod(skillMdPath, 0o000);
      await assert.rejects(
        planDeploy(testSkillManifest, sourceDir, ["claude-code"], home),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /Permission denied reading SKILL\.md/);
          return true;
        },
      );
    } finally {
      try {
        await chmod(skillMdPath, 0o644);
      } catch {
        // best effort
      }
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an unmanaged target", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;

      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "something.txt"), "user content");

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(failed[0]?.error.includes("not managed by inception-engine"));
      assert.ok(await exists(path.join(target, "something.txt")));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a target with a mismatched registry entry", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;

      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), "other content");
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
      assert.ok(await exists(path.join(target, "SKILL.md")));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("removes the backup after a successful redeploy", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      await executeDeploy(actions, false, false, home);
      await executeDeploy(actions, false, false, home);

      assert.ok(!(await exists(backupPath)));
      assert.ok(await exists(target));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("atomic redeploy behavior (POSIX)", {
  skip: process.platform === "win32",
}, () => {
  it("cleans up stale .inception-backup from a previous failed attempt", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      await executeDeploy(actions, false, false, home);
      await mkdir(backupPath, { recursive: true });
      await writeFile(path.join(backupPath, "stale.txt"), "leftover");

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(!(await exists(backupPath)));
      assert.ok(await exists(target));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not create a backup on first deploy", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      const { succeeded } = await executeDeploy(actions, false, false, home);
      assert.equal(succeeded, 1);
      assert.ok(await exists(target));
      assert.ok(!(await exists(backupPath)));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores the backup when registry write fails", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    const registryFile = path.join(home, ".inception-engine", "registry.json");
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      const { succeeded: firstSucceeded } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(firstSucceeded, 1);
      const originalLink = await readlink(target);

      await chmod(registryFile, 0o444);

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(!(await exists(backupPath)));
      assert.ok(await exists(target));
      assert.ok((await lstat(target)).isSymbolicLink());
      assert.equal(await readlink(target), originalLink);
    } finally {
      try {
        await chmod(registryFile, 0o644);
      } catch {
        // best effort
      }
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores the backup when copy-based redeploy fails", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const skillSource = await createSkillSource(
        sourceDir,
        "skills/test-skill",
      );
      const target = path.join(home, ".claude", "skills", "test-skill");
      await mkdir(path.dirname(target), { recursive: true });

      const firstAction: DeployAction = {
        kind: "skill-dir",
        skill: "test-skill",
        agent: "claude-code",
        source: skillSource,
        target,
        method: "copy",
        confidence: "documented",
      };
      const { succeeded: firstSucceeded } = await executeDeploy(
        [firstAction],
        false,
        false,
        home,
      );
      assert.equal(firstSucceeded, 1);
      assert.ok(await exists(target));

      const unreadableSource = path.join(sourceDir, "unreadable-source");
      await mkdir(unreadableSource, { recursive: true });
      await writeFile(path.join(unreadableSource, "SKILL.md"), "---");
      await chmod(unreadableSource, 0o000);

      const failAction: DeployAction = {
        kind: "skill-dir",
        skill: "test-skill",
        agent: "claude-code",
        source: unreadableSource,
        target,
        method: "copy",
        confidence: "documented",
      };
      const backupPath = `${target}.inception-backup`;

      const { succeeded, failed } = await executeDeploy(
        [failAction],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(!(await exists(backupPath)));
      assert.ok(await exists(target));
      assert.ok(await exists(path.join(target, "SKILL.md")));
    } finally {
      try {
        await chmod(path.join(sourceDir, "unreadable-source"), 0o755);
      } catch {
        // best effort
      }
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("atomically replaces stale backups without leaking stale content", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      await executeDeploy(actions, false, false, home);
      await mkdir(backupPath, { recursive: true });
      await writeFile(path.join(backupPath, "stale.txt"), "leftover content");

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(await exists(target));
      assert.ok(!(await exists(backupPath)));
      assert.ok(!(await exists(path.join(target, "stale.txt"))));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});
