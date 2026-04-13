import assert from "node:assert/strict";
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  lookupDeployment,
  registerDeployment,
} from "../../../src/core/ownership.ts";
import { executeRevert, planRevert } from "../../../src/core/revert.ts";
import { exists, makeTmpDir } from "../../helpers/fs.ts";
import { testSkillManifest } from "../../helpers/skill-dir.ts";

describe("executeRevert (POSIX)", {
  skip: process.platform === "win32",
}, () => {
  it("removes a symlink registered in the deployment registry", async () => {
    const home = await makeTmpDir();
    const sourceDir = await makeTmpDir();
    try {
      const actions = planRevert(testSkillManifest, ["claude-code"], home);
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
      assert.equal(await lookupDeployment(home, target), null);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("removes a copied directory registered in the deployment registry", async () => {
    const home = await makeTmpDir();
    try {
      const actions = planRevert(testSkillManifest, ["claude-code"], home);
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
      assert.equal(await lookupDeployment(home, target), null);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips missing targets", async () => {
    const home = await makeTmpDir();
    try {
      const actions = planRevert(testSkillManifest, ["claude-code"], home);
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

  it("records a failure when removal is blocked by permissions", async () => {
    const home = await makeTmpDir();
    const sourceDir = await makeTmpDir();
    const actions = planRevert(testSkillManifest, ["claude-code"], home);
    const target = actions[0]?.target ?? "";
    const targetParent = path.dirname(target);
    try {
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), "test");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: sourceDir,
        skill: "test-skill",
        agent: "claude-code",
        method: "copy",
      });

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
      const actions = planRevert(testSkillManifest, ["claude-code"], home);
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
      assert.ok(await exists(target));
      assert.ok(await lookupDeployment(home, target));
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("skips a symlink target that is not in the registry", async () => {
    const home = await makeTmpDir();
    const sourceDir = await makeTmpDir();
    try {
      const actions = planRevert(testSkillManifest, ["claude-code"], home);
      const target = actions[0]?.target;

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
      assert.ok(await exists(target));
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("skips a directory target that is not in the registry", async () => {
    const home = await makeTmpDir();
    try {
      const actions = planRevert(testSkillManifest, ["claude-code"], home);
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
      assert.ok(await exists(target));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips a target whose registry entry has mismatched ownership", async () => {
    const home = await makeTmpDir();
    const sourceDir = await makeTmpDir();
    try {
      const actions = planRevert(testSkillManifest, ["claude-code"], home);
      const target = actions[0]?.target;

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
      assert.ok(await exists(target));
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });
});
