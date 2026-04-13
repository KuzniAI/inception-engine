import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { runPreflight } from "../../src/core/preflight.ts";
import { logger } from "../../src/logger.ts";
import type { CliOptions, Manifest } from "../../src/types.ts";
import { makeTmpDir } from "../helpers/fs.ts";
import { normalizeSlashes } from "../helpers/path.ts";

logger.silence();

const baseOptions: CliOptions = {
  command: "deploy",
  directory: "/tmp",
  dryRun: false,
  agents: null,
  verbose: false,
  debug: false,
  force: false,
};

const emptyManifest: Manifest = {
  skills: [],
  files: [],
  configs: [],
  mcpServers: [],
  agentRules: [],
  permissions: [],
  agentDefinitions: [],
};

describe("runPreflight", () => {
  it("returns empty for empty detected agents list", async () => {
    const warnings = await runPreflight(
      baseOptions,
      emptyManifest,
      "/home/test",
      [],
    );
    assert.equal(warnings.length, 0);
  });

  it("returns empty for documented agents without policy notes", async () => {
    const warnings = await runPreflight(
      baseOptions,
      emptyManifest,
      "/home/test",
      ["claude-code", "codex", "gemini-cli", "opencode"],
    );
    assert.equal(warnings.length, 0);
  });

  it("returns empty for standard github-copilot without enterprise markers", async () => {
    const warnings = await runPreflight(
      baseOptions,
      emptyManifest,
      "/home/test",
      ["github-copilot"],
    );
    assert.equal(warnings.length, 0);
  });

  it("emits config-authority warning for antigravity (implementation-only skills)", async () => {
    const warnings = await runPreflight(
      baseOptions,
      emptyManifest,
      "/home/test",
      ["antigravity"],
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.kind, "config-authority");
    assert.match(warnings[0]?.message ?? "", /antigravity/);
    assert.match(warnings[0]?.message ?? "", /implementation-only/);
  });

  it("emits one warning per non-documented agent", async () => {
    const warnings = await runPreflight(
      baseOptions,
      emptyManifest,
      "/home/test",
      ["claude-code", "antigravity"],
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.kind, "config-authority");
    assert.match(warnings[0]?.message ?? "", /antigravity/);
  });

  it("emits shared-surface guidance when a skill targets github-copilot without claude-code", async () => {
    const manifest: Manifest = {
      ...emptyManifest,
      skills: [
        {
          name: "my-skill",
          path: "skills/my-skill",
          agents: ["github-copilot"],
        },
      ],
    };
    const warnings = await runPreflight(baseOptions, manifest, "/home/test", [
      "github-copilot",
    ]);
    const info = warnings.find((w) => w.kind === "info");
    assert.ok(info, "expected a shared-surface info warning");
    assert.match(info?.message ?? "", /via "claude-code"/);
  });

  it("emits unsupported warning when manifest uses github-copilot MCP with global scope", async () => {
    const manifest: Manifest = {
      ...emptyManifest,
      mcpServers: [
        {
          name: "my-mcp",
          agents: ["github-copilot"],
          config: { command: "npx", args: ["-y", "my-mcp"] },
          scope: "global",
        },
      ],
    };
    const warnings = await runPreflight(baseOptions, manifest, "/home/test", [
      "github-copilot",
    ]);
    const info = warnings.find((w) => w.kind === "info");
    assert.ok(info, "expected an unsupported-surface info warning");
    assert.match(info?.message ?? "", /unsupported/);
  });

  it("emits no capability warning when manifest uses github-copilot MCP with scope: repo", async () => {
    const manifest: Manifest = {
      ...emptyManifest,
      mcpServers: [
        {
          name: "my-mcp",
          agents: ["github-copilot"],
          config: { command: "npx", args: ["-y", "my-mcp"] },
          scope: "repo",
        },
      ],
    };
    const warnings = await runPreflight(baseOptions, manifest, "/home/test", [
      "github-copilot",
    ]);
    const capabilityWarning = warnings.find(
      (w) => w.kind === "info" && /mcpServers/.test(w.message),
    );
    assert.equal(
      capabilityWarning,
      undefined,
      `expected no MCP capability warning, got: ${capabilityWarning?.message}`,
    );
  });

  it("emits no config-authority warning for gemini-cli agentDefinitions (surface is now documented)", async () => {
    const manifest: Manifest = {
      ...emptyManifest,
      agentDefinitions: [
        {
          name: "my-agent",
          path: "agents/my-agent.md",
          agents: ["gemini-cli"],
          scope: "repo",
        },
      ],
    };
    const warnings = await runPreflight(baseOptions, manifest, "/home/test", [
      "gemini-cli",
    ]);
    const implementationOnlyWarning = warnings.find(
      (w) =>
        w.kind === "config-authority" && /implementation-only/.test(w.message),
    );
    assert.equal(
      implementationOnlyWarning,
      undefined,
      `expected no implementation-only warning, got: ${implementationOnlyWarning?.message}`,
    );
  });

  it("emits shared-surface config-authority guidance when github-copilot agentRules ride through claude-code", async () => {
    const manifest: Manifest = {
      ...emptyManifest,
      agentRules: [
        {
          name: "shared-rules",
          path: "CLAUDE.md",
          agents: ["claude-code", "github-copilot"],
          scope: "repo",
        },
      ],
    };
    const warnings = await runPreflight(baseOptions, manifest, "/home/test", [
      "claude-code",
      "github-copilot",
    ]);
    const warning = warnings.find(
      (w) =>
        w.kind === "config-authority" &&
        w.message.includes('shared through "claude-code"'),
    );
    assert.ok(
      warning,
      `expected shared-surface warning, got: ${JSON.stringify(warnings)}`,
    );
    assert.match(warning.message, /requires the primary target to deploy/);
  });

  it("emits shared-surface config-authority guidance for antigravity repo rules", async () => {
    const manifest: Manifest = {
      ...emptyManifest,
      agentRules: [
        {
          name: "gemini-rules",
          path: "GEMINI.md",
          agents: ["antigravity"],
          scope: "repo",
        },
      ],
    };
    const warnings = await runPreflight(baseOptions, manifest, "/home/test", [
      "antigravity",
    ]);
    const warning = warnings.find(
      (w) =>
        w.kind === "config-authority" &&
        w.message.includes('shared through "gemini-cli"'),
    );
    assert.ok(
      warning,
      `expected antigravity shared-via warning, got: ${JSON.stringify(warnings)}`,
    );
    assert.doesNotMatch(
      warning.message,
      /requires the primary target to deploy/,
    );
  });

  it("emits provisional config-authority warning for supported gemini executionConfigs", async () => {
    const manifest: Manifest = {
      ...emptyManifest,
      executionConfigs: [
        {
          name: "safe-mode",
          agents: ["gemini-cli"],
          config: { sandbox: "workspace-write" },
        },
      ],
    };
    const warnings = await runPreflight(baseOptions, manifest, "/home/test", [
      "gemini-cli",
    ]);
    const capabilityWarning = warnings.find(
      (w) =>
        w.kind === "config-authority" && /execution-config/.test(w.message),
    );
    assert.ok(
      capabilityWarning,
      `expected executionConfig warning, got: ${JSON.stringify(warnings)}`,
    );
    assert.match(capabilityWarning.message, /provisional/);
  });
});

