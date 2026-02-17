import { z } from 'zod';

// ── Enums ────────────────────────────────

export const NODE_TYPES = [
  'host', 'database_server', 'database', 'table',
  'web_service', 'api_endpoint', 'cache_server',
  'message_broker', 'queue', 'topic',
  'container', 'pod', 'k8s_cluster',
  'config_file', 'unknown',
] as const;
export type NodeType = typeof NODE_TYPES[number];

export const EDGE_RELATIONSHIPS = [
  'connects_to', 'reads_from', 'writes_to',
  'calls', 'contains', 'depends_on',
] as const;
export type EdgeRelationship = typeof EDGE_RELATIONSHIPS[number];

export const EVENT_TYPES = [
  'process_start', 'process_end',
  'connection_open', 'connection_close',
  'window_focus', 'tool_switch',
] as const;
export type EventType = typeof EVENT_TYPES[number];

// ── Zod Schemas ──────────────────────────

export const NodeSchema = z.object({
  id: z.string().describe('Format: "{type}:{host}:{port}" oder "{type}:{name}"'),
  type: z.enum(NODE_TYPES),
  name: z.string(),
  discoveredVia: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  metadata: z.record(z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
});
export type DiscoveryNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  relationship: z.enum(EDGE_RELATIONSHIPS),
  evidence: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type DiscoveryEdge = z.infer<typeof EdgeSchema>;

export const EventSchema = z.object({
  eventType: z.enum(EVENT_TYPES),
  process: z.string(),
  pid: z.number(),
  target: z.string().optional(),
  targetType: z.enum(NODE_TYPES).optional(),
  protocol: z.string().optional(),
  port: z.number().optional(),
});
export type ActivityEvent = z.infer<typeof EventSchema>;

export const SOPStepSchema = z.object({
  order: z.number(),
  instruction: z.string(),
  tool: z.string(),
  target: z.string().optional(),
  notes: z.string().optional(),
});
export type SOPStep = z.infer<typeof SOPStepSchema>;

export const SOPSchema = z.object({
  title: z.string(),
  description: z.string(),
  steps: z.array(SOPStepSchema),
  involvedSystems: z.array(z.string()),
  estimatedDuration: z.string(),
  frequency: z.string(),
  confidence: z.number().min(0).max(1),
});
export type SOP = z.infer<typeof SOPSchema>;

// ── DB Row Types ─────────────────────────

export interface NodeRow extends DiscoveryNode {
  sessionId: string;
  discoveredAt: string;
  depth: number;
  pathId?: string;
}

export interface EdgeRow extends DiscoveryEdge {
  id: string;
  sessionId: string;
  discoveredAt: string;
  pathId?: string;
}

export interface EventRow {
  id: string;
  sessionId: string;
  taskId?: string;
  timestamp: string;
  eventType: EventType;
  process: string;
  pid: number;
  target?: string;
  targetType?: NodeType;
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
  isSOPCandidate: boolean;
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

export interface SessionRow {
  id: string;
  mode: 'discover' | 'shadow';
  startedAt: string;
  completedAt?: string;
  config: string;
}

// ── IPC Protokoll ────────────────────────

export type DaemonMessage =
  | { type: 'event'; data: EventRow }
  | { type: 'prompt'; id: string; prompt: PendingPrompt }
  | { type: 'status'; data: ShadowStatus }
  | { type: 'agent-output'; text: string }
  | { type: 'info'; message: string };

export type ClientMessage =
  | { type: 'prompt-response'; id: string; answer: string }
  | { type: 'command'; command: 'new-task' | 'end-task' | 'status' | 'stop' }
  | { type: 'task-description'; description: string };

export interface PendingPrompt {
  kind: 'node-approval' | 'task-boundary' | 'task-end';
  context: Record<string, unknown>;
  options: string[];
  defaultAnswer: string;
  timeoutMs: number;
  createdAt: string;
}

export interface ShadowStatus {
  pid: number;
  uptime: number;
  nodeCount: number;
  eventCount: number;
  taskCount: number;
  pendingPrompts: number;
  autoSave: boolean;
  mode: 'foreground' | 'daemon';
  agentActive: boolean;
  cyclesRun: number;
  cyclesSkipped: number;
}

// ── Config ───────────────────────────────

export const MIN_POLL_INTERVAL_MS = 15_000; // 15s Minimum (Agent SDK Overhead)

export interface CartographyConfig {
  mode: 'discover' | 'shadow';
  maxDepth: number;
  maxTurns: number;
  entryPoints: string[];
  agentModel: string;
  shadowMode: 'foreground' | 'daemon';
  pollIntervalMs: number;
  inactivityTimeoutMs: number;
  promptTimeoutMs: number;
  trackWindowFocus: boolean;
  autoSaveNodes: boolean;
  enableNotifications: boolean;
  shadowModel: string;
  organization?: string;
  outputDir: string;
  dbPath: string;
  socketPath: string;
  pidFile: string;
  verbose: boolean;
}

export function defaultConfig(overrides: Partial<CartographyConfig> = {}): CartographyConfig {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  return {
    mode: 'discover',
    maxDepth: 8,
    maxTurns: 50,
    entryPoints: ['localhost'],
    agentModel: 'claude-sonnet-4-5-20250929',
    shadowMode: 'daemon',
    pollIntervalMs: 30_000,
    inactivityTimeoutMs: 300_000,
    promptTimeoutMs: 60_000,
    trackWindowFocus: false,
    autoSaveNodes: false,
    enableNotifications: true,
    shadowModel: 'claude-haiku-4-5-20251001',
    outputDir: './cartography-output',
    dbPath: `${home}/.cartography/cartography.db`,
    socketPath: `${home}/.cartography/daemon.sock`,
    pidFile: `${home}/.cartography/daemon.pid`,
    verbose: false,
    ...overrides,
  };
}
