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

  it("reports planned MCP support for github-copilot", () => {
    const confidence = describeCapabilityConfidence(
      "github-copilot",
      "mcpServers",
    );
    assert.match(confidence.message ?? "", /planned via/);
  });

  it("reports implementation-only confidence for gemini-cli agentDefinitions", () => {
    const confidence = describeCapabilityConfidence(
      "gemini-cli",
      "agentDefinitions",
    );
    assert.equal(confidence.confidence, "implementation-only");
    assert.match(confidence.message ?? "", /implementation-only/);
  });
});
