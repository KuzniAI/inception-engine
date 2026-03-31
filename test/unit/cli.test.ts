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

  it("valid manifest with --dry-run exits 0 and shows plan", async () => {
    const dir = await makeTmpDir();
    try {
      await makeValidRepo(dir);
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

  it("--dry-run does not write inception.json", async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(path.join(dir, "my-skill"), { recursive: true });
      await writeFile(
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
      const { access } = await import("node:fs/promises");
      let exists = true;
      try {
        await access(path.join(dir, "inception.json"));
      } catch {
        exists = false;
      }
      assert.ok(!exists, "inception.json should not exist after dry-run");
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

  it("empty directory with no skills exits 0 with info message", async () => {
    const dir = await makeTmpDir();
    try {
      const { stdout, code } = await run(["init", dir]);
      assert.equal(code, 0);
      assert.ok(
        stdout.includes("No skill"),
        `stdout should mention no skills: ${stdout}`,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
