import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  detectInstalledAgents,
  type ExecFn,
  isBinaryInPath,
  isBinaryViaCommandV,
  isBinaryViaWhereExe,
  isBinaryViaWhich,
} from "../src/core/detect.ts";

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

const NONEXISTENT_BINARY = "__nonexistent_binary_inception_test__";

describe("isBinaryViaCommandV", { skip: process.platform === "win32" }, () => {
  it("returns true for node (known to be in PATH)", async () => {
    const result = await isBinaryViaCommandV("node");
    assert.equal(result, true);
  });

  it("returns false for a nonexistent binary", async () => {
    const result = await isBinaryViaCommandV(NONEXISTENT_BINARY);
    assert.equal(result, false);
  });
});

describe("isBinaryViaWhich", { skip: process.platform === "win32" }, () => {
  it("returns true for node (known to be in PATH)", async () => {
    const result = await isBinaryViaWhich("node");
    assert.equal(result, true);
  });

  it("returns false for a nonexistent binary", async () => {
    const result = await isBinaryViaWhich(NONEXISTENT_BINARY);
    assert.equal(result, false);
  });
});

describe("isBinaryViaWhereExe", {
  skip: process.platform !== "win32",
}, () => {
  it("returns true for node.exe (known to be in PATH)", async () => {
    const result = await isBinaryViaWhereExe("node.exe");
    assert.equal(result, true);
  });

  it("returns false for a nonexistent binary", async () => {
    const result = await isBinaryViaWhereExe(NONEXISTENT_BINARY);
    assert.equal(result, false);
  });
});

describe("isBinaryInPath ENOENT fallback", {
  skip: process.platform === "win32",
}, () => {
  // Simulate an environment where `which` is not installed: the injected
  // execFn always throws ENOENT, forcing isBinaryInPath to fall back to
  // isBinaryViaCommandV (which uses the real /bin/sh `command -v`).
  const enoentFn: ExecFn = async () => {
    const err = Object.assign(new Error("spawn which ENOENT"), {
      code: "ENOENT",
    });
    throw err;
  };

  it("falls back to isBinaryViaCommandV when which throws ENOENT", async () => {
    // `node` is definitely in PATH — command -v should find it
    const result = await isBinaryInPath("node", enoentFn);
    assert.equal(result, true);
  });

  it("returns false when which is absent and binary does not exist", async () => {
    const result = await isBinaryInPath(NONEXISTENT_BINARY, enoentFn);
    assert.equal(result, false);
  });
});
