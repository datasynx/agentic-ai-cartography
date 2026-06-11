import { z } from 'zod';

// ── Enums ────────────────────────────────

export const NODE_TYPES = [
  'host', 'database_server', 'database', 'table',
  'web_service', 'api_endpoint', 'cache_server',
  'message_broker', 'queue', 'topic',
  'container', 'pod', 'k8s_cluster',
  'config_file', 'saas_tool', 'unknown',
] as const;
export type NodeType = typeof NODE_TYPES[number];

/**
 * Semantic groupings of node types — the single source of truth shared by the MCP
 * resource layer (services/databases) and the exporters (layer assignment). Each
 * node type belongs to at most one group; anything ungrouped is treated as "other".
 */
export const NODE_TYPE_GROUPS = {
  saas:      ['saas_tool'],
  web:       ['web_service', 'api_endpoint'],
  data:      ['database_server', 'database', 'table', 'cache_server'],
  messaging: ['message_broker', 'queue', 'topic'],
  infra:     ['host', 'container', 'pod', 'k8s_cluster'],
  config:    ['config_file'],
} as const satisfies Record<string, readonly NodeType[]>;

export const EDGE_RELATIONSHIPS = [
  'connects_to', 'reads_from', 'writes_to',
  'calls', 'contains', 'depends_on',
] as const;
export type EdgeRelationship = typeof EDGE_RELATIONSHIPS[number];

// ── Zod Schemas ──────────────────────────

export const NodeSchema = z.object({
  id: z.string().describe('Format: "{type}:{host}:{port}" or "{type}:{name}"'),
  type: z.enum(NODE_TYPES),
  name: z.string(),
  discoveredVia: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  domain: z.string().optional().describe('Business domain, e.g. "Marketing", "Finance"'),
  subDomain: z.string().optional().describe('Sub-domain, e.g. "Forecast client orders"'),
  qualityScore: z.number().min(0).max(100).optional().describe('Data quality score 0–100'),
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

// ── Cartography Map Types ────────────────

export const DataAssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
  subDomain: z.string().optional(),
  qualityScore: z.number().min(0).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  position: z.object({ q: z.number(), r: z.number() }),
});
export type DataAsset = z.infer<typeof DataAssetSchema>;

export const ClusterSchema = z.object({
  id: z.string(),
  label: z.string(),
  domain: z.string(),
  color: z.string(),
  assetIds: z.array(z.string()),
  centroid: z.object({ x: z.number(), y: z.number() }),
});
export type Cluster = z.infer<typeof ClusterSchema>;

export const ConnectionSchema = z.object({
  id: z.string(),
  sourceAssetId: z.string(),
  targetAssetId: z.string(),
  type: z.string().optional(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export interface CartographyMapData {
  assets: DataAsset[];
  clusters: Cluster[];
  connections: Connection[];
  meta: { exportedAt: string; theme: 'light' | 'dark' };
}

/** Navy → medium blue → periwinkle → teal/cyan palette */
export const DOMAIN_COLORS: Record<string, string> = {
  'Quality Control': '#1a2744',
  'Supply Chain': '#1e3a6e',
  'Marketing': '#6a7fb5',
  'Finance': '#3a8a8a',
  'HR': '#2a5a9a',
  'Logistics': '#0e7490',
  'Sales': '#1d4ed8',
  'Engineering': '#4338ca',
  'Operations': '#0891b2',
  'Data Layer': '#1e3352',
  'Web / API': '#1a3a1a',
  'Messaging': '#2a1a3a',
  'Infrastructure': '#0f2a40',
  'Other': '#374151',
};

/** Ordered palette for dynamic domain assignment */
export const DOMAIN_PALETTE = [
  '#1a2e5a', '#1e3a8a', '#1d4ed8', '#2563eb', '#3b82f6',
  '#6366f1', '#818cf8', '#7c9fc3', '#0e7490', '#0891b2',
  '#06b6d4', '#22d3ee', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4',
] as const;

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

export interface SessionRow {
  id: string;
  mode: 'discover';
  startedAt: string;
  completedAt?: string;
  config: string;
  /** Human-friendly, deterministically-derived label (e.g. "infra+data · 42 nodes · 2026-06-11"). */
  name?: string;
}

// ── Diff / Drift ─────────────────────────

/**
 * Node fields whose change marks a node as `changed` in a topology diff.
 * `confidence` is deliberately excluded — it fluctuates between scans (noise)
 * and is reported separately as `confidenceDelta` rather than triggering drift.
 */
export const DRIFT_FIELDS = ['type', 'name', 'domain', 'subDomain', 'qualityScore', 'metadata', 'tags'] as const;
export type DriftField = typeof DRIFT_FIELDS[number];

export interface NodeChange {
  id: string;
  before: NodeRow;
  after: NodeRow;
  /** Which of DRIFT_FIELDS differ between `before` and `after`. */
  changedFields: DriftField[];
  /** Informational confidence delta (after − before); does not itself trigger drift. */
  confidenceDelta: number;
}

export interface TopologyDiff {
  base: { sessionId: string; startedAt: string; nodeCount: number; edgeCount: number };
  current: { sessionId: string; startedAt: string; nodeCount: number; edgeCount: number };
  nodes: { added: NodeRow[]; removed: NodeRow[]; changed: NodeChange[]; unchanged: number };
  edges: { added: EdgeRow[]; removed: EdgeRow[]; unchanged: number };
  summary: {
    nodesAdded: number; nodesRemoved: number; nodesChanged: number;
    edgesAdded: number; edgesRemoved: number;
  };
}

// ── Config ───────────────────────────────

export interface CartographyConfig {
  maxDepth: number;
  maxTurns: number;
  entryPoints: string[];
  agentModel: string;
  organization?: string;
  outputDir: string;
  dbPath: string;
  verbose: boolean;
  /** Max characters of a single scan-tool response returned to the agent (guards the context window). */
  maxToolResponseBytes: number;
}

export function defaultConfig(overrides: Partial<CartographyConfig> = {}): CartographyConfig {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  return {
    maxDepth: 8,
    maxTurns: 50,
    entryPoints: ['localhost'],
    agentModel: 'claude-sonnet-4-5-20250929',
    outputDir: './cartography-output',
    dbPath: `${home}/.cartography/cartography.db`,
    verbose: false,
    maxToolResponseBytes: 100_000,
    ...overrides,
  };
}
