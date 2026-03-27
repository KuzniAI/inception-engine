/**
 * Shared helpers for mapping Zod parse errors to user-facing messages.
 */
export function formatZodPath(path: (string | number)[]): string {
  if (path.length === 0) return "";
  return `${path
    .map((seg, i) => {
      if (typeof seg === "number") return `[${seg}]`;
      return i === 0 ? seg : `.${seg}`;
    })
    .join("")} `;
}
