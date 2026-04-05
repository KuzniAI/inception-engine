import assert from "node:assert/strict";

/**
 * Normalize path separators to forward slashes for cross-platform path assertions.
 * Use this instead of hard-coding POSIX separators in expected strings.
 */
export function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

/**
 * Assert that a path ends with the given POSIX-style suffix, normalizing separators.
 * Use instead of: assert.ok(normalizeSlashes(p).endsWith("some/suffix"))
 */
export function assertPathEndsWith(
  actual: string,
  suffix: string,
  msg?: string,
): void {
  assert.ok(
    normalizeSlashes(actual).endsWith(suffix),
    msg ?? `Expected path "${actual}" to end with "${suffix}"`,
  );
}
