import { z } from "zod";
import { AgentIdSchema } from "./manifest.ts";

export const RegistryEntrySchema = z.object({
  kind: z
    .enum(["skill-dir", "file-write", "config-patch"])
    .default("skill-dir"),
  source: z.string(),
  skill: z.string(),
  agent: AgentIdSchema,
  method: z.enum(["symlink", "copy"]).optional(),
  deployed: z.string(),
});

export const RegistrySchema = z.object({
  version: z.literal(1),
  deployments: z.record(z.string(), RegistryEntrySchema),
});

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type Registry = z.infer<typeof RegistrySchema>;
