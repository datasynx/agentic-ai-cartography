import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
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

  it('sanitizes invisible/control characters in node and edge fields on write', () => {
    const sessionId = db.createSession('discover', defaultConfig());
    const zwsp = String.fromCodePoint(0x200b);
    const rlo = String.fromCodePoint(0x202e);
    db.upsertNode(sessionId, {
      id: 'saas_tool:evil',
      type: 'saas_tool',
      name: `git${zwsp}hub`,
      discoveredVia: 'bookmark',
      confidence: 0.9,
      metadata: { note: `ignore${zwsp}previous` },
      tags: [`${rlo}tag`],
      domain: `Eng${zwsp}ineering`,
    });
    db.upsertNode(sessionId, { id: 'saas_tool:b', type: 'saas_tool', name: 'b', discoveredVia: 't', confidence: 0.9, metadata: {}, tags: [] });
    db.insertEdge(sessionId, { sourceId: 'saas_tool:evil', targetId: 'saas_tool:b', relationship: 'connects_to', evidence: `via${zwsp}link`, confidence: 0.9 });

    const node = db.getNode(sessionId, 'saas_tool:evil')!;
    expect(node.name).toBe('github');
    expect(node.domain).toBe('Engineering');
    expect(node.tags).toEqual(['tag']);
    expect((node.metadata as { note: string }).note).toBe('ignoreprevious');

    const edge = db.getEdges(sessionId).find((e) => e.sourceId === 'saas_tool:evil')!;
    expect(edge.evidence).toBe('vialink');
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

  it('deleteSession removes session and all associated data', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);
    db.upsertNode(sessionId, {
      id: 'host:x', type: 'host', name: 'X', discoveredVia: 'test',
      confidence: 0.9, metadata: {}, tags: [],
    });
    db.insertEdge(sessionId, {
      sourceId: 'host:x', targetId: 'host:y',
      relationship: 'connects_to', evidence: 'test', confidence: 0.5,
    });
    db.insertEvent(sessionId, { eventType: 'test', process: 'node', pid: 1 });
    db.startTask(sessionId, 'task');

    db.deleteSession(sessionId);

    expect(db.getSession(sessionId)).toBeUndefined();
    expect(db.getNodes(sessionId)).toHaveLength(0);
    expect(db.getEdges(sessionId)).toHaveLength(0);
    expect(db.getEvents(sessionId)).toHaveLength(0);
    expect(db.getTasks(sessionId)).toHaveLength(0);
  });

  it('pruneSessions deletes old sessions only', () => {
    const config = defaultConfig();
    const s1 = db.createSession('discover', config);
    const s2 = db.createSession('discover', config);
    db.upsertNode(s1, {
      id: 'host:old', type: 'host', name: 'Old', discoveredVia: 'test',
      confidence: 0.5, metadata: {}, tags: [],
    });
    db.upsertNode(s2, {
      id: 'host:new', type: 'host', name: 'New', discoveredVia: 'test',
      confidence: 0.5, metadata: {}, tags: [],
    });

    // Prune everything older than a future date (deletes all)
    const deleted = db.pruneSessions('2099-01-01T00:00:00.000Z');
    expect(deleted).toBe(2);
    expect(db.getSessions()).toHaveLength(0);
    expect(db.getNodes(s1)).toHaveLength(0);
    expect(db.getNodes(s2)).toHaveLength(0);
  });

  it('pruneSessions returns 0 when no sessions match', () => {
    const config = defaultConfig();
    db.createSession('discover', config);
    // Prune with a very old cutoff — nothing should be deleted
    const deleted = db.pruneSessions('1970-01-01T00:00:00.000Z');
    expect(deleted).toBe(0);
    expect(db.getSessions()).toHaveLength(1);
  });

  it('getNodeCount returns correct count', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    expect(db.getNodeCount(sessionId)).toBe(0);

    db.upsertNode(sessionId, {
      id: 'host:a', type: 'host', name: 'A', discoveredVia: 'test',
      confidence: 0.5, metadata: {}, tags: [],
    });
    db.upsertNode(sessionId, {
      id: 'host:b', type: 'host', name: 'B', discoveredVia: 'test',
      confidence: 0.5, metadata: {}, tags: [],
    });

    expect(db.getNodeCount(sessionId)).toBe(2);
  });

  it('getNodes supports pagination', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    for (let i = 0; i < 5; i++) {
      db.upsertNode(sessionId, {
        id: `host:node${i}`, type: 'host', name: `Node${i}`, discoveredVia: 'test',
        confidence: 0.5, metadata: {}, tags: [],
      });
    }

    const page1 = db.getNodes(sessionId, { limit: 2 });
    expect(page1).toHaveLength(2);

    const page2 = db.getNodes(sessionId, { limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    const all = db.getNodes(sessionId);
    expect(all).toHaveLength(5);
  });

  it('getEdges supports pagination', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    db.upsertNode(sessionId, { id: 'a', type: 'host', name: 'A', discoveredVia: 'test', confidence: 1, metadata: {}, tags: [] });
    db.upsertNode(sessionId, { id: 'b', type: 'host', name: 'B', discoveredVia: 'test', confidence: 1, metadata: {}, tags: [] });
    db.upsertNode(sessionId, { id: 'c', type: 'host', name: 'C', discoveredVia: 'test', confidence: 1, metadata: {}, tags: [] });

    db.insertEdge(sessionId, { sourceId: 'a', targetId: 'b', relationship: 'connects_to', evidence: '', confidence: 1 });
    db.insertEdge(sessionId, { sourceId: 'b', targetId: 'c', relationship: 'connects_to', evidence: '', confidence: 1 });
    db.insertEdge(sessionId, { sourceId: 'a', targetId: 'c', relationship: 'connects_to', evidence: '', confidence: 1 });

    const page = db.getEdges(sessionId, { limit: 2 });
    expect(page).toHaveLength(2);

    const all = db.getEdges(sessionId);
    expect(all).toHaveLength(3);
  });

  it('migrates v1 database to v3', () => {
    const migPath = join(tmpdir(), `cartography-mig-v1-${Date.now()}.db`);
    try {
      const raw = new Database(migPath);
      raw.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('discover')),
          started_at TEXT NOT NULL, completed_at TEXT, config TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE nodes (
          id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id),
          type TEXT NOT NULL, name TEXT NOT NULL, discovered_via TEXT,
          discovered_at TEXT NOT NULL, path_id TEXT, depth INTEGER DEFAULT 0,
          confidence REAL DEFAULT 0.5, metadata TEXT NOT NULL DEFAULT '{}',
          tags TEXT NOT NULL DEFAULT '[]',
          PRIMARY KEY (id, session_id)
        );
        CREATE TABLE edges (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
          source_id TEXT NOT NULL, target_id TEXT NOT NULL,
          relationship TEXT NOT NULL, evidence TEXT, confidence REAL DEFAULT 0.5,
          discovered_at TEXT NOT NULL
        );
        CREATE TABLE activity_events (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, task_id TEXT,
          timestamp TEXT NOT NULL, event_type TEXT NOT NULL, process TEXT NOT NULL,
          pid INTEGER NOT NULL, source TEXT, target TEXT, target_type TEXT,
          port INTEGER, duration_ms INTEGER
        );
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, description TEXT,
          started_at TEXT NOT NULL, completed_at TEXT, steps TEXT NOT NULL DEFAULT '[]',
          involved_services TEXT NOT NULL DEFAULT '[]',
          status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled'))
        );
        CREATE TABLE workflows (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT,
          pattern TEXT NOT NULL, task_ids TEXT NOT NULL DEFAULT '[]',
          occurrences INTEGER DEFAULT 1, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
          avg_duration_ms INTEGER, involved_services TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE node_approvals (
          pattern TEXT PRIMARY KEY, action TEXT NOT NULL CHECK (action IN ('save','ignore','auto')),
          created_at TEXT NOT NULL
        );
      `);
      raw.pragma('user_version = 1');
      raw.close();

      const migDb = new CartographyDB(migPath);
      const sessionId = migDb.createSession('discover', defaultConfig());
      migDb.upsertNode(sessionId, {
        id: 'host:x', type: 'host', name: 'X', discoveredVia: 'test',
        confidence: 0.9, metadata: {}, tags: [], domain: 'Infra',
      });
      const nodes = migDb.getNodes(sessionId);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.domain).toBe('Infra');

      migDb.upsertConnection(sessionId, { sourceAssetId: 'a', targetAssetId: 'b' });
      expect(migDb.getConnections(sessionId)).toHaveLength(1);

      migDb.close();
    } finally {
      try { rmSync(migPath); } catch { /* ok */ }
    }
  });

  it('migrates a v2 database to the current schema version (composite + graph indexes)', () => {
    const migPath = join(tmpdir(), `cartography-mig-v2-${Date.now()}.db`);
    try {
      const raw = new Database(migPath);
      raw.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('discover')),
          started_at TEXT NOT NULL, completed_at TEXT, config TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE nodes (
          id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id),
          type TEXT NOT NULL, name TEXT NOT NULL, discovered_via TEXT,
          discovered_at TEXT NOT NULL, path_id TEXT, depth INTEGER DEFAULT 0,
          confidence REAL DEFAULT 0.5, metadata TEXT NOT NULL DEFAULT '{}',
          tags TEXT NOT NULL DEFAULT '[]', domain TEXT, sub_domain TEXT, quality_score REAL,
          PRIMARY KEY (id, session_id)
        );
        CREATE TABLE edges (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
          source_id TEXT NOT NULL, target_id TEXT NOT NULL,
          relationship TEXT NOT NULL, evidence TEXT, confidence REAL DEFAULT 0.5,
          discovered_at TEXT NOT NULL
        );
        CREATE TABLE connections (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
          source_asset_id TEXT NOT NULL, target_asset_id TEXT NOT NULL,
          type TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX idx_connections_session ON connections(session_id);
        CREATE TABLE activity_events (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, task_id TEXT,
          timestamp TEXT NOT NULL, event_type TEXT NOT NULL, process TEXT NOT NULL,
          pid INTEGER NOT NULL, source TEXT, target TEXT, target_type TEXT,
          port INTEGER, duration_ms INTEGER
        );
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, description TEXT,
          started_at TEXT NOT NULL, completed_at TEXT, steps TEXT NOT NULL DEFAULT '[]',
          involved_services TEXT NOT NULL DEFAULT '[]',
          status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled'))
        );
        CREATE TABLE workflows (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT,
          pattern TEXT NOT NULL, task_ids TEXT NOT NULL DEFAULT '[]',
          occurrences INTEGER DEFAULT 1, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
          avg_duration_ms INTEGER, involved_services TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE node_approvals (
          pattern TEXT PRIMARY KEY, action TEXT NOT NULL CHECK (action IN ('save','ignore','auto')),
          created_at TEXT NOT NULL
        );
      `);
      raw.pragma('user_version = 2');
      raw.close();

      const migDb = new CartographyDB(migPath);
      const sessionId = migDb.createSession('discover', defaultConfig());
      migDb.upsertConnection(sessionId, { sourceAssetId: 'x', targetAssetId: 'y' });
      const conns = migDb.getConnections(sessionId);
      expect(conns).toHaveLength(1);

      const version = (migDb as unknown as { db: Database.Database }).db.pragma('user_version', { simple: true });
      expect(version).toBe(4);

      migDb.close();
    } finally {
      try { rmSync(migPath); } catch { /* ok */ }
    }
  });

  it('connections use composite index for fast upsert lookups', () => {
    const config = defaultConfig();
    const sessionId = db.createSession('discover', config);

    const id1 = db.upsertConnection(sessionId, { sourceAssetId: 'a', targetAssetId: 'b', type: 'api' });
    const id2 = db.upsertConnection(sessionId, { sourceAssetId: 'a', targetAssetId: 'b', type: 'api' });
    expect(id1).toBe(id2);

    const id3 = db.upsertConnection(sessionId, { sourceAssetId: 'a', targetAssetId: 'c', type: 'db' });
    expect(id3).not.toBe(id1);

    const conns = db.getConnections(sessionId);
    expect(conns).toHaveLength(2);
  });
});

