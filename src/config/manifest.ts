import { readFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "../errors.ts";
import { formatZodPath } from "../schemas/errors.ts";
import type { Manifest } from "../schemas/manifest.ts";
import { ManifestSchema } from "../schemas/manifest.ts";

export async function loadManifest(directory: string): Promise<Manifest> {
  const manifestPath = path.join(directory, "inception.json");

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new UserError(
        "MANIFEST_INVALID",
        `No inception.json found in ${directory}. Are you pointing to the right repo?`,
      );
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new UserError(
        "MANIFEST_INVALID",
        `Permission denied reading ${manifestPath}. Check file permissions.`,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new UserError(
      "MANIFEST_INVALID",
      `Failed to read ${manifestPath}: ${detail}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UserError("MANIFEST_INVALID", `Invalid JSON in ${manifestPath}`);
  }

  return validateManifest(parsed, manifestPath);
}

function validateManifest(data: unknown, filePath: string): Manifest {
  const result = ManifestSchema.safeParse(data);

  if (!result.success) {
    const issue = result.error.issues[0];
    const issuePath = issue.path as (string | number)[];

    // Top-level "skills" key: missing or wrong type → uniform message
    if (issuePath.length === 1 && issuePath[0] === "skills") {
      throw new UserError(
        "MANIFEST_INVALID",
        `${filePath}: "skills" must be an array`,
      );
    }

    // Top-level array fields with wrong type → uniform message
    if (
      issuePath.length === 1 &&
      (issuePath[0] === "mcpServers" ||
        issuePath[0] === "agentRules" ||
        issuePath[0] === "agentDefinitions" ||
        issuePath[0] === "permissions" ||
        issuePath[0] === "files" ||
        issuePath[0] === "configs")
    ) {
      throw new UserError(
        "MANIFEST_INVALID",
        `${filePath}: "${issuePath[0]}" must be an array`,
      );
    }

    throw new UserError(
      "MANIFEST_INVALID",
      `${filePath}: ${formatZodPath(issuePath)}${issue.message}`,
    );
  }

  return result.data;
}
