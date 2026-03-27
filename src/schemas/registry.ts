import { z } from "zod";
import { AgentIdSchema } from "./manifest.ts";

export const RegistryEntrySchema = z.object({
  source: z.string(),
  skill: z.string(),
  agent: AgentIdSchema,
  method: z.enum(["symlink", "copy"]),
  deployed: z.string(),
});

export const RegistrySchema = z.object({
  version: z.literal(1),
  deployments: z.record(z.string(), RegistryEntrySchema),
});
