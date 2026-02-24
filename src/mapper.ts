/**
 * Node-to-Asset Mapping.
 * Converts existing DiscoveryNode/Edge data into the CartographyMap data model.
 */

import type { NodeRow, EdgeRow, DataAsset, Connection, CartographyMapData } from './types.js';
import { layoutClusters, groupByDomain } from './cluster.js';

// ── Domain Mapping ───────────────────────────────────────────────────────────

const TYPE_TO_DOMAIN: Record<string, string> = {
  database_server: 'Data Layer',
  database: 'Data Layer',
  table: 'Data Layer',
  cache_server: 'Data Layer',
  web_service: 'Web / API',
  api_endpoint: 'Web / API',
  message_broker: 'Messaging',
  queue: 'Messaging',
  topic: 'Messaging',
  host: 'Infrastructure',
  container: 'Infrastructure',
  pod: 'Infrastructure',
  k8s_cluster: 'Infrastructure',
  config_file: 'Infrastructure',
  saas_tool: 'SaaS Tools',
};

/**
 * Determine the domain for a node.
 * Priority: explicit node.domain > metadata.category > tag-based > type-based > "Other"
 */
function resolveDomain(node: NodeRow): string {
  // 1. Explicit domain field
  if (node.domain) return node.domain;

  // 2. Metadata category
  const meta = node.metadata as Record<string, unknown>;
  if (typeof meta['category'] === 'string' && meta['category'].length > 0) {
    return meta['category'];
  }

  // 3. Tags — use first tag that looks like a domain
  for (const tag of node.tags ?? []) {
    if (tag.length > 2 && tag[0] === tag[0].toUpperCase()) {
      return tag;
    }
  }

  // 4. Type-based mapping
  return TYPE_TO_DOMAIN[node.type] ?? 'Other';
}

// ── Conversion ───────────────────────────────────────────────────────────────

/**
 * Convert NodeRow[] to DataAsset[].
 */
export function nodesToAssets(nodes: NodeRow[]): DataAsset[] {
  return nodes.map(n => ({
    id: n.id,
    name: n.name,
    domain: resolveDomain(n),
    subDomain: n.subDomain,
    qualityScore: n.qualityScore ?? Math.round(n.confidence * 100),
    metadata: n.metadata ?? {},
    position: { q: 0, r: 0 }, // will be assigned by layoutClusters
  }));
}

/**
 * Convert EdgeRow[] to Connection[].
 */
export function edgesToConnections(edges: EdgeRow[]): Connection[] {
  return edges.map(e => ({
    id: e.id,
    sourceAssetId: e.sourceId,
    targetAssetId: e.targetId,
    type: e.relationship,
  }));
}

// ── Full Pipeline ─────────────────────────────────────────────────────────────

const HEX_SIZE = 24;

/**
 * Build a complete CartographyMapData from raw nodes and edges.
 */
export function buildMapData(
  nodes: NodeRow[],
  edges: EdgeRow[],
  options?: { theme?: 'light' | 'dark' },
): CartographyMapData {
  const rawAssets = nodesToAssets(nodes);
  const connections = edgesToConnections(edges);

  if (rawAssets.length === 0) {
    return {
      assets: [],
      clusters: [],
      connections,
      meta: { exportedAt: new Date().toISOString(), theme: options?.theme ?? 'light' },
    };
  }

  const groups = groupByDomain(rawAssets);
  const { clusters, assets } = layoutClusters(groups, HEX_SIZE);

  return {
    assets,
    clusters,
    connections,
    meta: { exportedAt: new Date().toISOString(), theme: options?.theme ?? 'light' },
  };
}
