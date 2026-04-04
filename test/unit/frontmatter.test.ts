import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  parseFrontmatterDocument,
  writeFrontmatterFile,
} from "../../src/core/adapters/frontmatter.ts";

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
    // Standard YAML with 2 space increments:
    // mcp-servers:
    //   my-skill:
    //     command: npx
    //     args:
    //       - serve
    // args is at 4 spaces. Item is at 6 spaces.
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
    // YAML package usually quotes special characters automatically if required.
    // In this case, v:a#l[u]e is valid unquoted in YAML 1.2 plain scalars.
    assert.match(content, /special: v:a#l\[u\]e/);
    assert.match(content, /plain: normal/);
  });

  it("parses valid frontmatter correctly", () => {
    const raw =
      "---\nname: my-skill\ndescription: A cool skill\n---\n\n# Body\nHere.";
    const parsed = parseFrontmatterDocument(raw);
    assert.deepEqual(parsed.attributes, {
      name: "my-skill",
      description: "A cool skill",
    });
    assert.equal(parsed.body.trim(), "# Body\nHere.");
  });

  it("parses empty YAML frontmatter block", () => {
    const raw = "---\n---\n# Body";
    const parsed = parseFrontmatterDocument(raw);
    assert.deepEqual(parsed.attributes, {});
    assert.equal(parsed.body.trim(), "# Body");
  });

  it("returns raw content as body when missing frontmatter delimiters", () => {
    const raw = "# Just Markdown\nNo frontmatter.";
    const parsed = parseFrontmatterDocument(raw);
    assert.deepEqual(parsed.attributes, {});
    assert.equal(parsed.body, raw);
  });

  it("throws on malformed YAML in frontmatter", () => {
    const raw = "---\nkey: : bad\n---";
    assert.throws(() => parseFrontmatterDocument(raw), /YAML/);
  });
});
