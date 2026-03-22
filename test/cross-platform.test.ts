import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  resolveAgentSkillPathFor,
  resolveAgentDetectPathFor,
  lookupHomeForUserWith,
} from "../src/core/resolve.ts";
import { AGENT_REGISTRY } from "../src/config/agents.ts";
import { UserError } from "../src/errors.ts";

const HOME = "/home/u";
const SKILL = "s";

// ---------------------------------------------------------------------------
// resolveAgentSkillPathFor — POSIX
// ---------------------------------------------------------------------------

describe("resolveAgentSkillPathFor — posix", () => {
  const p = "posix" as const;

  it("claude-code", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "claude-code")!;
    assert.equal(
      resolveAgentSkillPathFor(agent, SKILL, HOME, p),
      path.join(HOME, ".claude", "skills", SKILL)
    );
  });

  it("codex", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "codex")!;
    assert.equal(
      resolveAgentSkillPathFor(agent, SKILL, HOME, p),
      path.join(HOME, ".codex", "skills", SKILL)
    );
  });

  it("gemini-cli", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "gemini-cli")!;
    assert.equal(
      resolveAgentSkillPathFor(agent, SKILL, HOME, p),
      path.join(HOME, ".gemini", "skills", SKILL)
    );
  });

  it("antigravity", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "antigravity")!;
    assert.equal(
      resolveAgentSkillPathFor(agent, SKILL, HOME, p),
      path.join(HOME, ".gemini", "antigravity", "skills", SKILL)
    );
  });

  it("opencode", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "opencode")!;
    assert.equal(
      resolveAgentSkillPathFor(agent, SKILL, HOME, p),
      path.join(HOME, ".config", "opencode", "skills", SKILL)
    );
  });

  it("github-copilot", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "github-copilot")!;
    assert.equal(
      resolveAgentSkillPathFor(agent, SKILL, HOME, p),
      path.join(HOME, ".copilot", "skills", SKILL)
    );
  });
});

// ---------------------------------------------------------------------------
// resolveAgentSkillPathFor — Windows
// ---------------------------------------------------------------------------

describe("resolveAgentSkillPathFor — windows", () => {
  const p = "windows" as const;

  it("claude-code uses home (same template as posix)", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "claude-code")!;
    assert.equal(
      resolveAgentSkillPathFor(agent, SKILL, HOME, p),
      path.join(HOME, ".claude", "skills", SKILL)
    );
  });

  it("opencode uses APPDATA when set", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "opencode")!;
    const appdata = "C:\\Users\\u\\AppData\\Roaming";
    const saved = process.env["APPDATA"];
    try {
      process.env["APPDATA"] = appdata;
      assert.equal(
        resolveAgentSkillPathFor(agent, SKILL, HOME, p),
        path.join(appdata, "opencode", "skills", SKILL)
      );
    } finally {
      if (saved === undefined) delete process.env["APPDATA"];
      else process.env["APPDATA"] = saved;
    }
  });

  it("opencode falls back to home/AppData/Roaming when APPDATA is unset", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "opencode")!;
    const saved = process.env["APPDATA"];
    try {
      delete process.env["APPDATA"];
      assert.equal(
        resolveAgentSkillPathFor(agent, SKILL, HOME, p),
        path.join(HOME, "AppData", "Roaming", "opencode", "skills", SKILL)
      );
    } finally {
      if (saved === undefined) delete process.env["APPDATA"];
      else process.env["APPDATA"] = saved;
    }
  });

  it("antigravity uses home (same template as posix)", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "antigravity")!;
    assert.equal(
      resolveAgentSkillPathFor(agent, SKILL, HOME, p),
      path.join(HOME, ".gemini", "antigravity", "skills", SKILL)
    );
  });

  it("github-copilot uses home (same template as posix)", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "github-copilot")!;
    assert.equal(
      resolveAgentSkillPathFor(agent, SKILL, HOME, p),
      path.join(HOME, ".copilot", "skills", SKILL)
    );
  });
});

