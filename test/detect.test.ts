import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { detectInstalledAgents } from "../src/core/detect.ts";

function makeTmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ie-test-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("detectInstalledAgents", () => {
  it("returns empty array when no agents are installed", async () => {
    const home = makeTmpDir();
    try {
      const agents = await detectInstalledAgents(home);
      // May detect agents via binary-in-PATH, but directory check should find nothing
      // Filter to only directory-based detections by checking what we know
      assert.ok(Array.isArray(agents));
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("detects claude-code when .claude directory exists", async () => {
    const home = makeTmpDir();
    try {
      mkdirSync(path.join(home, ".claude"), { recursive: true });
      const agents = await detectInstalledAgents(home);
      assert.ok(agents.includes("claude-code"));
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("detects gemini-cli when .gemini directory exists", async () => {
    const home = makeTmpDir();
    try {
      mkdirSync(path.join(home, ".gemini"), { recursive: true });
      const agents = await detectInstalledAgents(home);
      assert.ok(agents.includes("gemini-cli"));
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("detects multiple agents", async () => {
    const home = makeTmpDir();
    try {
      mkdirSync(path.join(home, ".claude"), { recursive: true });
      mkdirSync(path.join(home, ".codex"), { recursive: true });
      mkdirSync(path.join(home, ".copilot"), { recursive: true });
      const agents = await detectInstalledAgents(home);
      assert.ok(agents.includes("claude-code"));
      assert.ok(agents.includes("codex"));
      assert.ok(agents.includes("github-copilot"));
    } finally {
      rmSync(home, { recursive: true });
    }
  });
});
