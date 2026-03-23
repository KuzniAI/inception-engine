import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadManifest } from "../src/config/manifest.ts";
import { UserError } from "../src/errors.ts";

function makeTmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ie-test-manifest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadManifest", () => {
  it("parses a valid manifest", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
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
      assert.equal(manifest.skills[0]!.name, "test-skill");
      assert.deepEqual(manifest.skills[0]!.agents, ["claude-code"]);
      assert.deepEqual(manifest.mcpServers, []);
      assert.deepEqual(manifest.agentRules, []);
    } finally {
      rmSync(dir, { recursive: true });
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

  it("throws on invalid JSON", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(path.join(dir, "inception.json"), "not json{");
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /Invalid JSON/);
        return true;
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on missing skills array", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(path.join(dir, "inception.json"), JSON.stringify({}));
      await assert.rejects(loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "MANIFEST_INVALID");
        assert.match(err.message, /"skills" must be an array/);
        return true;
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on unknown agent ID", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
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
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on missing skill name", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
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
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on skill.name with path traversal (../../.ssh)", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
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
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on skill.name with path separator (../escape)", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
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
      rmSync(dir, { recursive: true });
    }
  });

  it("accepts a skill.name with dots, hyphens, and digits (valid-name_1.0)", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
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
      assert.equal(manifest.skills[0]!.name, "valid-name_1.0");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on skill.path with path traversal (../../secret)", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
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
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on skill.path that is absolute (/etc/passwd)", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
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
      rmSync(dir, { recursive: true });
    }
  });
});
