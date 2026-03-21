import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { resolveHome, resolveAgentSkillPath, resolveAgentDetectPath } from "../src/core/resolve.ts";
import { AGENT_REGISTRY } from "../src/config/agents.ts";

describe("resolveAgentSkillPath", () => {
  it("resolves Claude Code skill path", () => {
    const claude = AGENT_REGISTRY.find((a) => a.id === "claude-code")!;
    const result = resolveAgentSkillPath(claude, "my-skill", "/Users/test");

    if (process.platform === "win32") {
      assert.equal(result, "/Users/test\\.claude\\skills\\my-skill");
    } else {
      assert.equal(result, "/Users/test/.claude/skills/my-skill");
    }
  });

  it("resolves OpenCode skill path with home", () => {
    const opencode = AGENT_REGISTRY.find((a) => a.id === "opencode")!;
    const result = resolveAgentSkillPath(opencode, "test-skill", "/home/user");

    if (process.platform === "win32") {
      // Uses {appdata} on Windows
      assert.ok(result.includes("opencode"));
    } else {
      assert.equal(result, "/home/user/.config/opencode/skills/test-skill");
    }
  });

  it("resolves Antigravity nested path", () => {
    const antigravity = AGENT_REGISTRY.find((a) => a.id === "antigravity")!;
    const result = resolveAgentSkillPath(antigravity, "my-skill", "/home/user");

    if (process.platform !== "win32") {
      assert.equal(result, "/home/user/.gemini/antigravity/skills/my-skill");
    }
  });
});

describe("resolveAgentDetectPath", () => {
  it("resolves detect path for each agent", () => {
    for (const agent of AGENT_REGISTRY) {
      const result = resolveAgentDetectPath(agent, "/home/user");
      assert.ok(result.startsWith("/home/user") || result.includes("opencode"));
      assert.ok(!result.includes("{home}"));
      assert.ok(!result.includes("{name}"));
    }
  });
});

describe("resolveHome", () => {
  it("returns os.homedir() when SUDO_USER is not set", () => {
    const saved = process.env["SUDO_USER"];
    try {
      delete process.env["SUDO_USER"];
      assert.equal(resolveHome(), os.homedir());
    } finally {
      if (saved === undefined) {
        delete process.env["SUDO_USER"];
      } else {
        process.env["SUDO_USER"] = saved;
      }
    }
  });

  it("looks up real home when SUDO_USER matches the current user", () => {
    if (process.platform === "win32") return;
    const currentUser = process.env["USER"] ?? os.userInfo().username;
    if (!currentUser) return;

    const saved = process.env["SUDO_USER"];
    try {
      process.env["SUDO_USER"] = currentUser;
      const result = resolveHome();
      assert.ok(typeof result === "string" && result.startsWith("/"), `expected absolute path, got: ${result}`);
    } finally {
      if (saved === undefined) {
        delete process.env["SUDO_USER"];
      } else {
        process.env["SUDO_USER"] = saved;
      }
    }
  });

  it("throws UserError when SUDO_USER is a non-existent user", () => {
    if (process.platform === "win32") return;
    const saved = process.env["SUDO_USER"];
    try {
      process.env["SUDO_USER"] = "__nonexistent_user_inception_engine_test__";
      assert.throws(() => resolveHome(), (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(/Cannot determine home directory/.test(err.message), err.message);
        return true;
      });
    } finally {
      if (saved === undefined) {
        delete process.env["SUDO_USER"];
      } else {
        process.env["SUDO_USER"] = saved;
      }
    }
  });
});
