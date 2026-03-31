import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { executeDeploy, planDeploy } from "../../src/core/deploy.ts";
import {
  lookupDeployment,
  registerDeployment,
} from "../../src/core/ownership.ts";
import { executeRevert, planRevert } from "../../src/core/revert.ts";
import type { SkillDirDeployAction } from "../../src/types.ts";
import { exists, makeTmpDir } from "./fs.ts";
import {
  createFailingRegistryPersistence,
  createSkillSource,
  testSkillManifest,
} from "./skill-dir.ts";

interface SkillDirScenarioOptions {
  method: "symlink" | "copy";
  assertManagedTarget(
    target: string,
    source: string,
    expectedSkillMd: string,
  ): Promise<void>;
}

const FIRST_SKILL_MD =
  "---\nname: test\ndescription: First skill\n---\n# First";
const SECOND_SKILL_MD =
  "---\nname: test\ndescription: Second skill\n---\n# Second";

export function registerSharedSkillDirDeployScenarios(
  options: SkillDirScenarioOptions,
): void {
  it("first deploy succeeds", async () => {
    const sourceDir = await makeTmpDir("ie-skill-dir-source");
    const home = await makeTmpDir("ie-skill-dir-home");
    try {
      const source = await createSkillSource(
        sourceDir,
        "skills/test-skill",
        FIRST_SKILL_MD,
      );
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
      await options.assertManagedTarget(
        actions[0]?.target,
        source,
        FIRST_SKILL_MD,
      );

      const entry = await lookupDeployment(home, actions[0]?.target);
      assert.ok(entry);
      assert.equal(entry.kind, "skill-dir");
      assert.equal(entry.method, options.method);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("dry-run reports the planned skill-dir change only", async () => {
    const sourceDir = await makeTmpDir("ie-skill-dir-source");
    const home = await makeTmpDir("ie-skill-dir-home");
    try {
      await createSkillSource(sourceDir, "skills/test-skill", FIRST_SKILL_MD);
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );

      const { succeeded, failed, planned } = await executeDeploy(
        actions,
        true,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.equal(planned.length, 1);
      assert.equal(
        planned[0]?.verb,
        options.method === "symlink" ? "create-symlink" : "copy-dir",
      );
      assert.ok(!(await exists(actions[0]?.target)));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an unmanaged target", async () => {
    const sourceDir = await makeTmpDir("ie-skill-dir-source");
    const home = await makeTmpDir("ie-skill-dir-home");
    try {
      await createSkillSource(sourceDir, "skills/test-skill", FIRST_SKILL_MD);
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "user.txt"), "user content");

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.match(failed[0]?.error, /not managed by inception-engine/);
      assert.equal(
        await readFile(path.join(target, "user.txt"), "utf-8"),
        "user content",
      );
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a target with a mismatched registry entry", async () => {
    const sourceDir = await makeTmpDir("ie-skill-dir-source");
    const home = await makeTmpDir("ie-skill-dir-home");
    try {
      await createSkillSource(sourceDir, "skills/test-skill", FIRST_SKILL_MD);
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), "other");
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/other/source",
        skill: "other-skill",
        agent: "codex",
        method: options.method,
      });

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.match(failed[0]?.error, /not managed by inception-engine/);
      assert.equal(
        await readFile(path.join(target, "SKILL.md"), "utf-8"),
        "other",
      );
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("managed redeploy succeeds", async () => {
    const sourceDir = await makeTmpDir("ie-skill-dir-source");
    const home = await makeTmpDir("ie-skill-dir-home");
    try {
      const source = await createSkillSource(
        sourceDir,
        "skills/test-skill",
        FIRST_SKILL_MD,
      );
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
      await options.assertManagedTarget(
        actions[0]?.target,
        source,
        FIRST_SKILL_MD,
      );
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores the prior managed target when registry persistence fails", async () => {
    const sourceDir = await makeTmpDir("ie-skill-dir-source");
    const home = await makeTmpDir("ie-skill-dir-home");
    try {
      const firstSource = await createSkillSource(
        sourceDir,
        "skills/test-skill",
        FIRST_SKILL_MD,
      );
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const firstAction = actions[0] as SkillDirDeployAction;
      await executeDeploy([firstAction], false, false, home);
      await writeFile(path.join(firstSource, "SKILL.md"), SECOND_SKILL_MD);

      const failAction: SkillDirDeployAction = {
        ...firstAction,
      };

      const { succeeded, failed } = await executeDeploy(
        [failAction],
        false,
        false,
        home,
        {
          registry: createFailingRegistryPersistence(),
        },
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.match(failed[0]?.error, /simulated registry persistence failure/);

      await options.assertManagedTarget(
        firstAction.target,
        firstSource,
        FIRST_SKILL_MD,
      );
      assert.ok(!(await exists(`${firstAction.target}.inception-backup`)));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
}

export function registerSharedSkillDirRevertScenarios(
  options: SkillDirScenarioOptions,
): void {
  it("reverts a managed skill-dir target", async () => {
    const sourceDir = await makeTmpDir("ie-skill-dir-source");
    const home = await makeTmpDir("ie-skill-dir-home");
    try {
      await createSkillSource(sourceDir, "skills/test-skill", FIRST_SKILL_MD);
      const { actions } = await planDeploy(
        testSkillManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      await executeDeploy(actions, false, false, home);

      const revertActions = planRevert(
        testSkillManifest,
        ["claude-code"],
        home,
      );
      const { succeeded, skipped, failed } = await executeRevert(
        revertActions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(skipped, 0);
      assert.equal(failed.length, 0);
      assert.ok(!(await exists(actions[0]?.target)));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips an unmanaged skill-dir target", async () => {
    const home = await makeTmpDir("ie-skill-dir-home");
    try {
      const revertActions = planRevert(
        testSkillManifest,
        ["claude-code"],
        home,
      );
      const target = revertActions[0]?.target;
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), FIRST_SKILL_MD);

      const { succeeded, skipped, failed } = await executeRevert(
        revertActions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.equal(failed.length, 0);
      assert.ok(await exists(target));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("skips a target whose registry entry belongs to a different skill", async () => {
    const sourceDir = await makeTmpDir("ie-skill-dir-source");
    const home = await makeTmpDir("ie-skill-dir-home");
    try {
      const source = await createSkillSource(
        sourceDir,
        "skills/test-skill",
        FIRST_SKILL_MD,
      );
      const revertActions = planRevert(
        testSkillManifest,
        ["claude-code"],
        home,
      );
      const target = revertActions[0]?.target;

      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), FIRST_SKILL_MD);
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source,
        skill: "different-skill",
        agent: "codex",
        method: options.method,
      });

      const { succeeded, skipped, failed } = await executeRevert(
        revertActions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(skipped, 1);
      assert.equal(failed.length, 0);
      assert.ok(await exists(target));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
}
