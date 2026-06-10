/**
 * `cartography-mcp` — dedicated binary that launches the MCP server.
 *
 * Minimal arg parsing (no commander) keeps stdout clean for the stdio protocol.
 * Usage:
 *   cartography-mcp                  # stdio (default)
 *   cartography-mcp --http --port N  # Streamable HTTP
 *   cartography-mcp --http --host 0.0.0.0 --allowed-hosts h:port --token SECRET
 *   cartography-mcp --db <path> --session <id|latest> --no-semantic
 */

import { startMcp, parseMcpArgs } from './mcp/start.js';

const USAGE =
  'Usage: cartography-mcp [--http] [--port N] [--host H] [--allowed-hosts h1,h2] ' +
  '[--token SECRET] [--db PATH] [--session ID] [--no-semantic]\n';

const parsed = parseMcpArgs(process.argv.slice(2));
if (parsed.help) {
  process.stderr.write(USAGE);
  process.exitCode = 0;
} else {
  const { help: _help, ...opts } = parsed;
  startMcp(opts).catch((err) => {
    process.stderr.write(`cartography-mcp failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
