import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { makeTmpDir } from "../helpers/fs.ts";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function run(args: string[], env?: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(PROJECT_ROOT, "src", "index.ts"), ...args],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, ...env },
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function makeValidRepo(
  dir: string,
  skillName = "test-skill",
  agents: string[] = ["claude-code"],
): Promise<void> {
  const manifest = {
    skills: [{ name: skillName, path: `skills/${skillName}`, agents }],
    files: [],
    configs: [],
    mcpServers: [],
    agentRules: [],
  };
  await writeFile(
    path.join(dir, "inception.json"),
    JSON.stringify(manifest, null, 2),
  );
  const skillDir = path.join(dir, "skills", skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: test-skill\ndescription: A test skill\n---\n# Test\n",
  );
}

describe("CLI exit codes and output", () => {
  it("--help exits 0 and prints usage", async () => {
    const { stdout, code } = await run(["--help"]);
    assert.equal(code, 0);
    assert.ok(
      stdout.includes("inception-engine"),
      "stdout should include tool name",
    );
    assert.ok(stdout.includes("--plan"), "stdout should include options");
  });

  it("no args exits 0 and prints usage", async () => {
    const { stdout, code } = await run([]);
    assert.equal(code, 0);
    assert.ok(
      stdout.includes("inception-engine"),
      "stdout should include tool name",
    );
  });

  it("unknown --agents value exits 2", async () => {
    const dir = await makeTmpDir();
    try {
      await makeValidRepo(dir);
      const { stderr, code } = await run([
        dir,
        "--agents",
        "invalid-xyz-agent",
      ]);
      assert.equal(code, 2);
      assert.ok(
        stderr.includes("Error:") || stderr.includes("invalid"),
        `stderr should mention error: ${stderr}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("non-existent directory exits 3", async () => {
    const { stderr, code } = await run(["/absolutely/nonexistent/path/xyz"]);
    assert.equal(code, 3);
    assert.ok(
      stderr.includes("Error:"),
      `stderr should mention error: ${stderr}`,
    );
  });

  it("directory with malformed JSON exits 3", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "inception.json"), "{not valid json}");
      const { stderr, code } = await run([dir]);
      assert.equal(code, 3);
      assert.ok(
        stderr.includes("Error:"),
        `stderr should mention error: ${stderr}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("directory with schema-invalid manifest exits 3", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "inception.json"),
        JSON.stringify({ skills: "not-an-array" }),
      );
      const { stderr, code } = await run([dir]);
      assert.equal(code, 3);
      assert.ok(
        stderr.includes("Error:"),
        `stderr should mention error: ${stderr}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("valid manifest with --plan exits 0 and shows plan", async () => {
    const dir = await makeTmpDir();
    try {
      await makeValidRepo(dir);
      const { stdout, code } = await run([
        dir,
        "--plan",
        "--agents",
        "claude-code",
      ]);
      assert.equal(code, 0);
      assert.ok(
        stdout.includes("[plan]"),
        `stdout should include [plan]: ${stdout}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("revert --dry-run with valid manifest exits 0", async () => {
    const dir = await makeTmpDir();
    try {
      await makeValidRepo(dir);
      const { code } = await run([
        "revert",
        dir,
        "--dry-run",
        "--agents",
        "claude-code",
      ]);
      assert.equal(code, 0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("missing <directory> argument exits 2", async () => {
    // Passing only a valid option but no positional directory
    const { stderr, code } = await run(["--dry-run"]);
    assert.equal(code, 2);
    assert.ok(
      stderr.includes("Error:"),
      `stderr should mention error: ${stderr}`,
    );
  });
});

describe("init command", () => {
  it("generates inception.json from a directory with skill folders", async () => {
    const dir = await makeTmpDir();
    try {
      // Create two skill directories
      for (const name of ["alpha", "beta"]) {
        await mkdir(path.join(dir, "skills", name), { recursive: true });
        await writeFile(
          path.join(dir, "skills", name, "SKILL.md"),
          `---\nname: ${name}\ndescription: A skill\n---\n`,
        );
      }
      const { stdout, code } = await run(["init", dir]);
      assert.equal(code, 0, `stdout: ${stdout}`);

      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { skills: Array<{ name: string; path: string }> };
      assert.equal(manifest.skills.length, 2);
      const names = manifest.skills.map((s) => s.name).sort();
      assert.deepEqual(names, ["alpha", "beta"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("--plan does not write inception.json", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      const { stdout, code } = await run(["init", dir, "--plan"]);
      assert.equal(code, 0, `stdout: ${stdout}`);
      assert.ok(
        stdout.includes("[plan]"),
        `stdout should include [plan]: ${stdout}`,
      );
      // File should NOT have been written
      const { access } = await import("node:fs/promises");
      let exists = true;
      try {
        await access(path.join(dir, "inception.json"));
      } catch {
        exists = false;
      }
      assert.ok(!exists, "inception.json should not exist after plan");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("refuses to overwrite existing inception.json without --force", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      await writeFile(path.join(dir, "inception.json"), "{}");
      const { code } = await run(["init", dir]);
      assert.equal(code, 2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("--force overwrites existing inception.json", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      await writeFile(path.join(dir, "inception.json"), "{}");
      const { code } = await run(["init", dir, "--force"]);
      assert.equal(code, 0);

      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { skills: Array<{ name: string }> };
      assert.equal(manifest.skills.length, 1);
      assert.equal(manifest.skills[0].name, "my-skill");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("--agents restricts agent list in generated manifest", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      const { code } = await run([
        "init",
        dir,
        "--agents",
        "claude-code,codex",
      ]);
      assert.equal(code, 0);

      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { skills: Array<{ agents: string[] }> };
      assert.deepEqual(manifest.skills[0].agents.sort(), [
        "claude-code",
        "codex",
      ]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("empty directory with no skills exits 0 with info message and writes manifest", async () => {
    const dir = await makeTmpDir();
    try {
      const { stdout, code } = await run(["init", dir]);
      assert.equal(code, 0);
      assert.ok(
        stdout.includes("No skill"),
        `stdout should mention no skills: ${stdout}`,
      );
      // manifest is still written even with no skills
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as Record<string, unknown>;
      assert.ok(
        Array.isArray(manifest.skills),
        "manifest.skills should be an array",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("generated manifest always includes all five section keys", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as Record<string, unknown>;
      assert.ok(
        Array.isArray(manifest.skills),
        "manifest.skills should be an array",
      );
      assert.ok(
        Array.isArray(manifest.files),
        "manifest.files should be an array",
      );
      assert.ok(
        Array.isArray(manifest.configs),
        "manifest.configs should be an array",
      );
      assert.ok(
        Array.isArray(manifest.mcpServers),
        "manifest.mcpServers should be an array",
      );
      assert.ok(
        Array.isArray(manifest.agentRules),
        "manifest.agentRules should be an array",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("discovers CLAUDE.md as agentRules entry for claude-code", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      await writeFile(path.join(dir, "CLAUDE.md"), "# rules\n");
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as {
        agentRules: Array<{ name: string; path: string; agents: string[] }>;
      };
      assert.ok(
        manifest.agentRules.length > 0,
        "should have at least one agentRules entry",
      );
      const entry = manifest.agentRules.find((r) =>
        r.path.endsWith("CLAUDE.md"),
      );
      assert.ok(entry, "should have an entry for CLAUDE.md");
      assert.ok(
        entry?.agents.includes("claude-code"),
        `agents should include claude-code, got: ${JSON.stringify(entry?.agents)}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("discovers AGENTS.md as agentRules entry for codex and opencode", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      await writeFile(path.join(dir, "AGENTS.md"), "# rules\n");
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as {
        agentRules: Array<{ name: string; path: string; agents: string[] }>;
      };
      const entry = manifest.agentRules.find((r) =>
        r.path.endsWith("AGENTS.md"),
      );
      assert.ok(entry, "should have an entry for AGENTS.md");
      assert.deepEqual(
        entry?.agents.slice().sort(),
        ["codex", "opencode"],
        `expected codex+opencode, got: ${JSON.stringify(entry?.agents)}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("discovers GEMINI.md as agentRules entry for gemini-cli and antigravity", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      await writeFile(path.join(dir, "GEMINI.md"), "# rules\n");
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as {
        agentRules: Array<{ name: string; path: string; agents: string[] }>;
      };
      const entry = manifest.agentRules.find((r) =>
        r.path.endsWith("GEMINI.md"),
      );
      assert.ok(entry, "should have an entry for GEMINI.md");
      assert.deepEqual(
        entry?.agents.slice().sort(),
        ["antigravity", "gemini-cli"],
        `expected gemini-cli+antigravity, got: ${JSON.stringify(entry?.agents)}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("--agents filter is applied to discovered agentRules entries", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      // CLAUDE.md normally maps to claude-code only; with --agents codex it should
      // fall back to the active agents list since intersection would be empty
      await writeFile(path.join(dir, "CLAUDE.md"), "# rules\n");
      const { code } = await run(["init", dir, "--agents", "codex"]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as {
        agentRules: Array<{ name: string; path: string; agents: string[] }>;
      };
      const entry = manifest.agentRules.find((r) =>
        r.path.endsWith("CLAUDE.md"),
      );
      assert.ok(entry, "should have an entry for CLAUDE.md");
      // intersection of [claude-code] and [codex] is empty → falls back to activeAgents [codex]
      assert.deepEqual(
        entry?.agents,
        ["codex"],
        `expected [codex] fallback, got: ${JSON.stringify(entry?.agents)}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("directory with no .md files produces agentRules: []", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { agentRules: unknown[] };
      assert.deepEqual(manifest.agentRules, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("agentRules name collision with skill gets -rules suffix", async () => {
    const dir = await makeTmpDir();
    try {
      // Skill named "my-rules", and a file "my-rules.md" → name collision
      await mkdir(path.join(dir, "my-rules"), { recursive: true });
      await writeFile(
        path.join(dir, "my-rules", "SKILL.md"),
        "---\nname: my-rules\ndescription: test\n---\n",
      );
      await writeFile(path.join(dir, "my-rules.md"), "# rules\n");
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as {
        skills: Array<{ name: string }>;
        agentRules: Array<{ name: string; path: string }>;
      };
      assert.ok(
        manifest.skills.some((s) => s.name === "my-rules"),
        "skill name should be my-rules",
      );
      const rulesEntry = manifest.agentRules.find((r) =>
        r.path.endsWith("my-rules.md"),
      );
      assert.ok(rulesEntry, "should have agentRules entry for my-rules.md");
      assert.equal(
        rulesEntry?.name,
        "my-rules-rules",
        `expected my-rules-rules, got: ${rulesEntry?.name}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // --- portability reconciliation ---

  it("copilot-instructions.md maps to claude-code, not github-copilot", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "copilot-instructions.md"), "# rules\n");
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as {
        agentRules: Array<{ name: string; path: string; agents: string[] }>;
      };
      const entry = manifest.agentRules.find((r) =>
        r.path.includes("copilot-instructions"),
      );
      assert.ok(entry, "should have an entry for copilot-instructions.md");
      assert.ok(
        entry?.agents.includes("claude-code"),
        `agents should include claude-code, got: ${JSON.stringify(entry?.agents)}`,
      );
      assert.ok(
        !entry?.agents.includes("github-copilot"),
        `agents should not include github-copilot, got: ${JSON.stringify(entry?.agents)}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("unrecognized .md fallback excludes github-copilot", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "my-custom-rules.md"), "# rules\n");
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as {
        agentRules: Array<{ name: string; path: string; agents: string[] }>;
      };
      const entry = manifest.agentRules.find((r) =>
        r.path.includes("my-custom-rules"),
      );
      assert.ok(entry, "should have an entry for my-custom-rules.md");
      assert.ok(
        !entry?.agents.includes("github-copilot"),
        `fallback agents should not include github-copilot, got: ${JSON.stringify(entry?.agents)}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("--agents github-copilot produces agentRules: []", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "my-custom-rules.md"), "# rules\n");
      const { code } = await run(["init", dir, "--agents", "github-copilot"]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { agentRules: unknown[] };
      assert.deepEqual(
        manifest.agentRules,
        [],
        "github-copilot cannot receive agentRules, so agentRules should be []",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // --- mcp-servers.json discovery ---

  it("valid mcp-servers.json populates mcpServers", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "mcp-servers.json"),
        JSON.stringify([
          {
            name: "my-server",
            agents: ["claude-code"],
            config: { command: "npx", args: ["-y", "my-pkg"] },
          },
        ]),
      );
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as {
        mcpServers: Array<{
          name: string;
          agents: string[];
          config: Record<string, unknown>;
        }>;
      };
      assert.equal(manifest.mcpServers.length, 1);
      assert.equal(manifest.mcpServers[0].name, "my-server");
      assert.deepEqual(manifest.mcpServers[0].agents, ["claude-code"]);
      assert.equal(manifest.mcpServers[0].config.command, "npx");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("invalid JSON in mcp-servers.json produces mcpServers: [] and a warning", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "mcp-servers.json"), "{not json}");
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { mcpServers: unknown[] };
      assert.deepEqual(manifest.mcpServers, []);
      assert.ok(
        stdout.includes("mcp-servers.json"),
        "stdout should mention mcp-servers.json warning",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("non-array mcp-servers.json produces mcpServers: [] and a warning", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "mcp-servers.json"),
        JSON.stringify({ name: "not-an-array" }),
      );
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { mcpServers: unknown[] };
      assert.deepEqual(manifest.mcpServers, []);
      assert.ok(
        stdout.includes("mcp-servers.json"),
        "stdout should mention mcp-servers.json warning",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("mcp-servers.json with mixed valid/invalid entries only keeps valid ones", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "mcp-servers.json"),
        JSON.stringify([
          {
            name: "valid-server",
            agents: ["claude-code"],
            config: { command: "npx" },
          },
          { name: "missing-config-and-agents" },
        ]),
      );
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { mcpServers: Array<{ name: string }> };
      assert.equal(manifest.mcpServers.length, 1);
      assert.equal(manifest.mcpServers[0].name, "valid-server");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("missing mcp-servers.json produces mcpServers: [] with no warning", async () => {
    const dir = await makeTmpDir();
    try {
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { mcpServers: unknown[] };
      assert.deepEqual(manifest.mcpServers, []);
      assert.ok(
        !stdout.includes("mcp-servers.json"),
        "stdout should not mention mcp-servers.json when file is absent",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // --- files/ and configs/ directory hints ---

  it("files/ directory produces a hint in stdout and files remains []", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "files"), { recursive: true });
      await writeFile(path.join(dir, "files", "settings.json"), "{}");
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { files: unknown[] };
      assert.deepEqual(manifest.files, []);
      assert.ok(
        stdout.includes("files/"),
        "stdout should mention the files/ directory",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("configs/ directory produces a hint in stdout and configs remains []", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "configs"), { recursive: true });
      await writeFile(path.join(dir, "configs", "patch.json"), "{}");
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { configs: unknown[] };
      assert.deepEqual(manifest.configs, []);
      assert.ok(
        stdout.includes("configs/"),
        "stdout should mention the configs/ directory",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // --- files-manifest.json discovery ---

  it("valid files-manifest.json populates files", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "source.txt"), "hello");
      await writeFile(
        path.join(dir, "files-manifest.json"),
        JSON.stringify([
          {
            name: "my-file",
            path: "source.txt",
            target: "{home}/.myconfig",
            agents: ["claude-code"],
          },
        ]),
      );
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as {
        files: Array<{
          name: string;
          path: string;
          target: string;
          agents: string[];
        }>;
      };
      assert.equal(manifest.files.length, 1);
      assert.equal(manifest.files[0].name, "my-file");
      assert.equal(manifest.files[0].target, "{home}/.myconfig");
      assert.deepEqual(manifest.files[0].agents, ["claude-code"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("invalid JSON in files-manifest.json produces files: [] and a warning", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "files-manifest.json"), "{not json}");
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { files: unknown[] };
      assert.deepEqual(manifest.files, []);
      assert.ok(
        stdout.includes("files-manifest.json"),
        "stdout should mention files-manifest.json warning",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("non-array files-manifest.json produces files: [] and a warning", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "files-manifest.json"),
        JSON.stringify({ name: "not-an-array" }),
      );
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { files: unknown[] };
      assert.deepEqual(manifest.files, []);
      assert.ok(
        stdout.includes("files-manifest.json"),
        "stdout should mention files-manifest.json warning",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("files-manifest.json with mixed valid/invalid entries only keeps valid ones", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "files-manifest.json"),
        JSON.stringify([
          {
            name: "valid-file",
            path: "source.txt",
            target: "{home}/.myconfig",
            agents: ["claude-code"],
          },
          { name: "missing-required-fields" },
        ]),
      );
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { files: Array<{ name: string }> };
      assert.equal(manifest.files.length, 1);
      assert.equal(manifest.files[0].name, "valid-file");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("files/ dir with valid files-manifest.json suppresses the hint", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "files"), { recursive: true });
      await writeFile(path.join(dir, "files", "settings.json"), "{}");
      await writeFile(
        path.join(dir, "files-manifest.json"),
        JSON.stringify([
          {
            name: "my-settings",
            path: "files/settings.json",
            target: "{home}/.claude/settings.json",
            agents: ["claude-code"],
          },
        ]),
      );
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { files: Array<{ name: string }> };
      assert.equal(manifest.files.length, 1);
      assert.ok(
        !stdout.includes("create files-manifest.json"),
        "hint should not appear when files were loaded from files-manifest.json",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // --- configs-manifest.json discovery ---

  it("valid configs-manifest.json populates configs", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "configs-manifest.json"),
        JSON.stringify([
          {
            name: "enable-feature",
            target: "{home}/.claude/settings.json",
            patch: { someFeature: true },
            agents: ["claude-code"],
          },
        ]),
      );
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as {
        configs: Array<{
          name: string;
          target: string;
          patch: Record<string, unknown>;
          agents: string[];
        }>;
      };
      assert.equal(manifest.configs.length, 1);
      assert.equal(manifest.configs[0].name, "enable-feature");
      assert.equal(manifest.configs[0].target, "{home}/.claude/settings.json");
      assert.deepEqual(manifest.configs[0].patch, { someFeature: true });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("invalid JSON in configs-manifest.json produces configs: [] and a warning", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(path.join(dir, "configs-manifest.json"), "{not json}");
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { configs: unknown[] };
      assert.deepEqual(manifest.configs, []);
      assert.ok(
        stdout.includes("configs-manifest.json"),
        "stdout should mention configs-manifest.json warning",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("non-array configs-manifest.json produces configs: [] and a warning", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "configs-manifest.json"),
        JSON.stringify({ name: "not-an-array" }),
      );
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { configs: unknown[] };
      assert.deepEqual(manifest.configs, []);
      assert.ok(
        stdout.includes("configs-manifest.json"),
        "stdout should mention configs-manifest.json warning",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("configs-manifest.json with mixed valid/invalid entries only keeps valid ones", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(
        path.join(dir, "configs-manifest.json"),
        JSON.stringify([
          {
            name: "valid-config",
            target: "{home}/.claude/settings.json",
            patch: { key: "value" },
            agents: ["claude-code"],
          },
          { name: "missing-required-fields" },
        ]),
      );
      const { code } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { configs: Array<{ name: string }> };
      assert.equal(manifest.configs.length, 1);
      assert.equal(manifest.configs[0].name, "valid-config");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("configs/ dir with valid configs-manifest.json suppresses the hint", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "configs"), { recursive: true });
      await writeFile(
        path.join(dir, "configs-manifest.json"),
        JSON.stringify([
          {
            name: "my-patch",
            target: "{home}/.claude/settings.json",
            patch: { feature: true },
            agents: ["claude-code"],
          },
        ]),
      );
      const { code, stdout } = await run(["init", dir]);
      assert.equal(code, 0);
      const manifest = JSON.parse(
        (
          await import("node:fs/promises").then((m) =>
            m.readFile(path.join(dir, "inception.json"), "utf-8"),
          )
        ).toString(),
      ) as { configs: Array<{ name: string }> };
      assert.equal(manifest.configs.length, 1);
      assert.ok(
        !stdout.includes("create configs-manifest.json"),
        "hint should not appear when configs were loaded from configs-manifest.json",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
