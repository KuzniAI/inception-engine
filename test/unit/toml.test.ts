import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  applyTomlMcpPatch,
  revertTomlMcpPatch,
} from "../../src/core/adapters/toml.ts";

describe("TOML Adapter", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "inception-toml-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("applies an MCP server patch to a new TOML file", async () => {
    const target = path.join(tmpDir, "config.toml");
    const config = { command: "npx", args: ["serve"] };

    await applyTomlMcpPatch(target, "my-skill", config);

    const content = await fs.readFile(target, "utf-8");
    assert.match(content, /\[mcpServers\.my-skill\]/);
    assert.match(content, /command = "npx"/);
    assert.match(content, /args = \[ "serve" \]/);
  });

  it("applies an MCP server patch to an existing TOML file preserving other keys", async () => {
    const target = path.join(tmpDir, "config.toml");
    await fs.writeFile(
      target,
      'title = "My App"\n\n[mcpServers.other]\ncommand = "ls"\n',
    );

    const config = { command: "npx", args: ["serve"] };
    await applyTomlMcpPatch(target, "my-skill", config);

    const content = await fs.readFile(target, "utf-8");
    assert.match(content, /title = "My App"/);
    assert.match(content, /\[mcpServers\.other\]/);
    assert.match(content, /\[mcpServers\.my-skill\]/);
    assert.match(content, /command = "npx"/);
  });

  it("reverts an MCP server patch", async () => {
    const target = path.join(tmpDir, "config.toml");
    await fs.writeFile(
      target,
      '[mcpServers.other]\ncommand = "ls"\n\n[mcpServers.my-skill]\ncommand = "npx"\n',
    );

    await revertTomlMcpPatch(target, "my-skill");

    const content = await fs.readFile(target, "utf-8");
    assert.match(content, /\[mcpServers\.other\]/);
    assert.doesNotMatch(content, /my-skill/);
  });

  it("cleans up [mcpServers] table if it becomes empty after revert", async () => {
    const target = path.join(tmpDir, "config.toml");
    await fs.writeFile(target, '[mcpServers.my-skill]\ncommand = "npx"\n');

    await revertTomlMcpPatch(target, "my-skill");

    const content = await fs.readFile(target, "utf-8");
    assert.strictEqual(content.trim(), "");
  });

  it("throws error if config.toml is invalid TOML", async () => {
    const target = path.join(tmpDir, "config.toml");
    await fs.writeFile(target, 'this is not = toml "bad"');

    await assert.rejects(
      () => applyTomlMcpPatch(target, "any", {}),
      /Invalid TOML document/,
    );
  });
});
