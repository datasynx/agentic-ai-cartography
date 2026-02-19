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
