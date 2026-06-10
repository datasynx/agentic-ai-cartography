import { describe, it, expect } from 'vitest';
import { parseMcpArgs } from '../src/mcp/start.js';

describe('parseMcpArgs', () => {
  it('defaults to stdio with no flags', () => {
    expect(parseMcpArgs([])).toEqual({});
  });

  it('parses the full HTTP team-mode invocation from the README', () => {
    const opts = parseMcpArgs([
      '--http',
      '--host', '0.0.0.0',
      '--port', '3737',
      '--allowed-hosts', 'cartography.internal:3737, other:3737',
      '--token', 'sekret',
    ]);
    expect(opts).toEqual({
      transport: 'http',
      host: '0.0.0.0',
      port: 3737,
      allowedHosts: ['cartography.internal:3737', 'other:3737'],
      token: 'sekret',
    });
  });

  it('parses --no-semantic, --db and --session', () => {
    const opts = parseMcpArgs(['--no-semantic', '--db', '/tmp/c.db', '--session', 'latest']);
    expect(opts).toMatchObject({ semantic: false, dbPath: '/tmp/c.db', session: 'latest' });
  });

  it('flags --help', () => {
    expect(parseMcpArgs(['--help']).help).toBe(true);
    expect(parseMcpArgs(['-h']).help).toBe(true);
  });
});
