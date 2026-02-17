import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  CartographyConfig, DiscoveryNode, DiscoveryEdge, ActivityEvent,
  NodeRow, EdgeRow, EventRow, TaskRow, WorkflowRow, SessionRow, SOP,
} from './types.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('discover','shadow')),
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
  PRIMARY KEY (id, session_id)
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
  status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  is_sop_candidate INTEGER DEFAULT 0
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

CREATE TABLE IF NOT EXISTS sops (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  steps TEXT NOT NULL,
  involved_systems TEXT NOT NULL DEFAULT '[]',
  estimated_duration TEXT,
  frequency TEXT,
  generated_at TEXT NOT NULL,
  confidence REAL DEFAULT 0.5
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
      this.db.pragma('user_version = 1');
    }
  }

  close(): void {
    this.db.pragma('optimize');
    this.db.close();
  }

  // ── Sessions ────────────────────────────

  createSession(mode: 'discover' | 'shadow', config: CartographyConfig): string {
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
    return {
      id: r['id'] as string,
      mode: r['mode'] as 'discover' | 'shadow',
      startedAt: r['started_at'] as string,
      completedAt: (r['completed_at'] as string | null) ?? undefined,
      config: r['config'] as string,
    };
  }

  // ── Nodes ───────────────────────────────

  upsertNode(sessionId: string, node: DiscoveryNode, depth = 0): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO nodes
        (id, session_id, type, name, discovered_via, discovered_at, depth, confidence, metadata, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      node.id, sessionId, node.type, node.name, node.discoveredVia,
      new Date().toISOString(), depth, node.confidence,
      JSON.stringify(node.metadata ?? {}),
      JSON.stringify(node.tags ?? []),
    );
  }

  getNodes(sessionId: string): NodeRow[] {
    const rows = this.db.prepare('SELECT * FROM nodes WHERE session_id = ?').all(sessionId) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r['id'] as string,
      sessionId: r['session_id'] as string,
      type: r['type'] as NodeRow['type'],
      name: r['name'] as string,
      discoveredVia: r['discovered_via'] as string,
      discoveredAt: r['discovered_at'] as string,
      depth: r['depth'] as number,
      confidence: r['confidence'] as number,
      metadata: JSON.parse(r['metadata'] as string) as Record<string, unknown>,
      tags: JSON.parse(r['tags'] as string) as string[],
      pathId: r['path_id'] as string | undefined,
    }));
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
    return rows.map(r => ({
      id: r['id'] as string,
      sessionId: r['session_id'] as string,
      sourceId: r['source_id'] as string,
      targetId: r['target_id'] as string,
      relationship: r['relationship'] as EdgeRow['relationship'],
      evidence: r['evidence'] as string,
      confidence: r['confidence'] as number,
      discoveredAt: r['discovered_at'] as string,
    }));
  }

  // ── Events ──────────────────────────────

  insertEvent(sessionId: string, event: ActivityEvent, taskId?: string): void {
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
    return rows.map(r => ({
      id: r['id'] as string,
      sessionId: r['session_id'] as string,
      taskId: r['task_id'] as string | undefined,
      timestamp: r['timestamp'] as string,
      eventType: r['event_type'] as EventRow['eventType'],
      process: r['process'] as string,
      pid: r['pid'] as number,
      target: r['target'] as string | undefined,
      targetType: r['target_type'] as EventRow['targetType'],
      port: r['port'] as number | undefined,
      durationMs: r['duration_ms'] as number | undefined,
    }));
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
    return {
      id: r['id'] as string,
      sessionId: r['session_id'] as string,
      description: r['description'] as string | undefined,
      startedAt: r['started_at'] as string,
      completedAt: r['completed_at'] as string | undefined,
      steps: r['steps'] as string,
      involvedServices: r['involved_services'] as string,
      status: r['status'] as TaskRow['status'],
      isSOPCandidate: Boolean(r['is_sop_candidate']),
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
    return rows.map(r => ({
      id: r['id'] as string,
      sessionId: r['session_id'] as string,
      name: r['name'] as string | undefined,
      pattern: r['pattern'] as string,
      taskIds: r['task_ids'] as string,
      occurrences: r['occurrences'] as number,
      firstSeen: r['first_seen'] as string,
      lastSeen: r['last_seen'] as string,
      avgDurationMs: r['avg_duration_ms'] as number,
      involvedServices: r['involved_services'] as string,
    }));
  }

  // ── SOPs ────────────────────────────────

  insertSOP(sop: { workflowId: string } & SOP): void {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO sops
        (id, workflow_id, title, description, steps, involved_systems,
         estimated_duration, frequency, generated_at, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sop.workflowId, sop.title, sop.description,
      JSON.stringify(sop.steps),
      JSON.stringify(sop.involvedSystems),
      sop.estimatedDuration, sop.frequency,
      new Date().toISOString(), sop.confidence,
    );
  }

  getSOPs(sessionId: string): Array<SOP & { id: string; workflowId: string }> {
    const rows = this.db.prepare(`
      SELECT s.* FROM sops s
      JOIN workflows w ON s.workflow_id = w.id
      WHERE w.session_id = ?
    `).all(sessionId) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r['id'] as string,
      workflowId: r['workflow_id'] as string,
      title: r['title'] as string,
      description: r['description'] as string,
      steps: JSON.parse(r['steps'] as string) as SOP['steps'],
      involvedSystems: JSON.parse(r['involved_systems'] as string) as string[],
      estimatedDuration: r['estimated_duration'] as string,
      frequency: r['frequency'] as string,
      confidence: r['confidence'] as number,
    }));
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
