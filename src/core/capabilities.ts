import { AGENT_REGISTRY_BY_ID } from "../config/agents.ts";
import type {
  AgentId,
  AgentSurfaceSupport,
  CapabilityKind,
  Confidence,
  PlanWarning,
  SupportedAgentSurface,
} from "../types.ts";

type CapabilityScope = "global" | "repo" | "workspace";

export interface ResolvedCapabilitySurface {
  agentId: AgentId;
  capability: CapabilityKind;
  supportStatus: "supported" | "unsupported" | "planned";
  support?: SupportedAgentSurface;
  supportRecord?: AgentSurfaceSupport;
  confidence?: Confidence;
  schemaLabel: string;
  surfaceKind: "agent-specific" | "native" | "shared-via";
  sharedVia?: AgentId;
  requiresPrimary: boolean;
  canDeployDirectlyWhenPrimaryAbsent: boolean;
  includeInInitByDefault: boolean;
  reason?: string;
  plannedSurface?: string;
}

export type DeployCapabilityPlan =
  | {
      outcome: "action";
      confidence?: Confidence;
      support?: SupportedAgentSurface;
    }
  | {
      outcome: "redundant";
      confidence?: Confidence;
      support?: SupportedAgentSurface;
      sharedVia: AgentId;
    }
  | {
      outcome: "warn";
      warning: PlanWarning;
    }
  | {
      outcome: "native";
    };

function resolveAgentRulesSupport(
  agentId: AgentId,
  scope: CapabilityScope,
): AgentSurfaceSupport | undefined {
  const agent = AGENT_REGISTRY_BY_ID[agentId];
  if (scope === "repo") {
    return agent?.agentRulesRepoSupport ?? agent?.agentRulesSupport;
  }
  if (scope === "workspace") {
    return (
      agent?.agentRulesWorkspaceSupport ??
      agent?.agentRulesRepoSupport ??
      agent?.agentRulesSupport
    );
  }
  return agent?.agentRulesSupport;
}

function capabilityLabel(capability: CapabilityKind): string {
  switch (capability) {
    case "skills":
      return "skills";
    case "mcpServers":
      return "mcpServers";
    case "agentRules":
      return "agentRules";
    case "permissions":
      return "permissions";
    case "agentDefinitions":
      return "agentDefinitions";
  }
}

function capabilitySurfaceLabel(capability: CapabilityKind): string {
  switch (capability) {
    case "skills":
      return "skill";
    case "mcpServers":
      return "MCP";
    case "agentRules":
      return "rules";
    case "permissions":
      return "permissions";
    case "agentDefinitions":
      return "agent-definitions";
  }
}

function resolveSkillsCapability(agentId: AgentId): ResolvedCapabilitySurface {
  const agent = AGENT_REGISTRY_BY_ID[agentId];
  if (agent.skills) {
    return {
      agentId,
      capability: "skills",
      supportStatus: "supported",
      confidence: agent.provenance.skills ?? "provisional",
      schemaLabel: "dedicated skill directory",
      surfaceKind: "agent-specific",
      requiresPrimary: false,
      canDeployDirectlyWhenPrimaryAbsent: true,
      includeInInitByDefault: true,
    };
  }

  const via = agent.skillsSurfaceKind?.via;
  return {
    agentId,
    capability: "skills",
    supportStatus: "supported",
    confidence: agent.provenance.skills,
    schemaLabel: "shared native skill directory",
    surfaceKind:
      agent.skillsSurfaceKind?.kind === "shared-via" ? "shared-via" : "native",
    sharedVia: via,
    requiresPrimary: true,
    canDeployDirectlyWhenPrimaryAbsent: false,
    includeInInitByDefault: false,
  };
}

