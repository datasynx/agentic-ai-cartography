/**
 * Shared entry-shape helpers. Most hosts accept the Claude-Desktop-style object
 * (`command`/`args`/`env` for stdio, `url`/`type` for HTTP); specs that diverge
 * (VS Code `type`, Zed `source`, Codex TOML, …) compose or override these.
 */

import type { ServerEntry } from './types.js';

/** The common `{ command, args, env }` | `{ type:'http', url }` server object. */
export function mcpServerObject(entry: ServerEntry): Record<string, unknown> {
  if (entry.url) {
    return { type: 'http', url: entry.url, ...(entry.env ? { env: entry.env } : {}) };
  }
  return {
    command: entry.command,
    args: entry.args ?? [],
    ...(entry.env ? { env: entry.env } : {}),
  };
}
