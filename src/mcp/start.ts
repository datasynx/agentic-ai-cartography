/**
 * Shared entry logic for launching the Cartography MCP server, used by both the
 * dedicated `cartography-mcp` binary and the `mcp` CLI sub-command.
 *
 * Wires in semantic search (lazy, falls back to lexical) and deterministic local
 * discovery (no LLM required). All logging goes to stderr so stdout stays a clean
 * MCP protocol channel.
 */

import { CartographyDB } from '../db.js';
import { defaultConfig } from '../types.js';
import { createMcpServer } from './server.js';
import type { SearchFn } from './server.js';
import { runStdio, runHttp } from './transports.js';
import { createSemanticSearch } from '../semantic/search.js';
import { localDiscoveryFn } from '../discovery/local.js';

export interface StartMcpOptions {
  dbPath?: string;
  session?: string | 'latest';
  /** `http` runs Streamable HTTP; otherwise stdio (default). */
  transport?: 'stdio' | 'http';
  port?: number;
  host?: string;
  /** Trusted Host headers when binding a non-loopback host (DNS-rebinding allowlist). */
  allowedHosts?: string[];
  /** Bearer token required on HTTP requests. Mandatory for a non-loopback bind. */
  token?: string;
  /** Enable semantic (vector) search. Default true; degrades to lexical if unavailable. */
  semantic?: boolean;
  /** Logger (stderr). */
  log?: (msg: string) => void;
}

export interface ParsedMcpArgs extends StartMcpOptions {
  /** `--help`/`-h` was passed; the caller should print usage and exit 0. */
  help?: boolean;
}

/**
 * Parse the `cartography-mcp` argv into StartMcpOptions. Kept here (not in the
 * binary) so it can be unit-tested without triggering the binary's side effects.
 */
export function parseMcpArgs(argv: string[]): ParsedMcpArgs {
  const opts: ParsedMcpArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--http') opts.transport = 'http';
    else if (a === '--stdio') opts.transport = 'stdio';
    else if (a === '--no-semantic') opts.semantic = false;
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--host') opts.host = argv[++i];
    else if (a === '--allowed-hosts') opts.allowedHosts = (argv[++i] ?? '').split(',').map((h) => h.trim()).filter(Boolean);
    else if (a === '--token') opts.token = argv[++i];
    else if (a === '--db') opts.dbPath = argv[++i];
    else if (a === '--session') opts.session = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

export async function startMcp(opts: StartMcpOptions = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => process.stderr.write(m + '\n'));
  const db = new CartographyDB(opts.dbPath ?? defaultConfig().dbPath);

  let search: SearchFn | undefined;
  if (opts.semantic !== false) {
    search = await createSemanticSearch(db, undefined, { log });
  }
  const discovery = localDiscoveryFn();

  const factory = () => createMcpServer({ db, session: opts.session ?? 'latest', search, discovery });

  if (opts.transport === 'http') {
    const port = opts.port ?? 3737;
    const host = opts.host ?? '127.0.0.1';
    const token = opts.token ?? process.env['CARTOGRAPHY_HTTP_TOKEN'];
    await runHttp(factory, {
      port,
      host,
      ...(opts.allowedHosts ? { allowedHosts: opts.allowedHosts } : {}),
      ...(token ? { token } : {}),
    });
    log(`Cartography MCP server (Streamable HTTP) on http://${host}:${port}/mcp${token ? ' (auth: bearer token required)' : ''}`);
  } else {
    log('Cartography MCP server (stdio) ready');
    await runStdio(factory());
  }
}
