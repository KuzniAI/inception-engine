import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
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
import type {
  ConfigPatchDeployAction,
  DeployAction,
  FileWriteDeployAction,
  Manifest,
} from "../src/types.ts";

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
      const { actions } = await planDeploy(
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
      const { actions } = await planDeploy(
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
      const { actions } = await planDeploy(
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

  it("attaches documented confidence to actions for claude-code", async () => {
    const sourceDir = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        "/home/test",
      );
      assert.equal(actions.length, 1);
      if (actions[0]?.kind !== "skill-dir") assert.fail("Expected skill-dir");
      assert.equal(actions[0].confidence, "documented");
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("attaches implementation-only confidence for antigravity", async () => {
    const sourceDir = makeTmpDir();
    const antigravityManifest: Manifest = {
      skills: [
        {
          name: "test-skill",
          path: "skills/test-skill",
          agents: ["antigravity"],
        },
      ],
      mcpServers: [],
      agentRules: [],
    };
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        antigravityManifest,
        sourceDir,
        ["antigravity"],
        "/home/test",
      );
      assert.equal(actions.length, 1);
      if (actions[0]?.kind !== "skill-dir") assert.fail("Expected skill-dir");
      assert.equal(actions[0].confidence, "implementation-only");
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("emits no warnings for all-documented agents", async () => {
    const sourceDir = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { warnings } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code", "codex"],
        "/home/test",
      );
      assert.equal(warnings.length, 0);
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("emits ambiguity warning when both gemini-cli and antigravity are detected", async () => {
    const sourceDir = makeTmpDir();
    const bothManifest: Manifest = {
      skills: [
        {
          name: "test-skill",
          path: "skills/test-skill",
          agents: ["gemini-cli", "antigravity"],
        },
      ],
      mcpServers: [],
      agentRules: [],
    };
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { warnings } = await planDeploy(
        bothManifest,
        sourceDir,
        ["gemini-cli", "antigravity"],
        "/home/test",
      );
      const ambiguity = warnings.find((w) => w.kind === "ambiguity");
      assert.ok(ambiguity, "expected an ambiguity warning");
      assert.match(ambiguity.message, /gemini-cli/);
      assert.match(ambiguity.message, /antigravity/);
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("adapter: mcpServers entry produces a config-patch action for claude-code", async () => {
    const sourceDir = makeTmpDir();
    try {
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [
          {
            name: "my-mcp",
            agents: ["claude-code"],
            config: { command: "my-server" },
          },
        ],
        agentRules: [],
      };
      const { actions, warnings } = await planDeploy(
        manifest,
        sourceDir,
        ["claude-code"],
        "/home/test",
      );
      assert.equal(actions.length, 1);
      const action = actions[0] as ConfigPatchDeployAction;
      assert.equal(action.kind, "config-patch");
      assert.equal(action.skill, "my-mcp");
      assert.equal(action.agent, "claude-code");
      assert.ok(
        action.target.endsWith(".claude.json"),
        `expected target to end with .claude.json, got: ${action.target}`,
      );
      assert.deepEqual(action.patch, {
        mcpServers: { "my-mcp": { command: "my-server" } },
      });
      assert.equal(warnings.length, 0);
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("adapter: mcpServers entry emits a warning for agent without documented mcpConfigPath", async () => {
    const sourceDir = makeTmpDir();
    try {
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [
          {
            name: "my-mcp",
            agents: ["github-copilot"],
            config: { command: "my-server" },
          },
        ],
        agentRules: [],
      };
      const { actions, warnings } = await planDeploy(
        manifest,
        sourceDir,
        ["github-copilot"],
        "/home/test",
      );
      assert.equal(actions.length, 0);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0]?.kind, "confidence");
      assert.match(
        warnings[0]?.message ?? "",
        /does not have a documented MCP config path/,
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("adapter: empty mcpServers and agentRules produce no extra actions or warnings", async () => {
    const sourceDir = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions, warnings } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        "/home/test",
      );
      // Only the one skill-dir action — no adapter output
      assert.equal(actions.length, 1);
      assert.equal(warnings.length, 0);
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
      const { actions } = await planDeploy(
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
      const action = actions[0];
      if (action?.kind !== "skill-dir") {
        assert.fail("Expected skill-dir action");
      }
      assert.equal(readlinkSync(target), action.source);
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
      const { actions } = await planDeploy(
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
      const { actions } = await planDeploy(
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
      const { actions } = await planDeploy(
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

  it("reports permission denied when skill directory is not readable (execute-only)", {
    skip: process.platform === "win32" || process.getuid?.() === 0,
  }, async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    const skillDir = path.join(sourceDir, "skills", "test-skill");
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      // 0o111 = --x--x--x: directory exists and is traversable but not readable
      chmodSync(skillDir, 0o111);
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], home),
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
        chmodSync(skillDir, 0o755);
      } catch {
        /* best effort */
      }
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports permission denied when SKILL.md is not readable", {
    skip: process.platform === "win32" || process.getuid?.() === 0,
  }, async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    const skillMdPath = path.join(
      sourceDir,
      "skills",
      "test-skill",
      "SKILL.md",
    );
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      chmodSync(skillMdPath, 0o000);
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], home),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /Permission denied reading SKILL\.md/);
          return true;
        },
      );
    } finally {
      try {
        chmodSync(skillMdPath, 0o644);
      } catch {
        /* best effort */
      }
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite unmanaged target", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
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
      const { actions } = await planDeploy(
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
      const { actions } = await planDeploy(
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
      const { actions } = await planDeploy(
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
      const { actions } = await planDeploy(
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
      const { actions } = await planDeploy(
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
        confidence: "documented",
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
        confidence: "documented",
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

  it("rename atomically replaces stale .inception-backup — no stale content leaks into target", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      // First deploy to establish a managed target
      await executeDeploy(actions, false, false, home);

      // Simulate a stale backup containing sentinel content
      mkdirSync(backupPath, { recursive: true });
      writeFileSync(path.join(backupPath, "stale.txt"), "leftover content");

      // Redeploy: rename(target, backupPath) atomically replaces the stale dir
      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(existsSync(target), "target must exist after redeploy");
      assert.ok(!existsSync(backupPath), "stale backup must be cleaned up");
      // The stale sentinel file must not appear in the new target
      assert.ok(
        !existsSync(path.join(target, "stale.txt")),
        "stale content must not leak into the new target",
      );
    } finally {
      rmSync(sourceDir, { recursive: true });
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
  it("source dir is unchanged after symlink deploy", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const before = await snapshotDir(sourceDir);
      const { actions } = await planDeploy(
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
        confidence: "documented",
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

  it("source dir is unchanged after symlink revert", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions: deployActions } = await planDeploy(
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
        confidence: "documented",
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

describe("executeDeploy (Windows)", {
  skip: process.platform !== "win32",
}, () => {
  it("creates copies on Windows", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
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
      assert.ok(!lstatSync(target).isSymbolicLink());
      assert.ok(existsSync(path.join(target, "SKILL.md")));
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("registers deployment in registry on Windows copy deploy", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      const skillSource = createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      await executeDeploy(actions, false, false, home);

      const target = actions[0]?.target;
      const entry = await lookupDeployment(home, target);
      assert.ok(entry);
      assert.equal(entry.skill, "test-skill");
      assert.equal(entry.agent, "claude-code");
      assert.equal(entry.source, skillSource);
      assert.equal(entry.method, "copy");
      assert.ok(!existsSync(path.join(skillSource, ".inception-totem")));
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not create copies in dry-run mode on Windows", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
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
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("overwrites existing copy (with registry entry) on Windows", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
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
      rmSync(sourceDir, { recursive: true, force: true });
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

  it("refuses to overwrite unmanaged target on Windows", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;

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
      assert.ok(existsSync(path.join(target, "something.txt")));
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite target with mismatched registry entry on Windows", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;

      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "SKILL.md"), "other content");
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
      assert.ok(existsSync(path.join(target, "SKILL.md")));
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("backup is removed after successful redeploy on Windows", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
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
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("atomic redeploy behavior (Windows)", {
  skip: process.platform !== "win32",
}, () => {
  it("cleans up stale .inception-backup from a previous failed attempt on Windows", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;
      const backupPath = `${target}.inception-backup`;

      await executeDeploy(actions, false, false, home);
      mkdirSync(backupPath, { recursive: true });
      writeFileSync(path.join(backupPath, "stale.txt"), "leftover");

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
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("no backup is created on first deploy (no prior target) on Windows", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
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
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("restores backup when deploy fails (registry not writable) on Windows", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
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
      chmodSync(registryFile, 0o444); // trigger EPERM on Windows

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(
        !existsSync(backupPath),
        "backup should be gone after rollback",
      );
      assert.ok(existsSync(target), "original target must be restored");
      assert.ok(
        existsSync(path.join(target, "SKILL.md")),
        "original content must be present",
      );
    } finally {
      try {
        chmodSync(path.join(home, ".inception-engine", "registry.json"), 0o666);
      } catch {
        /* best effort */
      }
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("executeDeploy — file-write", () => {
  it("copies source file to target", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "my-file.txt");
      const targetFile = path.join(home, "target-dir", "my-file.txt");
      writeFileSync(sourceFile, "hello from source");

      const action: FileWriteDeployAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        source: sourceFile,
        target: targetFile,
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(existsSync(targetFile));
      assert.equal(readFileSync(targetFile, "utf-8"), "hello from source");
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("registers file-write entry in registry", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "file.txt");
      writeFileSync(sourceFile, "content");

      const action: FileWriteDeployAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        source: sourceFile,
        target: targetFile,
      };

      await executeDeploy([action], false, false, home);
      const entry = await lookupDeployment(home, targetFile);
      assert.ok(entry);
      assert.equal(entry.kind, "file-write");
      assert.equal(entry.skill, "test-skill");
      assert.equal(entry.agent, "claude-code");
      if (entry.kind === "file-write") {
        assert.equal(entry.source, sourceFile);
      }
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("overwrites managed target on redeploy (same source path, updated content)", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      // The realistic redeploy scenario: same source file, content has changed
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "file.txt");
      writeFileSync(sourceFile, "version 1");

      const action: FileWriteDeployAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        source: sourceFile,
        target: targetFile,
      };

      await executeDeploy([action], false, false, home);

      // Simulate updated source content
      writeFileSync(sourceFile, "version 2");

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.equal(readFileSync(targetFile, "utf-8"), "version 2");
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite unmanaged file at target", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "existing.txt");
      writeFileSync(sourceFile, "new content");
      writeFileSync(targetFile, "original content");

      const action: FileWriteDeployAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        source: sourceFile,
        target: targetFile,
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(failed[0]?.error.includes("not managed by inception-engine"));
      assert.equal(readFileSync(targetFile, "utf-8"), "original content");
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dry-run does not write file and returns planned change", async () => {
    const sourceDir = makeTmpDir();
    const home = makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "subdir", "file.txt");
      writeFileSync(sourceFile, "content");

      const action: FileWriteDeployAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        source: sourceFile,
        target: targetFile,
      };

      const { succeeded, failed, planned } = await executeDeploy(
        [action],
        true,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(
        !existsSync(targetFile),
        "file should not be written in dry-run",
      );
      assert.equal(planned.length, 1);
      assert.equal(planned[0]?.verb, "write-file");
      assert.equal(planned[0]?.skill, "test-skill");
      assert.equal(planned[0]?.agent, "claude-code");
    } finally {
      rmSync(sourceDir, { recursive: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fails gracefully when source file does not exist", async () => {
    const home = makeTmpDir();
    try {
      const action: FileWriteDeployAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        source: "/nonexistent/file.txt",
        target: path.join(home, "out.txt"),
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.match(failed[0]?.error ?? "", /Source not found/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("executeDeploy — config-patch", () => {
  it("applies a JSON merge patch to an existing config file", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      writeFileSync(configFile, JSON.stringify({ a: 1, b: 2 }));

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: { b: 99, c: 3 },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);

      const result = JSON.parse(readFileSync(configFile, "utf-8"));
      assert.equal(result.a, 1);
      assert.equal(result.b, 99);
      assert.equal(result.c, 3);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("stores correct undoPatch in registry", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      writeFileSync(configFile, JSON.stringify({ a: 1, b: 2 }));

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: { b: 99, c: 3 },
      };

      await executeDeploy([action], false, false, home);
      const entry = await lookupDeployment(home, configFile);
      assert.ok(entry);
      assert.equal(entry.kind, "config-patch");
      if (entry.kind === "config-patch") {
        assert.equal(entry.undoPatch.b, 2); // original value
        assert.equal(entry.undoPatch.c, null); // key was absent
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("null patch values remove keys per RFC 7396", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      writeFileSync(configFile, JSON.stringify({ a: 1, b: 2 }));

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: { b: null },
      };

      await executeDeploy([action], false, false, home);
      const result = JSON.parse(readFileSync(configFile, "utf-8"));
      assert.equal(result.a, 1);
      assert.equal("b" in result, false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fails gracefully when target config does not exist", async () => {
    const home = makeTmpDir();
    try {
      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: path.join(home, "nonexistent.json"),
        patch: { key: "value" },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.match(failed[0]?.error ?? "", /Config file not found/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fails gracefully when target is not valid JSON", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      writeFileSync(configFile, "not json at all");

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: { key: "value" },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.match(failed[0]?.error ?? "", /not valid JSON/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dry-run does not modify config and returns planned change", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      writeFileSync(configFile, JSON.stringify({ a: 1, b: 2 }));

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: { b: 99 },
      };

      const { succeeded, failed, planned } = await executeDeploy(
        [action],
        true,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);

      const after = JSON.parse(readFileSync(configFile, "utf-8"));
      assert.equal(after.b, 2, "config should be unchanged after dry-run");

      assert.equal(planned.length, 1);
      assert.equal(planned[0]?.verb, "patch-config");
      assert.equal(planned[0]?.skill, "test-skill");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses to double-patch config already patched by different skill/agent", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      writeFileSync(configFile, JSON.stringify({ x: 1 }));

      await registerDeployment(home, configFile, {
        kind: "config-patch",
        patch: { x: 99 },
        undoPatch: { x: 1 },
        skill: "other-skill",
        agent: "codex",
      });

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: { y: 2 },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.match(failed[0]?.error ?? "", /already patched/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fails gracefully when patch is not a plain object", async () => {
    const home = makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      writeFileSync(configFile, JSON.stringify({ a: 1 }));

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: ["not", "an", "object"],
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.match(failed[0]?.error ?? "", /plain object/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
