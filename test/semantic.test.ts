import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { CartographyDB } from '../src/db.js';
import { defaultConfig } from '../src/types.js';
import { VectorStore } from '../src/semantic/store.js';
import { createHashEmbedder } from '../src/semantic/embeddings.js';
import { createSemanticSearch } from '../src/semantic/search.js';

const DB_PATH = join(tmpdir(), `cartography-sem-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
let db: CartographyDB;
let sid: string;

beforeEach(() => {
  db = new CartographyDB(DB_PATH);
  sid = db.createSession('discover', defaultConfig());
  const mk = (id: string, type: string, name: string, meta: Record<string, unknown> = {}) =>
    db.upsertNode(sid, { id, type: type as never, name, discoveredVia: 'test', confidence: 0.9, metadata: meta, tags: [] });
  mk('database_server:pg', 'database_server', 'PostgreSQL', { description: 'relational SQL database' });
  mk('cache_server:redis', 'cache_server', 'Redis', { description: 'in-memory key value cache store' });
  mk('saas_tool:github', 'saas_tool', 'GitHub', { description: 'source code hosting and version control' });
  mk('saas_tool:auth0', 'saas_tool', 'Auth0', { description: 'authentication and identity provider login' });
});

afterEach(() => {
  db.close();
  if (existsSync(DB_PATH)) rmSync(DB_PATH);
});

describe('semantic search (sqlite-vec + hash embedder)', () => {
  it('indexes nodes and finds the nearest by meaning', async () => {
    const store = new VectorStore(db, createHashEmbedder(256));
    expect(await store.init()).toBe(true);
    const { embedded, total } = await store.index(sid);
    expect(total).toBe(4);
    expect(embedded).toBe(4);

    const hits = await store.search(sid, 'postgres relational database', 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.nodeId).toBe('database_server:pg');
  });

  it('incrementally re-indexes only changed nodes', async () => {
    const store = new VectorStore(db, createHashEmbedder(256));
    await store.index(sid);
    const second = await store.index(sid);
    expect(second.embedded).toBe(0); // nothing changed

    db.upsertNode(sid, { id: 'saas_tool:new', type: 'saas_tool' as never, name: 'Stripe', discoveredVia: 't', confidence: 0.9, metadata: {}, tags: [] });
    const third = await store.index(sid);
    expect(third.embedded).toBe(1);
  });

  it('createSemanticSearch returns scored results and is usable as a SearchFn', async () => {
    const search = await createSemanticSearch(db, createHashEmbedder(256));
    const res = await search(db, sid, 'login identity authentication', { limit: 2 });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]!.node.id).toBe('saas_tool:auth0');
    expect(typeof res[0]!.score).toBe('number');
  });

  it('respects type filters', async () => {
    const search = await createSemanticSearch(db, createHashEmbedder(256));
    const res = await search(db, sid, 'database', { types: ['cache_server'], limit: 5 });
    for (const r of res) expect(r.node.type).toBe('cache_server');
  });
});
