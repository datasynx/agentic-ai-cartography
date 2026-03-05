import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { NODE_TYPES, EDGE_RELATIONSHIPS } from './types.js';
import type {
  CartographyConfig, DiscoveryNode, DiscoveryEdge,
  NodeRow, EdgeRow, SessionRow, Connection,
} from './types.js';

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
CREATE INDEX IF NOT EXISTS idx_edges_session ON edges(session_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON activity_events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON activity_events(task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_connections_session ON connections(session_id);
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
      this.db.pragma('user_version = 2');
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
      `);
      this.db.pragma('user_version = 2');
    }
  }

  close(): void {
    this.db.pragma('optimize');
    this.db.close();
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

  // ── Nodes ───────────────────────────────

  upsertNode(sessionId: string, node: DiscoveryNode, depth = 0): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO nodes
        (id, session_id, type, name, discovered_via, discovered_at, depth, confidence, metadata, tags,
         domain, sub_domain, quality_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      node.id, sessionId, node.type, node.name, node.discoveredVia,
      new Date().toISOString(), depth, node.confidence,
      JSON.stringify(node.metadata ?? {}),
      JSON.stringify(node.tags ?? []),
      node.domain ?? null,
      node.subDomain ?? null,
      node.qualityScore ?? null,
    );
  }

  getNodes(sessionId: string): NodeRow[] {
    const rows = this.db.prepare('SELECT * FROM nodes WHERE session_id = ?').all(sessionId) as Record<string, unknown>[];
    return rows.map(r => this.mapNode(r));
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
      metadata: JSON.parse(v.metadata) as Record<string, unknown>,
      tags: JSON.parse(v.tags) as string[],
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
      edge.relationship, edge.evidence, edge.confidence,
      new Date().toISOString(),
    );
  }

  getEdges(sessionId: string): EdgeRow[] {
    const rows = this.db.prepare('SELECT * FROM edges WHERE session_id = ?').all(sessionId) as Record<string, unknown>[];
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

  // ── Stats ───────────────────────────────

  getStats(sessionId: string): { nodes: number; edges: number; events: number; tasks: number } {
    const nodes = (this.db.prepare('SELECT COUNT(*) as c FROM nodes WHERE session_id = ?').get(sessionId) as { c: number }).c;
    const edges = (this.db.prepare('SELECT COUNT(*) as c FROM edges WHERE session_id = ?').get(sessionId) as { c: number }).c;
    const events = (this.db.prepare('SELECT COUNT(*) as c FROM activity_events WHERE session_id = ?').get(sessionId) as { c: number }).c;
    const tasks = (this.db.prepare('SELECT COUNT(*) as c FROM tasks WHERE session_id = ?').get(sessionId) as { c: number }).c;
    return { nodes, edges, events, tasks };
  }
}