describe('CartographyDB — graph queries', () => {
  let sid: string;

  beforeEach(() => {
    sid = db.createSession('discover', defaultConfig());
    const mk = (id: string, type: string, name: string, domain?: string) =>
      db.upsertNode(sid, { id, type: type as never, name, discoveredVia: 'test', confidence: 0.9, metadata: {}, tags: [], domain });
    mk('saas_tool:app', 'saas_tool', 'App', 'Engineering');
    mk('web_service:api', 'web_service', 'API', 'Engineering');
    mk('database_server:pg', 'database_server', 'Postgres', 'Data Layer');
    mk('cache_server:redis', 'cache_server', 'Redis', 'Data Layer');
    const edge = (s: string, t: string, rel: string) =>
      db.insertEdge(sid, { sourceId: s, targetId: t, relationship: rel as never, evidence: 'observed', confidence: 0.9 });
    edge('saas_tool:app', 'web_service:api', 'calls');
    edge('web_service:api', 'database_server:pg', 'writes_to');
    edge('web_service:api', 'cache_server:redis', 'depends_on');
    edge('database_server:pg', 'saas_tool:app', 'connects_to'); // cycle
  });

  it('getNode returns a single node or undefined', () => {
    expect(db.getNode(sid, 'saas_tool:app')?.name).toBe('App');
    expect(db.getNode(sid, 'nope:x')).toBeUndefined();
  });

  it('getNodesByType filters by type', () => {
    expect(db.getNodesByType(sid, ['database_server']).map(n => n.id)).toEqual(['database_server:pg']);
    expect(db.getNodesByType(sid, ['saas_tool', 'cache_server']).length).toBe(2);
    expect(db.getNodesByType(sid, [])).toEqual([]);
  });

  it('getNodesByIds batch-fetches into a keyed map, skipping unknown ids', () => {
    const byId = db.getNodesByIds(sid, ['saas_tool:app', 'cache_server:redis', 'nope:x']);
    expect(byId.size).toBe(2);
    expect(byId.get('saas_tool:app')?.name).toBe('App');
    expect(byId.has('nope:x')).toBe(false);
    expect(db.getNodesByIds(sid, []).size).toBe(0);
  });

  it('getNodesByIds returns every match across the chunk boundary', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `host:h${i}`);
    for (const id of ids) {
      db.upsertNode(sid, { id, type: 'host', name: id, discoveredVia: 'test', confidence: 0.5, metadata: {}, tags: [] });
    }
    expect(db.getNodesByIds(sid, ids).size).toBe(1000);
  });

  it('searchNodes matches id, name and domain case-insensitively', () => {
    expect(db.searchNodes(sid, 'redis').map(n => n.id)).toContain('cache_server:redis');
    expect(db.searchNodes(sid, 'POSTGRES').map(n => n.id)).toContain('database_server:pg');
    expect(db.searchNodes(sid, 'data layer').length).toBe(2);
    expect(db.searchNodes(sid, 'redis', { types: ['saas_tool'] })).toHaveLength(0);
  });

  it('getDependencies traverses downstream with correct depths', () => {
    const r = db.getDependencies(sid, 'saas_tool:app', { direction: 'downstream', maxDepth: 8 });
    const byId = Object.fromEntries(r.nodes.map(n => [n.id, n.depth]));
    expect(byId['web_service:api']).toBe(1);
    expect(byId['database_server:pg']).toBe(2);
    expect(byId['cache_server:redis']).toBe(2);
    expect(r.root?.id).toBe('saas_tool:app');
  });

  it('getDependencies traverses upstream', () => {
    const r = db.getDependencies(sid, 'database_server:pg', { direction: 'upstream', maxDepth: 8 });
    const ids = r.nodes.map(n => n.id);
    expect(ids).toContain('web_service:api');
    expect(ids).toContain('saas_tool:app');
  });

  it('getDependencies guards against cycles and respects maxDepth', () => {
    const shallow = db.getDependencies(sid, 'saas_tool:app', { direction: 'downstream', maxDepth: 1 });
    expect(shallow.nodes.map(n => n.id)).toEqual(['web_service:api']);
    // cycle present (pg -> app) must not cause infinite recursion
    const both = db.getDependencies(sid, 'saas_tool:app', { direction: 'both', maxDepth: 64 });
    expect(both.nodes.length).toBeLessThanOrEqual(3);
  });

  it('getGraphSummary aggregates totals, types, domains and top-connected', () => {
    const s = db.getGraphSummary(sid);
    expect(s.totals).toEqual({ nodes: 4, edges: 4 });
    expect(s.nodesByType['database_server']).toBe(1);
    expect(s.nodesByDomain['Data Layer']).toBe(2);
    expect(s.edgesByRelationship['calls']).toBe(1);
    expect(s.topConnected[0].id).toBeTruthy();
    expect(s.topConnected[0].degree).toBeGreaterThanOrEqual(2);
  });
});
