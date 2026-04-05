import { z } from "zod";
import { AgentIdSchema } from "./manifest.ts";

const RegistryOwnershipMetadataSchema = z.object({
  surfaceId: z.string().optional(),
  migratedFrom: z.array(z.string()).optional(),
});

const SkillDirRegistryEntrySchema = RegistryOwnershipMetadataSchema.extend({
  kind: z.literal("skill-dir"),
  source: z.string(),
  skill: z.string(),
  agent: AgentIdSchema,
  method: z.enum(["symlink", "copy"]).optional(),
  deployed: z.string(),
});

const FileWriteRegistryEntrySchema = RegistryOwnershipMetadataSchema.extend({
  kind: z.literal("file-write"),
  source: z.string(),
  skill: z.string(),
  agent: AgentIdSchema,
  deployed: z.string(),
});

const ConfigPatchRegistryEntrySchema = RegistryOwnershipMetadataSchema.extend({
  kind: z.literal("config-patch"),
  patch: z.record(z.string(), z.unknown()),
  undoPatch: z.record(z.string(), z.unknown()),
  skill: z.string(),
  agent: AgentIdSchema,
  deployed: z.string(),
});

const FrontmatterEmitRegistryEntrySchema =
  RegistryOwnershipMetadataSchema.extend({
    kind: z.literal("frontmatter-emit"),
    patch: z.record(z.string(), z.unknown()).optional(),
    undoPatch: z.record(z.string(), z.unknown()).optional(),
    created: z.boolean().optional(),
    hadFrontmatter: z.boolean().optional(),
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
