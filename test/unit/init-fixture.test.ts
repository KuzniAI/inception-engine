import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { runInit } from "../../src/core/init.ts";
import { logger } from "../../src/logger.ts";
import { makeTmpDir } from "../helpers/fs.ts";
import { assertPathEndsWith, normalizeSlashes } from "../helpers/path.ts";

logger.silence();

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const FIXTURE_DIR = path.join(
  PROJECT_ROOT,
  "test",
  "fixtures",
  "readme-sample",
);

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

/**
 * Extract the JSON manifest object from `init --plan` stdout.
 * The output format is:
 *   [plan] Would write /path/inception.json with N skill(s), ...:
 *   <blank line>
 *   { ...json... }
 * The [plan] prefix may include ANSI escape codes; the first `{` is
 * reliably the start of the JSON object.
 */
function extractPlanJson(stdout: string): unknown {
  const jsonStart = stdout.indexOf("{");
  assert.ok(
    jsonStart !== -1,
    `Could not find JSON object in --plan stdout:\n${stdout}`,
  );
  return JSON.parse(stdout.slice(jsonStart));
}

// ---------------------------------------------------------------------------
// Block 1: init --plan against the real limbo/ tree (read-only)
// ---------------------------------------------------------------------------

describe("init --plan against real limbo/ tree", () => {
  it("emits the 4 limbo skills with all 5 agents and empty other sections", async () => {
    const limboDir = path.join(PROJECT_ROOT, "limbo");
    const { stdout, code } = await run(["init", limboDir, "--plan"]);
    assert.equal(code, 0, `init --plan exited non-zero.\nstdout: ${stdout}`);
    assert.ok(stdout.includes("[plan]"), `missing [plan] prefix:\n${stdout}`);

    const manifest = extractPlanJson(stdout) as {
      skills: Array<{ name: string; path: string; agents: string[] }>;
      files: unknown[];
      configs: unknown[];
      mcpServers: unknown[];
      agentRules: unknown[];
      agentDefinitions: unknown[];
    };

    // Exactly 4 skills
    assert.equal(
      manifest.skills.length,
      4,
      `expected 4 skills, got ${manifest.skills.length}: ${JSON.stringify(manifest.skills.map((s) => s.name))}`,
    );

    // Names sorted alphabetically (sort before comparing - filesystem order not guaranteed)
    const names = manifest.skills.map((s) => s.name).sort();
    assert.deepEqual(names, [
      "inception",
      "interstellar",
      "tenet",
      "the-prestige",
    ]);

    // Each skill has exactly the 5 portability agents (github-copilot excluded)
    const expectedAgents = [
      "antigravity",
      "claude-code",
      "codex",
      "gemini-cli",
      "opencode",
    ];
    for (const skill of manifest.skills) {
      assert.deepEqual(
        skill.agents.slice().sort(),
        expectedAgents,
        `skill "${skill.name}" agents mismatch: ${JSON.stringify(skill.agents)}`,
      );
      assertPathEndsWith(
        skill.path,
        `skills/${skill.name}`,
        `skill "${skill.name}" path should end with skills/${skill.name}`,
      );
    }

    // All other sections are empty arrays
    assert.deepEqual(manifest.mcpServers, [], "mcpServers should be []");
    assert.deepEqual(manifest.agentRules, [], "agentRules should be []");
    assert.deepEqual(
      manifest.agentDefinitions,
      [],
      "agentDefinitions should be []",
    );
    assert.deepEqual(manifest.files, [], "files should be []");
    assert.deepEqual(manifest.configs, [], "configs should be []");
  });
});

// ---------------------------------------------------------------------------
// Block 2: init against README-shaped fixture (copied to temp dir)
// ---------------------------------------------------------------------------

