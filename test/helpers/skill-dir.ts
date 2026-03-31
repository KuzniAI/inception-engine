import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RegistryPersistence } from "../../src/core/ownership.ts";
import { defaultRegistryPersistence } from "../../src/core/ownership.ts";
import type { Registry } from "../../src/schemas/registry.ts";
import type { Manifest } from "../../src/types.ts";
import { exists } from "./fs.ts";

export async function createSkillSource(
  baseDir: string,
  skillPath = "skills/test-skill",
  skillBody = "---\nname: test\ndescription: Test skill\n---\n# Test",
): Promise<string> {
  const fullPath = path.join(baseDir, skillPath);
  await mkdir(fullPath, { recursive: true });
  await writeFile(path.join(fullPath, "SKILL.md"), skillBody);
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
  files: [],
  configs: [],
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

export async function assertSymlinkTarget(
  target: string,
  source: string,
): Promise<void> {
  assert.ok(await exists(target), "expected target to exist");
  assert.ok(
    (await lstat(target)).isSymbolicLink(),
    "expected a symlink target",
  );
  assert.equal(await readlink(target), source);
}

export async function assertCopyTarget(
  target: string,
  expectedSkillMd: string,
): Promise<void> {
  assert.ok(await exists(target), "expected target to exist");
  assert.ok(
    !(await lstat(target)).isSymbolicLink(),
    "expected a copied directory",
  );
  assert.equal(
    await readFile(path.join(target, "SKILL.md"), "utf-8"),
    expectedSkillMd,
  );
}
