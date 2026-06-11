import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { NODE_TYPES, EDGE_RELATIONSHIPS } from './types.js';
import type {
  CartographyConfig, DiscoveryNode, DiscoveryEdge,
  NodeRow, EdgeRow, SessionRow, Connection, TopologyDiff,
} from './types.js';
import { diffTopology } from './diff.js';
import { sanitizeUntrusted, sanitizeValue } from './sanitize.js';

/** Parse a JSON column, falling back to `fallback` if the stored value is corrupt. */
function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Row validation schemas ──────────────────────────────────────────────────

const SessionRowSchema = z.object({
  id: z.string(),
  mode: z.literal('discover'),
  started_at: z.string(),
  completed_at: z.string().nullable().optional(),
  config: z.string(),
});

const NodeRowSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  type: z.enum(NODE_TYPES),
  name: z.string(),
  discovered_via: z.string().nullable().optional(),
  discovered_at: z.string(),
  path_id: z.string().nullable().optional(),
  depth: z.number().default(0),
  confidence: z.number().default(0.5),
  metadata: z.string().default('{}'),
  tags: z.string().default('[]'),
  domain: z.string().nullable().optional(),
  sub_domain: z.string().nullable().optional(),
  quality_score: z.number().nullable().optional(),
});

const EdgeRowSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  source_id: z.string(),
  target_id: z.string(),
  relationship: z.enum(EDGE_RELATIONSHIPS),
  evidence: z.string().nullable().optional(),
  confidence: z.number().default(0.5),
  discovered_at: z.string(),
});

const EventRowSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  task_id: z.string().nullable().optional(),
  timestamp: z.string(),
  event_type: z.string(),
  process: z.string(),
  pid: z.number(),
  target: z.string().nullable().optional(),
  target_type: z.string().nullable().optional(),
  port: z.number().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
});

const TaskRowSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  description: z.string().nullable().optional(),
  started_at: z.string(),
  completed_at: z.string().nullable().optional(),
  steps: z.string().default('[]'),
  involved_services: z.string().default('[]'),
  status: z.enum(['active', 'completed', 'cancelled']),
});

const WorkflowRowSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  name: z.string().nullable().optional(),
  pattern: z.string(),
  task_ids: z.string().default('[]'),
  occurrences: z.number().default(1),
  first_seen: z.string(),
  last_seen: z.string(),
  avg_duration_ms: z.number().nullable().optional(),
  involved_services: z.string().default('[]'),
});

const ConnectionRowSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  source_asset_id: z.string(),
  target_asset_id: z.string(),
  type: z.string().nullable().optional(),
  created_at: z.string(),
});

export interface ConnectionRow extends Connection {
  sessionId: string;
  createdAt: string;
}

/** Aggregate, low-token index of a topology — used for progressive disclosure. */
export interface GraphSummary {
  sessionId: string;
  totals: { nodes: number; edges: number };
  nodesByType: Record<string, number>;
  nodesByDomain: Record<string, number>;
  edgesByRelationship: Record<string, number>;
  topConnected: Array<{ id: string; name: string; type: string; degree: number }>;
}

/** Result of a recursive dependency traversal. */
export interface TraversalResult {
  root?: NodeRow;
  direction: 'downstream' | 'upstream' | 'both';
  maxDepth: number;
  nodes: Array<NodeRow & { depth: number }>;
  edges: EdgeRow[];
}

// ── DB Row Types ──

export interface EventRow {
  id: string;
  sessionId: string;
  taskId?: string;
  timestamp: string;
  eventType: string;
  process: string;
  pid: number;
  target?: string;
  targetType?: string;
  port?: number;
  durationMs?: number;
}

export interface TaskRow {
  id: string;
  sessionId: string;
  description?: string;
  startedAt: string;
  completedAt?: string;
  steps: string;
  involvedServices: string;
  status: 'active' | 'completed' | 'cancelled';
}