// ---------------------------------------------------------------------------
// resolveAgentDetectPathFor — POSIX
// ---------------------------------------------------------------------------

describe("resolveAgentDetectPathFor — posix", () => {
  const p = "posix" as const;

  it("claude-code", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "claude-code")!;
    assert.equal(resolveAgentDetectPathFor(agent, HOME, p), path.join(HOME, ".claude"));
  });

  it("opencode uses .config/opencode", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "opencode")!;
    assert.equal(
      resolveAgentDetectPathFor(agent, HOME, p),
      path.join(HOME, ".config", "opencode")
    );
  });

  it("antigravity has nested detect path", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "antigravity")!;
    assert.equal(
      resolveAgentDetectPathFor(agent, HOME, p),
      path.join(HOME, ".gemini", "antigravity")
    );
  });
});

// ---------------------------------------------------------------------------
// resolveAgentDetectPathFor — Windows
// ---------------------------------------------------------------------------

describe("resolveAgentDetectPathFor — windows", () => {
  const p = "windows" as const;

  it("opencode uses APPDATA when set", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "opencode")!;
    const appdata = "C:\\Users\\u\\AppData\\Roaming";
    const saved = process.env["APPDATA"];
    try {
      process.env["APPDATA"] = appdata;
      assert.equal(
        resolveAgentDetectPathFor(agent, HOME, p),
        path.join(appdata, "opencode")
      );
    } finally {
      if (saved === undefined) delete process.env["APPDATA"];
      else process.env["APPDATA"] = saved;
    }
  });

  it("claude-code uses home (same template as posix)", () => {
    const agent = AGENT_REGISTRY.find((a) => a.id === "claude-code")!;
    assert.equal(resolveAgentDetectPathFor(agent, HOME, p), path.join(HOME, ".claude"));
  });
});

// ---------------------------------------------------------------------------
// lookupHomeForUserWith — getent path (linux)
// ---------------------------------------------------------------------------

describe("lookupHomeForUserWith — getent (linux)", () => {
  const platform = "linux" as NodeJS.Platform;
  const noopRead = readFileSync; // won't be called in success cases

  it("returns home from valid getent output", () => {
    const execFileFn = ((_cmd: string, _args: readonly string[], _opts: object) =>
      "alice:x:1000:1000::/home/alice:/bin/bash\n") as typeof execFileSync;
    assert.equal(
      lookupHomeForUserWith("alice", platform, execFileFn, noopRead),
      "/home/alice"
    );
  });

  it("falls through on getent failure and reads /etc/passwd", () => {
    const execFileFn = ((_cmd: string, _args: readonly string[], _opts: object) => {
      throw new Error("getent: command not found");
    }) as unknown as typeof execFileSync;
    const readFileFn = ((_p: string, _enc: string) =>
      "root:x:0:0:root:/root:/bin/bash\nalice:x:1000:1000::/home/alice:/bin/bash\n") as typeof readFileSync;
    assert.equal(
      lookupHomeForUserWith("alice", platform, execFileFn, readFileFn),
      "/home/alice"
    );
  });

  it("falls through when getent returns malformed output (no 6th field)", () => {
    const execFileFn = ((_cmd: string, _args: readonly string[], _opts: object) =>
      "badinput") as typeof execFileSync;
    const readFileFn = ((_p: string, _enc: string) =>
      "alice:x:1000:1000::/home/alice:/bin/bash\n") as typeof readFileSync;
    assert.equal(
      lookupHomeForUserWith("alice", platform, execFileFn, readFileFn),
      "/home/alice"
    );
  });
});

// ---------------------------------------------------------------------------
// lookupHomeForUserWith — dscl path (darwin)
// ---------------------------------------------------------------------------

