import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  lookupDeployment,
  registerDeployment,
  registryPath,
  unregisterDeployment,
  verifyDeployment,
} from "../src/core/ownership.ts";

function makeTmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ie-test-ownership-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("registerDeployment", () => {
  it("creates registry file and adds entry", async () => {
    const home = makeTmpDir();
    try {
      const target = "/fake/target/skill";
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/fake/source/skill",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });

      assert.ok(existsSync(registryPath(home)));

      const registry = JSON.parse(readFileSync(registryPath(home), "utf-8"));
      assert.equal(registry.version, 1);
      assert.ok(registry.deployments[target]);
      assert.equal(registry.deployments[target].kind, "skill-dir");
      assert.equal(registry.deployments[target].skill, "my-skill");
      assert.equal(registry.deployments[target].agent, "claude-code");
      assert.equal(registry.deployments[target].source, "/fake/source/skill");
      assert.equal(registry.deployments[target].method, "symlink");
      assert.ok(registry.deployments[target].deployed);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("overwrites existing entry for same target", async () => {
    const home = makeTmpDir();
    try {
      const target = "/fake/target/skill";
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/old/source",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/new/source",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });

      const registry = JSON.parse(readFileSync(registryPath(home), "utf-8"));
      assert.equal(registry.deployments[target].source, "/new/source");
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("sets registry file permissions to 0o644 on POSIX", async () => {
    if (process.platform === "win32") return;
    const home = makeTmpDir();
    try {
      await registerDeployment(home, "/fake/target", {
        kind: "skill-dir",
        source: "/fake/source",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });
      const { statSync } = await import("node:fs");
      const stat = statSync(registryPath(home));
      assert.equal(stat.mode & 0o777, 0o644);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("preserves other entries when adding a new one", async () => {
    const home = makeTmpDir();
    try {
      await registerDeployment(home, "/target/a", {
        kind: "skill-dir",
        source: "/src/a",
        skill: "a",
        agent: "claude-code",
        method: "symlink",
      });
      await registerDeployment(home, "/target/b", {
        kind: "skill-dir",
        source: "/src/b",
        skill: "b",
        agent: "codex",
        method: "copy",
      });

      const registry = JSON.parse(readFileSync(registryPath(home), "utf-8"));
      assert.ok(registry.deployments["/target/a"]);
      assert.ok(registry.deployments["/target/b"]);
    } finally {
      rmSync(home, { recursive: true });
    }
  });
});

describe("unregisterDeployment", () => {
  it("removes the entry for the given target", async () => {
    const home = makeTmpDir();
    try {
      await registerDeployment(home, "/target/a", {
        kind: "skill-dir",
        source: "/src/a",
        skill: "a",
        agent: "claude-code",
        method: "symlink",
      });
      await unregisterDeployment(home, "/target/a");

      const entry = await lookupDeployment(home, "/target/a");
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("is a no-op if target is not in registry", async () => {
    const home = makeTmpDir();
    try {
      await registerDeployment(home, "/target/a", {
        kind: "skill-dir",
        source: "/src/a",
        skill: "a",
        agent: "claude-code",
        method: "symlink",
      });
      // Should not throw
      await unregisterDeployment(home, "/target/nonexistent");

      const entry = await lookupDeployment(home, "/target/a");
      assert.ok(entry);
    } finally {
      rmSync(home, { recursive: true });
    }
  });
});

describe("lookupDeployment", () => {
  it("returns the entry when target is registered", async () => {
    const home = makeTmpDir();
    try {
      await registerDeployment(home, "/target/skill", {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "codex",
        method: "copy",
      });

      const entry = await lookupDeployment(home, "/target/skill");
      assert.ok(entry);
      assert.equal(entry.kind, "skill-dir");
      assert.equal(entry.source, "/src/skill");
      assert.equal(entry.skill, "my-skill");
      assert.equal(entry.agent, "codex");
      assert.equal(entry.method, "copy");
      assert.ok(entry.deployed);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("returns null when target is not registered", async () => {
    const home = makeTmpDir();
    try {
      const entry = await lookupDeployment(home, "/nonexistent");
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("returns null when registry file does not exist", async () => {
    const home = makeTmpDir();
    try {
      const entry = await lookupDeployment(home, "/anything");
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("returns null when registry file is corrupted", async () => {
    const home = makeTmpDir();
    try {
      const dir = path.dirname(registryPath(home));
      mkdirSync(dir, { recursive: true });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(registryPath(home), "not valid json!!!");

      const entry = await lookupDeployment(home, "/anything");
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true });
    }
  });
});

describe("verifyDeployment", () => {
  it("returns entry when all fields match", async () => {
    const home = makeTmpDir();
    try {
      const target = "/target/skill";
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });

      const entry = await verifyDeployment(home, target, {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "claude-code",
      });
      assert.ok(entry);
      assert.equal(entry.source, "/src/skill");
      assert.equal(entry.skill, "my-skill");
      assert.equal(entry.agent, "claude-code");
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("returns null when kind does not match", async () => {
    const home = makeTmpDir();
    try {
      const target = "/target/skill";
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });

      const entry = await verifyDeployment(home, target, {
        kind: "file-write",
        source: "/src/skill",
        skill: "my-skill",
        agent: "claude-code",
      });
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("returns null when source does not match", async () => {
    const home = makeTmpDir();
    try {
      const target = "/target/skill";
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });

      const entry = await verifyDeployment(home, target, {
        kind: "skill-dir",
        source: "/different/source",
        skill: "my-skill",
        agent: "claude-code",
      });
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("returns null when skill does not match", async () => {
    const home = makeTmpDir();
    try {
      const target = "/target/skill";
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });

      const entry = await verifyDeployment(home, target, {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "different-skill",
        agent: "claude-code",
      });
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("returns null when agent does not match", async () => {
    const home = makeTmpDir();
    try {
      const target = "/target/skill";
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });

      const entry = await verifyDeployment(home, target, {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "codex",
      });
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("returns null when no entry exists", async () => {
    const home = makeTmpDir();
    try {
      const entry = await verifyDeployment(home, "/nonexistent", {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "claude-code",
      });
      assert.equal(entry, null);
    } finally {
      rmSync(home, { recursive: true });
    }
  });
});
