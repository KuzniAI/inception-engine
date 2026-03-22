import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { resolveHome, resolveAgentSkillPath, resolveAgentDetectPath } from "../src/core/resolve.ts";
import { AGENT_REGISTRY } from "../src/config/agents.ts";
import { UserError } from "../src/errors.ts";

describe("resolveAgentSkillPath", () => {
  it("resolves Claude Code skill path", () => {
    const claude = AGENT_REGISTRY.find((a) => a.id === "claude-code")!;
    const result = resolveAgentSkillPath(claude, "my-skill", "/Users/test");
    assert.equal(result, path.join("/Users/test", ".claude", "skills", "my-skill"));
  });

  it("resolves OpenCode skill path with home", () => {
    const opencode = AGENT_REGISTRY.find((a) => a.id === "opencode")!;
    const result = resolveAgentSkillPath(opencode, "test-skill", "/home/user");
    // On non-Windows the posix template is used; cross-platform template tests live in cross-platform.test.ts
    assert.ok(result.includes("opencode") && result.includes("test-skill"));
  });

  it("resolves Antigravity nested path", () => {
    const antigravity = AGENT_REGISTRY.find((a) => a.id === "antigravity")!;
    const result = resolveAgentSkillPath(antigravity, "my-skill", "/home/user");
    assert.equal(result, path.join("/home/user", ".gemini", "antigravity", "skills", "my-skill"));
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
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "RESOLVE_FAILED");
        assert.match(err.message, /Cannot determine home directory/);
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
