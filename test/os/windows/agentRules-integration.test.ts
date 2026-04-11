import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { executeDeploy } from "../../../src/core/deploy.ts";
import {
  lookupDeployment,
  registerDeployment,
} from "../../../src/core/ownership.ts";
import { executeRevert } from "../../../src/core/revert.ts";
import type {
  FileWriteDeployAction,
  FileWriteRevertAction,
  FrontmatterEmitDeployAction,
  FrontmatterEmitRevertAction,
} from "../../../src/types.ts";
import { exists, makeTmpDir } from "../../helpers/fs.ts";

describe("agentRules repo/workspace file-write (Windows)", {
  skip: process.platform !== "win32",
}, () => {
  it("deploys agentRules with scope repo and registers it", async () => {
    const home = await makeTmpDir("ie-rules-home");
    const repo = await makeTmpDir("ie-rules-repo");
    const sourceDir = await makeTmpDir("ie-rules-source");
    try {
      const source = path.join(sourceDir, "CLAUDE.md");
      await writeFile(source, "# My Rules\n");
      const target = path.join(repo, "CLAUDE.md");

      const action: FileWriteDeployAction = {
        kind: "file-write",
        skill: "my-rules",
        agent: "claude-code",
        source,
        target,
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(await exists(target));
      const entry = await lookupDeployment(home, target);
      assert.ok(entry !== null);
      assert.equal(entry?.kind, "file-write");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("reverts agentRules with scope repo and unregisters it", async () => {
    const home = await makeTmpDir("ie-rules-home");
    const repo = await makeTmpDir("ie-rules-repo");
    try {
      const source = path.join(repo, "source-CLAUDE.md");
      const target = path.join(repo, "CLAUDE.md");
      await writeFile(target, "# My Rules\n");

      await registerDeployment(home, target, {
        kind: "file-write",
        source,
        skill: "my-rules",
        agent: "claude-code",
      });

      const action: FileWriteRevertAction = {
        kind: "file-write",
        skill: "my-rules",
        agent: "claude-code",
        target,
      };

      const { succeeded, failed } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(!(await exists(target)));
      assert.equal(await lookupDeployment(home, target), null);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("deploys agentRules with scope workspace and registers it", async () => {
    const home = await makeTmpDir("ie-rules-home");
    const workspace = await makeTmpDir("ie-rules-workspace");
    const sourceDir = await makeTmpDir("ie-rules-source");
    try {
      const source = path.join(sourceDir, "CLAUDE.md");
      await writeFile(source, "# Workspace Rules\n");
      const target = path.join(workspace, "CLAUDE.md");

      const action: FileWriteDeployAction = {
        kind: "file-write",
        skill: "my-rules",
        agent: "claude-code",
        source,
        target,
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(await exists(target));
      const entry = await lookupDeployment(home, target);
      assert.ok(entry !== null);
      assert.equal(entry?.kind, "file-write");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("reverts agentRules with scope workspace and unregisters it", async () => {
    const home = await makeTmpDir("ie-rules-home");
    const workspace = await makeTmpDir("ie-rules-workspace");
    try {
      const source = path.join(workspace, "source-CLAUDE.md");
      const target = path.join(workspace, "CLAUDE.md");
      await writeFile(target, "# Workspace Rules\n");

      await registerDeployment(home, target, {
        kind: "file-write",
        source,
        skill: "my-rules",
        agent: "claude-code",
      });

      const action: FileWriteRevertAction = {
        kind: "file-write",
        skill: "my-rules",
        agent: "claude-code",
        target,
      };

      const { succeeded, failed } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(!(await exists(target)));
      assert.equal(await lookupDeployment(home, target), null);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("Antigravity frontmatter-emit (Windows)", {
  skip: process.platform !== "win32",
}, () => {
  it("deploys frontmatter-emit for Antigravity and registers it", async () => {
    const home = await makeTmpDir("ie-fm-home");
    const repo = await makeTmpDir("ie-fm-repo");
    try {
      const target = path.join(repo, ".agents", "rules", "my-mcp.md");
      const frontmatter = {
        "mcp-servers": {
          "my-mcp": { command: "npx", args: ["-y", "my-mcp-server"] },
        },
      };

      const action: FrontmatterEmitDeployAction = {
        kind: "frontmatter-emit",
        skill: "my-mcp",
        agent: "antigravity",
        target,
        frontmatter,
      };

      const { succeeded, failed } = await executeDeploy(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(await exists(target));
      const content = await readFile(target, "utf-8");
      assert.ok(content.includes("mcp-servers:"));
      const entry = await lookupDeployment(home, target);
      assert.ok(entry !== null);
      assert.equal(entry?.kind, "frontmatter-emit");
      assert.equal((entry as { created?: boolean }).created, true);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("reverts frontmatter-emit for Antigravity and removes file when no body", async () => {
    const home = await makeTmpDir("ie-fm-home");
    const repo = await makeTmpDir("ie-fm-repo");
    try {
      const target = path.join(repo, ".agents", "rules", "my-mcp.md");
      const frontmatter = {
        "mcp-servers": {
          "my-mcp": { command: "npx", args: ["-y", "my-mcp-server"] },
        },
      };

      // Deploy first so the file and registry entry are created.
      const deployAction: FrontmatterEmitDeployAction = {
        kind: "frontmatter-emit",
        skill: "my-mcp",
        agent: "antigravity",
        target,
        frontmatter,
      };
      await executeDeploy([deployAction], false, false, home);

      const action: FrontmatterEmitRevertAction = {
        kind: "frontmatter-emit",
        skill: "my-mcp",
        agent: "antigravity",
        target,
      };

      const { succeeded, failed } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      assert.ok(!(await exists(target)));
      assert.equal(await lookupDeployment(home, target), null);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("reverts frontmatter-emit for Antigravity preserving body when file had prior content", async () => {
    const home = await makeTmpDir("ie-fm-home");
    const repo = await makeTmpDir("ie-fm-repo");
    try {
      const target = path.join(repo, ".agents", "rules", "my-mcp.md");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "# My Rules\n");

      const undoPatch = { "mcp-servers": null };
      await registerDeployment(home, target, {
        kind: "frontmatter-emit",
        patch: {
          "mcp-servers": {
            "my-mcp": { command: "npx", args: ["-y", "my-mcp-server"] },
          },
        },
        undoPatch,
        created: false,
        hadFrontmatter: false,
        skill: "my-mcp",
        agent: "antigravity",
      });

      const action: FrontmatterEmitRevertAction = {
        kind: "frontmatter-emit",
        skill: "my-mcp",
        agent: "antigravity",
        target,
      };

      const { succeeded, failed } = await executeRevert(
        [action],
        false,
        false,
        home,
      );
      assert.equal(succeeded, 1);
      assert.equal(failed.length, 0);
      // File should still exist because it had body content.
      assert.ok(await exists(target));
      const content = await readFile(target, "utf-8");
      assert.ok(!content.includes("mcp-servers:"));
      assert.ok(content.includes("My Rules"));
      assert.equal(await lookupDeployment(home, target), null);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});
