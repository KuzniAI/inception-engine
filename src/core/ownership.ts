import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RegistrySchema } from "../schemas/registry.ts";
import type { AgentId } from "../types.ts";

const REGISTRY_DIR = ".inception-engine";
const REGISTRY_FILE = "registry.json";

export interface RegistryEntry {
  source: string;
  skill: string;
  agent: AgentId;
  method: "symlink" | "copy";
  deployed: string;
}

interface Registry {
  version: 1;
  deployments: Record<string, RegistryEntry>;
}

export function registryPath(home: string): string {
  return path.join(home, REGISTRY_DIR, REGISTRY_FILE);
}

async function loadRegistry(home: string): Promise<Registry> {
  try {
    const content = await readFile(registryPath(home), "utf-8");
    const parsed = JSON.parse(content);
    const result = RegistrySchema.safeParse(parsed);
    return result.success ? (result.data as Registry) : emptyRegistry();
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

export async function registerDeployment(
  home: string,
  targetPath: string,
  entry: Omit<RegistryEntry, "deployed">,
): Promise<void> {
  const registry = await loadRegistry(home);
  registry.deployments[targetPath] = {
    ...entry,
    deployed: new Date().toISOString(),
  };
  await saveRegistry(home, registry);
}

export async function unregisterDeployment(
  home: string,
  targetPath: string,
): Promise<void> {
  const registry = await loadRegistry(home);
  if (!(targetPath in registry.deployments)) return;
  delete registry.deployments[targetPath];
  await saveRegistry(home, registry);
}

export async function lookupDeployment(
  home: string,
  targetPath: string,
): Promise<RegistryEntry | null> {
  const registry = await loadRegistry(home);
  return registry.deployments[targetPath] ?? null;
}

export async function verifyDeployment(
  home: string,
  targetPath: string,
  expected: { source: string; skill: string; agent: AgentId },
): Promise<RegistryEntry | null> {
  const entry = await lookupDeployment(home, targetPath);
  if (!entry) return null;
  if (
    entry.source !== expected.source ||
    entry.skill !== expected.skill ||
    entry.agent !== expected.agent
  ) {
    return null;
  }
  return entry;
}
