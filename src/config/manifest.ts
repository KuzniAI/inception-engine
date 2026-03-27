import { readFile } from "node:fs/promises";
import path from "node:path";
import { ManifestSchema } from "../schemas/manifest.ts";
import { UserError } from "../errors.ts";
import type { Manifest } from "../types.ts";

export async function loadManifest(directory: string): Promise<Manifest> {
  const manifestPath = path.join(directory, "inception.json");

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch {
    throw new UserError(
      "MANIFEST_INVALID",
      `No inception.json found in ${directory}. Are you pointing to the right repo?`,
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

function formatPath(segments: (string | number)[]): string {
  if (segments.length === 0) return "";
  return `${segments
    .map((seg, i) => {
      if (typeof seg === "number") return `[${seg}]`;
      return i === 0 ? seg : `.${seg}`;
    })
    .join("")} `;
}

function validateManifest(data: unknown, filePath: string): Manifest {
  const result = ManifestSchema.safeParse(data);

  if (!result.success) {
    const issue = result.error.issues[0];

    // Top-level "skills" key: missing or wrong type → uniform message
    if (issue.path.length === 1 && issue.path[0] === "skills") {
      throw new UserError(
        "MANIFEST_INVALID",
        `${filePath}: "skills" must be an array`,
      );
    }

    const prefix = formatPath(issue.path as (string | number)[]);
    throw new UserError(
      "MANIFEST_INVALID",
      `${filePath}: ${prefix}${issue.message}`,
    );
  }

  return result.data as Manifest;
}
