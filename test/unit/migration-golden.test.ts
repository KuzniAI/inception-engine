import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  lookupDeployment,
  registerDeployment,
  registryPath,
} from "../../src/core/ownership.ts";
import { executeRevert } from "../../src/core/revert.ts";
import type { FrontmatterEmitRevertAction } from "../../src/types.ts";
import { makeTmpDir } from "../helpers/fs.ts";

function sanitizeRegistry(raw: string): unknown {
  const parsed = JSON.parse(raw) as {
    version: number;
    deployments: Record<string, Record<string, unknown>>;
  };

  for (const entry of Object.values(parsed.deployments)) {
    if (typeof entry.deployed === "string") {
      entry.deployed = "<timestamp>";
    }
  }

  return parsed;
}

describe("migration golden", () => {
  it("preserves a golden registry shape when ownership migrates targets", async () => {
    const home = await makeTmpDir();
    try {
      const oldTarget = "/repo/.agents/rules/legacy-tool.md";
      const newTarget = "/repo/.agents/rules/current-tool.md";

      await registerDeployment(home, oldTarget, {
        kind: "frontmatter-emit",
        patch: { "mcp-servers": { tool: { command: "legacy" } } },
        undoPatch: { "mcp-servers": null },
        created: true,
        hadFrontmatter: false,
        skill: "tool",
        agent: "antigravity",
      });

      await registerDeployment(home, newTarget, {
        kind: "frontmatter-emit",
        patch: { "mcp-servers": { tool: { command: "current" } } },
        undoPatch: { "mcp-servers": null },
        created: true,
        hadFrontmatter: false,
        skill: "tool",
        agent: "antigravity",
        migratedFrom: [oldTarget],
      });

      const registry = sanitizeRegistry(
        await readFile(registryPath(home), "utf-8"),
      );
      assert.deepEqual(registry, {
        version: 1,
        deployments: {
          [newTarget]: {
            kind: "frontmatter-emit",
            patch: { "mcp-servers": { tool: { command: "current" } } },
            undoPatch: { "mcp-servers": null },
            created: true,
            hadFrontmatter: false,
            skill: "tool",
            agent: "antigravity",
            surfaceId: "frontmatter-emit:antigravity:tool",
            migratedFrom: [oldTarget],
            deployed: "<timestamp>",
          },
        },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reverts the migrated target and leaves the old target unmanaged", async () => {
    const home = await makeTmpDir();
    try {
      const oldTarget = path.join(home, ".agents", "rules", "legacy-tool.md");
      const newTarget = path.join(home, ".agents", "rules", "current-tool.md");
      await mkdir(path.dirname(oldTarget), { recursive: true });
      await writeFile(oldTarget, "# legacy\n");
      await writeFile(
        newTarget,
        "---\nname: Shared\nmcp-servers:\n  tool:\n    command: current\n---\n\n# body\n",
      );

      await registerDeployment(home, oldTarget, {
        kind: "frontmatter-emit",
        patch: { "mcp-servers": { tool: { command: "legacy" } } },
        undoPatch: { "mcp-servers": null },
        created: true,
        hadFrontmatter: false,
        skill: "tool",
        agent: "antigravity",
      });

      await registerDeployment(home, newTarget, {
        kind: "frontmatter-emit",
        patch: { "mcp-servers": { tool: { command: "current" } } },
        undoPatch: { "mcp-servers": null },
        created: false,
        hadFrontmatter: true,
        skill: "tool",
        agent: "antigravity",
        migratedFrom: [oldTarget],
      });

      const action: FrontmatterEmitRevertAction = {
        kind: "frontmatter-emit",
        skill: "tool",
        agent: "antigravity",
        target: newTarget,
      };
      const result = await executeRevert([action], false, false, home);

      assert.equal(result.succeeded, 1);
      assert.equal(await lookupDeployment(home, oldTarget), null);
      assert.equal(await lookupDeployment(home, newTarget), null);
      assert.equal(await readFile(oldTarget, "utf-8"), "# legacy\n");
      const reverted = await readFile(newTarget, "utf-8");
      assert.match(reverted, /^---\nname: Shared\n---\n+/);
      assert.match(reverted, /# body\n$/);
      assert.doesNotMatch(reverted, /mcp-servers:/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("preserves a golden dry-run revert plan for migrated frontmatter targets", async () => {
    const home = await makeTmpDir();
    try {
      const oldTarget = path.join(home, ".agents", "rules", "legacy-tool.md");
      const newTarget = path.join(home, ".agents", "rules", "current-tool.md");
      await mkdir(path.dirname(oldTarget), { recursive: true });
      await writeFile(oldTarget, "# legacy\n");
      await writeFile(
        newTarget,
        "---\nname: Shared\nmcp-servers:\n  tool:\n    command: current\n---\n\n# body\n",
      );

      await registerDeployment(home, oldTarget, {
        kind: "frontmatter-emit",
        patch: { "mcp-servers": { tool: { command: "legacy" } } },
        undoPatch: { "mcp-servers": null },
        created: true,
        hadFrontmatter: false,
        skill: "tool",
        agent: "antigravity",
      });

      await registerDeployment(home, newTarget, {
        kind: "frontmatter-emit",
        patch: { "mcp-servers": { tool: { command: "current" } } },
        undoPatch: { "mcp-servers": null },
        created: false,
        hadFrontmatter: true,
        skill: "tool",
        agent: "antigravity",
        migratedFrom: [oldTarget],
      });

      const action: FrontmatterEmitRevertAction = {
        kind: "frontmatter-emit",
        skill: "tool",
        agent: "antigravity",
        target: newTarget,
      };
      const result = await executeRevert([action], true, false, home);

      assert.deepEqual(result.planned, [
        {
          verb: "unapply-patch",
          kind: "frontmatter-emit",
          skill: "tool",
          agent: "antigravity",
          target: newTarget,
          patch: { "mcp-servers": null },
        },
      ]);
      assert.equal(await lookupDeployment(home, oldTarget), null);
      assert.ok(await readFile(newTarget, "utf-8"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("falls back to legacy whole-file revert for frontmatter entries without undoPatch", async () => {
    const home = await makeTmpDir();
    try {
      const target = path.join(home, ".agents", "rules", "legacy-tool.md");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(
        target,
        "---\nmcp-servers:\n  tool:\n    command: legacy\n---\n\n# old body\n",
      );

      const rawRegistry = {
        version: 1,
        deployments: {
          [target]: {
            kind: "frontmatter-emit",
            skill: "tool",
            agent: "antigravity",
            deployed: "2026-01-01T00:00:00.000Z",
          },
        },
      };
      await mkdir(path.dirname(registryPath(home)), { recursive: true });
      await writeFile(
        registryPath(home),
        `${JSON.stringify(rawRegistry, null, 2)}\n`,
      );

      const action: FrontmatterEmitRevertAction = {
        kind: "frontmatter-emit",
        skill: "tool",
        agent: "antigravity",
        target,
      };
      const result = await executeRevert([action], false, false, home);

      assert.equal(result.succeeded, 1);
      await assert.rejects(() => readFile(target, "utf-8"));
      assert.equal(await lookupDeployment(home, target), null);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
