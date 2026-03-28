import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { AGENT_REGISTRY } from "../src/config/agents.ts";
import {
  resolveAgentDetectPath,
  resolveAgentSkillPath,
  resolveHome,
} from "../src/core/resolve.ts";
import { UserError } from "../src/errors.ts";

function getAgent(id: string) {
  const agent = AGENT_REGISTRY.find((a) => a.id === id);
  assert.ok(agent, `agent "${id}" not found in AGENT_REGISTRY`);
  return agent;
}

describe("resolveAgentSkillPath", () => {
  it("resolves Claude Code skill path", () => {
    const claude = getAgent("claude-code");
    const result = resolveAgentSkillPath(claude, "my-skill", "/Users/test");
    assert.equal(
      result,
      path.join("/Users/test", ".claude", "skills", "my-skill"),
    );
  });

  it("resolves OpenCode skill path with home", () => {
    const opencode = getAgent("opencode");
    const result = resolveAgentSkillPath(opencode, "test-skill", "/home/user");
    // On non-Windows the posix template is used; cross-platform template tests live in cross-platform.test.ts
    assert.ok(result.includes("opencode") && result.includes("test-skill"));
  });

  it("resolves Antigravity nested path", () => {
    const antigravity = getAgent("antigravity");
    const result = resolveAgentSkillPath(antigravity, "my-skill", "/home/user");
    assert.equal(
      result,
      path.join("/home/user", ".gemini", "antigravity", "skills", "my-skill"),
    );
  });
});

describe("resolveAgentDetectPath", () => {
  it("resolves detect path for each agent", () => {
    for (const agent of AGENT_REGISTRY) {
      const result = resolveAgentDetectPath(agent, "/home/user");
      assert.ok(
        path.isAbsolute(result),
        `expected absolute path, got: ${result}`,
      );
      assert.ok(!result.includes("{home}"));
      assert.ok(!result.includes("{name}"));
    }
  });
});

describe("resolveHome", () => {
  it("returns os.homedir() when SUDO_USER is not set", () => {
    const saved = process.env.SUDO_USER;
    try {
      delete process.env.SUDO_USER;
      assert.equal(resolveHome(), os.homedir());
    } finally {
      if (saved === undefined) {
        delete process.env.SUDO_USER;
      } else {
        process.env.SUDO_USER = saved;
      }
    }
  });

  it("ignores SUDO_USER when not running as root and returns os.homedir()", {
    skip: process.platform === "win32",
  }, () => {
    const currentUser = process.env.USER ?? os.userInfo().username;
    if (!currentUser) return;

    const saved = process.env.SUDO_USER;
    try {
      process.env.SUDO_USER = currentUser;
      const result = resolveHome();
      assert.equal(result, os.homedir());
    } finally {
      if (saved === undefined) {
        delete process.env.SUDO_USER;
      } else {
        process.env.SUDO_USER = saved;
      }
    }
  });

  it("throws UserError when SUDO_USER is a non-existent user (only when running as root)", {
    skip: process.platform === "win32",
  }, () => {
    const saved = process.env.SUDO_USER;
    try {
      process.env.SUDO_USER = "__nonexistent_user_inception_engine_test__";
      assert.throws(
        () => resolveHome(),
        (err: unknown) => {
          assert.ok(err instanceof UserError);
          assert.equal(err.code, "RESOLVE_FAILED");
          assert.match(err.message, /Cannot determine home directory/);
          return true;
        },
      );
    } finally {
      if (saved === undefined) {
        delete process.env.SUDO_USER;
      } else {
        process.env.SUDO_USER = saved;
      }
    }
  });
});
