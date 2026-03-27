import nodePath from "node:path";
import { z } from "zod";
import type { AgentId } from "../types.ts";
import { AGENT_IDS } from "../types.ts";

const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const AgentIdSchema = z
  .string()
  .superRefine((v, ctx) => {
    if (!(AGENT_IDS as readonly string[]).includes(v)) {
      ctx.addIssue({
        code: "custom",
        message: `unknown agent "${v}". Valid agents: ${AGENT_IDS.join(", ")}`,
      });
    }
  })
  .transform((v) => v as AgentId);

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
    .array(AgentIdSchema, { message: "agents must be a non-empty array" })
    .min(1, { message: "agents must be a non-empty array" }),
});

export const ManifestSchema = z.object({
  skills: z.array(SkillEntrySchema),
  mcpServers: z.array(z.unknown()).catch([]),
  agentRules: z.array(z.unknown()).catch([]),
});
