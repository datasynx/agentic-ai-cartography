import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CartographyDB } from '../src/db.js';
import { defaultConfig } from '../src/types.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

const TEST_DB = join(tmpdir(), `cartography-test-${Date.now()}.db`);

let db: CartographyDB;

beforeEach(() => {
  db = new CartographyDB(TEST_DB);
});

afterEach(() => {
  db.close();
  if (existsSync(TEST_DB)) rmSync(TEST_DB);
});

describe('CartographyDB', () => {
  it('creates and retrieves a session', () => {
    const config = defaultConfig();
    const id = db.createSession('discover', config);
    expect(id).toBeTruthy();

    const session = db.getSession(id);
    expect(session?.id).toBe(id);
    expect(session?.mode).toBe('discover');
    expect(session?.completedAt).toBeUndefined();
  });

  it('ends a session', () => {
    const config = defaultConfig();
    const id = db.createSession('discover', config);
    db.endSession(id);
    const session = db.getSession(id);
    expect(session?.completedAt).toBeTruthy();
  });

  it('upserts and retrieves nodes', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    db.upsertNode(sessionId, {
      id: 'database_server:localhost:5432',
      type: 'database_server',
      name: 'postgres',
      discoveredVia: 'ss -tlnp',
      confidence: 0.9,
      metadata: { version: '15' },
      tags: ['primary'],
    });

    const nodes = db.getNodes(sessionId);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe('database_server:localhost:5432');
    expect(nodes[0]?.confidence).toBe(0.9);
    expect(nodes[0]?.tags).toEqual(['primary']);
  });

  it('inserts and retrieves edges', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    db.insertEdge(sessionId, {
      sourceId: 'web_service:localhost:3000',
      targetId: 'database_server:localhost:5432',
      relationship: 'reads_from',
      evidence: 'pg connection in env',
      confidence: 0.8,
    });

    const edges = db.getEdges(sessionId);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.relationship).toBe('reads_from');
  });

  it('inserts and retrieves events', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    db.insertEvent(sessionId, {
      eventType: 'connection_open',
      process: 'node',
      pid: 12345,
      target: 'localhost:5432',
      targetType: 'database_server',
    });

    const events = db.getEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('connection_open');
  });

  it('manages tasks', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    const taskId = db.startTask(sessionId, 'Deploy check');
    expect(taskId).toBeTruthy();

    const active = db.getActiveTask(sessionId);
    expect(active?.description).toBe('Deploy check');

    db.endCurrentTask(sessionId);
    expect(db.getActiveTask(sessionId)).toBeUndefined();

    const tasks = db.getTasks(sessionId);
    expect(tasks[0]?.status).toBe('completed');
  });

  it('returns stats', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    db.upsertNode(sessionId, {
      id: 'web_service:localhost:3000',
      type: 'web_service',
      name: 'express',
      discoveredVia: 'ss',
      confidence: 0.9,
      metadata: {},
      tags: [],
    });

    const stats = db.getStats(sessionId);
    expect(stats.nodes).toBe(1);
    expect(stats.edges).toBe(0);
  });

  it('gets latest session', () => {
    const config = defaultConfig();
    db.createSession('discover', config);
    const id2 = db.createSession('discover', config);

    const latest = db.getLatestSession();
    expect(latest?.id).toBe(id2);

    const latestDiscover = db.getLatestSession('discover');
    expect(latestDiscover?.mode).toBe('discover');
  });

  it('stores and retrieves domain/subDomain/qualityScore on nodes', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    db.upsertNode(sessionId, {
      id: 'saas_tool:hubspot',
      type: 'saas_tool',
      name: 'HubSpot',
      discoveredVia: 'manual',
      confidence: 1,
      metadata: {},
      tags: [],
      domain: 'Marketing',
      subDomain: 'Client Lifetime Value',
      qualityScore: 82,
    });

    const nodes = db.getNodes(sessionId);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.domain).toBe('Marketing');
    expect(nodes[0]?.subDomain).toBe('Client Lifetime Value');
    expect(nodes[0]?.qualityScore).toBe(82);
  });

  it('creates and retrieves connections', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    const id = db.upsertConnection(sessionId, {
      sourceAssetId: 'node-a',
      targetAssetId: 'node-b',
      type: 'lineage',
    });
    expect(id).toBeTruthy();

    const conns = db.getConnections(sessionId);
    expect(conns).toHaveLength(1);
    expect(conns[0]?.sourceAssetId).toBe('node-a');
    expect(conns[0]?.targetAssetId).toBe('node-b');
    expect(conns[0]?.type).toBe('lineage');
  });

  it('deduplicates connections', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    const id1 = db.upsertConnection(sessionId, { sourceAssetId: 'a', targetAssetId: 'b' });
    const id2 = db.upsertConnection(sessionId, { sourceAssetId: 'a', targetAssetId: 'b' });
    expect(id1).toBe(id2);
    expect(db.getConnections(sessionId)).toHaveLength(1);
  });

  it('deletes a connection', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    const id = db.upsertConnection(sessionId, { sourceAssetId: 'x', targetAssetId: 'y' });
    db.deleteConnection(sessionId, id);
    expect(db.getConnections(sessionId)).toHaveLength(0);
  });
});
