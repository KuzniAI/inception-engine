import { access, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function makeTmpDir(prefix = "ie-test-dir"): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
