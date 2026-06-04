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
  /** Enable semantic (vector) search. Default true; degrades to lexical if unavailable. */
  semantic?: boolean;
  /** Logger (stderr). */
  log?: (msg: string) => void;
}

export async function startMcp(opts: StartMcpOptions = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => process.stderr.write(m + '\n'));
  const db = new CartographyDB(opts.dbPath ?? defaultConfig().dbPath);

  let search: SearchFn | undefined;
  if (opts.semantic !== false) {
    search = await createSemanticSearch(db);
    log('semantic search: ready');
  }
  const discovery = localDiscoveryFn();

  const factory = () => createMcpServer({ db, session: opts.session ?? 'latest', search, discovery });

  if (opts.transport === 'http') {
    const port = opts.port ?? 3737;
    const host = opts.host ?? '127.0.0.1';
    await runHttp(factory, { port, host });
    log(`Cartography MCP server (Streamable HTTP) on http://${host}:${port}/mcp`);
  } else {
    log('Cartography MCP server (stdio) ready');
    await runStdio(factory());
  }
}
