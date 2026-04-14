import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { writeFileAtomic } from "../atomic-write.ts";

/**
 * Splits a Markdown string into YAML frontmatter and the remaining body.
 * Expects the file to start with --- delimiter.
 */
export function splitFrontmatter(raw: string): {
  frontmatter: string;
  body: string;
} {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: "", body: raw };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );

  if (closingIndex === -1) {
    return { frontmatter: "", body: raw };
  }

  // Preserve the actual lines for the body to avoid normalizing line endings if not needed
  // but for frontmatter block, we join with \n for the YAML parser
  const frontmatter = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");

  return { frontmatter, body };
}

/**
 * Parses a Markdown string with YAML frontmatter.
 */
export function parseFrontmatterDocument<T = Record<string, unknown>>(
  raw: string,
): {
  attributes: T;
  body: string;
  hasFrontmatter: boolean;
} {
  const { frontmatter, body } = splitFrontmatter(raw);
  if (!(frontmatter || raw.startsWith("---"))) {
    return { attributes: {} as T, body, hasFrontmatter: false };
  }
  const attributes = YAML.parse(frontmatter) as T;
  return { attributes: (attributes || {}) as T, body, hasFrontmatter: true };
}

/**
 * Serializes an object to a YAML block.
 */
export function serializeFrontmatter(data: Record<string, unknown>): string {
  // Using a consistent indentation that matches standard YAML
  return YAML.stringify(data, { indent: 2 }).trim();
}

/**
 * Builds the full content of a frontmatter-bearing Markdown file.
 */
export function buildFrontmatterDocument(
  frontmatter: Record<string, unknown>,
  body = "",
): string {
  return buildMarkdownDocument(frontmatter, body, { hasFrontmatter: true });
}

export function buildMarkdownDocument(
  frontmatter: Record<string, unknown>,
  body = "",
  options: { hasFrontmatter?: boolean } = {},
): string {
  const cleanBody = body.trimStart();
  if (Object.keys(frontmatter).length === 0 && !options.hasFrontmatter) {
    return cleanBody;
  }
  const serialized = serializeFrontmatter(frontmatter);
  // Ensure exactly one newline after the closing delimiter before the body
  const separator = cleanBody ? "\n\n" : "\n";
  return `---\n${serialized}\n---\n${separator}${cleanBody}`;
}

/**
 * Reads an existing `.md` file and parses its frontmatter.
 * Returns `{ attributes: {}, body: "" }` if the file does not exist.
 */
export async function readFrontmatterFile(filePath: string): Promise<{
  attributes: Record<string, unknown>;
  body: string;
}> {
  const document = await readFrontmatterDocumentFile(filePath);
  return { attributes: document.attributes, body: document.body };
}

export async function readFrontmatterDocumentFile(filePath: string): Promise<{
  exists: boolean;
  hasFrontmatter: boolean;
  attributes: Record<string, unknown>;
  body: string;
}> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        exists: false,
        hasFrontmatter: false,
        attributes: {},
        body: "",
      };
    }
    throw err;
  }
  const parsed = parseFrontmatterDocument(raw);
  return { exists: true, ...parsed };
}

/**
 * Atomically writes a Markdown file with the given frontmatter and optional
 * body. Preserves any existing body content when `preserveBody` is true.
 */
export async function writeFrontmatterFile(
  filePath: string,
  frontmatter: Record<string, unknown>,
  options: { preserveBody?: boolean } = {},
): Promise<void> {
  let body = "";
  if (options.preserveBody) {
    const existing = await readFrontmatterFile(filePath);
    body = existing.body;
  }
  const content = buildFrontmatterDocument(frontmatter, body);
  await writeFileAtomic(filePath, content);
}
