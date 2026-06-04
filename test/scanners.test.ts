import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { CartographyDB } from '../src/db.js';
import { defaultConfig } from '../src/types.js';
import { ScannerRegistry } from '../src/scanners/types.js';
import type { Scanner } from '../src/scanners/types.js';
import { extractListeningPorts } from '../src/scanners/ports.js';
import { defaultRegistry } from '../src/scanners/registry.js';
import { runLocalDiscovery } from '../src/discovery/local.js';

describe('extractListeningPorts', () => {
  it('extracts known service ports from ss output', () => {
    const ss = 'LISTEN 0 128 0.0.0.0:5432 0.0.0.0:* users:(("postgres",pid=10,fd=5))\n' +
      'LISTEN 0 511 127.0.0.1:6379 0.0.0.0:* users:(("redis-server",pid=20,fd=6))\n' +
      'LISTEN 0 128 *:22 *:*';
    expect(extractListeningPorts(ss).sort()).toEqual([5432, 6379]); // 22 (ssh) not in map
  });
  it('extracts ports from lsof and PowerShell output', () => {
    expect(extractListeningPorts('postgres 1 u 5u IPv4 TCP *:5432 (LISTEN)')).toEqual([5432]);
    expect(extractListeningPorts('0.0.0.0:3306 PID=99 mysqld')).toEqual([3306]);
  });
});

describe('ScannerRegistry', () => {
  const fake = (id: string, platforms: Scanner['platforms']): Scanner => ({
    id, title: id, platforms, detect: () => true, scan: async () => ({ nodes: [], edges: [] }),
  });

  it('registers, gets and lists scanners; rejects duplicates', () => {
    const r = new ScannerRegistry().register(fake('a', 'all'));
    expect(r.get('a')?.id).toBe('a');
    expect(r.list()).toHaveLength(1);
    expect(() => r.register(fake('a', 'all'))).toThrow(/already registered/);
  });

  it('filters by platform', () => {
    const r = new ScannerRegistry().register(fake('all', 'all')).register(fake('win', ['win32']));
    expect(r.forPlatform('linux').map((s) => s.id)).toEqual(['all']);
    expect(r.forPlatform('win32').map((s) => s.id).sort()).toEqual(['all', 'win']);
  });

  it('defaultRegistry contains the built-in scanners', () => {
    expect(defaultRegistry().list().map((s) => s.id).sort()).toEqual(['bookmarks', 'installed-apps', 'local-ports']);
  });
});

describe('runLocalDiscovery', () => {
  const DB_PATH = join(tmpdir(), `cartography-disc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  let db: CartographyDB;
  let sid: string;

  beforeEach(() => {
    db = new CartographyDB(DB_PATH);
    sid = db.createSession('discover', defaultConfig());
  });
  afterEach(() => {
    db.close();
    if (existsSync(DB_PATH)) rmSync(DB_PATH);
  });

  it('runs scanners, dedupes by confidence and persists nodes/edges', async () => {
    const registry = new ScannerRegistry()
      .register({
        id: 's1', title: 's1', platforms: 'all', detect: () => true,
        scan: async () => ({
          nodes: [
            { id: 'database_server:pg', type: 'database_server', name: 'pg', discoveredVia: 's1', confidence: 0.6, metadata: {}, tags: [] },
            { id: 'web_service:api', type: 'web_service', name: 'api', discoveredVia: 's1', confidence: 0.9, metadata: {}, tags: [] },
          ],
          edges: [{ sourceId: 'web_service:api', targetId: 'database_server:pg', relationship: 'writes_to', evidence: 'x', confidence: 0.9 }],
        }),
      })
      .register({
        id: 's2', title: 's2', platforms: 'all', detect: () => true,
        scan: async () => ({
          // higher-confidence duplicate of pg + an edge to a missing node (must be dropped)
          nodes: [{ id: 'database_server:pg', type: 'database_server', name: 'PostgreSQL', discoveredVia: 's2', confidence: 0.95, metadata: {}, tags: [] }],
          edges: [{ sourceId: 'web_service:api', targetId: 'ghost:x', relationship: 'calls', evidence: 'x', confidence: 0.5 }],
        }),
      });

    const result = await runLocalDiscovery(db, sid, { registry });
    expect(result.nodes).toBe(2);
    expect(result.scanners.sort()).toEqual(['s1', 's2']);

    const nodes = db.getNodes(sid);
    expect(nodes.find((n) => n.id === 'database_server:pg')?.name).toBe('PostgreSQL'); // higher confidence won
    expect(db.getEdges(sid)).toHaveLength(1); // edge to ghost node dropped
  });

  it('isolates scanner failures', async () => {
    const registry = new ScannerRegistry()
      .register({ id: 'boom', title: 'boom', platforms: 'all', detect: () => true, scan: async () => { throw new Error('nope'); } })
      .register({ id: 'ok', title: 'ok', platforms: 'all', detect: () => true, scan: async () => ({ nodes: [{ id: 'host:a', type: 'host', name: 'a', discoveredVia: 'ok', confidence: 0.9, metadata: {}, tags: [] }], edges: [] }) });
    const result = await runLocalDiscovery(db, sid, { registry });
    expect(result.scanners).toEqual(['ok']);
    expect(result.nodes).toBe(1);
  });
});
