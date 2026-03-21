import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadManifest } from "../src/config/manifest.ts";

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `ie-test-manifest-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadManifest", () => {
  it("parses a valid manifest", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [
            { name: "test-skill", path: "skills/test-skill", agents: ["claude-code"] },
          ],
        })
      );

      const manifest = loadManifest(dir);
      assert.equal(manifest.skills.length, 1);
      assert.equal(manifest.skills[0]!.name, "test-skill");
      assert.deepEqual(manifest.skills[0]!.agents, ["claude-code"]);
      assert.deepEqual(manifest.mcpServers, []);
      assert.deepEqual(manifest.agentRules, []);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on missing file", () => {
    assert.throws(() => loadManifest("/nonexistent/path"), /No inception\.json found/);
  });

  it("throws on invalid JSON", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(path.join(dir, "inception.json"), "not json{");
      assert.throws(() => loadManifest(dir), /Invalid JSON/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on missing skills array", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(path.join(dir, "inception.json"), JSON.stringify({}));
      assert.throws(() => loadManifest(dir), /"skills" must be an array/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on unknown agent ID", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [{ name: "s", path: "p", agents: ["unknown-agent"] }],
        })
      );
      assert.throws(() => loadManifest(dir), /unknown agent "unknown-agent"/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on missing skill name", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [{ path: "p", agents: ["claude-code"] }],
        })
      );
      assert.throws(() => loadManifest(dir), /name must be a non-empty string/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on skill.name with path traversal (../../.ssh)", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [{ name: "../../.ssh", path: "skills/s", agents: ["claude-code"] }],
        })
      );
      assert.throws(() => loadManifest(dir), /name must contain only/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on skill.name with path separator (../escape)", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [{ name: "../escape", path: "skills/s", agents: ["claude-code"] }],
        })
      );
      assert.throws(() => loadManifest(dir), /name must contain only/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("accepts a skill.name with dots, hyphens, and digits (valid-name_1.0)", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [{ name: "valid-name_1.0", path: "skills/s", agents: ["claude-code"] }],
        })
      );
      const manifest = loadManifest(dir);
      assert.equal(manifest.skills[0]!.name, "valid-name_1.0");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("throws on skill.path that is absolute (/etc/passwd)", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        path.join(dir, "inception.json"),
        JSON.stringify({
          skills: [{ name: "s", path: "/etc/passwd", agents: ["claude-code"] }],
        })
      );
      assert.throws(() => loadManifest(dir), /must be a relative path/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
