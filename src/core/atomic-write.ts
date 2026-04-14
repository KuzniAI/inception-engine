import { cp, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writes `content` to `targetPath` atomically by staging through a temp file
 * in the same directory and renaming into place. The temp file is cleaned up
 * on error. Parent directory is created if absent.
 *
 * On Windows, `fs.rename` throws EPERM when the target file already exists.
 * In that case we fall back to `cp` + `unlink` of the temp file, which is not
 * atomic but is the best available option without third-party packages.
 */
export async function writeFileAtomic(
  targetPath: string,
  content: string,
  options?: { encoding?: BufferEncoding },
): Promise<void> {
  const dir = path.dirname(targetPath);
  const tempPath = path.join(
    dir,
    `.inception-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(tempPath, content, options?.encoding ?? "utf-8");
    try {
      await rename(tempPath, targetPath);
    } catch (err) {
      // On Windows, rename fails with EPERM when the target already exists.
      if (
        process.platform === "win32" &&
        ((err as NodeJS.ErrnoException).code === "EPERM" ||
          (err as NodeJS.ErrnoException).code === "EBUSY")
      ) {
        await cp(tempPath, targetPath);
        await unlink(tempPath);
        return;
      }
      throw err;
    }
  } catch (err) {
    try {
      await unlink(tempPath);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}
