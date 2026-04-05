import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type ConfigPatchRegistryEntry,
  type FileWriteRegistryEntry,
  type FrontmatterEmitRegistryEntry,
  type Registry,
  type RegistryEntry,
  RegistrySchema,
  type SkillDirRegistryEntry,
} from "../schemas/registry.ts";
import type { AgentId } from "../types.ts";

export type { RegistryEntry } from "../schemas/registry.ts";

const REGISTRY_DIR = ".inception-engine";
const REGISTRY_FILE = "registry.json";

export interface RegistryPersistence {
  load(home: string): Promise<Registry>;
  save(home: string, registry: Registry): Promise<void>;
}

export type VerifyExpected =
  | { kind: "skill-dir"; source: string; skill: string; agent: AgentId }
  | { kind: "file-write"; source: string; skill: string; agent: AgentId }
  | { kind: "config-patch"; skill: string; agent: AgentId };

export function registryPath(home: string): string {
  return path.join(home, REGISTRY_DIR, REGISTRY_FILE);
}

async function loadRegistry(home: string): Promise<Registry> {
  try {
    const content = await readFile(registryPath(home), "utf-8");
    const parsed = JSON.parse(content);
    const result = RegistrySchema.safeParse(parsed);
    return result.success ? result.data : emptyRegistry();
  } catch {
    return emptyRegistry();
  }
}

async function saveRegistry(home: string, registry: Registry): Promise<void> {
  const dir = path.join(home, REGISTRY_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = registryPath(home);
  await writeFile(filePath, `${JSON.stringify(registry, null, 2)}\n`);
  await setFilePermissions(filePath);
}

export const defaultRegistryPersistence: RegistryPersistence = {
  load: loadRegistry,
  save: saveRegistry,
};

/**
 * Ensure the file is not world-writable regardless of umask.
 * On Windows, the OS inherits ACLs from the parent directory — no-op is correct.
 */
async function setFilePermissions(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(filePath, 0o644);
  }
}

function emptyRegistry(): Registry {
  return { version: 1, deployments: {} };
}

export type RegisterEntry =
  | Omit<SkillDirRegistryEntry, "deployed">
  | Omit<FileWriteRegistryEntry, "deployed">
  | Omit<ConfigPatchRegistryEntry, "deployed">
  | Omit<FrontmatterEmitRegistryEntry, "deployed">;

function surfaceIdForEntry(entry: RegisterEntry): string {
  return entry.surfaceId ?? `${entry.kind}:${entry.agent}:${entry.skill}`;
}

export async function registerDeployment(
  home: string,
  targetPath: string,
  entry: RegisterEntry,
  persistence: RegistryPersistence = defaultRegistryPersistence,
): Promise<void> {
  const registry = await persistence.load(home);
  const surfaceId = surfaceIdForEntry(entry);
  for (const migratedTarget of entry.migratedFrom ?? []) {
    if (migratedTarget === targetPath) continue;
    const existing = registry.deployments[migratedTarget];
    if (existing?.surfaceId === surfaceId) {
      delete registry.deployments[migratedTarget];
    }
  }
  registry.deployments[targetPath] = {
    ...entry,
    surfaceId,
    deployed: new Date().toISOString(),
  } as RegistryEntry;
  await persistence.save(home, registry);
}

export async function unregisterDeployment(
  home: string,
  targetPath: string,
  persistence: RegistryPersistence = defaultRegistryPersistence,
): Promise<void> {
  const registry = await persistence.load(home);
  if (!(targetPath in registry.deployments)) return;
  delete registry.deployments[targetPath];
  await persistence.save(home, registry);
}

export async function lookupDeployment(
  home: string,
  targetPath: string,
  persistence: RegistryPersistence = defaultRegistryPersistence,
): Promise<RegistryEntry | null> {
  const registry = await persistence.load(home);
  return registry.deployments[targetPath] ?? null;
}

export async function verifyDeployment(
  home: string,
  targetPath: string,
  expected: VerifyExpected,
  persistence: RegistryPersistence = defaultRegistryPersistence,
): Promise<RegistryEntry | null> {
  const entry = await lookupDeployment(home, targetPath, persistence);
  if (!entry) return null;
  if (entry.kind !== expected.kind) return null;
  if (entry.skill !== expected.skill) return null;
  if (entry.agent !== expected.agent) return null;
  if (
    (expected.kind === "skill-dir" || expected.kind === "file-write") &&
    (entry.kind === "skill-dir" || entry.kind === "file-write") &&
    entry.source !== expected.source
  ) {
    return null;
  }
  return entry;
}