describe("lookupHomeForUserWith — dscl (darwin)", () => {
  const platform = "darwin" as NodeJS.Platform;

  it("returns home from valid dscl output", () => {
    const execFileFn = ((_cmd: string, _args: readonly string[], _opts: object) =>
      "NFSHomeDirectory: /Users/alice\n") as typeof execFileSync;
    assert.equal(
      lookupHomeForUserWith("alice", platform, execFileFn, readFileSync),
      "/Users/alice"
    );
  });

  it("falls through on dscl failure and reads /etc/passwd", () => {
    const execFileFn = ((_cmd: string, _args: readonly string[], _opts: object) => {
      throw new Error("dscl: record not found");
    }) as unknown as typeof execFileSync;
    const readFileFn = ((_p: string, _enc: string) =>
      "alice:x:1000:1000::/Users/alice:/bin/zsh\n") as typeof readFileSync;
    assert.equal(
      lookupHomeForUserWith("alice", platform, execFileFn, readFileFn),
      "/Users/alice"
    );
  });

  it("falls through when dscl returns non-absolute home", () => {
    const execFileFn = ((_cmd: string, _args: readonly string[], _opts: object) =>
      "NFSHomeDirectory: \n") as typeof execFileSync;
    const readFileFn = ((_p: string, _enc: string) =>
      "alice:x:1000:1000::/Users/alice:/bin/zsh\n") as typeof readFileSync;
    assert.equal(
      lookupHomeForUserWith("alice", platform, execFileFn, readFileFn),
      "/Users/alice"
    );
  });
});

// ---------------------------------------------------------------------------
// lookupHomeForUserWith — /etc/passwd fallback
// ---------------------------------------------------------------------------

describe("lookupHomeForUserWith — /etc/passwd fallback", () => {
  const platform = "linux" as NodeJS.Platform;
  const throwExec = ((_cmd: string, _args: readonly string[], _opts: object) => {
    throw new Error("getent absent");
  }) as unknown as typeof execFileSync;

  it("finds user among multiple users", () => {
    const readFileFn = ((_p: string, _enc: string) =>
      "root:x:0:0:root:/root:/bin/bash\nalice:x:1000:1000::/home/alice:/bin/bash\nbob:x:1001:1001::/home/bob:/bin/bash\n") as typeof readFileSync;
    assert.equal(
      lookupHomeForUserWith("bob", platform, throwExec, readFileFn),
      "/home/bob"
    );
  });

  it("ignores lines with wrong username", () => {
    const readFileFn = ((_p: string, _enc: string) =>
      "alice:x:1000:1000::/home/alice:/bin/bash\nbob:x:1001:1001::/home/bob:/bin/bash\n") as typeof readFileSync;
    // looking up "alice", should not return bob's home
    assert.equal(
      lookupHomeForUserWith("alice", platform, throwExec, readFileFn),
      "/home/alice"
    );
  });

  it("ignores passwd lines with non-absolute home field", () => {
    // alice's home field is empty — should fall through to error
    const readFileFn = ((_p: string, _enc: string) =>
      "alice:x:1000:1000:::") as typeof readFileSync;
    assert.throws(
      () => lookupHomeForUserWith("alice", platform, throwExec, readFileFn),
      (err: unknown) => err instanceof UserError && err.code === "RESOLVE_FAILED"
    );
  });
});

// ---------------------------------------------------------------------------
// lookupHomeForUserWith — all methods fail
// ---------------------------------------------------------------------------

describe("lookupHomeForUserWith — all methods fail", () => {
  it("throws UserError with code RESOLVE_FAILED", () => {
    const throwExec = ((_cmd: string, _args: readonly string[], _opts: object) => {
      throw new Error("no exec");
    }) as unknown as typeof execFileSync;
    const throwRead = ((_p: string, _enc: string) => {
      throw new Error("no read");
    }) as unknown as typeof readFileSync;
    assert.throws(
      () => lookupHomeForUserWith("alice", "linux", throwExec, throwRead),
      (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.equal(err.code, "RESOLVE_FAILED");
        assert.match(err.message, /Cannot determine home directory/);
        return true;
      }
    );
  });
});
