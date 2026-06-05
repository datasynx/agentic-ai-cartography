/**
 * The canonical Cartography MCP server entry every client spec receives. Kept in
 * one place so the npx invocation (and any future packaging change) is defined
 * exactly once and reused across all hosts.
 */

import type { ServerEntry } from './types.js';

export const PACKAGE_NAME = '@datasynx/agentic-ai-cartography';
export const MCP_BIN = 'cartography-mcp';
export const DEFAULT_SERVER_NAME = 'cartography';

export interface EntryOptions {
  /** `http` produces a `url` entry; otherwise stdio via npx. */
  transport?: 'stdio' | 'http';
  /** HTTP endpoint (used when transport === 'http'). */
  url?: string;
  /** Extra environment variables to inject. */
  env?: Record<string, string>;
  /** Extra package arguments appended after the bin name (e.g. `--db`, `--session`). */
  packageArgs?: string[];
}

/** Build the default server entry (stdio via `npx` unless an HTTP url is given). */
export function defaultServerEntry(opts: EntryOptions = {}): ServerEntry {
  if (opts.transport === 'http') {
    return { url: opts.url ?? 'http://127.0.0.1:3737/mcp', ...(opts.env ? { env: opts.env } : {}) };
  }
  const args = ['-y', '--package', PACKAGE_NAME, MCP_BIN, ...(opts.packageArgs ?? [])];
  return { command: 'npx', args, ...(opts.env ? { env: opts.env } : {}) };
}
