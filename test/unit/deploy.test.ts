import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { executeDeploy, planDeploy } from "../../src/core/deploy.ts";
import {
  lookupDeployment,
  registerDeployment,
} from "../../src/core/ownership.ts";
import { executeRevert, planRevert } from "../../src/core/revert.ts";
import { UserError } from "../../src/errors.ts";
import { logger } from "../../src/logger.ts";
import type {
  ConfigPatchDeployAction,
  DeployAction,
  FileWriteDeployAction,
  FrontmatterEmitDeployAction,
  Manifest,
} from "../../src/types.ts";
import { exists, makeTmpDir } from "../helpers/fs.ts";

logger.silence();

async function createSkillSource(
  baseDir: string,
  skillPath: string,
): Promise<string> {
  const fullPath = path.join(baseDir, skillPath);
  await mkdir(fullPath, { recursive: true });
  await writeFile(
    path.join(fullPath, "SKILL.md"),
    "---\nname: test\ndescription: Test skill\n---\n# Test",
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
  files: [],
  configs: [],
  mcpServers: [],
  agentRules: [],
  permissions: [],
  agentDefinitions: [],
};

describe("planDeploy", () => {
  it("creates actions for detected agents only", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await rm(sourceDir, { recursive: true });
    }
  });

  it("creates actions for multiple agents", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code", "codex"],
        "/home/test",
      );
      assert.equal(actions.length, 2);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("skips agents not in detected list", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
        sourceDir,
        ["gemini-cli"],
        "/home/test",
      );
      assert.equal(actions.length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when skill source path does not exist", async () => {
    const sourceDir = await makeTmpDir();
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
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when skill source path is a file, not a directory", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await mkdir(path.join(sourceDir, "skills"), { recursive: true });
      await writeFile(
        path.join(sourceDir, "skills", "test-skill"),
        "not a dir",
      );
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
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when skill source directory is missing SKILL.md", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await mkdir(path.join(sourceDir, "skills", "test-skill"), {
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
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when SKILL.md is missing YAML frontmatter", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const skillDir = path.join(sourceDir, "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(path.join(skillDir, "SKILL.md"), "# Test");
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /must start with YAML frontmatter/);
          return true;
        },
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when SKILL.md frontmatter is missing name", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const skillDir = path.join(sourceDir, "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\ndescription: Missing name\n---\n# Test",
      );
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /must include a non-empty "name" field/);
          return true;
        },
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when SKILL.md frontmatter is missing description", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const skillDir = path.join(sourceDir, "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: test\n---\n# Test",
      );
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(
            err.message,
            /must include a non-empty "description" field/,
          );
          return true;
        },
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when SKILL.md has malformed YAML frontmatter", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const skillDir = path.join(sourceDir, "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: : bad\n---\n# Test",
      );
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "DEPLOY_FAILED");
          assert.match(err.message, /malformed YAML frontmatter/);
          return true;
        },
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when SKILL.md frontmatter name is multiline", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const skillDir = path.join(sourceDir, "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: |\n  multiline\n  name\ndescription: test\n---\n# Test",
      );
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.match(err.message, /must be a single-line string/);
          return true;
        },
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when SKILL.md frontmatter description is multiline", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const skillDir = path.join(sourceDir, "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: test\ndescription: >\n  multiline\n  description\n---\n# Test",
      );
      await assert.rejects(
        planDeploy(testManifest, sourceDir, ["claude-code"], "/home/test"),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.match(err.message, /must be a single-line string/);
          return true;
        },
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("attaches documented confidence to actions for claude-code", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await rm(sourceDir, { recursive: true });
    }
  });

  it("attaches implementation-only confidence for antigravity", async () => {
    const sourceDir = await makeTmpDir();
    const antigravityManifest: Manifest = {
      skills: [
        {
          name: "test-skill",
          path: "skills/test-skill",
          agents: ["antigravity"],
        },
      ],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no warnings for all-documented agents", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { warnings } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code", "codex"],
        "/home/test",
      );
      assert.equal(warnings.length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits ambiguity warning when both gemini-cli and antigravity are in the same agentRules entry", async () => {
    const sourceDir = await makeTmpDir();
    const bothManifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [
        {
          name: "shared-rules",
          path: "GEMINI.md",
          agents: ["gemini-cli", "antigravity"],
          scope: "global",
        },
      ],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      await writeFile(
        path.join(sourceDir, "GEMINI.md"),
        "---\nname: shared-rules\ndescription: test\n---\n# Shared Rules",
      );
      const { warnings } = await planDeploy(
        bothManifest,
        sourceDir,
        ["gemini-cli", "antigravity"],
        "/home/test",
      );
      const ambiguity = warnings.find((w) => w.kind === "ambiguity");
      assert.ok(ambiguity, "expected an ambiguity warning");
      // both agents now target the same GEMINI.md surface — warn that listing
      // both is redundant but harmless
      assert.match(ambiguity.message, /redundant but harmless/);
      assert.match(ambiguity.message, /same surface/);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits ambiguity warning when both gemini-cli and antigravity are detected and share settings.json", async () => {
    const sourceDir = await makeTmpDir();
    const bothManifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [
        {
          name: "shared-mcp",
          agents: ["gemini-cli", "antigravity"],
          config: { command: "my-server" },
        },
      ],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      const { warnings } = await planDeploy(
        bothManifest,
        sourceDir,
        ["gemini-cli", "antigravity"],
        "/home/test",
      );
      const ambiguity = warnings.find((w) => w.kind === "ambiguity");
      assert.ok(ambiguity, "expected an ambiguity warning");
      assert.match(ambiguity.message, /shared MCP surface/);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits NO ambiguity warning when both gemini-cli and antigravity are detected but targets are distinct", async () => {
    const sourceDir = await makeTmpDir();
    const bothManifest: Manifest = {
      skills: [
        {
          name: "test-skill",
          path: "skills/test-skill",
          agents: ["gemini-cli", "antigravity"],
        },
      ],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { warnings } = await planDeploy(
        bothManifest,
        sourceDir,
        ["gemini-cli", "antigravity"],
        "/home/test",
      );
      const ambiguity = warnings.find((w) => w.kind === "ambiguity");
      assert.ok(!ambiguity, "did not expect an ambiguity warning");
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("agentRules entry with gemini-cli and antigravity (global scope) produces ONE deduplicated file-write action", async () => {
    const sourceDir = await makeTmpDir();
    const bothManifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [
        {
          name: "my-rules",
          path: "GEMINI.md",
          agents: ["gemini-cli", "antigravity"],
          scope: "global",
        },
      ],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      await writeFile(
        path.join(sourceDir, "GEMINI.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const { actions } = await planDeploy(
        bothManifest,
        sourceDir,
        ["gemini-cli", "antigravity"],
        "/home/test",
      );
      const rulesActions = actions.filter((a) => a.kind === "file-write");
      // Both agents target ~/.gemini/GEMINI.md — deduplication emits only one action.
      assert.equal(
        rulesActions.length,
        1,
        "expected one deduplicated file-write action",
      );
      // First agent in list wins.
      assert.equal(rulesActions[0]?.agent, "gemini-cli");
      assert.ok(
        (rulesActions[0] as FileWriteDeployAction).target
          .replaceAll("\\", "/")
          .endsWith(".gemini/GEMINI.md"),
        `expected target to end with .gemini/GEMINI.md, got: ${rulesActions[0]?.agent}`,
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("adapter: mcpServers entry produces a config-patch action for claude-code", async () => {
    const sourceDir = await makeTmpDir();
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
        permissions: [],
        agentDefinitions: [],
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
      await rm(sourceDir, { recursive: true });
    }
  });

  it("adapter: mcpServers entry emits a schema-aware warning for unsupported MCP surfaces", async () => {
    const sourceDir = await makeTmpDir();
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
        permissions: [],
        agentDefinitions: [],
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
      assert.match(warnings[0]?.message ?? "", /planned/);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("adapter: empty mcpServers and agentRules produce no extra actions or warnings", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await rm(sourceDir, { recursive: true });
    }
  });

  it("ignores invalid skill sources for agents that are not being deployed", async () => {
    const sourceDir = await makeTmpDir();
    const manifest: Manifest = {
      skills: [
        {
          name: "codex-only",
          path: "skills/missing",
          agents: ["codex"],
        },
        {
          name: "claude-only",
          path: "skills/claude-only",
          agents: ["claude-code"],
        },
      ],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      await createSkillSource(sourceDir, "skills/claude-only");
      const { actions } = await planDeploy(
        manifest,
        sourceDir,
        ["claude-code"],
        "/home/test",
      );
      assert.equal(actions.length, 1);
      assert.equal(actions[0]?.skill, "claude-only");
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("ignores invalid file sources for agents that are not being deployed", async () => {
    const sourceDir = await makeTmpDir();
    const manifest: Manifest = {
      skills: [],
      files: [
        {
          name: "codex-file",
          path: "missing.txt",
          target: "{home}/missing.txt",
          agents: ["codex"],
        },
        {
          name: "claude-file",
          path: "present.txt",
          target: "{home}/present.txt",
          agents: ["claude-code"],
        },
      ],
      configs: [],
      mcpServers: [],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      await writeFile(path.join(sourceDir, "present.txt"), "present");
      const { actions } = await planDeploy(
        manifest,
        sourceDir,
        ["claude-code"],
        "/home/test",
      );
      assert.equal(actions.length, 1);
      assert.equal(actions[0]?.skill, "claude-file");
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("ignores invalid agentRule sources for agents that are not being deployed", async () => {
    const sourceDir = await makeTmpDir();
    const manifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [
        {
          name: "codex-rules",
          path: "missing.md",
          agents: ["codex"],
          scope: "global",
        },
        {
          name: "claude-rules",
          path: "CLAUDE.md",
          agents: ["claude-code"],
          scope: "global",
        },
      ],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      await writeFile(
        path.join(sourceDir, "CLAUDE.md"),
        "---\nname: test-rule\ndescription: test\n---\n# Rules",
      );
      const { actions } = await planDeploy(
        manifest,
        sourceDir,
        ["claude-code"],
        "/home/test",
      );
      assert.equal(actions.length, 1);
      assert.equal(actions[0]?.skill, "claude-rules");
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("mcpServers entry with gemini-cli and antigravity produces actions at distinct targets", async () => {
    const sourceDir = await makeTmpDir();
    const manifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [
        {
          name: "my-mcp",
          agents: ["gemini-cli", "antigravity"],
          config: { command: "my-server" },
        },
      ],
      agentRules: [],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      const { actions, warnings } = await planDeploy(
        manifest,
        sourceDir,
        ["gemini-cli", "antigravity"],
        "/home/test",
        "/repo",
      );
      const ambiguity = warnings.find((w) => w.kind === "ambiguity");
      assert.ok(ambiguity, "expected an ambiguity warning");

      const geminiAction = actions.find(
        (a) => a.agent === "gemini-cli",
      ) as ConfigPatchDeployAction;
      const antigravityAction = actions.find(
        (a) => a.agent === "antigravity",
      ) as FrontmatterEmitDeployAction;

      assert.ok(geminiAction, "expected a gemini-cli action");
      assert.match(geminiAction.target, /[\\/]\.gemini[\\/]settings\.json$/);

      assert.ok(antigravityAction, "expected an antigravity action");
      // Antigravity's target for mcpServer is .agents/rules/{name}.md
      assert.match(
        antigravityAction.target,
        /[\\/]\.agents[\\/]rules[\\/]my-mcp\.md$/,
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("agentRules with scope: repo and workspace emits scope-aware ambiguity warnings for Gemini CLI", async () => {
    const sourceDir = await makeTmpDir();
    const manifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [
        {
          name: "repo-rules",
          path: "repo.md",
          agents: ["gemini-cli", "antigravity"],
          scope: "repo",
        },
        {
          name: "workspace-rules",
          path: "workspace.md",
          agents: ["gemini-cli", "antigravity"],
          scope: "workspace",
        },
      ],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      await writeFile(
        path.join(sourceDir, "repo.md"),
        "---\nname: repo-rule\ndescription: test\n---\n# Repo",
      );
      await writeFile(
        path.join(sourceDir, "workspace.md"),
        "---\nname: workspace-rule\ndescription: test\n---\n# Workspace",
      );

      const { warnings } = await planDeploy(
        manifest,
        sourceDir,
        ["gemini-cli", "antigravity"],
        "/home/test",
        "/repo",
        "/workspace",
      );

      const repoWarning = warnings.find(
        (w) => w.kind === "ambiguity" && w.message.includes("repo-rules"),
      );
      const workspaceWarning = warnings.find(
        (w) => w.kind === "ambiguity" && w.message.includes("workspace-rules"),
      );

      assert.ok(repoWarning, "expected ambiguity warning for repo-rules");
      assert.match(repoWarning.message, /same surface/);

      // antigravity does not support workspace scope, so the paths do not
      // match — no ambiguity warning should be emitted for workspace-rules
      assert.equal(
        workspaceWarning,
        undefined,
        "expected no ambiguity warning for workspace-rules (antigravity lacks workspace support)",
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("agentDefinitions entry with gemini-cli and antigravity emits ambiguity warning for behavioral divergence", async () => {
    const sourceDir = await makeTmpDir();
    const manifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [],
      permissions: [],
      agentDefinitions: [
        {
          name: "my-agent",
          path: "agents/my-agent.md",
          agents: ["gemini-cli", "antigravity"],
        },
      ],
    };
    try {
      await mkdir(path.join(sourceDir, "agents"), { recursive: true });
      await writeFile(
        path.join(sourceDir, "agents", "my-agent.md"),
        "---\nname: test-agent\ndescription: test\n---\n# Agent",
      );
      const { actions, warnings } = await planDeploy(
        manifest,
        sourceDir,
        ["gemini-cli", "antigravity"],
        "/home/test",
        "/repo",
      );

      const ambiguity = warnings.find(
        (w) => w.kind === "ambiguity" && w.message.includes("agentDefinitions"),
      );
      assert.ok(
        ambiguity,
        "expected an ambiguity warning for agentDefinitions",
      );
      assert.match(ambiguity.message, /behavioral divergence/);

      const geminiAction = actions.find((a) => a.agent === "gemini-cli");
      const antigravityAction = actions.find((a) => a.agent === "antigravity");

      assert.ok(geminiAction, "expected a geminiAction");
      assert.ok(antigravityAction, "expected an antigravityAction");

      assert.match(
        geminiAction.target,
        /[\\/]\.gemini[\\/]agents[\\/]my-agent\.md$/,
      );
      assert.match(
        antigravityAction.target,
        /[\\/]\.agents[\\/]rules[\\/]my-agent\.md$/,
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("agentRules support scope: workspace for supported agents", async () => {
    const sourceDir = await makeTmpDir();
    const manifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [
        {
          name: "workspace-rules",
          path: "workspace.md",
          agents: ["claude-code"],
          scope: "workspace",
        },
      ],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      await writeFile(
        path.join(sourceDir, "workspace.md"),
        "---\nname: workspace-rule\ndescription: test\n---\n# Workspace",
      );
      const { actions, warnings } = await planDeploy(
        manifest,
        sourceDir,
        ["claude-code"],
        "/home/test",
        "/repo",
        "/workspace",
      );

      assert.equal(actions.length, 1);
      assert.equal(actions[0]?.kind, "file-write");
      assert.equal(actions[0]?.agent, "claude-code");
      assert.equal(actions[0]?.target, "/workspace/CLAUDE.md");
      assert.equal(warnings.length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("agentRules support scope: workspace even if unsupported by agent (emits confidence warning)", async () => {
    const sourceDir = await makeTmpDir();
    const manifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [],
      agentRules: [
        {
          name: "workspace-rules",
          path: "workspace.md",
          agents: ["antigravity"],
          scope: "workspace",
        },
      ],
      permissions: [],
      agentDefinitions: [],
    };
    try {
      await writeFile(
        path.join(sourceDir, "workspace.md"),
        "---\nname: workspace-rule\ndescription: test\n---\n# Workspace",
      );
      const { warnings } = await planDeploy(
        manifest,
        sourceDir,
        ["antigravity"],
        "/home/test",
        "/repo",
        "/workspace",
      );

      const confidence = warnings.find(
        (w) =>
          w.kind === "confidence" &&
          w.message.includes("workspace") &&
          w.message.includes("unsupported"),
      );
      assert.ok(
        confidence,
        "expected an unsupported confidence warning for workspace scope on antigravity",
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits collision warning when agentDefinitions and mcpServers share a name for antigravity", async () => {
    const sourceDir = await makeTmpDir();
    const manifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [
        {
          name: "my-tool",
          agents: ["antigravity"],
          config: { command: "npx", args: ["-y", "my-tool"] },
        },
      ],
      agentRules: [],
      permissions: [],
      agentDefinitions: [
        { name: "my-tool", path: "agents/my-tool.md", agents: ["antigravity"] },
      ],
    };
    try {
      await mkdir(path.join(sourceDir, "agents"), { recursive: true });
      await writeFile(
        path.join(sourceDir, "agents", "my-tool.md"),
        "---\nname: my-tool\ndescription: test\n---\n# Tool\n",
      );
      const { warnings } = await planDeploy(
        manifest,
        sourceDir,
        ["antigravity"],
        "/home/test",
        "/repo",
      );
      const collision = warnings.find(
        (w) => w.kind === "collision" && w.message.includes("my-tool"),
      );
      assert.ok(
        collision,
        "expected a collision warning for same-name agentDefinitions and mcpServers entries",
      );
      assert.ok(
        collision?.message.includes(".agents/rules/my-tool.md"),
        "collision warning should reference the resolved path",
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no collision warning when agentDefinitions and mcpServers have different names for antigravity", async () => {
    const sourceDir = await makeTmpDir();
    const manifest: Manifest = {
      skills: [],
      files: [],
      configs: [],
      mcpServers: [
        {
          name: "my-mcp",
          agents: ["antigravity"],
          config: { command: "npx", args: ["-y", "my-mcp"] },
        },
      ],
      agentRules: [],
      permissions: [],
      agentDefinitions: [
        {
          name: "my-agent",
          path: "agents/my-agent.md",
          agents: ["antigravity"],
        },
      ],
    };
    try {
      await mkdir(path.join(sourceDir, "agents"), { recursive: true });
      await writeFile(
        path.join(sourceDir, "agents", "my-agent.md"),
        "---\nname: my-agent\ndescription: test\n---\n# Agent\n",
      );
      const { warnings } = await planDeploy(
        manifest,
        sourceDir,
        ["antigravity"],
        "/home/test",
        "/repo",
      );
      const collision = warnings.find(
        (w) =>
          w.kind === "collision" &&
          (w.message.includes("my-mcp") || w.message.includes("my-agent")),
      );
      assert.equal(
        collision,
        undefined,
        "should not emit a collision warning when names differ",
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });
});

describe("executeDeploy", { skip: process.platform === "win32" }, () => {
  it("creates symlinks on POSIX", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      assert.ok(await exists(target));
      assert.ok((await lstat(target)).isSymbolicLink());
      const action = actions[0];
      if (action?.kind !== "skill-dir") {
        assert.fail("Expected skill-dir action");
      }
      assert.equal(await readlink(target), action.source);
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("registers deployment in registry on POSIX symlink deploy", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const skillSource = await createSkillSource(
        sourceDir,
        "skills/test-skill",
      );
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
      if (entry.kind !== "skill-dir") assert.fail("Expected skill-dir");
      assert.equal(entry.skill, "test-skill");
      assert.equal(entry.agent, "claude-code");
      assert.equal(entry.source, skillSource);
      assert.equal(entry.method, "symlink");

      // No .inception-totem should exist in source
      assert.ok(
        !(await exists(path.join(skillSource, ".inception-totem"))),
        "no .inception-totem should be written to source directory",
      );
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not create symlinks in dry-run mode", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      assert.ok(!(await exists(target)));
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("overwrites existing symlink (with registry entry)", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports error for missing source (caught at planning)", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports permission denied when source is unreadable (caught at planning)", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    // Chmod the parent so traversal into the skill source dir fails with EACCES
    const skillsDir = path.join(sourceDir, "skills");
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      await chmod(skillsDir, 0o000);
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
      await chmod(skillsDir, 0o755);
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports permission denied when skill directory is not readable (execute-only)", {
    skip: process.platform === "win32" || process.getuid?.() === 0,
  }, async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    const skillDir = path.join(sourceDir, "skills", "test-skill");
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      // 0o111 = --x--x--x: directory exists and is traversable but not readable
      await chmod(skillDir, 0o111);
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
        await chmod(skillDir, 0o755);
      } catch {
        /* best effort */
      }
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports permission denied when SKILL.md is not readable", {
    skip: process.platform === "win32" || process.getuid?.() === 0,
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
        await chmod(skillMdPath, 0o644);
      } catch {
        /* best effort */
      }
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite unmanaged target", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;

      // Create an unmanaged directory at the target (no registry entry)
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

      // Original content should still be there
      assert.ok(await exists(path.join(target, "something.txt")));
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite target with mismatched registry entry", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
        sourceDir,
        ["claude-code"],
        home,
      );
      const target = actions[0]?.target;

      // Create a directory at the target and register it under a different source/skill
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

      // Original content should still be there
      assert.ok(await exists(path.join(target, "SKILL.md")));
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("backup is removed after successful redeploy", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
        !(await exists(backupPath)),
        "backup should not exist after successful redeploy",
      );
      assert.ok(await exists(target), "target should exist after redeploy");
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("atomic redeploy behavior", {
  skip: process.platform === "win32",
}, () => {
  it("cleans up stale .inception-backup from a previous failed attempt", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await mkdir(backupPath, { recursive: true });
      await writeFile(path.join(backupPath, "stale.txt"), "leftover");

      // Redeploy should clean up the stale backup and succeed
      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(
        !(await exists(backupPath)),
        "stale backup should be cleaned up",
      );
      assert.ok(await exists(target), "target should exist after redeploy");
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("no backup is created on first deploy (no prior target)", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      assert.ok(await exists(target));
      assert.ok(
        !(await exists(backupPath)),
        "no backup should be created when there was no prior target",
      );
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores backup when registry write fails (registry file read-only)", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    const registryFile = path.join(home, ".inception-engine", "registry.json");
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      const originalLink = await readlink(target);

      // Make registry file read-only so registerDeployment fails on the next attempt.
      // The lookupDeployment (read) still works; only the write will throw EACCES.
      await chmod(registryFile, 0o444);

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
        !(await exists(backupPath)),
        "backup should be gone after rollback",
      );

      // Original managed symlink must be restored at the target path
      assert.ok(await exists(target), "original symlink must be restored");
      assert.ok(
        (await lstat(target)).isSymbolicLink(),
        "restored target must be a symlink",
      );
      assert.equal(
        await readlink(target),
        originalLink,
        "restored symlink must point to original source",
      );
    } finally {
      try {
        await chmod(registryFile, 0o644);
      } catch {
        /* best effort */
      }
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores backup when cp fails (source not readable)", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      // First deploy using copy method to establish a managed target directory
      const skillSource = await createSkillSource(
        sourceDir,
        "skills/test-skill",
      );
      const target = path.join(home, ".claude", "skills", "test-skill");
      await mkdir(path.dirname(target), { recursive: true });

      const firstAction: import("../../src/types.ts").DeployAction = {
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

      // Create an unreadable source directory for the next deploy attempt
      // access() (F_OK) passes — the dir exists — but cp() fails reading its contents
      const unreadableSource = path.join(sourceDir, "unreadable-source");
      await mkdir(unreadableSource, { recursive: true });
      await writeFile(path.join(unreadableSource, "SKILL.md"), "---");
      await chmod(unreadableSource, 0o000);

      const backupPath = `${target}.inception-backup`;
      const failAction: import("../../src/types.ts").DeployAction = {
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
        !(await exists(backupPath)),
        "backup should be gone after rollback",
      );

      // Original managed directory must be restored with its content intact
      assert.ok(await exists(target), "original target must be restored");
      assert.ok(
        await exists(path.join(target, "SKILL.md")),
        "restored target must have original content",
      );
    } finally {
      try {
        await chmod(path.join(sourceDir, "unreadable-source"), 0o755);
      } catch {
        /* best effort */
      }
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rename atomically replaces stale .inception-backup — no stale content leaks into target", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await mkdir(backupPath, { recursive: true });
      await writeFile(path.join(backupPath, "stale.txt"), "leftover content");

      // Redeploy: rename(target, backupPath) atomically replaces the stale dir
      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(await exists(target), "target must exist after redeploy");
      assert.ok(!(await exists(backupPath)), "stale backup must be cleaned up");
      // The stale sentinel file must not appear in the new target
      assert.ok(
        !(await exists(path.join(target, "stale.txt"))),
        "stale content must not leak into the new target",
      );
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("planDeploy path traversal", () => {
  it("throws when skill.path resolves to the repository root itself (.)", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const rootManifest: Manifest = {
        skills: [{ name: "root-skill", path: ".", agents: ["claude-code"] }],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [],
        permissions: [],
        agentDefinitions: [],
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
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when skill.path escapes sourceDir via traversal (../../outside)", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const traversalManifest: Manifest = {
        skills: [
          { name: "evil", path: "../../outside", agents: ["claude-code"] },
        ],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [],
        permissions: [],
        agentDefinitions: [],
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
      await rm(sourceDir, { recursive: true });
    }
  });

  it("throws when skill.path escapes via symlink", async () => {
    const sourceDir = await makeTmpDir();
    const outsideDir = await makeTmpDir();
    try {
      // Create a symlink inside the repo that points outside
      const symlinkPath = path.join(sourceDir, "skills", "escape");
      await mkdir(path.join(sourceDir, "skills"), { recursive: true });
      await symlink(
        outsideDir,
        symlinkPath,
        process.platform === "win32" ? "junction" : "dir",
      );

      const escapeManifest: Manifest = {
        skills: [
          { name: "evil", path: "skills/escape", agents: ["claude-code"] },
        ],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [],
        permissions: [],
        agentDefinitions: [],
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
      await rm(sourceDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true });
    }
  });
});

async function snapshotDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries.sort();
}

describe("source directory immutability", () => {
  it("source dir is unchanged after symlink deploy", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("source dir is unchanged after copy deploy", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const skillSource = await createSkillSource(
        sourceDir,
        "skills/test-skill",
      );
      const target = path.join(home, ".claude", "skills", "test-skill");
      await mkdir(path.dirname(target), { recursive: true });
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
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("source dir is unchanged after symlink revert", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("source dir is unchanged after copy revert", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const skillSource = await createSkillSource(
        sourceDir,
        "skills/test-skill",
      );
      const target = path.join(home, ".claude", "skills", "test-skill");
      await mkdir(path.dirname(target), { recursive: true });
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
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("executeDeploy (Windows)", {
  skip: process.platform !== "win32",
}, () => {
  it("creates copies on Windows", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      assert.ok(await exists(target));
      assert.ok(!(await lstat(target)).isSymbolicLink());
      assert.ok(await exists(path.join(target, "SKILL.md")));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("registers deployment in registry on Windows copy deploy", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const skillSource = await createSkillSource(
        sourceDir,
        "skills/test-skill",
      );
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
      if (entry.kind !== "skill-dir") assert.fail("Expected skill-dir");
      assert.equal(entry.skill, "test-skill");
      assert.equal(entry.agent, "claude-code");
      assert.equal(entry.source, skillSource);
      assert.equal(entry.method, "copy");
      assert.ok(!(await exists(path.join(skillSource, ".inception-totem"))));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not create copies in dry-run mode on Windows", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      assert.ok(!(await exists(target)));
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("overwrites existing copy (with registry entry) on Windows", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports error for missing source (caught at planning)", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite unmanaged target on Windows", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
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

  it("refuses to overwrite target with mismatched registry entry on Windows", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
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

  it("backup is removed after successful redeploy on Windows", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
        !(await exists(backupPath)),
        "backup should not exist after successful redeploy",
      );
      assert.ok(await exists(target), "target should exist after redeploy");
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("atomic redeploy behavior (Windows)", {
  skip: process.platform !== "win32",
}, () => {
  it("cleans up stale .inception-backup from a previous failed attempt on Windows", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
      const { actions } = await planDeploy(
        testManifest,
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
      assert.ok(
        !(await exists(backupPath)),
        "stale backup should be cleaned up",
      );
      assert.ok(await exists(target), "target should exist after redeploy");
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("no backup is created on first deploy (no prior target) on Windows", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      assert.ok(await exists(target));
      assert.ok(
        !(await exists(backupPath)),
        "no backup should be created when there was no prior target",
      );
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores backup when deploy fails (registry not writable) on Windows", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await createSkillSource(sourceDir, "skills/test-skill");
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
      await chmod(registryFile, 0o444); // trigger EPERM on Windows

      const { succeeded, failed } = await executeDeploy(
        actions,
        false,
        false,
        home,
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(
        !(await exists(backupPath)),
        "backup should be gone after rollback",
      );
      assert.ok(await exists(target), "original target must be restored");
      assert.ok(
        await exists(path.join(target, "SKILL.md")),
        "original content must be present",
      );
    } finally {
      try {
        await chmod(
          path.join(home, ".inception-engine", "registry.json"),
          0o666,
        );
      } catch {
        /* best effort */
      }
      await rm(sourceDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("executeDeploy — file-write", () => {
  it("copies source file to target", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "my-file.txt");
      const targetFile = path.join(home, "target-dir", "my-file.txt");
      await writeFile(sourceFile, "hello from source");

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
      assert.ok(await exists(targetFile));
      assert.equal(await readFile(targetFile, "utf-8"), "hello from source");
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("registers file-write entry in registry", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "file.txt");
      await writeFile(sourceFile, "content");

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
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("overwrites managed target on redeploy (same source path, updated content)", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      // The realistic redeploy scenario: same source file, content has changed
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "file.txt");
      await writeFile(sourceFile, "version 1");

      const action: FileWriteDeployAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        source: sourceFile,
        target: targetFile,
      };

      await executeDeploy([action], false, false, home);

      // Simulate updated source content
      await writeFile(sourceFile, "version 2");

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.equal(await readFile(targetFile, "utf-8"), "version 2");
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite unmanaged file at target", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "existing.txt");
      await writeFile(sourceFile, "new content");
      await writeFile(targetFile, "original content");

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
      assert.equal(await readFile(targetFile, "utf-8"), "original content");
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("dry-run does not write file and returns planned change", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "subdir", "file.txt");
      await writeFile(sourceFile, "content");

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
        !(await exists(targetFile)),
        "file should not be written in dry-run",
      );
      assert.equal(planned.length, 1);
      assert.equal(planned[0]?.verb, "write-file");
      assert.equal(planned[0]?.skill, "test-skill");
      assert.equal(planned[0]?.agent, "claude-code");
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("fails gracefully when source file does not exist", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rolls back a newly written file when registry persistence fails", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "out.txt");
      await writeFile(sourceFile, "content");

      const action: FileWriteDeployAction = {
        kind: "file-write",
        skill: "test-skill",
        agent: "claude-code",
        source: sourceFile,
        target: targetFile,
      };

      const failingRegistry = {
        async load() {
          return { version: 1 as const, deployments: {} };
        },
        async save() {
          throw new Error("registry unavailable");
        },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
        { registry: failingRegistry },
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.ok(
        !(await exists(targetFile)),
        "target file should be rolled back",
      );
      assert.ok(!(await exists(`${targetFile}.inception-backup`)));
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores the previous managed file when registry persistence fails during overwrite", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "managed.txt");
      await writeFile(sourceFile, "new content");
      await writeFile(targetFile, "old content");

      let loadCount = 0;
      const failingRegistry = {
        async load() {
          loadCount += 1;
          return {
            version: 1 as const,
            deployments:
              loadCount === 1
                ? {
                    [targetFile]: {
                      kind: "file-write" as const,
                      source: sourceFile,
                      skill: "test-skill",
                      agent: "claude-code" as const,
                      deployed: new Date().toISOString(),
                    },
                  }
                : {},
          };
        },
        async save() {
          throw new Error("registry unavailable");
        },
      };

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
        { registry: failingRegistry },
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.equal(await readFile(targetFile, "utf-8"), "old content");
      assert.ok(!(await exists(`${targetFile}.inception-backup`)));
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("leaves the original managed file untouched when the final swap fails", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "managed.txt");
      await writeFile(sourceFile, "new content");
      await writeFile(targetFile, "old content");

      await registerDeployment(home, targetFile, {
        kind: "file-write",
        source: sourceFile,
        skill: "test-skill",
        agent: "claude-code",
      });

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
        {
          fileOps: {
            copyFile,
            writeFile,
            rm,
            async rename(source, target) {
              if (source.includes(".inception-tmp-") && target === targetFile) {
                throw new Error("swap failed");
              }
              await rename(source, target);
            },
          },
        },
      );

      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.equal(await readFile(targetFile, "utf-8"), "old content");
      assert.ok(!(await exists(`${targetFile}.inception-backup`)));
      assert.deepEqual(
        (await readdir(path.dirname(targetFile))).filter((entry) =>
          entry.includes(".inception-tmp-"),
        ),
        [],
      );
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("cleans up a stale file-write backup before replacing a managed file", async () => {
    const sourceDir = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const sourceFile = path.join(sourceDir, "file.txt");
      const targetFile = path.join(home, "managed.txt");
      const backupPath = `${targetFile}.inception-backup`;
      await writeFile(sourceFile, "new content");
      await writeFile(targetFile, "old content");
      await writeFile(backupPath, "stale backup");

      await registerDeployment(home, targetFile, {
        kind: "file-write",
        source: sourceFile,
        skill: "test-skill",
        agent: "claude-code",
      });

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
      assert.equal(await readFile(targetFile, "utf-8"), "new content");
      assert.ok(!(await exists(backupPath)));
    } finally {
      await rm(sourceDir, { recursive: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("executeDeploy — config-patch", () => {
  it("applies a JSON merge patch to an existing config file", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ a: 1, b: 2 }));

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

      const result = JSON.parse(await readFile(configFile, "utf-8"));
      assert.equal(result.a, 1);
      assert.equal(result.b, 99);
      assert.equal(result.c, 3);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("stores correct undoPatch in registry", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ a: 1, b: 2 }));

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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("null patch values remove keys per RFC 7396", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ a: 1, b: 2 }));

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: { b: null },
      };

      await executeDeploy([action], false, false, home);
      const result = JSON.parse(await readFile(configFile, "utf-8"));
      assert.equal(result.a, 1);
      assert.equal("b" in result, false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("fails gracefully when target config does not exist", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("fails gracefully when target is not valid JSON", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, "not json at all");

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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("dry-run does not modify config and returns planned change", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ a: 1, b: 2 }));

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

      const after = JSON.parse(await readFile(configFile, "utf-8"));
      assert.equal(after.b, 2, "config should be unchanged after dry-run");

      assert.equal(planned.length, 1);
      assert.equal(planned[0]?.verb, "patch-config");
      assert.equal(planned[0]?.skill, "test-skill");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refuses to double-patch config already patched by different skill/agent", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ x: 1 }));

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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("fails gracefully when patch is not a plain object", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ a: 1 }));

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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("applies nested JSON merge patch, preserving sibling keys", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(
        configFile,
        JSON.stringify({
          mcpServers: { "existing-server": { command: "old" } },
        }),
      );

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "new-server",
        agent: "claude-code",
        target: configFile,
        patch: { mcpServers: { "new-server": { command: "new" } } },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);

      const result = JSON.parse(await readFile(configFile, "utf-8"));
      assert.deepEqual(result.mcpServers["existing-server"], {
        command: "old",
      });
      assert.deepEqual(result.mcpServers["new-server"], { command: "new" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("stores correct deep undoPatch for nested patch", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(
        configFile,
        JSON.stringify({
          mcpServers: { "existing-server": { command: "old" } },
        }),
      );

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "new-server",
        agent: "claude-code",
        target: configFile,
        patch: { mcpServers: { "new-server": { command: "new" } } },
      };

      await executeDeploy([action], false, false, home);
      const entry = await lookupDeployment(home, configFile);
      assert.ok(entry);
      assert.equal(entry.kind, "config-patch");
      if (entry.kind === "config-patch") {
        // The undo patch should be nested, not shallow
        const mcpUndo = entry.undoPatch.mcpServers as Record<string, unknown>;
        assert.ok(
          typeof mcpUndo === "object" && mcpUndo !== null,
          "undoPatch.mcpServers should be a nested object",
        );
        // Only the new server key should be in the undo patch
        assert.equal(mcpUndo["new-server"], null); // was absent, so null = delete on undo
        assert.equal("existing-server" in mcpUndo, false); // sibling not touched
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("null patch value inside nested object deletes only that leaf key", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(
        configFile,
        JSON.stringify({
          mcpServers: {
            "server-a": { command: "a" },
            "server-b": { command: "b" },
          },
        }),
      );

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "remove-server-a",
        agent: "claude-code",
        target: configFile,
        patch: { mcpServers: { "server-a": null } },
      };

      await executeDeploy([action], false, false, home);
      const result = JSON.parse(await readFile(configFile, "utf-8"));
      assert.equal("server-a" in result.mcpServers, false);
      assert.deepEqual(result.mcpServers["server-b"], { command: "b" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores the original config when registry persistence fails after patching", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ a: 1, b: 2 }));

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: { b: 99 },
      };

      const failingRegistry = {
        async load() {
          return { version: 1 as const, deployments: {} };
        },
        async save() {
          throw new Error("registry unavailable");
        },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
        { registry: failingRegistry },
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.deepEqual(JSON.parse(await readFile(configFile, "utf-8")), {
        a: 1,
        b: 2,
      });
      assert.ok(!(await exists(`${configFile}.inception-backup`)));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("leaves the original config untouched when the final swap fails", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      await writeFile(configFile, JSON.stringify({ a: 1, b: 2 }));

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: { b: 99 },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
        {
          fileOps: {
            copyFile,
            writeFile,
            rm,
            async rename(source, target) {
              if (source.includes(".inception-tmp-") && target === configFile) {
                throw new Error("swap failed");
              }
              await rename(source, target);
            },
          },
        },
      );

      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.deepEqual(JSON.parse(await readFile(configFile, "utf-8")), {
        a: 1,
        b: 2,
      });
      assert.ok(!(await exists(`${configFile}.inception-backup`)));
      assert.deepEqual(
        (await readdir(path.dirname(configFile))).filter((entry) =>
          entry.includes(".inception-tmp-"),
        ),
        [],
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("cleans up a stale config-patch backup before replacing the config", async () => {
    const home = await makeTmpDir();
    try {
      const configFile = path.join(home, "config.json");
      const backupPath = `${configFile}.inception-backup`;
      await writeFile(configFile, JSON.stringify({ a: 1, b: 2 }));
      await writeFile(backupPath, "stale backup");

      const action: ConfigPatchDeployAction = {
        kind: "config-patch",
        skill: "test-skill",
        agent: "claude-code",
        target: configFile,
        patch: { b: 99 },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );

      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.deepEqual(JSON.parse(await readFile(configFile, "utf-8")), {
        a: 1,
        b: 99,
      });
      assert.ok(!(await exists(backupPath)));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("executeDeploy — frontmatter-emit", () => {
  it("merges engine-owned frontmatter while preserving unrelated keys and body", async () => {
    const home = await makeTmpDir();
    try {
      const targetFile = path.join(home, ".agents", "rules", "my-mcp.md");
      await mkdir(path.dirname(targetFile), { recursive: true });
      await writeFile(
        targetFile,
        "---\nname: Existing Agent\ndescription: Keep me\n---\n\n# Body\n",
      );

      const action: FrontmatterEmitDeployAction = {
        kind: "frontmatter-emit",
        skill: "my-mcp",
        agent: "antigravity",
        target: targetFile,
        frontmatter: {
          "mcp-servers": {
            "my-mcp": { command: "npx", args: ["-y", "serve"] },
          },
        },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);

      const content = await readFile(targetFile, "utf-8");
      assert.match(content, /name: Existing Agent/);
      assert.match(content, /description: Keep me/);
      assert.match(content, /mcp-servers:/);
      assert.match(content, /# Body/);

      const entry = await lookupDeployment(home, targetFile);
      assert.ok(entry);
      assert.equal(entry?.kind, "frontmatter-emit");
      if (entry?.kind === "frontmatter-emit") {
        assert.deepEqual(entry.patch, action.frontmatter);
        assert.deepEqual(entry.undoPatch, { "mcp-servers": null });
        assert.equal(entry.created, false);
        assert.equal(entry.hadFrontmatter, true);
        assert.equal(entry.surfaceId, "frontmatter-emit:antigravity:my-mcp");
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refuses to double-patch frontmatter already owned by another skill", async () => {
    const home = await makeTmpDir();
    try {
      const targetFile = path.join(home, ".agents", "rules", "shared.md");
      await mkdir(path.dirname(targetFile), { recursive: true });
      await writeFile(targetFile, "---\nname: Shared\n---\n");

      await registerDeployment(home, targetFile, {
        kind: "frontmatter-emit",
        patch: { "mcp-servers": { other: { command: "other" } } },
        undoPatch: { "mcp-servers": null },
        created: false,
        hadFrontmatter: true,
        skill: "other-skill",
        agent: "antigravity",
      });

      const action: FrontmatterEmitDeployAction = {
        kind: "frontmatter-emit",
        skill: "my-mcp",
        agent: "antigravity",
        target: targetFile,
        frontmatter: { "mcp-servers": { "my-mcp": { command: "npx" } } },
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
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores the original markdown file when registry persistence fails", async () => {
    const home = await makeTmpDir();
    try {
      const targetFile = path.join(home, ".agents", "rules", "my-mcp.md");
      await mkdir(path.dirname(targetFile), { recursive: true });
      const original = "---\nname: Existing Agent\n---\n\n# Body\n";
      await writeFile(targetFile, original);

      const action: FrontmatterEmitDeployAction = {
        kind: "frontmatter-emit",
        skill: "my-mcp",
        agent: "antigravity",
        target: targetFile,
        frontmatter: { "mcp-servers": { "my-mcp": { command: "npx" } } },
      };

      const failingRegistry = {
        async load() {
          return { version: 1 as const, deployments: {} };
        },
        async save() {
          throw new Error("registry unavailable");
        },
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
        { registry: failingRegistry },
      );
      assert.equal(succeeded, 0);
      assert.equal(failed.length, 1);
      assert.equal(await readFile(targetFile, "utf-8"), original);
      assert.ok(!(await exists(`${targetFile}.inception-backup`)));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