describe("github-copilot devcontainer support", () => {
  it("emits no capability warning for devcontainer MCP when Copilot is detected and devcontainer scope is targeted", async () => {
    const manifestWithMcp: Manifest = {
      ...emptyManifest,
      mcpServers: [
        {
          name: "test-mcp",
          scope: "devcontainer",
          agents: ["github-copilot"],
          config: { command: "node", args: ["server.js"] },
        },
      ],
    };
    const warnings = await runPreflight(
      baseOptions,
      manifestWithMcp,
      "/home/test",
      ["github-copilot"],
    );
    const capabilityWarning = warnings.find(
      (w) => w.kind === "info" && /mcpServers/.test(w.message),
    );
    assert.equal(
      capabilityWarning,
      undefined,
      `expected no MCP capability warning for devcontainer scope, got: ${capabilityWarning?.message}`,
    );
  });
});

describe("instruction precedence warnings", () => {
  it("emits duplicate-content precedence warning when same source used in both global and repo scope for an agent", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "CLAUDE.md"), "# Rules");
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "global-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "global",
          },
          {
            name: "repo-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      const precedenceWarnings = warnings.filter(
        (w) => w.kind === "precedence",
      );
      assert.ok(precedenceWarnings.length > 0, "expected a precedence warning");
      assert.ok(
        precedenceWarnings.some(
          (w) =>
            w.message.includes("claude-code") &&
            w.message.includes("CLAUDE.md"),
        ),
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits stacking advisory when different source files in global and repo scope for an agent", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "global.md"), "# Global");
      await writeFile(path.join(sourceDir, "repo.md"), "# Repo");
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "global-rules",
            path: "global.md",
            agents: ["claude-code"],
            scope: "global",
          },
          {
            name: "repo-rules",
            path: "repo.md",
            agents: ["claude-code"],
            scope: "repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      const precedenceWarnings = warnings.filter(
        (w) => w.kind === "precedence",
      );
      assert.ok(precedenceWarnings.length > 0, "expected a precedence warning");
      assert.ok(
        precedenceWarnings.some(
          (w) =>
            w.message.includes("claude-code") &&
            w.message.includes("simultaneously"),
        ),
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no precedence warning when agent only has global entries", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "CLAUDE.md"), "# Rules");
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "global-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "precedence").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no precedence warning when agent only has repo entries", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "CLAUDE.md"), "# Rules");
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "repo-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "precedence").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no precedence warning for agents not in detectedAgents", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "CLAUDE.md"), "# Rules");
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "global-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "global",
          },
          {
            name: "repo-rules",
            path: "CLAUDE.md",
            agents: ["claude-code"],
            scope: "repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["codex"],
      );
      assert.equal(warnings.filter((w) => w.kind === "precedence").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits Copilot precedence warning when github-copilot has both shared-via (scope: repo) and native (scope: copilot-repo) entries", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "shared.md"), "# Shared rules");
      await writeFile(path.join(sourceDir, "native.md"), "# Native rules");
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "shared-rules",
            path: "shared.md",
            agents: ["claude-code", "github-copilot"],
            scope: "repo",
          },
          {
            name: "native-rules",
            path: "native.md",
            agents: ["github-copilot"],
            scope: "copilot-repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["github-copilot"],
      );
      const precedenceWarnings = warnings.filter(
        (w) => w.kind === "precedence",
      );
      assert.ok(precedenceWarnings.length > 0, "expected a precedence warning");
      assert.ok(
        precedenceWarnings.some(
          (w) =>
            w.message.includes("github-copilot") &&
            w.message.includes("CLAUDE.md-shared") &&
            w.message.includes("native Copilot"),
        ),
        `expected Copilot precedence warning, got: ${JSON.stringify(precedenceWarnings)}`,
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits Copilot precedence warning when github-copilot has both global (scope: global) and copilot-scoped entries", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "shared.md"), "# Shared rules");
      await writeFile(path.join(sourceDir, "scoped.md"), "# Scoped rules");
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "shared-rules",
            path: "shared.md",
            agents: ["claude-code", "github-copilot"],
            scope: "global",
          },
          {
            name: "typescript",
            path: "scoped.md",
            agents: ["github-copilot"],
            scope: "copilot-scoped",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["github-copilot"],
      );
      const precedenceWarnings = warnings.filter(
        (w) => w.kind === "precedence",
      );
      assert.ok(
        precedenceWarnings.some(
          (w) =>
            w.message.includes("github-copilot") &&
            w.message.includes("native Copilot"),
        ),
        `expected Copilot precedence warning, got: ${JSON.stringify(precedenceWarnings)}`,
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no Copilot precedence warning when github-copilot only has native entries", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(path.join(sourceDir, "native.md"), "# Native rules");
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "native-rules",
            path: "native.md",
            agents: ["github-copilot"],
            scope: "copilot-repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["github-copilot"],
      );
      assert.equal(warnings.filter((w) => w.kind === "precedence").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });
});

