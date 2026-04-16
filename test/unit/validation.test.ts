import assert from "node:assert/strict";
import { realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { createSourcePathValidator } from "../../src/core/validation.ts";
import { UserError } from "../../src/errors.ts";
import { makeTmpDir } from "../helpers/fs.ts";

describe("createSourcePathValidator", () => {
  it("reports per-entry manifestPath on repeated symlink-escape errors for the same source", async () => {
    const root = await realpath(await makeTmpDir());
    const outside = await realpath(await makeTmpDir());
    try {
      const src = path.join(root, "escape");
      await symlink(
        outside,
        src,
        process.platform === "win32" ? "junction" : "dir",
      );

      const validate = createSourcePathValidator(root);

      await assert.rejects(
        () => validate(src, "entry-one", root),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.match(err.message, /entry-one/);
          assert.match(err.message, /via symlink/);
          return true;
        },
      );

      // Second call hits the cached escape outcome but still surfaces the
      // current manifestPath, not the one captured on the first call.
      await assert.rejects(
        () => validate(src, "entry-two", root),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.match(err.message, /entry-two/);
          assert.doesNotMatch(err.message, /entry-one/);
          return true;
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true });
    }
  });

  it("memoizes the ok outcome for a missing source across calls", async () => {
    const root = await realpath(await makeTmpDir());
    const outside = await realpath(await makeTmpDir());
    try {
      const src = path.join(root, "later");
      const validate = createSourcePathValidator(root);

      // Missing source: validator swallows ENOENT and caches "ok".
      await validate(src, "entry-one", root);

      // Replace the missing source with an escaping symlink. If the first
      // call's ok outcome is cached, the validator does not re-run
      // realpath/identity-walk and still passes.
      await symlink(
        outside,
        src,
        process.platform === "win32" ? "junction" : "dir",
      );

      await validate(src, "entry-two", root);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true });
    }
  });

  it("reuses the cached ok outcome when the same source is validated repeatedly", async () => {
    const root = await realpath(await makeTmpDir());
    try {
      const src = path.join(root, "file.md");
      await writeFile(src, "# ok");
      const validate = createSourcePathValidator(root);

      await validate(src, "entry-one", root);
      // Deleting the file before the second call would cause a fresh realpath
      // to return ENOENT and also resolve to ok, so to really observe the
      // cache we replace it with an escaping symlink.
      await rm(src);
      const outside = await realpath(await makeTmpDir());
      try {
        await symlink(
          outside,
          src,
          process.platform === "win32" ? "junction" : "dir",
        );
        // Cache hit: no escape error despite the symlink now pointing outside.
        await validate(src, "entry-two", root);
      } finally {
        await rm(outside, { recursive: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs the out-of-root string gate per call with the caller's manifestPath", async () => {
    const root = await realpath(await makeTmpDir());
    try {
      const validate = createSourcePathValidator(root);
      const outside = path.resolve(root, "..", "elsewhere", "thing.md");

      await assert.rejects(
        () => validate(outside, "entry-one", root),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.match(err.message, /entry-one/);
          assert.match(err.message, /resolves outside the repository root/);
          assert.doesNotMatch(err.message, /via symlink/);
          return true;
        },
      );

      await assert.rejects(
        () => validate(outside, "entry-two", root),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.match(err.message, /entry-two/);
          return true;
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
