import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { writeFileAtomic } from "../../src/core/atomic-write.ts";
import { exists, makeTmpDir } from "../helpers/fs.ts";

describe("writeFileAtomic", () => {
  it("creates a file with the correct content", async () => {
    const dir = await makeTmpDir();
    try {
      const target = path.join(dir, "output.txt");
      await writeFileAtomic(target, "hello world");
      const content = await readFile(target, "utf-8");
      assert.equal(content, "hello world");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("overwrites an existing file", async () => {
    const dir = await makeTmpDir();
    try {
      const target = path.join(dir, "output.txt");
      await writeFile(target, "old content", "utf-8");
      await writeFileAtomic(target, "new content");
      const content = await readFile(target, "utf-8");
      assert.equal(content, "new content");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates parent directory if it does not exist", async () => {
    const dir = await makeTmpDir();
    try {
      const target = path.join(dir, "nested", "deep", "output.txt");
      await writeFileAtomic(target, "nested content");
      const content = await readFile(target, "utf-8");
      assert.equal(content, "nested content");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves no orphan temp file after successful write", async () => {
    const dir = await makeTmpDir();
    try {
      const target = path.join(dir, "output.txt");
      await writeFileAtomic(target, "content");
      // Ensure no .inception-tmp-* files remain
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(dir);
      const temps = entries.filter((e) => e.includes(".inception-tmp-"));
      assert.equal(
        temps.length,
        0,
        `Unexpected temp files: ${temps.join(", ")}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not leave a partial file at the target when the target dir is read-only", async () => {
    // Skip on Windows where chmod semantics differ
    if (process.platform === "win32") return;
    const dir = await makeTmpDir();
    try {
      const { chmod } = await import("node:fs/promises");
      const subdir = path.join(dir, "readonly");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(subdir, { recursive: true });
      await chmod(subdir, 0o555); // remove write permission
      const target = path.join(subdir, "output.txt");
      await assert.rejects(() => writeFileAtomic(target, "content"));
      // Target should not exist after failure
      assert.equal(await exists(target), false);
    } finally {
      const { chmod } = await import("node:fs/promises");
      await chmod(path.join(dir, "readonly"), 0o755).catch((_e) => {
        /* best-effort restore */
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("respects custom encoding option", async () => {
    const dir = await makeTmpDir();
    try {
      const target = path.join(dir, "output.txt");
      await writeFileAtomic(target, "utf8 content", { encoding: "utf-8" });
      const content = await readFile(target, "utf-8");
      assert.equal(content, "utf8 content");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