describe("instruction budget warnings", () => {
  it("emits budget warning for agentRules source file exceeding 50 KB", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(
        path.join(sourceDir, "big.md"),
        Buffer.alloc(51 * 1024, "x"),
      );
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "big-rules",
            path: "big.md",
            agents: ["claude-code"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      const budgetWarnings = warnings.filter((w) => w.kind === "budget");
      assert.ok(budgetWarnings.length > 0, "expected a budget warning");
      assert.ok(
        budgetWarnings.some(
          (w) => w.message.includes("big.md") && w.message.includes("KB"),
        ),
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits budget warning for agentDefinitions source file exceeding 50 KB", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await mkdir(path.join(sourceDir, "agents"), { recursive: true });
      await writeFile(
        path.join(sourceDir, "agents", "big-agent.md"),
        Buffer.alloc(51 * 1024, "x"),
      );
      const manifest: Manifest = {
        ...emptyManifest,
        agentDefinitions: [
          {
            name: "big-agent",
            path: "agents/big-agent.md",
            agents: ["claude-code"],
            scope: "repo",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      const budgetWarnings = warnings.filter((w) => w.kind === "budget");
      assert.ok(budgetWarnings.length > 0, "expected a budget warning");
      assert.ok(
        budgetWarnings.some((w) =>
          normalizeSlashes(w.message).includes("agents/big-agent.md"),
        ),
      );
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no budget warning for files at or below 50 KB", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(
        path.join(sourceDir, "small.md"),
        Buffer.alloc(49 * 1024, "x"),
      );
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "small-rules",
            path: "small.md",
            agents: ["claude-code"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "budget").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits no budget warning when entry's agents are not in detectedAgents", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(
        path.join(sourceDir, "big.md"),
        Buffer.alloc(51 * 1024, "x"),
      );
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "big-rules",
            path: "big.md",
            agents: ["codex"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "budget").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("deduplicates budget warnings when the same source path appears in two entries", async () => {
    const sourceDir = await makeTmpDir();
    try {
      await writeFile(
        path.join(sourceDir, "big.md"),
        Buffer.alloc(51 * 1024, "x"),
      );
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "rules-a",
            path: "big.md",
            agents: ["claude-code"],
            scope: "global",
          },
          {
            name: "rules-b",
            path: "big.md",
            agents: ["claude-code"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "budget").length, 1);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("silently skips missing source files without emitting a budget warning", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "missing-rules",
            path: "does-not-exist.md",
            agents: ["claude-code"],
            scope: "global",
          },
        ],
      };
      const warnings = await runPreflight(
        { ...baseOptions, directory: sourceDir },
        manifest,
        "/home/test",
        ["claude-code"],
      );
      assert.equal(warnings.filter((w) => w.kind === "budget").length, 0);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits precedence warnings for triple overlap (global, repo, workspace) for an agent", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          { name: "g", path: "g.md", agents: ["claude-code"], scope: "global" },
          { name: "r", path: "r.md", agents: ["claude-code"], scope: "repo" },
          {
            name: "w",
            path: "w.md",
            agents: ["claude-code"],
            scope: "workspace",
          },
        ],
      };
      await writeFile(path.join(sourceDir, "g.md"), "# G");
      await writeFile(path.join(sourceDir, "r.md"), "# R");
      await writeFile(path.join(sourceDir, "w.md"), "# W");

      const warnings = await runPreflight(baseOptions, manifest, "/home/test", [
        "claude-code",
      ]);

      const precedence = warnings.filter((w) => w.kind === "precedence");
      assert.equal(precedence.length, 1);
      const msg = precedence[0]?.message ?? "";
      assert.match(msg, /global/);
      assert.match(msg, /repo/);
      assert.match(msg, /workspace/);
      assert.match(msg, /active simultaneously/);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("emits duplicate-content warning for workspace overlap (global vs workspace)", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const manifest: Manifest = {
        ...emptyManifest,
        agentRules: [
          {
            name: "global",
            path: "SHARED.md",
            agents: ["claude-code"],
            scope: "global",
          },
          {
            name: "workspace",
            path: "SHARED.md",
            agents: ["claude-code"],
            scope: "workspace",
          },
        ],
      };
      await writeFile(path.join(sourceDir, "SHARED.md"), "# Shared");

      const warnings = await runPreflight(baseOptions, manifest, "/home/test", [
        "claude-code",
      ]);

      const duplicate = warnings.find(
        (w) =>
          w.kind === "precedence" && w.message.includes("distinct targets"),
      );
      assert.ok(duplicate, "expected duplicate target warning");
      assert.match(duplicate.message, /global and workspace/);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });

  it("detects precedence overlaps for Gemini CLI combinations", async () => {
    const sourceDir = await makeTmpDir();
    try {
      const manifest: Manifest = {
        skills: [],
        files: [],
        configs: [],
        mcpServers: [],
        agentRules: [
          { name: "g", path: "r1.md", agents: ["gemini-cli"], scope: "global" },
          { name: "r", path: "r1.md", agents: ["gemini-cli"], scope: "repo" },
        ],
        permissions: [],
        agentDefinitions: [],
      };
      await writeFile(path.join(sourceDir, "r1.md"), "# R1");

      const warnings = await runPreflight(baseOptions, manifest, "/home/test", [
        "gemini-cli",
      ]);

      const precedence = warnings.filter((w) => w.kind === "precedence");
      // Expect 2: one for duplicate path, one for simultaneous load
      assert.equal(precedence.length, 2);
    } finally {
      await rm(sourceDir, { recursive: true });
    }
  });
});
