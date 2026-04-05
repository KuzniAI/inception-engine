import { z } from "zod";
import { AgentIdSchema } from "./manifest.ts";

const SkillDirRegistryEntrySchema = z.object({
  kind: z.literal("skill-dir"),
  source: z.string(),
  skill: z.string(),
  agent: AgentIdSchema,
  method: z.enum(["symlink", "copy"]).optional(),
  deployed: z.string(),
});

const FileWriteRegistryEntrySchema = z.object({
  kind: z.literal("file-write"),
  source: z.string(),
  skill: z.string(),
  agent: AgentIdSchema,
  deployed: z.string(),
});

const ConfigPatchRegistryEntrySchema = z.object({
  kind: z.literal("config-patch"),
  patch: z.record(z.string(), z.unknown()),
  undoPatch: z.record(z.string(), z.unknown()),
  skill: z.string(),
  agent: AgentIdSchema,
  deployed: z.string(),
});

const FrontmatterEmitRegistryEntrySchema = z.object({
  kind: z.literal("frontmatter-emit"),
  skill: z.string(),
  agent: AgentIdSchema,
  deployed: z.string(),
});

export const RegistryEntrySchema = z.discriminatedUnion("kind", [
  SkillDirRegistryEntrySchema,
  FileWriteRegistryEntrySchema,
  ConfigPatchRegistryEntrySchema,
  FrontmatterEmitRegistryEntrySchema,
]);

export const RegistrySchema = z.object({
  version: z.literal(1),
  deployments: z.record(z.string(), RegistryEntrySchema),
});

export type SkillDirRegistryEntry = z.infer<typeof SkillDirRegistryEntrySchema>;
export type FileWriteRegistryEntry = z.infer<
  typeof FileWriteRegistryEntrySchema
>;
export type ConfigPatchRegistryEntry = z.infer<
  typeof ConfigPatchRegistryEntrySchema
>;
export type FrontmatterEmitRegistryEntry = z.infer<
  typeof FrontmatterEmitRegistryEntrySchema
>;
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type Registry = z.infer<typeof RegistrySchema>;
