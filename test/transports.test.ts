import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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

  it('refuses to bind a non-loopback host without an auth token', async () => {
    await expect(
      runHttp(factory, { host: '0.0.0.0', port: 0, allowedHosts: ['example.com'] }),
    ).rejects.toThrow(/auth token/i);
  });

  it('allows a non-loopback host when an allowlist AND token are provided', async () => {
    const srv = await runHttp(factory, { host: '0.0.0.0', port: 0, allowedHosts: ['example.com'], token: 'secret' });
    servers.push(srv);
    expect(srv.listening).toBe(true);
  });

  it('binds loopback by default with DNS-rebinding protection on', async () => {
    const srv = await runHttp(factory, { host: '127.0.0.1', port: 0 });
    servers.push(srv);
    expect(srv.listening).toBe(true);
  });

  it('rejects requests without a valid bearer token when a token is configured', async () => {
    const srv = await runHttp(factory, { host: '127.0.0.1', port: 0, token: 'secret' });
    servers.push(srv);
    const { port } = srv.address() as AddressInfo;

    const unauth = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(unauth.status).toBe(401);

    const wrong = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer nope' },
      body: '{}',
    });
    expect(wrong.status).toBe(401);
  });

  it('does not 401 a request carrying the correct bearer token', async () => {
    const srv = await runHttp(factory, { host: '127.0.0.1', port: 0, token: 'secret' });
    servers.push(srv);
    const { port } = srv.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: '{}',
    });
    expect(res.status).not.toBe(401);
  });
});
