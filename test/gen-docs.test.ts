import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildDocs } from '../scripts/gen-docs.js';

describe('auto-generated docs (single source of truth = code)', () => {
  it('tool table, client matrix, quickstarts and AGENTS.md are up to date', async () => {
    const d = await buildDocs();
    // If these fail, run `npm run docs:tables`.
    expect(readFileSync(d.mcpPath, 'utf8')).toBe(d.mcp);
    expect(readFileSync(d.clientsPath, 'utf8')).toBe(d.clients);
    expect(readFileSync(d.agentsPath, 'utf8')).toBe(d.agents);
  });

  it('the generated tool table reflects the live MCP tools with read-only hints', async () => {
    const { mcp } = await buildDocs();
    expect(mcp).toContain('| `query_infrastructure` | ✅ |');
    expect(mcp).toContain('| `run_discovery` | — |'); // not read-only
  });

  it('the client matrix covers every registered host', async () => {
    const { clients } = await buildDocs();
    for (const id of ['claude-code', 'cursor', 'vscode', 'codex', 'windsurf', 'goose', 'openhands', 'claude-desktop']) {
      expect(clients).toContain(`| \`${id}\``);
    }
    // VS Code quickstart must use the `servers` key, not mcpServers
    expect(clients).toMatch(/### VS Code[\s\S]*?"servers"/);
  });
});
