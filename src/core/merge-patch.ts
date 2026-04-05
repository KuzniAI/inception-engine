export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function computeUndoPatch(
  original: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const undoPatch: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    const patchVal = patch[key];
    if (isPlainObject(patchVal) && isPlainObject(original[key])) {
      undoPatch[key] = computeUndoPatch(
        original[key] as Record<string, unknown>,
        patchVal as Record<string, unknown>,
      );
    } else {
      undoPatch[key] = key in original ? original[key] : null;
    }
  }
  return undoPatch;
}

export function applyMergePatch(
  original: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const patched: Record<string, unknown> = { ...original };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete patched[key];
    } else if (isPlainObject(value) && isPlainObject(patched[key])) {
      patched[key] = applyMergePatch(
        patched[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      patched[key] = value;
    }
  }
  return patched;
}

export function applyUndoPatch(
  current: Record<string, unknown>,
  undoPatch: Record<string, unknown>,
): Record<string, unknown> {
  const restored: Record<string, unknown> = { ...current };
  for (const [key, originalValue] of Object.entries(undoPatch)) {
    if (originalValue === null) {
      delete restored[key];
    } else if (isPlainObject(originalValue) && isPlainObject(restored[key])) {
      restored[key] = applyUndoPatch(
        restored[key] as Record<string, unknown>,
        originalValue as Record<string, unknown>,
      );
    } else {
      restored[key] = originalValue;
    }
  }
  return restored;
}