describe("init against readme-sample fixture", () => {
  it("generates a manifest covering all README-documented init discovery paths", async () => {
    const tmpDir = await makeTmpDir("ie-fixture-readme");
    try {
      // Copy the static fixture tree (including .claude/ hidden dir) into tmpDir
      await cp(FIXTURE_DIR, tmpDir, { recursive: true });

      const { stdout, code } = await run(["init", tmpDir]);
      assert.equal(code, 0, `init exited non-zero.\nstdout: ${stdout}`);

      const manifest = JSON.parse(
        await readFile(path.join(tmpDir, "inception.json"), "utf-8"),
      ) as {
        skills: Array<{ name: string; path: string; agents: string[] }>;
        agentRules: Array<{
          name: string;
          path: string;
          agents: string[];
          scope: string;
        }>;
        mcpServers: Array<{
          name: string;
          agents: string[];
          config: Record<string, unknown>;
          scope?: string;
        }>;
        agentDefinitions: Array<{
          name: string;
          path: string;
          agents: string[];
          scope?: string;
        }>;
        files: unknown[];
        configs: unknown[];
      };

      // --- skills: 2 entries, github-copilot excluded per portability rules ---
      assert.equal(
        manifest.skills.length,
        2,
        `expected 2 skills, got ${manifest.skills.length}: ${JSON.stringify(manifest.skills.map((s) => s.name))}`,
      );
      const skillNames = manifest.skills.map((s) => s.name).sort();
      assert.deepEqual(skillNames, ["my-skill", "other-skill"]);

      const expectedSkillAgents = [
        "antigravity",
        "claude-code",
        "codex",
        "gemini-cli",
        "opencode",
      ];
      for (const skill of manifest.skills) {
        assert.deepEqual(
          skill.agents.slice().sort(),
          expectedSkillAgents,
          `skill "${skill.name}" should have all 5 agents (not github-copilot): ${JSON.stringify(skill.agents)}`,
        );
        assertPathEndsWith(
          skill.path,
          `skills/${skill.name}`,
          `skill "${skill.name}" path should end with skills/${skill.name}`,
        );
      }

      // --- agentRules: 3 entries for CLAUDE.md, AGENTS.md, GEMINI.md ---
      assert.equal(
        manifest.agentRules.length,
        3,
        `expected 3 agentRules, got ${manifest.agentRules.length}: ${JSON.stringify(manifest.agentRules.map((r) => r.name))}`,
      );

      const claudeRule = manifest.agentRules.find((r) =>
        normalizeSlashes(r.path).endsWith("CLAUDE.md"),
      );
      assert.ok(claudeRule, "should have an agentRules entry for CLAUDE.md");
      assert.deepEqual(
        claudeRule?.agents.slice().sort(),
        ["claude-code"],
        `CLAUDE.md agents: ${JSON.stringify(claudeRule?.agents)}`,
      );
      assert.equal(claudeRule?.scope, "global");

      const agentsRule = manifest.agentRules.find((r) =>
        normalizeSlashes(r.path).endsWith("AGENTS.md"),
      );
      assert.ok(agentsRule, "should have an agentRules entry for AGENTS.md");
      assert.deepEqual(
        agentsRule?.agents.slice().sort(),
        ["codex", "opencode"],
        `AGENTS.md agents: ${JSON.stringify(agentsRule?.agents)}`,
      );
      assert.equal(agentsRule?.scope, "global");

      const geminiRule = manifest.agentRules.find((r) =>
        normalizeSlashes(r.path).endsWith("GEMINI.md"),
      );
      assert.ok(geminiRule, "should have an agentRules entry for GEMINI.md");
      assert.deepEqual(
        geminiRule?.agents.slice().sort(),
        ["gemini-cli"],
        // antigravity is shared-via gemini-cli and excluded from init defaults
        `GEMINI.md agents should be [gemini-cli] only: ${JSON.stringify(geminiRule?.agents)}`,
      );
      assert.equal(geminiRule?.scope, "global");

      // --- mcpServers: 1 entry round-tripped from mcp-servers.json sidecar ---
      assert.equal(
        manifest.mcpServers.length,
        1,
        `expected 1 mcpServer, got ${manifest.mcpServers.length}`,
      );
      const mcp = manifest.mcpServers[0];
      assert.equal(mcp.name, "my-mcp-server");
      assert.deepEqual(mcp.agents.slice().sort(), [
        "claude-code",
        "codex",
        "gemini-cli",
        "opencode",
      ]);
      assert.equal(mcp.config.command, "npx");
      assert.deepEqual(mcp.config.args, ["-y", "@example/mcp-server"]);

      // --- agentDefinitions: 1 entry from .claude/agents/ -> claude-code ---
      assert.equal(
        manifest.agentDefinitions.length,
        1,
        `expected 1 agentDefinition, got ${manifest.agentDefinitions.length}`,
      );
      const def = manifest.agentDefinitions[0];
      assert.equal(def.name, "code-reviewer");
      assert.deepEqual(def.agents, ["claude-code"]);
      assert.equal(def.scope, "repo");
      assertPathEndsWith(
        def.path,
        ".claude/agents/code-reviewer.md",
        "code-reviewer path should end with .claude/agents/code-reviewer.md",
      );

      // --- files and configs stay empty (no sidecar manifests for them) ---
      assert.deepEqual(manifest.files, [], "files should be []");
      assert.deepEqual(manifest.configs, [], "configs should be []");
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Block 3: init discovery of GitHub Copilot native instruction surfaces
// ---------------------------------------------------------------------------

describe("init Copilot native instruction discovery", () => {
  it("runInit dryRun succeeds when .github/copilot-instructions.md is present", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, ".github"), { recursive: true });
      await writeFile(
        path.join(dir, ".github", "copilot-instructions.md"),
        "# Copilot instructions",
      );
      // Use dryRun to avoid writing inception.json
      const result = await runInit({
        directory: dir,
        agents: null,
        dryRun: true,
        force: false,
        verbose: false,
      });
      assert.equal(result, 0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("init --plan output includes copilot-repo scope for .github/copilot-instructions.md", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, ".github"), { recursive: true });
      await writeFile(
        path.join(dir, ".github", "copilot-instructions.md"),
        "# Copilot instructions",
      );
      const { stdout, code } = await run(["init", dir, "--plan"]);
      assert.equal(code, 0, `init --plan failed:\n${stdout}`);
      const manifest = extractPlanJson(stdout) as {
        agentRules: Array<{
          name: string;
          path: string;
          agents: string[];
          scope: string;
        }>;
      };
      const copilotEntry = manifest.agentRules.find(
        (r) => r.scope === "copilot-repo",
      );
      assert.ok(
        copilotEntry,
        `expected a copilot-repo entry in agentRules, got: ${JSON.stringify(manifest.agentRules)}`,
      );
      assert.deepEqual(copilotEntry.agents, ["github-copilot"]);
      assertPathEndsWith(
        copilotEntry.path,
        ".github/copilot-instructions.md",
        `copilot-repo entry path should end with .github/copilot-instructions.md`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("init --plan output includes copilot-scoped scope for .github/instructions/*.instructions.md", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, ".github", "instructions"), {
        recursive: true,
      });
      await writeFile(
        path.join(dir, ".github", "instructions", "typescript.instructions.md"),
        "# TypeScript scoped instructions",
      );
      await writeFile(
        path.join(dir, ".github", "instructions", "python.instructions.md"),
        "# Python scoped instructions",
      );
      const { stdout, code } = await run(["init", dir, "--plan"]);
      assert.equal(code, 0, `init --plan failed:\n${stdout}`);
      const manifest = extractPlanJson(stdout) as {
        agentRules: Array<{
          name: string;
          path: string;
          agents: string[];
          scope: string;
        }>;
      };
      const scopedEntries = manifest.agentRules.filter(
        (r) => r.scope === "copilot-scoped",
      );
      assert.equal(
        scopedEntries.length,
        2,
        `expected 2 copilot-scoped entries, got ${scopedEntries.length}: ${JSON.stringify(manifest.agentRules)}`,
      );
      for (const entry of scopedEntries) {
        assert.deepEqual(entry.agents, ["github-copilot"]);
      }
      const names = scopedEntries.map((e) => e.name).sort();
      assert.deepEqual(names, ["python", "typescript"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("non-.github/ copilot-instructions.md still maps to claude-code (backward compat)", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "rules"), { recursive: true });
      await writeFile(
        path.join(dir, "rules", "copilot-instructions.md"),
        "# Copilot instructions",
      );
      const { stdout, code } = await run(["init", dir, "--plan"]);
      assert.equal(code, 0, `init --plan failed:\n${stdout}`);
      const manifest = extractPlanJson(stdout) as {
        agentRules: Array<{
          name: string;
          path: string;
          agents: string[];
          scope: string;
        }>;
      };
      const entry = manifest.agentRules.find((r) =>
        r.path.endsWith("copilot-instructions.md"),
      );
      assert.ok(
        entry,
        `expected a copilot-instructions.md entry, got: ${JSON.stringify(manifest.agentRules)}`,
      );
      assert.ok(
        entry.agents.includes("claude-code"),
        `expected agents to include claude-code, got: ${JSON.stringify(entry.agents)}`,
      );
      assert.notEqual(
        entry.scope,
        "copilot-repo",
        "rules/ copilot-instructions.md should not use copilot-repo scope",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
