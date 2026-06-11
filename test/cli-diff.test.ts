import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { CartographyDB } from '../src/db.js';
import { defaultConfig } from '../src/types.js';

// End-to-end smoke test of the `diff` CLI command. It is self-contained (no Claude
// CLI required), so we seed a DB with two sessions and spawn the real CLI.
const DB_PATH = join(tmpdir(), `cartography-clidiff-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const TSX = join(process.cwd(), 'node_modules', '.bin', 'tsx');
const CLI = join(process.cwd(), 'src', 'cli.ts');

const runCli = (args: string[]): string =>
  execFileSync(TSX, [CLI, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

beforeAll(() => {
  const db = new CartographyDB(DB_PATH);
  const cfg = defaultConfig();
  const s1 = db.createSession('discover', cfg);
  db.upsertNode(s1, { id: 'host:a', type: 'host', name: 'a', discoveredVia: 't', confidence: 0.9, metadata: {}, tags: [] });
  db.upsertNode(s1, { id: 'database_server:pg', type: 'database_server', name: 'pg', discoveredVia: 't', confidence: 0.9, metadata: {}, tags: [] });
  db.endSession(s1);
  const s2 = db.createSession('discover', cfg);
  db.upsertNode(s2, { id: 'host:a', type: 'host', name: 'a', discoveredVia: 't', confidence: 0.9, metadata: {}, tags: [] });
  db.upsertNode(s2, { id: 'cache_server:redis', type: 'cache_server', name: 'redis', discoveredVia: 't', confidence: 0.9, metadata: {}, tags: [] });
  db.endSession(s2);
  db.close();
});

afterAll(() => {
  for (const ext of ['', '-wal', '-shm']) if (existsSync(DB_PATH + ext)) rmSync(DB_PATH + ext);
});

describe('cartography diff (CLI E2E)', () => {
  it('emits a parseable JSON diff of the two most recent sessions', () => {
    const out = runCli(['diff', '--db', DB_PATH, '--format', 'json']);
    const d = JSON.parse(out);
    expect(d.summary.nodesAdded).toBe(1);
    expect(d.summary.nodesRemoved).toBe(1);
    expect(d.nodes.added.map((n: { id: string }) => n.id)).toContain('cache_server:redis');
    expect(d.nodes.removed.map((n: { id: string }) => n.id)).toContain('database_server:pg');
  }, 30000);

  it('emits Mermaid with diff classes', () => {
    const out = runCli(['diff', '--db', DB_PATH, '--format', 'mermaid']);
    expect(out).toContain('graph TB');
    expect(out).toContain('classDef added');
    expect(out).toContain(':::removed');
  }, 30000);
});