function getSurfaceRecordAndConfidence(
  agentId: AgentId,
  capability: Exclude<CapabilityKind, "skills">,
  scope: CapabilityScope,
): {
  supportRecord: AgentSurfaceSupport | undefined;
  confidence?: Confidence;
} {
  const agent = AGENT_REGISTRY_BY_ID[agentId];
  if (capability === "mcpServers") {
    return {
      supportRecord: agent.mcpSupport,
      confidence: agent.provenance.mcpConfig,
    };
  }
  if (capability === "agentRules") {
    return {
      supportRecord: resolveAgentRulesSupport(agentId, scope),
      confidence: agent.provenance.agentRules,
    };
  }
  if (capability === "permissions") {
    return {
      supportRecord: agent.permissionsSupport,
      confidence: agent.provenance.permissions,
    };
  }
  return {
    supportRecord: agent.agentDefinitionsSupport,
    confidence: agent.provenance.agentDefinitions,
  };
}

function resolveUnsupportedSurface(
  agentId: AgentId,
  capability: Exclude<CapabilityKind, "skills">,
  supportRecord: AgentSurfaceSupport | undefined,
  confidence?: Confidence,
): ResolvedCapabilitySurface {
  return {
    agentId,
    capability,
    supportStatus: "unsupported",
    supportRecord,
    confidence,
    schemaLabel: supportRecord?.schemaLabel ?? "an unsupported surface",
    surfaceKind: "agent-specific",
    requiresPrimary: false,
    canDeployDirectlyWhenPrimaryAbsent: false,
    includeInInitByDefault: false,
    reason:
      supportRecord?.status === "unsupported"
        ? supportRecord.reason
        : undefined,
  };
}

function resolvePlannedSurface(
  agentId: AgentId,
  capability: Exclude<CapabilityKind, "skills">,
  supportRecord: Extract<AgentSurfaceSupport, { status: "planned" }>,
  confidence?: Confidence,
): ResolvedCapabilitySurface {
  return {
    agentId,
    capability,
    supportStatus: "planned",
    supportRecord,
    confidence,
    schemaLabel: supportRecord.schemaLabel,
    surfaceKind: "agent-specific",
    requiresPrimary: false,
    canDeployDirectlyWhenPrimaryAbsent: false,
    includeInInitByDefault: false,
    reason: supportRecord.reason,
    plannedSurface: supportRecord.plannedSurface,
  };
}

function resolveSupportedSurface(
  agentId: AgentId,
  capability: Exclude<CapabilityKind, "skills">,
  supportRecord: SupportedAgentSurface,
  confidence?: Confidence,
): ResolvedCapabilitySurface {
  const surfaceKind = supportRecord.surfaceKind?.kind ?? "agent-specific";
  const sharedVia =
    supportRecord.surfaceKind?.kind === "shared-via"
      ? supportRecord.surfaceKind.via
      : undefined;
  const requiresPrimary =
    supportRecord.surfaceKind?.kind === "shared-via" &&
    supportRecord.surfaceKind.requiresPrimary === true;

  return {
    agentId,
    capability,
    supportStatus: "supported",
    support: supportRecord,
    supportRecord,
    confidence: confidence ?? "provisional",
    schemaLabel: supportRecord.schemaLabel,
    surfaceKind,
    sharedVia,
    requiresPrimary,
    canDeployDirectlyWhenPrimaryAbsent:
      surfaceKind !== "shared-via" || !requiresPrimary,
    includeInInitByDefault: surfaceKind === "agent-specific",
  };
}

export function resolveCapabilitySurface(
  agentId: AgentId,
  capability: CapabilityKind,
  scope: CapabilityScope = "global",
): ResolvedCapabilitySurface {
  if (capability === "skills") return resolveSkillsCapability(agentId);

  const { supportRecord, confidence } = getSurfaceRecordAndConfidence(
    agentId,
    capability,
    scope,
  );
  if (!supportRecord || supportRecord.status === "unsupported") {
    return resolveUnsupportedSurface(
      agentId,
      capability,
      supportRecord,
      confidence,
    );
  }
  if (supportRecord.status === "planned") {
    return resolvePlannedSurface(
      agentId,
      capability,
      supportRecord,
      confidence,
    );
  }
  return resolveSupportedSurface(
    agentId,
    capability,
    supportRecord,
    confidence,
  );
}

