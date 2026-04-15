import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { formatDryRunPlan } from "../../src/formatters.ts";
import type { PlannedChange } from "../../src/types.ts";

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value);
}

describe("formatDryRunPlan", () => {
  it("returns an empty string when there are no planned changes", () => {
    assert.equal(formatDryRunPlan([]), "");
  });

  it("groups changes by agent, sorts groups, and renders supported detail fields", () => {
    const plan: PlannedChange[] = [
      {
        agent: "opencode",
        kind: "config-patch",
        skill: "beta",
        target: "/targets/opencode.json",
        verb: "patch-config",
        patch: { enabled: true },
      },
      {
        agent: "claude-code",
        kind: "file-write",
        skill: "alpha",
        source: "/source/alpha.md",
        target: "/targets/alpha.md",
        verb: "write-file",
      },
      {
        agent: "claude-code",
        kind: "config-patch",
        skill: "gamma",
        target: "/targets/gamma.json",
        verb: "unapply-patch",
        patch: { enabled: null },
      },
      {
        agent: "claude-code",
        kind: "toml-patch",
        skill: "delta",
        target: "/targets/delta.toml",
        verb: "patch-toml",
        patch: { approval_policy: "suggest" },
      },
      {
        agent: "claude-code",
        kind: "frontmatter-emit",
        skill: "epsilon",
        target: "/targets/epsilon.md",
        verb: "emit-frontmatter",
        frontmatter: { tools: ["github"] },
      },
      {
        agent: "claude-code",
        kind: "file-write",
        skill: "zeta",
        target: "/targets/zeta.md",
        verb: "remove",
      },
    ];

    const output = stripAnsi(formatDryRunPlan(plan));

    assert.match(
      output,
      /^claude-code\n(?:[\s\S]*?)\nopencode\n/m,
      `expected claude-code group before opencode, got:\n${output}`,
    );
    assert.match(output, /write-file alpha/);
    assert.match(output, /source: \/source\/alpha\.md/);
    assert.match(output, /target: \/targets\/alpha\.md/);
    assert.match(output, /undo:\s+\{"enabled":null\}/);
    assert.match(output, /patch:\s+\{"approval_policy":"suggest"\}/);
    assert.match(output, /frontmatter: \{"tools":\["github"\]\}/);
    assert.match(output, /remove zeta/);
    assert.doesNotMatch(output, /source: \/targets\/zeta\.md/);
    assert.match(output, /patch-config beta/);
  });
});
