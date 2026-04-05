import nodePath from "node:path";
import { z } from "zod";

const AGENT_IDS = [
  "claude-code",
  "codex",
  "gemini-cli",
  "antigravity",
  "opencode",
  "github-copilot",
] as const;

export { AGENT_IDS };

const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

// Target templates must be rooted at a known placeholder and may only add
// descendant path segments beneath that root. e.g. "{home}/.claude/settings.json"
// is valid, while "{home}/../.ssh/config" is rejected.
// {repo} resolves to the manifest directory at deploy time, enabling repo-local
// targets (e.g. Antigravity's .agents/rules/ surface).
const TARGET_TEMPLATE_RE =
  /^\{(home|appdata|xdg_config|repo|workspace)\}(?:[\\/].*)?$/;

// Standalone schema used for type derivation and single-ID validation (e.g. index.ts).
export const AgentIdSchema = z.enum(AGENT_IDS);
export type AgentId = z.output<typeof AgentIdSchema>;

// Used inside SkillEntrySchema.agents so that enum failures embed the received
// value in the message (Zod 4's invalid_value issue omits the received value).
// The .pipe(AgentIdSchema) at the end provides the AgentId output type.
const agentIdElement = z
  .string()
  .superRefine((v, ctx) => {
    if (!(AGENT_IDS as readonly string[]).includes(v)) {
      ctx.addIssue({
        code: "custom",
        message: `unknown agent "${v}". Valid agents: ${AGENT_IDS.join(", ")}`,
      });
    }
  })
  .pipe(AgentIdSchema);

const nameField = z
  .string({ message: "name must be a non-empty string" })
  .min(1, { message: "name must be a non-empty string" })
  .regex(SAFE_NAME_RE, {
    message:
      "name must contain only letters, digits, hyphens, underscores, and dots, and must not start with a dot",
  });

const agentsField = z
  .array(agentIdElement, { message: "agents must be a non-empty array" })
  .min(1, { message: "agents must be a non-empty array" })
  .transform((arr) => [...new Set(arr)]);

const sourcePathField = z
  .string({ message: "path must be a non-empty string" })
  .min(1, { message: "path must be a non-empty string" })
  .refine((p) => !nodePath.isAbsolute(p), {
    message: "path must be a relative path",
  })
  .refine((p) => !nodePath.normalize(p).startsWith(".."), {
    message: "path must not escape the repository root",
  });

const targetTemplateField = z
  .string({ message: "target must be a non-empty string" })
  .min(1, { message: "target must be a non-empty string" })
  .refine((t) => TARGET_TEMPLATE_RE.test(t), {
    message:
      "target must start with a known placeholder: {home}, {appdata}, {xdg_config}, or {repo}",
  })
  .refine((t) => !t.split(/[\\/]+/).includes(".."), {
    message: "target must not escape its placeholder root",
  });

export const SkillEntrySchema = z.object({
  name: nameField,
  path: sourcePathField,
  agents: agentsField,
});

export const FileEntrySchema = z.object({
  name: nameField,
  path: sourcePathField,
  target: targetTemplateField,
  agents: agentsField,
});

export const ConfigEntrySchema = z.object({
  name: nameField,
  target: targetTemplateField,
  patch: z.record(z.string(), z.unknown()),
  agents: agentsField,
});

export const McpServerEntrySchema = z.object({
  name: nameField,
  agents: agentsField,
  // Raw server descriptor passed verbatim to each agent adapter.
  // Adapters are responsible for validating the shape they need.
  config: z.record(z.string(), z.unknown()),
});

export const AgentRuleEntrySchema = z.object({
  name: nameField,
  agents: agentsField,
  // Relative path to the rules/instruction file within the source bundle.
  // Must be a .md or .markdown file. Structural requirements (e.g. YAML
  // frontmatter) are validated per agent requirements by the adapter.
  path: sourcePathField,
  // Deployment scope: "global" targets the agent's home-directory instruction
  // file (default), "repo" targets the project-root instruction file within the
  // deployed repository (e.g. {repo}/CLAUDE.md for claude-code), and "workspace"
  // targets the agent's workspace-local instruction surface.
  scope: z.enum(["global", "repo", "workspace"]).default("global"),
});

export const PermissionsEntrySchema = z.object({
  name: nameField,
  agents: agentsField,
  // Raw permission config payload validated per agent by the permissions adapter.
  // For claude-code: { permissions: { allow?: string[], deny?: string[] } }
  // For codex: { approval_policy?: "auto" | "manual" | "suggest" | "on-failure" }
  config: z.record(z.string(), z.unknown()),
});

export const AgentDefinitionEntrySchema = z.object({
  name: nameField,
  agents: agentsField,
  // Relative path to the agent definition Markdown file within the source bundle.
  // Must be a .md or .markdown file. Structural requirements (e.g. YAML
  // frontmatter) are validated per agent requirements by the adapter.
  path: sourcePathField,
});

export const ManifestSchema = z.object({
  skills: z.array(SkillEntrySchema).superRefine((skills, ctx) => {
    const seen = new Set<string>();
    for (const [i, skill] of skills.entries()) {
      if (seen.has(skill.name)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "name"],
          message: `duplicate skill name "${skill.name}"`,
        });
      }
      seen.add(skill.name);
    }
  }),
  files: z.array(FileEntrySchema).default([]),
  configs: z.array(ConfigEntrySchema).default([]),
  mcpServers: z.array(McpServerEntrySchema).default([]),
  agentRules: z.array(AgentRuleEntrySchema).default([]),
  permissions: z.array(PermissionsEntrySchema).default([]),
  agentDefinitions: z.array(AgentDefinitionEntrySchema).default([]),
});

export type SkillEntry = z.infer<typeof SkillEntrySchema>;
export type FileEntry = z.infer<typeof FileEntrySchema>;
export type ConfigEntry = z.infer<typeof ConfigEntrySchema>;
export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;
export type AgentRuleEntry = z.infer<typeof AgentRuleEntrySchema>;
export type PermissionsEntry = z.infer<typeof PermissionsEntrySchema>;
export type AgentDefinitionEntry = z.infer<typeof AgentDefinitionEntrySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

// Parses the --agents CLI flag: comma-separated agent IDs → AgentId[]
export const AgentListSchema = z
  .string()
  .transform((s) => s.split(",").map((id) => id.trim()))
  .pipe(
    z.array(agentIdElement).min(1, { message: "agent list must not be empty" }),
  );