function createSurfaceWarning(
  surface: ResolvedCapabilitySurface,
  entryName: string,
): PlanWarning {
  const label = capabilityLabel(surface.capability);

  if (surface.supportStatus === "unsupported") {
    return {
      kind: "confidence",
      message: `${label}: agent "${surface.agentId}" uses ${surface.schemaLabel} (unsupported) and ${surface.reason ?? "does not expose a supported adapter"} — skipping "${entryName}"`,
    };
  }

  if (surface.supportStatus === "planned") {
    return {
      kind: "confidence",
      message: `${label}: agent "${surface.agentId}" ${capabilitySurfaceLabel(surface.capability)} support is planned via ${surface.plannedSurface} — skipping "${entryName}" until that surface is implemented`,
    };
  }

  if (surface.surfaceKind === "shared-via" && surface.sharedVia) {
    return {
      kind: "confidence",
      message: `${label}: agent "${surface.agentId}" reads this surface via "${surface.sharedVia}" — add "${surface.sharedVia}" to the entry's agents list to deploy to this surface, or deploy via the "${surface.sharedVia}" ${label} target instead`,
    };
  }

  return {
    kind: "confidence",
    message: `${label}: agent "${surface.agentId}" does not expose a directly deployable surface — skipping "${entryName}"`,
  };
}

export function planCapabilityForDeploy(opts: {
  agentId: AgentId;
  capability: CapabilityKind;
  entryName: string;
  targetAgentIds: AgentId[];
  scope?: CapabilityScope;
}): DeployCapabilityPlan {
  const surface = resolveCapabilitySurface(
    opts.agentId,
    opts.capability,
    opts.scope,
  );

  if (surface.supportStatus !== "supported") {
    return {
      outcome: "warn",
      warning: createSurfaceWarning(surface, opts.entryName),
    };
  }

  if (surface.surfaceKind === "native") {
    return { outcome: "native" };
  }

  if (surface.surfaceKind === "shared-via" && surface.sharedVia) {
    if (opts.targetAgentIds.includes(surface.sharedVia)) {
      return {
        outcome: "redundant",
        confidence: surface.confidence,
        support: surface.support,
        sharedVia: surface.sharedVia,
      };
    }
    if (!surface.canDeployDirectlyWhenPrimaryAbsent) {
      return {
        outcome: "warn",
        warning: createSurfaceWarning(surface, opts.entryName),
      };
    }
  }

  return {
    outcome: "action",
    confidence: surface.confidence,
    support: surface.support,
  };
}

export function shouldInitIncludeAgent(
  agentId: AgentId,
  capability: CapabilityKind,
  scope: CapabilityScope = "global",
): boolean {
  return resolveCapabilitySurface(agentId, capability, scope)
    .includeInInitByDefault;
}

export function describeCapabilityConfidence(
  agentId: AgentId,
  capability: CapabilityKind,
  scope: CapabilityScope = "global",
): {
  confidence?: Confidence;
  message: string | null;
} {
  const surface = resolveCapabilitySurface(agentId, capability, scope);

  if (surface.supportStatus === "planned") {
    return {
      confidence: surface.confidence,
      message: `Agent "${agentId}" ${capabilitySurfaceLabel(capability)} support remains planned via ${surface.plannedSurface}.`,
    };
  }

  if (surface.supportStatus === "unsupported") {
    return {
      confidence: surface.confidence,
      message: `Agent "${agentId}" ${capabilitySurfaceLabel(capability)} surface is unsupported: ${surface.reason ?? surface.schemaLabel}.`,
    };
  }

  if (surface.surfaceKind === "shared-via" && surface.sharedVia) {
    return {
      confidence: surface.confidence,
      message: `Agent "${agentId}" ${capabilitySurfaceLabel(capability)} surface is shared through "${surface.sharedVia}"${surface.requiresPrimary ? " and requires the primary target to deploy" : ""}.`,
    };
  }

  if (surface.confidence === "implementation-only") {
    return {
      confidence: surface.confidence,
      message: `Agent "${agentId}" ${capabilitySurfaceLabel(capability)} support is implementation-only: behavior is based on registry inspection and local validation, not published documentation.`,
    };
  }

  if (surface.confidence === "provisional") {
    return {
      confidence: surface.confidence,
      message: `Agent "${agentId}" ${capabilitySurfaceLabel(capability)} support is provisional: behavior has not been independently verified.`,
    };
  }

  return { confidence: surface.confidence, message: null };
}
