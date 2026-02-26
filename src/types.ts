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

export const EDGE_RELATIONSHIPS = [
  'connects_to', 'reads_from', 'writes_to',
  'calls', 'contains', 'depends_on',
] as const;
export type EdgeRelationship = typeof EDGE_RELATIONSHIPS[number];

// ── Zod Schemas ──────────────────────────

export const NodeSchema = z.object({
  id: z.string().describe('Format: "{type}:{host}:{port}" oder "{type}:{name}"'),
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
    ...overrides,
  };
}
