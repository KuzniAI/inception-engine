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

export const SkillEntrySchema = z.object({
  name: z
    .string({ message: "name must be a non-empty string" })
    .min(1, { message: "name must be a non-empty string" })
    .regex(SAFE_NAME_RE, {
      message:
        "name must contain only letters, digits, hyphens, underscores, and dots, and must not start with a dot",
    }),
  path: z
    .string({ message: "path must be a non-empty string" })
    .min(1, { message: "path must be a non-empty string" })
    .refine((p) => !nodePath.isAbsolute(p), {
      message: "path must be a relative path",
    })
    .refine((p) => !nodePath.normalize(p).startsWith(".."), {
      message: "path must not escape the repository root",
    }),
  agents: z
    .array(agentIdElement, { message: "agents must be a non-empty array" })
    .min(1, { message: "agents must be a non-empty array" }),
});

export const ManifestSchema = z.object({
  skills: z.array(SkillEntrySchema),
  mcpServers: z.array(z.unknown()).catch([]),
  agentRules: z.array(z.unknown()).catch([]),
});

export type SkillEntry = z.infer<typeof SkillEntrySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

// Parses the --agents CLI flag: comma-separated agent IDs → AgentId[]
export const AgentListSchema = z
  .string()
  .transform((s) => s.split(",").map((id) => id.trim()))
  .pipe(
    z.array(agentIdElement).min(1, { message: "agent list must not be empty" }),
  );
