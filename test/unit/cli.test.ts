import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

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

function makeTmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ie-test-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeValidRepo(
  dir: string,
  skillName = "test-skill",
  agents: string[] = ["claude-code"],
): void {
  const manifest = {
    skills: [{ name: skillName, path: `skills/${skillName}`, agents }],
    mcpServers: [],
    agentRules: [],
  };
  writeFileSync(
    path.join(dir, "inception.json"),
    JSON.stringify(manifest, null, 2),
  );
  const skillDir = path.join(dir, "skills", skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
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
    assert.ok(stdout.includes("--dry-run"), "stdout should include options");
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
    const dir = makeTmpDir();
    try {
      makeValidRepo(dir);
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
      rmSync(dir, { recursive: true });
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
    const dir = makeTmpDir();
    try {
      writeFileSync(path.join(dir, "inception.json"), "{not valid json}");
      const { stderr, code } = await run([dir]);
      assert.equal(code, 3);
      assert.ok(
        stderr.includes("Error:"),
        `stderr should mention error: ${stderr}`,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("directory with schema-invalid manifest exits 3", async () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(
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
      rmSync(dir, { recursive: true });
    }
  });

  it("valid manifest with --dry-run exits 0 and shows plan", async () => {
    const dir = makeTmpDir();
    try {
      makeValidRepo(dir);
      const { stdout, code } = await run([
        dir,
        "--dry-run",
        "--agents",
        "claude-code",
      ]);
      assert.equal(code, 0);
      assert.ok(
        stdout.includes("[dry-run]"),
        `stdout should include [dry-run]: ${stdout}`,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("revert --dry-run with valid manifest exits 0", async () => {
    const dir = makeTmpDir();
    try {
      makeValidRepo(dir);
      const { code } = await run([
        "revert",
        dir,
        "--dry-run",
        "--agents",
        "claude-code",
      ]);
      assert.equal(code, 0);
    } finally {
      rmSync(dir, { recursive: true });
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
    const dir = makeTmpDir();
    try {
      // Create two skill directories
      for (const name of ["alpha", "beta"]) {
        mkdirSync(path.join(dir, "skills", name), { recursive: true });
        writeFileSync(
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
      rmSync(dir, { recursive: true });
    }
  });

  it("--dry-run does not write inception.json", async () => {
    const dir = makeTmpDir();
    try {
      mkdirSync(path.join(dir, "my-skill"), { recursive: true });
      writeFileSync(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      const { stdout, code } = await run(["init", dir, "--dry-run"]);
      assert.equal(code, 0, `stdout: ${stdout}`);
      assert.ok(
        stdout.includes("[dry-run]"),
        `stdout should include [dry-run]: ${stdout}`,
      );
      // File should NOT have been written
      const { existsSync } = await import("node:fs");
      assert.ok(
        !existsSync(path.join(dir, "inception.json")),
        "inception.json should not exist after dry-run",
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("refuses to overwrite existing inception.json without --force", async () => {
    const dir = makeTmpDir();
    try {
      mkdirSync(path.join(dir, "my-skill"), { recursive: true });
      writeFileSync(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      writeFileSync(path.join(dir, "inception.json"), "{}");
      const { code } = await run(["init", dir]);
      assert.equal(code, 2);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("--force overwrites existing inception.json", async () => {
    const dir = makeTmpDir();
    try {
      mkdirSync(path.join(dir, "my-skill"), { recursive: true });
      writeFileSync(
        path.join(dir, "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
      );
      writeFileSync(path.join(dir, "inception.json"), "{}");
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
      rmSync(dir, { recursive: true });
    }
  });

  it("--agents restricts agent list in generated manifest", async () => {
    const dir = makeTmpDir();
    try {
      mkdirSync(path.join(dir, "my-skill"), { recursive: true });
      writeFileSync(
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
      rmSync(dir, { recursive: true });
    }
  });

  it("empty directory with no skills exits 0 with info message", async () => {
    const dir = makeTmpDir();
    try {
      const { stdout, code } = await run(["init", dir]);
      assert.equal(code, 0);
      assert.ok(
        stdout.includes("No skill"),
        `stdout should mention no skills: ${stdout}`,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
