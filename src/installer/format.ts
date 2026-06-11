/**
 * Format-agnostic (de)serialization for host config files. JSON keeps 2-space
 * indentation; TOML uses smol-toml; YAML uses the `yaml` package. Empty or
 * whitespace-only input parses to an empty object so a fresh install starts clean.
 */

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ConfigFormat } from './types.js';

export function parseConfig(text: string, format: ConfigFormat): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    switch (format) {
      case 'json':
        return JSON.parse(text) as Record<string, unknown>;
      case 'toml':
        return parseToml(text) as Record<string, unknown>;
      case 'yaml':
        return (parseYaml(text) as Record<string, unknown>) ?? {};
    }
  } catch (err) {
    // Fail loudly with an actionable message rather than crashing with a raw
    // parser stack or silently discarding (and then clobbering) the user's config.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse existing ${format.toUpperCase()} config: ${detail}`);
  }
}

export function serializeConfig(obj: Record<string, unknown>, format: ConfigFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(obj, null, 2) + '\n';
    case 'toml':
      return stringifyToml(obj) + '\n';
    case 'yaml':
      return stringifyYaml(obj);
  }
}
