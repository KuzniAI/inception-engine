import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeCapabilityConfidence,
  planCapabilityForDeploy,
  shouldInitIncludeAgent,
} from "../../src/core/capabilities.ts";

describe("capabilities planner", () => {
  it("treats antigravity agentRules as deployable but not init-default", () => {
    const plan = planCapabilityForDeploy({
      agentId: "antigravity",
      capability: "agentRules",
      entryName: "shared-rules",
      targetAgentIds: ["antigravity"],
      scope: "global",
    });
    assert.equal(plan.outcome, "action");
    assert.equal(shouldInitIncludeAgent("antigravity", "agentRules"), false);
  });

  it("treats github-copilot skills as shared-through claude-code", () => {
    const plan = planCapabilityForDeploy({
      agentId: "github-copilot",
      capability: "skills",
      entryName: "my-skill",
      targetAgentIds: ["github-copilot"],
    });
    assert.equal(plan.outcome, "warn");
    if (plan.outcome !== "warn") return;
    assert.match(plan.warning.message, /via "claude-code"/);
    assert.equal(shouldInitIncludeAgent("github-copilot", "skills"), false);
  });

  it("marks github-copilot rules redundant when claude-code is also targeted", () => {
    const plan = planCapabilityForDeploy({
      agentId: "github-copilot",
      capability: "agentRules",
      entryName: "shared-rules",
      targetAgentIds: ["claude-code", "github-copilot"],
      scope: "global",
    });
    assert.equal(plan.outcome, "redundant");
  });

  it("reports unsupported for github-copilot MCP with global scope (no user-level config)", () => {
    const confidence = describeCapabilityConfidence(
      "github-copilot",
      "mcpServers",
      "global",
    );
    assert.match(confidence.message ?? "", /unsupported/);
  });

  it("reports supported for github-copilot MCP with scope: repo", () => {
    const plan = planCapabilityForDeploy({
      agentId: "github-copilot",
      capability: "mcpServers",
      entryName: "my-mcp",
      targetAgentIds: ["github-copilot"],
      scope: "repo",
    });
    assert.equal(plan.outcome, "action");
    if (plan.outcome !== "action") return;
    assert.equal(plan.confidence, "documented");
  });

  it("reports supported for github-copilot MCP with scope: workspace", () => {
    const plan = planCapabilityForDeploy({
      agentId: "github-copilot",
      capability: "mcpServers",
      entryName: "my-mcp",
      targetAgentIds: ["github-copilot"],
      scope: "workspace",
    });
    assert.equal(plan.outcome, "action");
  });

  it("reports documented confidence for gemini-cli agentDefinitions (surface is now fully documented)", () => {
    const confidence = describeCapabilityConfidence(
      "gemini-cli",
      "agentDefinitions",
    );
    assert.equal(confidence.confidence, "documented");
    assert.equal(confidence.message, null);
  });
});
