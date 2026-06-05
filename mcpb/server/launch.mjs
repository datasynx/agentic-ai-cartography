#!/usr/bin/env node
/**
 * Thin launcher for the Claude Desktop .mcpb bundle.
 *
 * Rather than vendoring the package's native dependencies (better-sqlite3) into a
 * platform-specific bundle, this stub spawns the published npm server over stdio
 * via `npx`. Claude Desktop runs `node ${__dirname}/server/launch.mjs`; we forward
 * stdio transparently so the MCP stdio transport works unchanged.
 */

import { spawn } from 'node:child_process';

const PACKAGE = '@datasynx/agentic-ai-cartography';
const BIN = 'cartography-mcp';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const child = spawn(npx, ['-y', '--package', PACKAGE, BIN, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (err) => {
  process.stderr.write(`cartography .mcpb launcher failed to start npx: ${err.message}\n`);
  process.exit(1);
});
