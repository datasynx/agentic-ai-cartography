/**
 * `cartography-mcp` — dedicated binary that launches the MCP server.
 *
 * Minimal arg parsing (no commander) keeps stdout clean for the stdio protocol.
 * Usage:
 *   cartography-mcp                  # stdio (default)
 *   cartography-mcp --http --port N  # Streamable HTTP
 *   cartography-mcp --db <path> --session <id|latest> --no-semantic
 */

import { startMcp } from './mcp/start.js';

function parseArgs(argv: string[]) {
  const opts: { transport?: 'stdio' | 'http'; port?: number; host?: string; dbPath?: string; session?: string; semantic?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--http') opts.transport = 'http';
    else if (a === '--stdio') opts.transport = 'stdio';
    else if (a === '--no-semantic') opts.semantic = false;
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--host') opts.host = argv[++i];
    else if (a === '--db') opts.dbPath = argv[++i];
    else if (a === '--session') opts.session = argv[++i];
    else if (a === '--help' || a === '-h') {
      process.stderr.write('Usage: cartography-mcp [--http] [--port N] [--host H] [--db PATH] [--session ID] [--no-semantic]\n');
      process.exit(0);
    }
  }
  return opts;
}

startMcp(parseArgs(process.argv.slice(2))).catch((err) => {
  process.stderr.write(`cartography-mcp failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
