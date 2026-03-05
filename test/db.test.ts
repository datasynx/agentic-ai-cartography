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

  // ── Edge Cases ──

  it('returns undefined for non-existent session', () => {
    expect(db.getSession('non-existent-id')).toBeUndefined();
  });

  it('returns zero stats for empty session', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);
    const stats = db.getStats(sessionId);
    expect(stats).toEqual({ nodes: 0, edges: 0, events: 0, tasks: 0 });
  });

  it('upserts a node (replaces on same id)', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);
    db.upsertNode(sessionId, {
      id: 'host:test',
      type: 'host',
      name: 'original',
      discoveredVia: 'ss',
      confidence: 0.5,
      metadata: {},
      tags: [],
    });
    db.upsertNode(sessionId, {
      id: 'host:test',
      type: 'host',
      name: 'updated',
      discoveredVia: 'ss',
      confidence: 0.9,
      metadata: {},
      tags: [],
    });
    const nodes = db.getNodes(sessionId);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.name).toBe('updated');
    expect(nodes[0]?.confidence).toBe(0.9);
  });

  it('deletes a node and its orphaned edges', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);
    db.upsertNode(sessionId, {
      id: 'host:a', type: 'host', name: 'A', discoveredVia: 'test',
      confidence: 0.5, metadata: {}, tags: [],
    });
    db.upsertNode(sessionId, {
      id: 'host:b', type: 'host', name: 'B', discoveredVia: 'test',
      confidence: 0.5, metadata: {}, tags: [],
    });
    db.insertEdge(sessionId, {
      sourceId: 'host:a', targetId: 'host:b',
      relationship: 'connects_to', evidence: 'test', confidence: 0.5,
    });
    db.deleteNode(sessionId, 'host:a');
    expect(db.getNodes(sessionId)).toHaveLength(1);
    expect(db.getEdges(sessionId)).toHaveLength(0);
  });

  it('handles events with since filter', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);
    db.insertEvent(sessionId, { eventType: 'old', process: 'node', pid: 1 });
    const eventsAfter = db.getEvents(sessionId, '2099-01-01T00:00:00.000Z');
    expect(eventsAfter).toHaveLength(0);
  });

  it('handles multiple sessions independently', () => {
    const config = defaultConfig();
    const s1 = db.createSession('discover', config);
    const s2 = db.createSession('discover', config);
    db.upsertNode(s1, {
      id: 'host:s1', type: 'host', name: 'session1', discoveredVia: 'test',
      confidence: 0.5, metadata: {}, tags: [],
    });
    db.upsertNode(s2, {
      id: 'host:s2', type: 'host', name: 'session2', discoveredVia: 'test',
      confidence: 0.5, metadata: {}, tags: [],
    });
    expect(db.getNodes(s1)).toHaveLength(1);
    expect(db.getNodes(s2)).toHaveLength(1);
    expect(db.getNodes(s1)[0]?.name).toBe('session1');
  });

  it('getSessions returns all sessions in reverse order', () => {
    const config = defaultConfig();
    const id1 = db.createSession('discover', config);
    const id2 = db.createSession('discover', config);
    const sessions = db.getSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.id).toBe(id2);
    expect(sessions[1]?.id).toBe(id1);
  });

  it('getLatestSession returns undefined when no sessions exist', () => {
    expect(db.getLatestSession()).toBeUndefined();
  });

  it('stores and retrieves workflows', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);
    db.insertWorkflow(sessionId, {
      sessionId, name: 'test-workflow', pattern: 'A->B->C', taskIds: '[]',
      occurrences: 3, firstSeen: '2024-01-01T00:00:00Z', lastSeen: '2024-01-02T00:00:00Z',
      avgDurationMs: 500, involvedServices: '["svc-a","svc-b"]',
    });
    const workflows = db.getWorkflows(sessionId);
    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.name).toBe('test-workflow');
    expect(workflows[0]?.occurrences).toBe(3);
  });

  it('manages approvals', () => {
    db.setApproval('*.internal.com', 'save');
    expect(db.getApproval('*.internal.com')).toBe('save');
    db.setApproval('*.internal.com', 'ignore');
    expect(db.getApproval('*.internal.com')).toBe('ignore');
    expect(db.getApproval('non-existent')).toBeUndefined();
  });

  it('updates task description on active task', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);
    db.startTask(sessionId, 'initial');
    db.updateTaskDescription(sessionId, 'updated description');
    const active = db.getActiveTask(sessionId);
    expect(active?.description).toBe('updated description');
  });

  it('returns undefined for getActiveTask when no active task', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);
    expect(db.getActiveTask(sessionId)).toBeUndefined();
  });

  it('handles connection without type', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);
    db.upsertConnection(sessionId, { sourceAssetId: 'a', targetAssetId: 'b' });
    const conns = db.getConnections(sessionId);
    expect(conns).toHaveLength(1);
    expect(conns[0]?.type).toBeUndefined();
  });
});
