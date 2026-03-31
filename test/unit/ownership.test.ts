import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  defaultRegistryPersistence,
  lookupDeployment,
  registerDeployment,
  registryPath,
  unregisterDeployment,
  verifyDeployment,
} from "../../src/core/ownership.ts";
import { exists, makeTmpDir } from "../helpers/fs.ts";

describe("registerDeployment", () => {
  it("creates registry file and adds entry", async () => {
    const home = await makeTmpDir();
    try {
      const target = "/fake/target/skill";
      await registerDeployment(home, target, {
        kind: "skill-dir",
        source: "/fake/source/skill",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });

      assert.ok(await exists(registryPath(home)));

      const registry = JSON.parse(await readFile(registryPath(home), "utf-8"));
      assert.equal(registry.version, 1);
      assert.ok(registry.deployments[target]);
      assert.equal(registry.deployments[target].kind, "skill-dir");
      assert.equal(registry.deployments[target].skill, "my-skill");
      assert.equal(registry.deployments[target].agent, "claude-code");
      assert.equal(registry.deployments[target].source, "/fake/source/skill");
      assert.equal(registry.deployments[target].method, "symlink");
      assert.ok(registry.deployments[target].deployed);
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("overwrites existing entry for same target", async () => {
    const home = await makeTmpDir();
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

      const registry = JSON.parse(await readFile(registryPath(home), "utf-8"));
      assert.equal(registry.deployments[target].source, "/new/source");
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("sets registry file permissions to 0o644 on POSIX", {
    skip: process.platform === "win32",
  }, async () => {
    const home = await makeTmpDir();
    try {
      await registerDeployment(home, "/fake/target", {
        kind: "skill-dir",
        source: "/fake/source",
        skill: "my-skill",
        agent: "claude-code",
        method: "symlink",
      });
      const { stat } = await import("node:fs/promises");
      const statResult = await stat(registryPath(home));
      assert.equal(statResult.mode & 0o777, 0o644);
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("preserves other entries when adding a new one", async () => {
    const home = await makeTmpDir();
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

      const registry = JSON.parse(await readFile(registryPath(home), "utf-8"));
      assert.ok(registry.deployments["/target/a"]);
      assert.ok(registry.deployments["/target/b"]);
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("surfaces persistence failures from the registry writer", async () => {
    const home = await makeTmpDir();
    try {
      await assert.rejects(
        registerDeployment(
          home,
          "/fake/target",
          {
            kind: "skill-dir",
            source: "/fake/source",
            skill: "my-skill",
            agent: "claude-code",
            method: "copy",
          },
          {
            load: defaultRegistryPersistence.load,
            async save() {
              throw new Error("simulated registry persistence failure");
            },
          },
        ),
        /simulated registry persistence failure/,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("unregisterDeployment", () => {
  it("removes the entry for the given target", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true });
    }
  });

  it("is a no-op if target is not in registry", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true });
    }
  });
});

describe("lookupDeployment", () => {
  it("returns the entry when target is registered", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true });
    }
  });

  it("returns null when target is not registered", async () => {
    const home = await makeTmpDir();
    try {
      const entry = await lookupDeployment(home, "/nonexistent");
      assert.equal(entry, null);
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("returns null when registry file does not exist", async () => {
    const home = await makeTmpDir();
    try {
      const entry = await lookupDeployment(home, "/anything");
      assert.equal(entry, null);
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("returns null when registry file is corrupted", async () => {
    const home = await makeTmpDir();
    try {
      const dir = path.dirname(registryPath(home));
      await mkdir(dir, { recursive: true });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(registryPath(home), "not valid json!!!");

      const entry = await lookupDeployment(home, "/anything");
      assert.equal(entry, null);
    } finally {
      await rm(home, { recursive: true });
    }
  });
});

describe("verifyDeployment", () => {
  it("returns entry when all fields match", async () => {
    const home = await makeTmpDir();
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
      if (entry.kind !== "skill-dir") assert.fail("Expected skill-dir");
      assert.equal(entry.source, "/src/skill");
      assert.equal(entry.skill, "my-skill");
      assert.equal(entry.agent, "claude-code");
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("returns null when kind does not match", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true });
    }
  });

  it("returns null when source does not match", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true });
    }
  });

  it("returns null when skill does not match", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true });
    }
  });

  it("returns null when agent does not match", async () => {
    const home = await makeTmpDir();
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
      await rm(home, { recursive: true });
    }
  });

  it("returns null when no entry exists", async () => {
    const home = await makeTmpDir();
    try {
      const entry = await verifyDeployment(home, "/nonexistent", {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "claude-code",
      });
      assert.equal(entry, null);
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("returns entry for config-patch when kind, skill, agent match (no source check)", async () => {
    const home = await makeTmpDir();
    try {
      const target = "/target/config.json";
      await registerDeployment(home, target, {
        kind: "config-patch",
        patch: { key: "value" },
        undoPatch: { key: null },
        skill: "my-skill",
        agent: "claude-code",
      });

      const entry = await verifyDeployment(home, target, {
        kind: "config-patch",
        skill: "my-skill",
        agent: "claude-code",
      });
      assert.ok(entry);
      assert.equal(entry.kind, "config-patch");
      assert.equal(entry.skill, "my-skill");
      assert.equal(entry.agent, "claude-code");
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("returns null when verifying config-patch but agent mismatches", async () => {
    const home = await makeTmpDir();
    try {
      const target = "/target/config.json";
      await registerDeployment(home, target, {
        kind: "config-patch",
        patch: { key: "value" },
        undoPatch: { key: null },
        skill: "my-skill",
        agent: "claude-code",
      });

      const entry = await verifyDeployment(home, target, {
        kind: "config-patch",
        skill: "my-skill",
        agent: "codex",
      });
      assert.equal(entry, null);
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("returns null when kind in expected does not match registry entry kind", async () => {
    const home = await makeTmpDir();
    try {
      const target = "/target/config.json";
      await registerDeployment(home, target, {
        kind: "config-patch",
        patch: { key: "value" },
        undoPatch: { key: null },
        skill: "my-skill",
        agent: "claude-code",
      });

      const entry = await verifyDeployment(home, target, {
        kind: "skill-dir",
        source: "/src/skill",
        skill: "my-skill",
        agent: "claude-code",
      });
      assert.equal(entry, null);
    } finally {
      await rm(home, { recursive: true });
    }
  });
});

describe("registerDeployment — config-patch", () => {
  it("stores patch and undoPatch in registry", async () => {
    const home = await makeTmpDir();
    try {
      const target = "/target/config.json";
      await registerDeployment(home, target, {
        kind: "config-patch",
        patch: { a: 99, b: "new" },
        undoPatch: { a: 1, b: null },
        skill: "my-skill",
        agent: "claude-code",
      });

      const raw = JSON.parse(await readFile(registryPath(home), "utf-8"));
      const entry = raw.deployments[target];
      assert.ok(entry);
      assert.equal(entry.kind, "config-patch");
      assert.equal(entry.patch.a, 99);
      assert.equal(entry.patch.b, "new");
      assert.equal(entry.undoPatch.a, 1);
      assert.equal(entry.undoPatch.b, null);
      assert.equal(entry.skill, "my-skill");
      assert.equal(entry.agent, "claude-code");
      assert.ok(entry.deployed);
    } finally {
      await rm(home, { recursive: true });
    }
  });
});

describe("loadRegistry — backward compatibility", () => {
  it("reads old-style skill-dir entries without discriminated union", async () => {
    const home = await makeTmpDir();
    try {
      // Write a registry.json as it would have been written by the old flat schema
      const dir = path.join(home, ".inception-engine");
      await mkdir(dir, { recursive: true });
      const oldEntry = {
        kind: "skill-dir",
        source: "/old/source",
        skill: "legacy-skill",
        agent: "claude-code",
        method: "symlink",
        deployed: "2026-01-01T00:00:00.000Z",
      };
      const oldRegistry = {
        version: 1,
        deployments: { "/old/target": oldEntry },
      };
      await writeFile(
        registryPath(home),
        `${JSON.stringify(oldRegistry, null, 2)}\n`,
        "utf-8",
      );

      const entry = await lookupDeployment(home, "/old/target");
      assert.ok(entry, "old skill-dir entry should be readable");
      assert.equal(entry.kind, "skill-dir");
      assert.equal(entry.skill, "legacy-skill");
      assert.equal(entry.agent, "claude-code");
      if (entry.kind === "skill-dir") {
        assert.equal(entry.source, "/old/source");
        assert.equal(entry.method, "symlink");
      }
    } finally {
      await rm(home, { recursive: true });
    }
  });
});
