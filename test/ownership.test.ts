import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  formatTotem,
  isOwnedByInceptionEngine,
  writeTotem,
} from "../src/core/ownership.ts";

function makeTmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ie-test-ownership-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("formatTotem", () => {
  it("starts with inception-engine header", () => {
    const content = formatTotem({
      source: "/a/b",
      skill: "test",
      agent: "claude-code",
    });
    assert.ok(content.startsWith("inception-engine\n"));
  });

  it("includes source, skill, agent, and deployed fields", () => {
    const content = formatTotem({
      source: "/a/b",
      skill: "my-skill",
      agent: "codex",
    });
    assert.ok(content.includes("source=/a/b"));
    assert.ok(content.includes("skill=my-skill"));
    assert.ok(content.includes("agent=codex"));
    assert.ok(content.includes("deployed="));
  });
});

describe("writeTotem", () => {
  it("creates .inception-totem with correct content", async () => {
    const dir = makeTmpDir();
    try {
      await writeTotem(dir, {
        source: "/src",
        skill: "s",
        agent: "claude-code",
      });
      const { readFileSync, statSync } = await import("node:fs");
      const content = readFileSync(path.join(dir, ".inception-totem"), "utf-8");
      assert.ok(content.startsWith("inception-engine\n"));
      // Verify permissions (0o644)
      if (process.platform !== "win32") {
        const mode = statSync(path.join(dir, ".inception-totem")).mode & 0o777;
        assert.equal(mode, 0o644);
      }
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("isOwnedByInceptionEngine", () => {
  if (process.platform === "win32") return;

  it("returns true for directory with valid .inception-totem", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        path.join(dir, ".inception-totem"),
        "inception-engine\nsource=/x\n",
      );
      const stat = lstatSync(dir);
      assert.equal(await isOwnedByInceptionEngine(dir, stat), true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("returns false for directory without .inception-totem", async () => {
    const dir = makeTmpDir();
    try {
      const stat = lstatSync(dir);
      assert.equal(await isOwnedByInceptionEngine(dir, stat), false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("returns false for directory with invalid .inception-totem content", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
        path.join(dir, ".inception-totem"),
        "not-inception-engine\n",
      );
      const stat = lstatSync(dir);
      assert.equal(await isOwnedByInceptionEngine(dir, stat), false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("returns true for symlink whose target has valid .inception-totem", async () => {
    const sourceDir = makeTmpDir();
    const linkParent = makeTmpDir();
    const linkPath = path.join(linkParent, "link");
    try {
      writeFileSync(
        path.join(sourceDir, ".inception-totem"),
        "inception-engine\nsource=/x\n",
      );
      symlinkSync(sourceDir, linkPath, "dir");
      const stat = lstatSync(linkPath);
      assert.equal(await isOwnedByInceptionEngine(linkPath, stat), true);
    } finally {
      rmSync(linkParent, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true });
    }
  });

  it("returns false for symlink whose target lacks .inception-totem", async () => {
    const sourceDir = makeTmpDir();
    const linkParent = makeTmpDir();
    const linkPath = path.join(linkParent, "link");
    try {
      // Source has SKILL.md but no .inception-totem — should NOT be treated as owned
      writeFileSync(path.join(sourceDir, "SKILL.md"), "---");
      symlinkSync(sourceDir, linkPath, "dir");
      const stat = lstatSync(linkPath);
      assert.equal(await isOwnedByInceptionEngine(linkPath, stat), false);
    } finally {
      rmSync(linkParent, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true });
    }
  });
});
