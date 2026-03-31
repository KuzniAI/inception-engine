import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import type {
  Registry,
  RegistryPersistence,
} from "../../src/core/ownership.ts";
import { defaultRegistryPersistence } from "../../src/core/ownership.ts";
import type { Manifest } from "../../src/types.ts";

export function makeTmpDir(prefix: string): string {
  const dir = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function createSkillSource(
  baseDir: string,
  skillPath = "skills/test-skill",
  skillBody = "---\nname: test\ndescription: Test skill\n---\n# Test",
): string {
  const fullPath = path.join(baseDir, skillPath);
  mkdirSync(fullPath, { recursive: true });
  writeFileSync(path.join(fullPath, "SKILL.md"), skillBody);
  return fullPath;
}

export const testSkillManifest: Manifest = {
  skills: [
    {
      name: "test-skill",
      path: "skills/test-skill",
      agents: ["claude-code"],
    },
  ],
  mcpServers: [],
  agentRules: [],
};

export function createFailingRegistryPersistence(
  error = new Error("simulated registry persistence failure"),
): RegistryPersistence {
  return {
    load(home: string): Promise<Registry> {
      return defaultRegistryPersistence.load(home);
    },
    async save(): Promise<void> {
      throw error;
    },
  };
}

export function assertSymlinkTarget(target: string, source: string): void {
  assert.ok(existsSync(target), "expected target to exist");
  assert.ok(lstatSync(target).isSymbolicLink(), "expected a symlink target");
  assert.equal(readlinkSync(target), source);
}

export function assertCopyTarget(
  target: string,
  expectedSkillMd: string,
): void {
  assert.ok(existsSync(target), "expected target to exist");
  assert.ok(!lstatSync(target).isSymbolicLink(), "expected a copied directory");
  assert.equal(
    readFileSync(path.join(target, "SKILL.md"), "utf-8"),
    expectedSkillMd,
  );
}
