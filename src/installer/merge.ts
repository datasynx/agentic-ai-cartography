/**
 * Idempotent deep-merge of plain objects. Used by client specs to splice a server
 * entry into an existing config without clobbering unrelated keys. Arrays and
 * scalars from `source` replace those in `target`; nested plain objects merge
 * recursively. `source` is never mutated; `target` is cloned.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
