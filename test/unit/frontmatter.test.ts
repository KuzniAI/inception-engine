import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeFrontmatterFile } from "../../src/core/adapters/frontmatter.ts";

describe("Frontmatter Adapter", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "inception-frontmatter-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a new frontmatter file", async () => {
    const target = path.join(tmpDir, "rule.md");
    const frontmatter = {
      "mcp-servers": {
        "my-skill": { command: "npx", args: ["serve"] },
      },
    };

    await writeFrontmatterFile(target, frontmatter);

    const content = await fs.readFile(target, "utf-8");
    assert.match(content, /^---\nmcp-servers:/);
    assert.match(content, /my-skill:/);
    assert.match(content, /command: npx/);
    assert.match(content, /args:\n {6}- serve/);
  });

  it("updates an existing frontmatter file preserving body", async () => {
    const target = path.join(tmpDir, "rule.md");
    const original =
      "---\ntitle: Old Title\n---\n\n# Body content\nExisting text here.";
    await fs.writeFile(target, original);

    const frontmatter = {
      "mcp-servers": {
        "my-skill": { command: "npx" },
      },
    };

    await writeFrontmatterFile(target, frontmatter, { preserveBody: true });

    const content = await fs.readFile(target, "utf-8");
    assert.match(content, /^---\nmcp-servers:/);
    assert.match(content, /# Body content/);
    assert.match(content, /Existing text here\./);
  });

  it("serializes nested objects correctly", async () => {
    const target = path.join(tmpDir, "rule.md");
    const frontmatter = {
      obj: {
        nested: {
          key: "value",
        },
      },
    };

    await writeFrontmatterFile(target, frontmatter);

    const content = await fs.readFile(target, "utf-8");
    assert.match(content, /obj:\n {2}nested:\n {4}key: value/);
  });

  it("quotes string values with special characters", async () => {
    const target = path.join(tmpDir, "rule.md");
    const frontmatter = {
      special: "v:a#l[u]e",
      plain: "normal",
    };

    await writeFrontmatterFile(target, frontmatter);

    const content = await fs.readFile(target, "utf-8");
    assert.match(content, /special: "v:a#l\[u\]e"/);
    assert.match(content, /plain: normal/);
  });
});
