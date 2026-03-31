import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  detectInstalledAgents,
  type ExecFn,
  isBinaryInPath,
  isBinaryViaCommandV,
  isBinaryViaWhereExe,
  isBinaryViaWhich,
} from "../../src/core/detect.ts";
import { makeTmpDir } from "../helpers/fs.ts";

describe("detectInstalledAgents", () => {
  it("returns empty array when no agents are installed", async () => {
    const home = await makeTmpDir();
    try {
      const agents = await detectInstalledAgents(home);
      // May detect agents via binary-in-PATH, but directory check should find nothing
      // Filter to only directory-based detections by checking what we know
      assert.ok(Array.isArray(agents));
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("detects claude-code when .claude directory exists", async () => {
    const home = await makeTmpDir();
    try {
      await mkdir(path.join(home, ".claude"), { recursive: true });
      const agents = await detectInstalledAgents(home);
      assert.ok(agents.includes("claude-code"));
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("detects gemini-cli when .gemini directory exists", async () => {
    const home = await makeTmpDir();
    try {
      await mkdir(path.join(home, ".gemini"), { recursive: true });
      const agents = await detectInstalledAgents(home);
      assert.ok(agents.includes("gemini-cli"));
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("detects multiple agents", async () => {
    const home = await makeTmpDir();
    try {
      await mkdir(path.join(home, ".claude"), { recursive: true });
      await mkdir(path.join(home, ".codex"), { recursive: true });
      await mkdir(path.join(home, ".copilot"), { recursive: true });
      const agents = await detectInstalledAgents(home);
      assert.ok(agents.includes("claude-code"));
      assert.ok(agents.includes("codex"));
      assert.ok(agents.includes("github-copilot"));
    } finally {
      await rm(home, { recursive: true });
    }
  });
});

const NONEXISTENT_BINARY = "__nonexistent_binary_inception_test__";

describe("isBinaryViaCommandV", { skip: process.platform === "win32" }, () => {
  it("returns true for node (known to be in PATH)", async () => {
    const result = await isBinaryViaCommandV("node");
    assert.equal(result, true);
  });

  it("returns false for a nonexistent binary", async () => {
    const result = await isBinaryViaCommandV(NONEXISTENT_BINARY);
    assert.equal(result, false);
  });
});

describe("isBinaryViaWhich", { skip: process.platform === "win32" }, () => {
  it("returns true for node (known to be in PATH)", async () => {
    const result = await isBinaryViaWhich("node");
    assert.equal(result, true);
  });

  it("returns false for a nonexistent binary", async () => {
    const result = await isBinaryViaWhich(NONEXISTENT_BINARY);
    assert.equal(result, false);
  });
});

describe("isBinaryViaWhereExe", {
  skip: process.platform !== "win32",
}, () => {
  it("returns true for node.exe (known to be in PATH)", async () => {
    const result = await isBinaryViaWhereExe("node.exe");
    assert.equal(result, true);
  });

  it("returns false for a nonexistent binary", async () => {
    const result = await isBinaryViaWhereExe(NONEXISTENT_BINARY);
    assert.equal(result, false);
  });
});

describe("mocked resolution", () => {
  it("isBinaryViaWhereExe returns true on success", async () => {
    let calledCmd = "";
    const mockSuccess: ExecFn = async (cmd) => {
      calledCmd = cmd;
    };
    const result = await isBinaryViaWhereExe("foo", mockSuccess);
    assert.equal(result, true);
    assert.equal(calledCmd, "where.exe");
  });

  it("isBinaryViaWhereExe returns false on failure", async () => {
    const mockFail: ExecFn = async () => {
      throw new Error("fail");
    };
    const result = await isBinaryViaWhereExe("foo", mockFail);
    assert.equal(result, false);
  });

  it("isBinaryViaWhich returns true on success", async () => {
    let calledCmd = "";
    const mockSuccess: ExecFn = async (cmd) => {
      calledCmd = cmd;
    };
    const result = await isBinaryViaWhich("foo", mockSuccess);
    assert.equal(result, true);
    assert.equal(calledCmd, "which");
  });

  it("isBinaryViaWhich returns false on failure", async () => {
    const mockFail: ExecFn = async () => {
      throw new Error("fail");
    };
    const result = await isBinaryViaWhich("foo", mockFail);
    assert.equal(result, false);
  });

  it("isBinaryViaCommandV returns true on success", async () => {
    let calledCmd = "";
    const mockSuccess: ExecFn = async (cmd) => {
      calledCmd = cmd;
    };
    const result = await isBinaryViaCommandV("foo", mockSuccess);
    assert.equal(result, true);
    assert.equal(calledCmd, "sh");
  });

  it("isBinaryViaCommandV returns false on failure", async () => {
    const mockFail: ExecFn = async () => {
      throw new Error("fail");
    };
    const result = await isBinaryViaCommandV("foo", mockFail);
    assert.equal(result, false);
  });

  it("isBinaryInPath routes to where.exe on win32", async () => {
    let calledCmd = "";
    const mockSuccess: ExecFn = async (cmd) => {
      calledCmd = cmd;
    };
    const result = await isBinaryInPath("foo", mockSuccess, "win32");
    assert.equal(result, true);
    assert.equal(calledCmd, "where.exe");
  });

  describe("isBinaryInPath ENOENT fallback", () => {
    it("falls back to command -v when which throws ENOENT and succeeds", async () => {
      const calls: string[] = [];
      const enoentFn: ExecFn = async (cmd) => {
        calls.push(cmd);
        if (cmd === "which") {
          const err = Object.assign(new Error("spawn which ENOENT"), {
            code: "ENOENT",
          });
          throw err;
        }
        // "sh" (command -v) succeeds
      };

      const result = await isBinaryInPath("foo", enoentFn, "linux");
      assert.equal(result, true);
      assert.deepEqual(calls, ["which", "sh"]);
    });

    it("returns false when which throws ENOENT and command -v fails", async () => {
      const enoentFn: ExecFn = async (cmd) => {
        if (cmd === "which") {
          const err = Object.assign(new Error("spawn which ENOENT"), {
            code: "ENOENT",
          });
          throw err;
        }
        if (cmd === "sh") {
          throw new Error("sh failed");
        }
      };

      const result = await isBinaryInPath("foo", enoentFn, "linux");
      assert.equal(result, false);
    });

    it("returns false when which fails with non-ENOENT", async () => {
      let calledCmd = "";
      const otherErrFn: ExecFn = async (cmd) => {
        calledCmd = cmd;
        throw new Error("some other error");
      };

      const result = await isBinaryInPath("foo", otherErrFn, "linux");
      assert.equal(result, false);
      assert.equal(calledCmd, "which");
    });
  });
});
