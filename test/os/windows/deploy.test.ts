import assert from "node:assert/strict";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { executeDeploy, planDeploy } from "../../../src/core/deploy.ts";
import {
  lookupDeployment,
  registerDeployment,
} from "../../../src/core/ownership.ts";
import { UserError } from "../../../src/errors.ts";
import { exists, makeTmpDir } from "../../helpers/fs.ts";
import {
  createSkillSource,
  testSkillManifest,
} from "../../helpers/skill-dir.ts";

describe("executeDeploy (Windows)", {
  skip: process.platform !== "win32",
}, () => {
  it("creates copies", async () => {
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
      assert.ok(await exists(actions[0]?.target));
      assert.ok(await exists(path.join(actions[0]?.target, "SKILL.md")));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("registers deployment in registry on copy deploy", async () => {
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

      const entry = await lookupDeployment(home, actions[0]?.target);
      assert.ok(entry);
      if (entry.kind !== "skill-dir") {
        assert.fail("Expected skill-dir");
      }
      assert.equal(entry.skill, "test-skill");
      assert.equal(entry.agent, "claude-code");
      assert.equal(entry.source, skillSource);
      assert.equal(entry.method, "copy");
      assert.ok(
        !(await exists(path.join(skillSource, ".inception-totem"))),
        "no .inception-totem should be written to source directory",
      );
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not create copies in dry-run mode", async () => {
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

  it("overwrites an existing copy with a matching registry entry", async () => {
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
        method: "copy",
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

describe("atomic redeploy behavior (Windows)", {
  skip: process.platform !== "win32",
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

  it("restores the backup when deploy fails because the registry is not writable", async () => {
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

      const { succeeded: firstSucceeded } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(firstSucceeded, 1);

      const registryFile = path.join(
        home,
        ".inception-engine",
        "registry.json",
      );
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
      assert.ok(await exists(path.join(target, "SKILL.md")));
    } finally {
      try {
        await chmod(
          path.join(home, ".inception-engine", "registry.json"),
          0o666,
        );
      } catch {
        // best effort
      }
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});
