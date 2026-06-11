/**
 * Sanitization of untrusted text before it enters the catalog or an LLM context
 * window. Discovery ingests text from sources outside our control — browser
 * bookmark titles, command output, scanner reports — which can carry hidden
 * prompt-injection payloads using invisible Unicode (zero-width spaces,
 * bidi/format controls, soft hyphens) or stray control characters.
 *
 * `sanitizeUntrusted` strips those while preserving ordinary whitespace
 * (tab/0x09, line feed/0x0A, carriage return/0x0D) and NFC-normalizes the
 * result. It is a no-op for normal ASCII/printable text.
 *
 * The set of stripped code points is defined numerically (below) rather than as
 * a regex of literal invisible characters, so the source stays pure ASCII and
 * auditable.
 */

// Inclusive code-point ranges to remove.
const STRIP_RANGES: ReadonlyArray<readonly [number, number]> = [
  // C0 controls except 0x09 (tab), 0x0A (LF), 0x0D (CR)
  [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f],
  [0x7f, 0x7f],           // DEL
  [0x80, 0x9f],           // C1 controls
  [0x00ad, 0x00ad],       // soft hyphen
  [0x200b, 0x200f],       // ZWSP, ZWNJ, ZWJ, LRM, RLM
  [0x202a, 0x202e],       // bidi embeddings & overrides
  [0x2060, 0x2064],       // word joiner, invisible math operators
  [0x2066, 0x2069],       // bidi isolates
  [0x206a, 0x206f],       // deprecated format characters
  [0xfeff, 0xfeff],       // BOM / ZWNBSP
];

const STRIP = new Set<number>();
for (const [start, end] of STRIP_RANGES) {
  for (let cp = start; cp <= end; cp++) STRIP.add(cp);
}

/** Strip invisible/control characters and NFC-normalize untrusted text. */
export function sanitizeUntrusted(text: string): string {
  if (!text) return text;
  let out = '';
  for (const ch of text.normalize('NFC')) {
    if (!STRIP.has(ch.codePointAt(0) as number)) out += ch;
  }
  return out;
}

/** Recursively apply `sanitizeUntrusted` to every string in an arbitrary value. */
export function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeUntrusted(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeValue(v);
    return out;
  }
  return value;
}
