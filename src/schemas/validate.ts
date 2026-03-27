import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Validates a value against any Standard Schema-compatible schema (Zod, Valibot, etc.).
 * Only synchronous schemas are supported; async schemas throw at runtime.
 */
export function validate<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
): StandardSchemaV1.Result<T> {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new Error("Async schemas are not supported");
  }
  return result;
}
