import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { AGENT_REGISTRY } from "../../src/config/agents.ts";
import {
  resolveAgentDetectPath,
  resolveAgentSkillPath,
  resolveHome,
} from "../../src/core/resolve.ts";
import {
  resolveRuntimePaths,
  resolveTargetTemplate,
} from "../../src/core/runtime-paths.ts";
import { UserError } from "../../src/errors.ts";

const posixJoin = path.posix.join;

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
      posixJoin("/Users/test", ".claude", "skills", "my-skill"),
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
      posixJoin("/home/user", ".gemini", "antigravity", "skills", "my-skill"),
    );
  });

  it("throws with a shared-via hint for github-copilot (no skills field)", () => {
    const copilot = getAgent("github-copilot");
    assert.throws(
      () => resolveAgentSkillPath(copilot, "my-skill", "/home/user"),
      (err: Error) => {
        assert.ok(
          err.message.includes("claude-code"),
          `expected hint referencing claude-code, got: ${err.message}`,
        );
        return true;
      },
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
    skip: process.getuid?.() === 0,
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
    skip: process.getuid?.() !== 0,
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

describe("resolveTargetTemplate", () => {
  it("resolves a descendant path under the placeholder root", () => {
    const home = path.join(path.sep, "home", "user");
    const result = resolveTargetTemplate("{home}/.claude/settings.json", home);
    assert.equal(result, `${home}/.claude/settings.json`);
  });

  it("resolves appdata, local_appdata, xdg_config, repo, and workspace roots", () => {
    const savedAppData = process.env.APPDATA;
    const savedLocalAppData = process.env.LOCALAPPDATA;
    const savedXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.APPDATA = "/env/appdata";
      process.env.LOCALAPPDATA = "/env/local";
      process.env.XDG_CONFIG_HOME = "/env/xdg";

      assert.equal(
        resolveTargetTemplate("{appdata}/opencode/opencode.json", "/home/user"),
        "/env/appdata/opencode/opencode.json",
      );
      assert.equal(
        resolveTargetTemplate("{local_appdata}/Temp/config.json", "/home/user"),
        "/env/local/Temp/config.json",
      );
      assert.equal(
        resolveTargetTemplate(
          "{xdg_config}/opencode/config.json",
          "/home/user",
        ),
        "/env/xdg/opencode/config.json",
      );
      assert.equal(
        resolveTargetTemplate("{repo}/.claude/mcp.json", "/home/user", "/repo"),
        "/repo/.claude/mcp.json",
      );
      assert.equal(
        resolveTargetTemplate("{workspace}/CLAUDE.md", "/home/user", "/repo"),
        "/repo/CLAUDE.md",
      );
      assert.equal(
        resolveTargetTemplate(
          "{workspace}/CLAUDE.md",
          "/home/user",
          "/repo",
          "/workspace",
        ),
        "/workspace/CLAUDE.md",
      );
      assert.equal(resolveTargetTemplate("{home}", "/home/user"), "/home/user");
    } finally {
      if (savedAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = savedAppData;
      if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = savedLocalAppData;
      if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = savedXdg;
    }
  });

  it("throws for invalid templates and missing repo or workspace roots", () => {
    assert.throws(
      () => resolveTargetTemplate("relative/path.txt", "/home/user"),
      /Invalid target template/,
    );
    assert.throws(
      () => resolveTargetTemplate("{repo}/x", "/home/user"),
      /no repo directory was provided/,
    );
    assert.throws(
      () => resolveTargetTemplate("{workspace}/x", "/home/user"),
      /no workspace directory was provided/,
    );
  });

  it("throws when the template escapes the placeholder root", () => {
    assert.throws(
      () => resolveTargetTemplate("{home}/../.ssh/config", "/home/user"),
      /outside its placeholder root/,
    );
  });
});

describe("resolveRuntimePaths", () => {
  it("uses absolute env vars and ignores relative overrides", () => {
    const savedAppData = process.env.APPDATA;
    const savedLocalAppData = process.env.LOCALAPPDATA;
    const savedXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.APPDATA = "/custom/appdata";
      process.env.LOCALAPPDATA = "relative/local";
      process.env.XDG_CONFIG_HOME = "relative/xdg";

      const paths = resolveRuntimePaths("/home/user");
      assert.equal(paths.appdata, "/custom/appdata");
      assert.equal(paths.localAppdata, "/home/user/AppData/Local");
      assert.equal(paths.xdgConfig, "/home/user/.config");
    } finally {
      if (savedAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = savedAppData;
      if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = savedLocalAppData;
      if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = savedXdg;
    }
  });
});
