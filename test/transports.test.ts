import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { runHttp } from '../src/mcp/transports.js';
import { createMcpServer } from '../src/mcp/server.js';
import { CartographyDB } from '../src/db.js';
import { defaultConfig } from '../src/types.js';

const servers: Server[] = [];
const dbs: CartographyDB[] = [];

function factory() {
  const db = new CartographyDB(':memory:');
  db.createSession('discover', defaultConfig());
  dbs.push(db);
  return createMcpServer({ db });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  dbs.splice(0).forEach((d) => d.close());
});

describe('runHttp transport hardening', () => {
  it('refuses to bind a non-loopback host without an explicit allowlist (CVE-2025-66414)', async () => {
    await expect(runHttp(factory, { host: '0.0.0.0', port: 0 })).rejects.toThrow(/allowedHosts/i);
  });

  it('allows a non-loopback host when an explicit allowlist is provided', async () => {
    const srv = await runHttp(factory, { host: '0.0.0.0', port: 0, allowedHosts: ['example.com'] });
    servers.push(srv);
    expect(srv.listening).toBe(true);
  });

  it('binds loopback by default with DNS-rebinding protection on', async () => {
    const srv = await runHttp(factory, { host: '127.0.0.1', port: 0 });
    servers.push(srv);
    expect(srv.listening).toBe(true);
  });
});
