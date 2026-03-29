import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { UserError } from "../errors.ts";

export function sourceAccessError(err: unknown, sourcePath: string): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return `Source not found: ${sourcePath}`;
  if (code === "EACCES" || code === "EPERM")
    return `Permission denied accessing source: ${sourcePath}`;
  const detail = err instanceof Error ? err.message : String(err);
  return `Failed to access source ${sourcePath}: ${detail}`;
}

function normalizePathForComparison(candidate: string): string {
  const normalized = path.normalize(candidate);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isSameOrDescendantPath(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePathForComparison(candidate);
  const normalizedRoot = normalizePathForComparison(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + path.sep)
  );
}

async function isSameFileSystemLocation(
  a: string,
  b: string,
): Promise<boolean> {
  const [aStat, bStat] = await Promise.all([stat(a), stat(b)]);
  return aStat.dev === bStat.dev && aStat.ino === bStat.ino;
}

async function isWithinRootByIdentity(
  candidate: string,
  root: string,
): Promise<boolean> {
  let current = candidate;
  while (true) {
    if (await isSameFileSystemLocation(current, root)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export async function validateSourcePath(
  source: string,
  skillPath: string,
  resolvedSourceDir: string,
  realRoot: string,
): Promise<void> {
  if (!source.startsWith(resolvedSourceDir + path.sep)) {
    throw new UserError(
      "DEPLOY_FAILED",
      `Skill path "${skillPath}" resolves outside the repository root: ${source}`,
    );
  }

  try {
    const realSource = await realpath(source);
    if (
      !(
        isSameOrDescendantPath(realSource, realRoot) ||
        (await isWithinRootByIdentity(realSource, realRoot))
      )
    ) {
      throw new UserError(
        "DEPLOY_FAILED",
        `Skill path "${skillPath}" resolves outside the repository root via symlink: ${source} -> ${realSource}`,
      );
    }
  } catch (err) {
    if (err instanceof UserError) throw err;
    // Source doesn't exist yet — will be caught during execute
  }
}

export async function validateSourceFile(
  sourcePath: string,
  manifestPath: string,
): Promise<void> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(sourcePath);
  } catch (err) {
    throw new UserError("DEPLOY_FAILED", sourceAccessError(err, manifestPath));
  }
  if (!stat.isFile()) {
    throw new UserError(
      "DEPLOY_FAILED",
      `Source is not a file: ${manifestPath}`,
    );
  }
}
