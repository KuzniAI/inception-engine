import assert from "node:assert/strict";
import { chmod, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { loadManifest } from "../../src/config/manifest.ts";
import { UserError } from "../../src/errors.ts";
import { makeTmpDir } from "../helpers/fs.ts";

describe("loadManifest", () => {
  it("parses a valid manifest", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [
            {
              name: "test-skill",
              path: "skills/test-skill",
              agents: ["claude-code"],
            },
          ],
        }),
      );

      const manifest = await loadManifest(dir);
      assert.equal(manifest.skills.length, 1);
      assert.equal(manifest.skills[0]?.name, "test-skill");
      assert.deepEqual(manifest.skills[0]?.agents, ["claude-code"]);
      assert.deepEqual(manifest.mcpServers, []);
      assert.deepEqual(manifest.agentRules, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on missing file", async () => {
    await assert.rejects(loadManifest("/nonexistent/path"), (err: unknown) => {
      assert.ok(err instanceof UserError);
      assert.equal(err.code, "MANIFEST_INVALID");
      assert.match(err.message, /No inception\.json found/);
      return true;
    });
  });

  it("throws permission error when manifest is unreadable", {
    skip: process.platform === "win32",
  }, async () => {
    const dir = await makeTmpDir();
    const manifestPath = path.join(dir, "inception.json");
    try {
      await writeFile(manifestPath, JSON.stringify({ skills: [] }));
      await chmod(manifestPath, 0o000);
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /Permission denied reading/);
        return true;
      });
    } finally {
      await chmod(manifestPath, 0o644);
      await rm(dir, { recursive: true });
    }
  });

  it("throws on invalid JSON", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "inception.json"), "not json{");
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /Invalid JSON/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on missing skills array", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "inception.json"), JSON.stringify({}));
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /"skills" must be an array/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on unknown agent ID", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [{ name: "s", path: "p", agents: ["unknown-agent"] }],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /unknown agent "unknown-agent"/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on missing skill name", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [{ path: "p", agents: ["claude-code"] }],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /name must be a non-empty string/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on skill.name with path traversal (../../.ssh)", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [
            { name: "../../.ssh", path: "skills/s", agents: ["claude-code"] },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /name must contain only/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on skill.name with path separator (../escape)", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [
            { name: "../escape", path: "skills/s", agents: ["claude-code"] },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /name must contain only/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("accepts a skill.name with dots, hyphens, and digits (valid-name_1.0)", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [
            {
              name: "valid-name_1.0",
              path: "skills/s",
              agents: ["claude-code"],
            },
          ],
        }),
      );
      const manifest = await loadManifest(dir);
      assert.equal(manifest.skills[0]?.name, "valid-name_1.0");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on skill.path with path traversal (../../secret)", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [
            { name: "s", path: "../../secret", agents: ["claude-code"] },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /must not escape the repository root/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on skill.path that is absolute (/etc/passwd)", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [{ name: "s", path: "/etc/passwd", agents: ["claude-code"] }],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /must be a relative path/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when mcpServers is not an array", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({ skills: [], mcpServers: "not-an-array" }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /"mcpServers" must be an array/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentRules is not an array", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({ skills: [], agentRules: 42 }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /"agentRules" must be an array/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when mcpServers entry is missing 'name'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          mcpServers: [
            { agents: ["claude-code"], config: { command: "my-server" } },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /name must be a non-empty string/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when mcpServers entry has an empty 'name'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          mcpServers: [
            { name: "", agents: ["claude-code"], config: { command: "s" } },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /name must be a non-empty string/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when mcpServers entry is missing 'agents'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          mcpServers: [{ name: "my-mcp", config: { command: "s" } }],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /agents must be a non-empty array/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when mcpServers entry is missing 'config'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          mcpServers: [{ name: "my-mcp", agents: ["claude-code"] }],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /mcpServers\[0\]/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("accepts a valid mcpServers entry", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          mcpServers: [
            {
              name: "my-mcp",
              agents: ["claude-code"],
              config: { command: "my-server", args: ["--flag"] },
            },
          ],
        }),
      );
      const manifest = await loadManifest(dir);
      assert.equal(manifest.mcpServers.length, 1);
      assert.equal(manifest.mcpServers[0]?.name, "my-mcp");
      assert.deepEqual(manifest.mcpServers[0]?.agents, ["claude-code"]);
      assert.deepEqual(manifest.mcpServers[0]?.config, {
        command: "my-server",
        args: ["--flag"],
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentRules entry is not an object", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({ skills: [], agentRules: ["not-an-object"] }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /agentRules\[0\]/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentRules entry has an empty 'name'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          agentRules: [
            { name: "", agents: ["claude-code"], path: "rules/CLAUDE.md" },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /name must be a non-empty string/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentRules entry is missing 'agents'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          agentRules: [{ name: "my-rule", path: "rules/AGENTS.md" }],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /agents must be a non-empty array/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentRules entry is missing 'path'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          agentRules: [{ name: "my-rule", agents: ["claude-code"] }],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /agentRules\[0\]/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentRules entry has an escaping 'path'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          agentRules: [
            {
              name: "my-rule",
              agents: ["claude-code"],
              path: "../../../etc/passwd",
            },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /must not escape the repository root/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when file target escapes its placeholder root", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          files: [
            {
              name: "bad-target",
              path: "rules.md",
              target: "{home}/../.ssh/config",
              agents: ["claude-code"],
            },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(
          err.message,
          /target must not escape its placeholder root/,
        );
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("accepts a valid agentRules entry", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          agentRules: [
            {
              name: "my-rule",
              agents: ["claude-code"],
              path: "rules/CLAUDE.md",
            },
          ],
        }),
      );
      const manifest = await loadManifest(dir);
      assert.equal(manifest.agentRules.length, 1);
      assert.equal(manifest.agentRules[0]?.name, "my-rule");
      assert.deepEqual(manifest.agentRules[0]?.agents, ["claude-code"]);
      assert.equal(manifest.agentRules[0]?.path, "rules/CLAUDE.md");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("defaults mcpServers and agentRules to [] when omitted", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({ skills: [] }),
      );
      const manifest = await loadManifest(dir);
      assert.deepEqual(manifest.mcpServers, []);
      assert.deepEqual(manifest.agentRules, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on duplicate skill names", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [
            { name: "my-skill", path: "skills/a", agents: ["claude-code"] },
            { name: "my-skill", path: "skills/b", agents: ["codex"] },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /duplicate skill name "my-skill"/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("deduplicates agent IDs within a skill", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [
            {
              name: "my-skill",
              path: "skills/s",
              agents: ["claude-code", "claude-code", "codex"],
            },
          ],
        }),
      );
      const manifest = await loadManifest(dir);
      assert.deepEqual(manifest.skills[0]?.agents, ["claude-code", "codex"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentDefinitions is not an array", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({ skills: [], agentDefinitions: 42 }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /"agentDefinitions" must be an array/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("accepts a valid agentDefinitions entry", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          agentDefinitions: [
            {
              name: "my-agent",
              agents: ["claude-code"],
              path: "agents/my-agent.md",
            },
          ],
        }),
      );
      const manifest = await loadManifest(dir);
      assert.equal(manifest.agentDefinitions.length, 1);
      assert.equal(manifest.agentDefinitions[0]?.name, "my-agent");
      assert.deepEqual(manifest.agentDefinitions[0]?.agents, ["claude-code"]);
      assert.equal(manifest.agentDefinitions[0]?.path, "agents/my-agent.md");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("defaults agentDefinitions to [] when omitted", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({ skills: [] }),
      );
      const manifest = await loadManifest(dir);
      assert.deepEqual(manifest.agentDefinitions, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentDefinitions entry is missing 'name'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          agentDefinitions: [
            { agents: ["claude-code"], path: "agents/my-agent.md" },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /name must be a non-empty string/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentDefinitions entry is missing 'path'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          agentDefinitions: [{ name: "my-agent", agents: ["claude-code"] }],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /agentDefinitions\[0\]/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentDefinitions entry has an escaping 'path'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          agentDefinitions: [
            {
              name: "my-agent",
              agents: ["claude-code"],
              path: "../../../etc/passwd",
            },
          ],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /must not escape the repository root/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws when agentDefinitions entry is missing 'agents'", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [],
          agentDefinitions: [{ name: "my-agent", path: "agents/my-agent.md" }],
        }),
      );
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /agents must be a non-empty array/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
