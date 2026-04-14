import { readFile } from "node:fs/promises";
import { parse, stringify } from "smol-toml";
import { writeFileAtomic } from "../atomic-write.ts";

/**
 * Reads and parses a TOML file. Returns an empty object if the file does not
 * exist (treat a missing config.toml as an empty config).
 */
export async function readTomlConfig(
  filePath: string,
): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw err;
  }
  const parsed = parse(raw);
  return parsed as Record<string, unknown>;
}

async function writeTomlConfigAtomic(
  filePath: string,
  obj: Record<string, unknown>,
): Promise<void> {
  await writeFileAtomic(filePath, stringify(obj));
}

/**
 * Merges a named MCP server entry into `config.toml`'s `[mcpServers]` table.
 * Returns the undo record (the previous value under that key, or null if it
 * was absent) so revert can restore the exact prior state.
 */
export async function applyTomlMcpPatch(
  filePath: string,
  name: string,
  config: Record<string, unknown>,
): Promise<{ previousValue: unknown | null }> {
  const current = await readTomlConfig(filePath);

  const mcpServers =
    typeof current.mcpServers === "object" &&
    current.mcpServers !== null &&
    !Array.isArray(current.mcpServers)
      ? (current.mcpServers as Record<string, unknown>)
      : {};

  const previousValue = Object.hasOwn(mcpServers, name)
    ? mcpServers[name]
    : null;

  const patched: Record<string, unknown> = {
    ...current,
    mcpServers: { ...mcpServers, [name]: config },
  };

  await writeTomlConfigAtomic(filePath, patched);
  return { previousValue };
}

/**
 * Removes a named MCP server entry from `config.toml`'s `[mcpServers]` table.
 * If the entry is absent, this is a no-op. If the table becomes empty after
 * removal, the `mcpServers` key itself is removed from the document.
 */
export async function revertTomlMcpPatch(
  filePath: string,
  name: string,
): Promise<void> {
  let current: Record<string, unknown>;
  try {
    current = await readTomlConfig(filePath);
  } catch {
    // File gone — nothing to revert.
    return;
  }

  const mcpServers =
    typeof current.mcpServers === "object" &&
    current.mcpServers !== null &&
    !Array.isArray(current.mcpServers)
      ? (current.mcpServers as Record<string, unknown>)
      : {};

  if (!Object.hasOwn(mcpServers, name)) return; // already absent

  const { [name]: _removed, ...remainingServers } = mcpServers;
  const reverted: Record<string, unknown> = { ...current };

  if (Object.keys(remainingServers).length === 0) {
    delete reverted.mcpServers;
  } else {
    reverted.mcpServers = remainingServers;
  }

  await writeTomlConfigAtomic(filePath, reverted);
}
