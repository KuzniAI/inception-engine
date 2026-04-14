import { chmod, lstat, mkdir, readFile } from "node:fs/promises";
import { writeFileAtomic } from "./atomic-write.ts";
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

export function registryDirPath(home: string): string {
  return path.join(home, REGISTRY_DIR);
}

async function assertSafeRegistryStoragePath(
  targetPath: string,
  label: "registry directory" | "registry file",
): Promise<void> {
  try {
    const stat = await lstat(targetPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to use ${label} symlink: ${targetPath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

async function loadRegistry(home: string): Promise<Registry> {
  try {
    await assertSafeRegistryStoragePath(
      registryDirPath(home),
      "registry directory",
    );
    await assertSafeRegistryStoragePath(registryPath(home), "registry file");
    const content = await readFile(registryPath(home), "utf-8");
    const parsed = JSON.parse(content);
    const result = RegistrySchema.safeParse(parsed);
    return result.success ? result.data : emptyRegistry();
  } catch {
    return emptyRegistry();
  }
}

async function saveRegistry(home: string, registry: Registry): Promise<void> {
  const dir = registryDirPath(home);
  await assertSafeRegistryStoragePath(dir, "registry directory");
  await mkdir(dir, { recursive: true });
  await setDirectoryPermissions(dir);
  const filePath = registryPath(home);
  await assertSafeRegistryStoragePath(filePath, "registry file");
  await writeFileAtomic(filePath, `${JSON.stringify(registry, null, 2)}\n`);
  await setFilePermissions(filePath);
}

export const defaultRegistryPersistence: RegistryPersistence = {
  load: loadRegistry,
  save: saveRegistry,
};

/**
 * Per-run in-memory registry cache. Loads the registry from disk once on
 * first access, buffers all save calls in memory, and writes to disk only
 * when flush() is called explicitly at the end of a deploy or revert run.
 *
 * Implements RegistryPersistence so it can be passed as deps.registry to
 * executeDeploy and executeRevert without touching any action-level callers.
 */
export class RunRegistry implements RegistryPersistence {
  private cache: Registry | null = null;
  private dirty = false;
  private readonly backing: RegistryPersistence;

  constructor(backing: RegistryPersistence) {
    this.backing = backing;
  }

  async load(home: string): Promise<Registry> {
    if (this.cache === null) {
      this.cache = await this.backing.load(home);
    }
    return this.cache;
  }

  async save(_home: string, registry: Registry): Promise<void> {
    this.cache = registry;
    this.dirty = true;
  }

  /**
   * Validate that the registry is writable before any actions run. Writes the
   * current (possibly empty) registry state so that a backing store failure is
   * detected upfront, before any filesystem changes are made by deploy or
   * revert actions. Skipped in dry-run flows.
   */
  async preflight(home: string): Promise<void> {
    const registry = await this.load(home);
    await this.backing.save(home, registry);
  }

  async flush(home: string): Promise<void> {
    if (this.dirty && this.cache !== null) {
      await this.backing.save(home, this.cache);
      this.dirty = false;
    }
  }
}

/**
 * Restrict access to the state directory regardless of umask.
 * On Windows, the OS inherits ACLs from the parent directory — no-op is correct.
 */
async function setDirectoryPermissions(dirPath: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(dirPath, 0o700);
  }
}

/**
 * Restrict the registry file to the current user regardless of umask.
 * On Windows, the OS inherits ACLs from the parent directory — no-op is correct.
 */
async function setFilePermissions(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(filePath, 0o600);
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
