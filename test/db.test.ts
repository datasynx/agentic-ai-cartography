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
    const sessionId = db.createSession('shadow', config);

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
    const sessionId = db.createSession('shadow', config);

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
    const id2 = db.createSession('shadow', config);

    const latest = db.getLatestSession();
    expect(latest?.id).toBe(id2);

    const latestDiscover = db.getLatestSession('discover');
    expect(latestDiscover?.mode).toBe('discover');
  });
});
