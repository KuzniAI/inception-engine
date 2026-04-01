import { createRequire } from "node:module";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const _require = createRequire(import.meta.url);
// front-matter is a CommonJS module whose export is the callable parse function.
const parseFrontmatter = _require("front-matter") as <T>(input: string) => {
  attributes: T;
  body: string;
};

// ---------------------------------------------------------------------------
// Hand-rolled flat-YAML serializer
// Handles the shapes found in MCP server descriptors: strings, numbers,
// booleans, string arrays, and one-level nested objects (e.g. "env").
// ---------------------------------------------------------------------------

function serializeScalar(value: string | number | boolean): string {
  if (typeof value === "string") {
    const needsQuotes = /[:#[\]{},|>&*!'"@`]|^\s|\s$/.test(value);
    return needsQuotes
      ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
      : value;
  }
  return String(value);
}

function serializeArray(key: string, arr: unknown[], pad: string): string {
  if (arr.length === 0) return `${pad}${key}: []`;
  const items = arr.map((item) => {
    const scalar =
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
        ? serializeScalar(item as string | number | boolean)
        : JSON.stringify(item);
    return `${pad}  - ${scalar}`;
  });
  return [`${pad}${key}:`, ...items].join("\n");
}

function serializeObject(
  key: string,
  obj: Record<string, unknown>,
  pad: string,
): string {
  const inner = serializeFrontmatterAtDepth(obj, `${pad}  `);
  return inner ? `${pad}${key}:\n${inner}` : `${pad}${key}: {}`;
}

function serializeFrontmatterAtDepth(
  data: Record<string, unknown>,
  pad: string,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(serializeArray(key, value, pad));
    } else if (typeof value === "object") {
      lines.push(serializeObject(key, value as Record<string, unknown>, pad));
    } else {
      lines.push(
        `${pad}${key}: ${serializeScalar(value as string | number | boolean)}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Serializes a flat (one-level) object to a YAML block suitable for use inside
 * `---` frontmatter delimiters.
 */
export function serializeFrontmatter(data: Record<string, unknown>): string {
  return serializeFrontmatterAtDepth(data, "");
}

/**
 * Builds the full content of a frontmatter-bearing Markdown file.
 * If `body` is provided it is appended after the closing delimiter.
 */
export function buildFrontmatterDocument(
  frontmatter: Record<string, unknown>,
  body = "",
): string {
  const serialized = serializeFrontmatter(frontmatter);
  return `---\n${serialized}\n---\n${body}`;
}

function createAtomicTempPath(targetPath: string): string {
  return `${targetPath}.inception-tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

/**
 * Reads an existing `.md` file and parses its frontmatter (using the
 * `front-matter` package). Returns the parsed attributes and raw body.
 * Returns `{ attributes: {}, body: "" }` if the file does not exist.
 */
export async function readFrontmatterFile(filePath: string): Promise<{
  attributes: Record<string, unknown>;
  body: string;
}> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { attributes: {}, body: "" };
    throw err;
  }
  const parsed = parseFrontmatter<Record<string, unknown>>(raw);
  return { attributes: parsed.attributes, body: parsed.body };
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
  const tempPath = createAtomicTempPath(filePath);
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(tempPath, content, "utf-8");
    await rename(tempPath, filePath);
  } catch (err) {
    try {
      await rm(tempPath, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}
