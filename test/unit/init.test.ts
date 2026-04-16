import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInsideSkillDir } from "../../src/core/init.ts";

describe("isInsideSkillDir", () => {
  it("matches a file directly inside a discovered skill directory", () => {
    assert.equal(
      isInsideSkillDir("skills/alpha/guide.md", new Set(["skills/alpha"])),
      true,
    );
  });

  it("matches a file nested below a discovered skill directory", () => {
    assert.equal(
      isInsideSkillDir(
        "skills/alpha/docs/reference/guide.md",
        new Set(["skills/alpha"]),
      ),
      true,
    );
  });

  it("does not match similarly prefixed sibling paths", () => {
    assert.equal(
      isInsideSkillDir(
        "skills/alpha-helper/guide.md",
        new Set(["skills/alpha"]),
      ),
      false,
    );
  });
});