export interface WorkflowRow {
  id: string;
  sessionId: string;
  name?: string;
  pattern: string;
  taskIds: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  avgDurationMs: number;
  involvedServices: string;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('discover')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  config TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  discovered_via TEXT,
  discovered_at TEXT NOT NULL,
  path_id TEXT,
  depth INTEGER DEFAULT 0,
  confidence REAL DEFAULT 0.5,
  metadata TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  domain TEXT,
  sub_domain TEXT,
  quality_score REAL,
  PRIMARY KEY (id, session_id)
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  source_asset_id TEXT NOT NULL,
  target_asset_id TEXT NOT NULL,
  type TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  evidence TEXT,
  confidence REAL DEFAULT 0.5,
  discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  task_id TEXT,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  process TEXT NOT NULL,
  pid INTEGER NOT NULL,
  target TEXT,
  target_type TEXT,
  port INTEGER,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  description TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  involved_services TEXT NOT NULL DEFAULT '[]',
  status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled'))
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  name TEXT,
  pattern TEXT NOT NULL,
  task_ids TEXT NOT NULL DEFAULT '[]',
  occurrences INTEGER DEFAULT 1,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  avg_duration_ms INTEGER,
  involved_services TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS node_approvals (
  pattern TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('save','ignore','auto')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_session ON nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(session_id, type);
CREATE INDEX IF NOT EXISTS idx_edges_session ON edges(session_id);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(session_id, source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(session_id, target_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON activity_events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON activity_events(task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_connections_session ON connections(session_id);
CREATE INDEX IF NOT EXISTS idx_connections_lookup ON connections(session_id, source_asset_id, target_asset_id);
`;

export class CartographyDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  private migrate(): void {
    const version = (this.db.pragma('user_version', { simple: true }) as number);
    if (version === 0) {
      this.db.exec(SCHEMA);
      this.db.pragma('user_version = 4');
      return;
    } else if (version === 1) {
      // v1 → v2: add hex map columns to nodes + connections table
      const cols = (this.db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>).map(c => c.name);
      if (!cols.includes('domain')) this.db.exec('ALTER TABLE nodes ADD COLUMN domain TEXT');
      if (!cols.includes('sub_domain')) this.db.exec('ALTER TABLE nodes ADD COLUMN sub_domain TEXT');
      if (!cols.includes('quality_score')) this.db.exec('ALTER TABLE nodes ADD COLUMN quality_score REAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS connections (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          source_asset_id TEXT NOT NULL,
          target_asset_id TEXT NOT NULL,
          type TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_connections_session ON connections(session_id);
        CREATE INDEX IF NOT EXISTS idx_connections_lookup ON connections(session_id, source_asset_id, target_asset_id);
      `);
      this.db.pragma('user_version = 3');
    }
    if (version === 2) {
      // v2 → v3: add composite index for connection upsert lookups
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_connections_lookup ON connections(session_id, source_asset_id, target_asset_id)');
      this.db.pragma('user_version = 3');
    }
    // v3 → v4: add graph-traversal indexes (idempotent for any pre-v4 DB)
    const current = this.db.pragma('user_version', { simple: true }) as number;
    if (current < 4) {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(session_id, type);
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(session_id, source_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(session_id, target_id);
      `);
      this.db.pragma('user_version = 4');
    }
  }

  close(): void {
    this.db.pragma('optimize');
    this.db.close();
  }

  /**
   * Advanced: the underlying better-sqlite3 connection. Used by the optional
   * semantic-search layer to load the `sqlite-vec` extension and manage its
   * virtual table. Prefer the typed methods above for everything else.
   */
  rawConnection(): Database.Database {
    return this.db;
  }

  // ── Sessions ────────────────────────────

  createSession(mode: 'discover', config: CartographyConfig): string {
    const id = crypto.randomUUID();
    this.db.prepare(
      'INSERT INTO sessions (id, mode, started_at, config) VALUES (?, ?, ?, ?)'
    ).run(id, mode, new Date().toISOString(), JSON.stringify(config));
    return id;
  }

  endSession(id: string): void {
    this.db.prepare('UPDATE sessions SET completed_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSession(row) : undefined;
  }

  getLatestSession(mode?: string): SessionRow | undefined {
    const row = mode
      ? this.db.prepare('SELECT * FROM sessions WHERE mode = ? ORDER BY rowid DESC LIMIT 1').get(mode) as Record<string, unknown> | undefined
      : this.db.prepare('SELECT * FROM sessions ORDER BY rowid DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    return row ? this.mapSession(row) : undefined;
  }

  getSessions(): SessionRow[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY rowid DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.mapSession(r));
  }

  private mapSession(r: Record<string, unknown>): SessionRow {
    const v = SessionRowSchema.parse(r);
    return {
      id: v.id,
      mode: v.mode,
      startedAt: v.started_at,
      completedAt: v.completed_at ?? undefined,
      config: v.config,
    };
  }

  /**
   * Compare two discovery sessions and report drift (added/removed/changed nodes
   * and added/removed edges). Read-only; no schema changes. Throws if either
   * session id does not exist.
   */
  diffSessions(baseId: string, currentId: string): TopologyDiff {
    const base = this.getSession(baseId);
    if (!base) throw new Error(`Base session not found: ${baseId}`);
    const current = this.getSession(currentId);
    if (!current) throw new Error(`Current session not found: ${currentId}`);

    const baseData = { nodes: this.getNodes(baseId), edges: this.getEdges(baseId) };
    const curData = { nodes: this.getNodes(currentId), edges: this.getEdges(currentId) };
    const delta = diffTopology(baseData, curData);

    return {
      base: { sessionId: baseId, startedAt: base.startedAt, nodeCount: baseData.nodes.length, edgeCount: baseData.edges.length },
      current: { sessionId: currentId, startedAt: current.startedAt, nodeCount: curData.nodes.length, edgeCount: curData.edges.length },
      ...delta,
    };
  }

  // ── Nodes ───────────────────────────────

  upsertNode(sessionId: string, node: DiscoveryNode, depth = 0): void {
    // Sanitize untrusted free-text before it enters the catalog (and later an LLM
    // context): strip invisible/control characters that could hide prompt injection.
    this.db.prepare(`
      INSERT OR REPLACE INTO nodes
        (id, session_id, type, name, discovered_via, discovered_at, depth, confidence, metadata, tags,
         domain, sub_domain, quality_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      node.id, sessionId, node.type, sanitizeUntrusted(node.name), node.discoveredVia,
      new Date().toISOString(), depth, node.confidence,
      JSON.stringify(sanitizeValue(node.metadata ?? {})),
      JSON.stringify((node.tags ?? []).map(sanitizeUntrusted)),
      node.domain != null ? sanitizeUntrusted(node.domain) : null,
      node.subDomain != null ? sanitizeUntrusted(node.subDomain) : null,
      node.qualityScore ?? null,
    );
  }

  getNodes(sessionId: string, opts?: { limit?: number; offset?: number }): NodeRow[] {
    let sql = 'SELECT * FROM nodes WHERE session_id = ?';
    if (opts?.limit) {
      sql += ` LIMIT ${opts.limit}`;
      if (opts.offset) sql += ` OFFSET ${opts.offset}`;
    }
    const rows = this.db.prepare(sql).all(sessionId) as Record<string, unknown>[];
    return rows.map(r => this.mapNode(r));
  }

  getNodeCount(sessionId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM nodes WHERE session_id = ?').get(sessionId) as { cnt: number };
    return row.cnt;
  }

  private mapNode(r: Record<string, unknown>): NodeRow {
    const v = NodeRowSchema.parse(r);
    return {
      id: v.id,
      sessionId: v.session_id,
      type: v.type,
      name: v.name,
      discoveredVia: v.discovered_via ?? '',
      discoveredAt: v.discovered_at,
      depth: v.depth,
      confidence: v.confidence,
      metadata: safeJsonParse<Record<string, unknown>>(v.metadata, {}),
      tags: safeJsonParse<string[]>(v.tags, []),
      pathId: v.path_id ?? undefined,
      domain: v.domain ?? undefined,
      subDomain: v.sub_domain ?? undefined,
      qualityScore: v.quality_score ?? undefined,
    };
  }

  deleteNode(sessionId: string, nodeId: string): void {
    this.db.prepare('DELETE FROM nodes WHERE session_id = ? AND id = ?').run(sessionId, nodeId);
    // Remove orphaned edges
    this.db.prepare(
      'DELETE FROM edges WHERE session_id = ? AND (source_id = ? OR target_id = ?)'
    ).run(sessionId, nodeId, nodeId);
  }

  // ── Edges ───────────────────────────────

  insertEdge(sessionId: string, edge: DiscoveryEdge): void {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT OR IGNORE INTO edges
        (id, session_id, source_id, target_id, relationship, evidence, confidence, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sessionId, edge.sourceId, edge.targetId,
      edge.relationship, sanitizeUntrusted(edge.evidence), edge.confidence,
      new Date().toISOString(),
    );
  }

  getEdges(sessionId: string, opts?: { limit?: number; offset?: number }): EdgeRow[] {
    let sql = 'SELECT * FROM edges WHERE session_id = ?';
    if (opts?.limit) {
      sql += ` LIMIT ${opts.limit}`;
      if (opts.offset) sql += ` OFFSET ${opts.offset}`;
    }
    const rows = this.db.prepare(sql).all(sessionId) as Record<string, unknown>[];
    return rows.map(r => {
      const v = EdgeRowSchema.parse(r);
      return {
        id: v.id,
        sessionId: v.session_id,
        sourceId: v.source_id,
        targetId: v.target_id,
        relationship: v.relationship,
        evidence: v.evidence ?? '',
        confidence: v.confidence,
        discoveredAt: v.discovered_at,
      };
    });
  }

  // ── Events ──────────────────────────────

  insertEvent(sessionId: string, event: Pick<EventRow, 'eventType' | 'process' | 'pid' | 'target' | 'targetType' | 'port'>, taskId?: string): void {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO activity_events
        (id, session_id, task_id, timestamp, event_type, process, pid, target, target_type, port)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sessionId, taskId ?? null, new Date().toISOString(),
      event.eventType, event.process, event.pid,
      event.target ?? null, event.targetType ?? null, event.port ?? null,
    );
  }

  getEvents(sessionId: string, since?: string): EventRow[] {
    const rows = since
      ? this.db.prepare('SELECT * FROM activity_events WHERE session_id = ? AND timestamp > ? ORDER BY timestamp').all(sessionId, since) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM activity_events WHERE session_id = ? ORDER BY timestamp').all(sessionId) as Record<string, unknown>[];
    return rows.map(r => {
      const v = EventRowSchema.parse(r);
      return {
        id: v.id,
        sessionId: v.session_id,
        taskId: v.task_id ?? undefined,
        timestamp: v.timestamp,
        eventType: v.event_type,
        process: v.process,
        pid: v.pid,
        target: v.target ?? undefined,
        targetType: v.target_type ?? undefined,
        port: v.port ?? undefined,
        durationMs: v.duration_ms ?? undefined,
      };
    });
  }

  // ── Tasks ───────────────────────────────

  startTask(sessionId: string, description?: string): string {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO tasks (id, session_id, description, started_at, steps, involved_services, status)
      VALUES (?, ?, ?, ?, '[]', '[]', 'active')
    `).run(id, sessionId, description ?? null, new Date().toISOString());
    return id;
  }

  endCurrentTask(sessionId: string): void {
    this.db.prepare(`
      UPDATE tasks SET status = 'completed', completed_at = ?
      WHERE session_id = ? AND status = 'active'
    `).run(new Date().toISOString(), sessionId);
  }

  updateTaskDescription(sessionId: string, description: string): void {
    this.db.prepare(`
      UPDATE tasks SET description = ?
      WHERE session_id = ? AND status = 'active'
    `).run(description, sessionId);
  }

  getActiveTask(sessionId: string): TaskRow | undefined {
    const row = this.db.prepare(
      "SELECT * FROM tasks WHERE session_id = ? AND status = 'active' LIMIT 1"
    ).get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapTask(row) : undefined;
  }

  getTasks(sessionId: string): TaskRow[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY started_at').all(sessionId) as Record<string, unknown>[];
    return rows.map(r => this.mapTask(r));
  }

  private mapTask(r: Record<string, unknown>): TaskRow {
    const v = TaskRowSchema.parse(r);
    return {
      id: v.id,
      sessionId: v.session_id,
      description: v.description ?? undefined,
      startedAt: v.started_at,
      completedAt: v.completed_at ?? undefined,
      steps: v.steps,
      involvedServices: v.involved_services,
      status: v.status,
    };
  }

  // ── Workflows ───────────────────────────

  insertWorkflow(sessionId: string, data: Omit<WorkflowRow, 'id'>): void {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO workflows
        (id, session_id, name, pattern, task_ids, occurrences,
         first_seen, last_seen, avg_duration_ms, involved_services)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sessionId, data.name ?? null, data.pattern,
      data.taskIds, data.occurrences,
      data.firstSeen, data.lastSeen, data.avgDurationMs,
      data.involvedServices,
    );
  }

  getWorkflows(sessionId: string): WorkflowRow[] {
    const rows = this.db.prepare('SELECT * FROM workflows WHERE session_id = ?').all(sessionId) as Record<string, unknown>[];
    return rows.map(r => {
      const v = WorkflowRowSchema.parse(r);
      return {
        id: v.id,
        sessionId: v.session_id,
        name: v.name ?? undefined,
        pattern: v.pattern,
        taskIds: v.task_ids,
        occurrences: v.occurrences,
        firstSeen: v.first_seen,
        lastSeen: v.last_seen,
        avgDurationMs: v.avg_duration_ms ?? 0,
        involvedServices: v.involved_services,
      };
    });
  }

  // ── Connections (user-created hex map links) ─────────────────────────────

  upsertConnection(sessionId: string, conn: Omit<Connection, 'id'>): string {
    // Idempotent: same source+target+type = same connection
    const existing = this.db.prepare(
      'SELECT id FROM connections WHERE session_id = ? AND source_asset_id = ? AND target_asset_id = ?'
    ).get(sessionId, conn.sourceAssetId, conn.targetAssetId) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO connections (id, session_id, source_asset_id, target_asset_id, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, conn.sourceAssetId, conn.targetAssetId, conn.type ?? null, new Date().toISOString());
    return id;
  }

  getConnections(sessionId: string): ConnectionRow[] {
    const rows = this.db.prepare('SELECT * FROM connections WHERE session_id = ?').all(sessionId) as Record<string, unknown>[];
    return rows.map(r => {
      const v = ConnectionRowSchema.parse(r);
      return {
        id: v.id,
        sessionId: v.session_id,
        sourceAssetId: v.source_asset_id,
        targetAssetId: v.target_asset_id,
        type: v.type ?? undefined,
        createdAt: v.created_at,
      };
    });
  }

  deleteConnection(sessionId: string, connectionId: string): void {
    this.db.prepare('DELETE FROM connections WHERE session_id = ? AND id = ?').run(sessionId, connectionId);
  }

  // ── Approvals ───────────────────────────

  setApproval(pattern: string, action: 'save' | 'ignore' | 'auto'): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO node_approvals (pattern, action, created_at) VALUES (?, ?, ?)
    `).run(pattern, action, new Date().toISOString());
  }

  getApproval(pattern: string): string | undefined {
    const row = this.db.prepare('SELECT action FROM node_approvals WHERE pattern = ?').get(pattern) as { action: string } | undefined;
    return row?.action;
  }

  // ── Pruning ──────────────────────────────

  /**
   * Delete a session and all its associated data (nodes, edges, events, tasks, workflows, connections).
   */
  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM connections WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM workflows WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM activity_events WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM tasks WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM edges WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM nodes WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  /**
   * Prune sessions older than the given ISO date string. Returns count of deleted sessions.
   */
  pruneSessions(olderThan: string): number {
    const rows = this.db.prepare(
      'SELECT id FROM sessions WHERE started_at < ?'
    ).all(olderThan) as { id: string }[];
    for (const row of rows) {
      this.deleteSession(row.id);
    }
    return rows.length;
  }

  // ── Graph queries (read-only context layer) ─────────────────────────────────

  /** Fetch a single node by id within a session. */
  getNode(sessionId: string, nodeId: string): NodeRow | undefined {
    const row = this.db.prepare('SELECT * FROM nodes WHERE session_id = ? AND id = ?')
      .get(sessionId, nodeId) as Record<string, unknown> | undefined;
    return row ? this.mapNode(row) : undefined;
  }

  /** Batch-fetch nodes by id, keyed for O(1) lookup. Chunked to stay under SQLite's bind-variable limit. */
  getNodesByIds(sessionId: string, ids: readonly string[]): Map<string, NodeRow> {
    const out = new Map<string, NodeRow>();
    for (let i = 0; i < ids.length; i += 900) {
      const chunk = ids.slice(i, i + 900);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db.prepare(
        `SELECT * FROM nodes WHERE session_id = ? AND id IN (${placeholders})`,
      ).all(sessionId, ...chunk) as Record<string, unknown>[];
      for (const r of rows) { const n = this.mapNode(r); out.set(n.id, n); }
    }
    return out;
  }

  /** Fetch all nodes of one or more types. */
  getNodesByType(sessionId: string, types: readonly string[]): NodeRow[] {
    if (types.length === 0) return [];
    const placeholders = types.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM nodes WHERE session_id = ? AND type IN (${placeholders})`,
    ).all(sessionId, ...types) as Record<string, unknown>[];
    return rows.map(r => this.mapNode(r));
  }

  /**
   * Lexical search over node id, name, domain, sub-domain and tags.
   * Case-insensitive substring match — the deterministic fallback for semantic search.
   */
  searchNodes(sessionId: string, query: string, opts?: { types?: readonly string[]; limit?: number }): NodeRow[] {
    const q = `%${query.trim().toLowerCase()}%`;
    const params: unknown[] = [sessionId, q, q, q, q, q];
    let sql = `
      SELECT * FROM nodes
      WHERE session_id = ?
        AND (
          lower(id) LIKE ? OR lower(name) LIKE ?
          OR lower(COALESCE(domain, '')) LIKE ?
          OR lower(COALESCE(sub_domain, '')) LIKE ?
          OR lower(tags) LIKE ?
        )`;
    if (opts?.types && opts.types.length > 0) {
      sql += ` AND type IN (${opts.types.map(() => '?').join(',')})`;
      params.push(...opts.types);
    }
    sql += ' ORDER BY confidence DESC';
    if (opts?.limit) sql += ` LIMIT ${Math.max(1, Math.floor(opts.limit))}`;
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.mapNode(r));
  }

  /**
   * Traverse the dependency graph from a node using a recursive CTE with a
   * path-based cycle guard. `downstream` follows source→target (what the node
   * depends on / points to); `upstream` follows target→source (what depends on it).
   */
  getDependencies(
    sessionId: string,
    nodeId: string,
    opts: { direction?: 'downstream' | 'upstream' | 'both'; maxDepth?: number } = {},
  ): TraversalResult {
    const direction = opts.direction ?? 'downstream';
    const maxDepth = Math.max(1, Math.min(opts.maxDepth ?? 8, 64));
    const root = this.getNode(sessionId, nodeId);

    const depthById = new Map<string, number>();
    const collect = (dir: 'downstream' | 'upstream'): void => {
      // SEP = newline; node ids never contain newlines, so the path guard is collision-free.
      const [from, to] = dir === 'downstream' ? ['source_id', 'target_id'] : ['target_id', 'source_id'];
      const sql = `
        WITH RECURSIVE walk(node_id, depth, path) AS (
          SELECT ?, 0, char(10) || ? || char(10)
          UNION ALL
          SELECT e.${to}, w.depth + 1, w.path || e.${to} || char(10)
          FROM edges e JOIN walk w ON e.${from} = w.node_id
          WHERE e.session_id = ?
            AND w.depth < ?
            AND instr(w.path, char(10) || e.${to} || char(10)) = 0
        )
        SELECT node_id, MIN(depth) AS depth FROM walk WHERE node_id != ? GROUP BY node_id`;
      const rows = this.db.prepare(sql).all(nodeId, nodeId, sessionId, maxDepth, nodeId) as Array<{ node_id: string; depth: number }>;
      for (const r of rows) {
        const prev = depthById.get(r.node_id);
        if (prev === undefined || r.depth < prev) depthById.set(r.node_id, r.depth);
      }
    };

    if (direction === 'both') { collect('downstream'); collect('upstream'); }
    else collect(direction);

    const byId = this.getNodesByIds(sessionId, [...depthById.keys()]);
    const nodes = [...depthById.entries()]
      .map(([id, depth]) => { const n = byId.get(id); return n ? { ...n, depth } : undefined; })
      .filter((n): n is NodeRow & { depth: number } => n !== undefined)
      .sort((a, b) => a.depth - b.depth);

    // Edges that lie within the reached subgraph (including the root).
    const reachable = new Set<string>([nodeId, ...depthById.keys()]);
    const edges = this.getEdges(sessionId).filter(e => reachable.has(e.sourceId) && reachable.has(e.targetId));

    return { root, direction, maxDepth, nodes, edges };
  }

  /** Lightweight aggregate index of the whole topology — the progressive-disclosure summary. */
  getGraphSummary(sessionId: string): GraphSummary {
    const totals = {
      nodes: (this.db.prepare('SELECT COUNT(*) c FROM nodes WHERE session_id = ?').get(sessionId) as { c: number }).c,
      edges: (this.db.prepare('SELECT COUNT(*) c FROM edges WHERE session_id = ?').get(sessionId) as { c: number }).c,
    };
    const byType: Record<string, number> = {};
    for (const r of this.db.prepare('SELECT type, COUNT(*) c FROM nodes WHERE session_id = ? GROUP BY type').all(sessionId) as Array<{ type: string; c: number }>) {
      byType[r.type] = r.c;
    }
    const byDomain: Record<string, number> = {};
    for (const r of this.db.prepare("SELECT COALESCE(domain, '(none)') d, COUNT(*) c FROM nodes WHERE session_id = ? GROUP BY d").all(sessionId) as Array<{ d: string; c: number }>) {
      byDomain[r.d] = r.c;
    }
    const byRelationship: Record<string, number> = {};
    for (const r of this.db.prepare('SELECT relationship rel, COUNT(*) c FROM edges WHERE session_id = ? GROUP BY rel').all(sessionId) as Array<{ rel: string; c: number }>) {
      byRelationship[r.rel] = r.c;
    }
    const topConnected = (this.db.prepare(`
      SELECT n.id, n.name, n.type, COUNT(e.id) AS degree
      FROM nodes n
      LEFT JOIN edges e ON e.session_id = n.session_id AND (e.source_id = n.id OR e.target_id = n.id)
      WHERE n.session_id = ?
      GROUP BY n.id, n.name, n.type
      ORDER BY degree DESC, n.confidence DESC
      LIMIT 10
    `).all(sessionId) as Array<{ id: string; name: string; type: string; degree: number }>);

    return { sessionId, totals, nodesByType: byType, nodesByDomain: byDomain, edgesByRelationship: byRelationship, topConnected };
  }

  // ── Stats ───────────────────────────────

  getStats(sessionId: string): { nodes: number; edges: number; events: number; tasks: number } {
    const nodes = (this.db.prepare('SELECT COUNT(*) as c FROM nodes WHERE session_id = ?').get(sessionId) as { c: number }).c;
    const edges = (this.db.prepare('SELECT COUNT(*) as c FROM edges WHERE session_id = ?').get(sessionId) as { c: number }).c;
    const events = (this.db.prepare('SELECT COUNT(*) as c FROM activity_events WHERE session_id = ?').get(sessionId) as { c: number }).c;
    const tasks = (this.db.prepare('SELECT COUNT(*) as c FROM tasks WHERE session_id = ?').get(sessionId) as { c: number }).c;
    return { nodes, edges, events, tasks };
  }
}
