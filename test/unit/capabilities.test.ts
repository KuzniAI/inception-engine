import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeCapabilityConfidence,
  planCapabilityForDeploy,
  resolveCapabilitySurface,
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

  it("treats antigravity agentRules as shared-via gemini-cli but directly deployable when the primary is absent", () => {
    const plan = planCapabilityForDeploy({
      agentId: "antigravity",
      capability: "agentRules",
      entryName: "gemini-compatible-rules",
      targetAgentIds: ["antigravity"],
      scope: "repo",
    });
    assert.equal(plan.outcome, "action");

    const confidence = describeCapabilityConfidence(
      "antigravity",
      "agentRules",
      "repo",
    );
    assert.match(confidence.message ?? "", /shared through "gemini-cli"/);
    assert.doesNotMatch(
      confidence.message ?? "",
      /requires the primary target to deploy/,
    );
  });

  it("marks gemini-cli hooks as planned and excludes them from init defaults", () => {
    const surface = resolveCapabilitySurface("gemini-cli", "hooks");
    assert.equal(surface.supportStatus, "planned");
    assert.equal(surface.plannedSurface, "settings.json hooks field");

    const plan = planCapabilityForDeploy({
      agentId: "gemini-cli",
      capability: "hooks",
      entryName: "future-hooks",
      targetAgentIds: ["gemini-cli"],
    });
    assert.equal(plan.outcome, "warn");
    if (plan.outcome !== "warn") return;
    assert.match(
      plan.warning.message,
      /planned via settings\.json hooks field/,
    );
    assert.equal(shouldInitIncludeAgent("gemini-cli", "hooks"), false);
  });

  it("reports unsupported confidence for codex hooks and opencode workspace rules", () => {
    const codexHooks = describeCapabilityConfidence("codex", "hooks");
    assert.match(codexHooks.message ?? "", /hooks surface is unsupported/);

    const workspaceRules = describeCapabilityConfidence(
      "opencode",
      "agentRules",
      "workspace",
    );
    assert.match(
      workspaceRules.message ?? "",
      /workspace-local instruction surface distinct from repo-local AGENTS\.md/,
    );
  });

  it("resolves executionConfigs support records for supported and unsupported agents", () => {
    const gemini = resolveCapabilitySurface("gemini-cli", "executionConfigs");
    assert.equal(gemini.supportStatus, "supported");
    assert.equal(gemini.schemaLabel, "Settings execution config");

    const claude = resolveCapabilitySurface("claude-code", "executionConfigs");
    assert.equal(claude.supportStatus, "unsupported");
    assert.equal(claude.schemaLabel, "an unsupported surface");
  });
});
