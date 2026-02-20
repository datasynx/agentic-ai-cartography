/**
 * Domain-based hex clustering.
 * Groups data assets by domain, assigns organic hex positions via spiral fill,
 * spaces clusters apart, computes centroids and color palette.
 */

import { hexSpiral, hexToPixel, hexDistance, type AxialCoord } from './hex.js';
import type { HexAsset, HexCluster, NodeRow } from './types.js';

// ── Color Palette ─────────────────────────────────────────────────────────────

/**
 * Blue → teal spectrum, ordered so adjacent domains look distinct.
 * Matches spec: navy → medium blue → periwinkle → teal/cyan.
 */
const DOMAIN_PALETTE = [
  '#1a2e5a', // 0 deep navy
  '#1e3a8a', // 1 dark blue
  '#1d4ed8', // 2 medium blue
  '#2563eb', // 3 blue
  '#3b82f6', // 4 light blue
  '#6366f1', // 5 indigo
  '#818cf8', // 6 periwinkle
  '#7c9fc3', // 7 slate blue
  '#0e7490', // 8 dark teal
  '#0891b2', // 9 teal
  '#06b6d4', // 10 cyan
  '#22d3ee', // 11 light cyan
  '#0d9488', // 12 dark teal-green
  '#14b8a6', // 13 teal
  '#2dd4bf', // 14 light teal
  '#5eead4', // 15 pale teal
];

/**
 * Assign a deterministic color from the palette to a domain name.
 */
export function domainColor(domain: string, allDomains: string[]): string {
  const idx = allDomains.indexOf(domain);
  return DOMAIN_PALETTE[idx % DOMAIN_PALETTE.length];
}

/**
 * Generate a slightly lighter shade variant of a hex color string.
 * Used for per-hexagon depth/texture variation within a cluster.
 */
export function shadeVariant(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ── Cluster Layout ────────────────────────────────────────────────────────────

const HEX_SIZE = 24;        // circumradius of each hexagon tile
const CLUSTER_GAP = 3;      // min hex distance between cluster bounding cells

interface ClusterPlacement {
  domain: string;
  positions: AxialCoord[];
  origin: AxialCoord;
}

/**
 * Arrange all domain clusters on the hex grid without overlap.
 * Uses a greedy spiral placement: place cluster 0 at origin,
 * each subsequent cluster is placed at the nearest gap-respecting position.
 */
function layoutClusters(
  domainSizes: Array<{ domain: string; count: number }>,
): ClusterPlacement[] {
  const placements: ClusterPlacement[] = [];
  const occupied = new Set<string>();

  const key = (q: number, r: number) => `${q},${r}`;

  for (const { domain, count } of domainSizes) {
    // Find an origin for this cluster that doesn't overlap any placed hex
    let origin: AxialCoord = { q: 0, r: 0 };
    if (placements.length > 0) {
      origin = findFreeOrigin(placements, occupied, count, CLUSTER_GAP);
    }

    // Assign hex positions via spiral from origin
    const positions = hexSpiral(origin, count);

    for (const p of positions) {
      occupied.add(key(p.q, p.r));
    }

    placements.push({ domain, positions, origin });
  }

  return placements;
}

/**
 * Find an origin far enough from all existing clusters.
 */
function findFreeOrigin(
  existing: ClusterPlacement[],
  occupied: Set<string>,
  newCount: number,
  gap: number,
): AxialCoord {
  const radius = estimateRadius(newCount);
  // Search in expanding rings around the global origin
  for (let searchRing = 1; searchRing < 200; searchRing++) {
    const candidates = hexSpiral({ q: 0, r: 0 }, searchRing * (radius * 2 + gap + 2));
    for (const candidate of candidates) {
      const testPositions = hexSpiral(candidate, newCount);
      let fits = true;
      for (const tp of testPositions) {
        // Check gap against all already-occupied hexes
        for (const ep of existing.flatMap(p => p.positions)) {
          if (hexDistance(tp, ep) < gap) {
            fits = false;
            break;
          }
        }
        if (!fits) break;
      }
      if (fits) return candidate;
    }
  }
  // Fallback: just offset by a large amount
  return { q: existing.length * 20, r: 0 };
}

function estimateRadius(count: number): number {
  return Math.ceil(Math.sqrt(count));
}

// ── Centroid ──────────────────────────────────────────────────────────────────

function computeCentroid(positions: AxialCoord[], size: number): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const { q, r } of positions) {
    const { x, y } = hexToPixel(q, r, size);
    sx += x; sy += y;
  }
  return { x: sx / positions.length, y: sy / positions.length };
}

// ── Sub-cluster helpers ───────────────────────────────────────────────────────

export interface SubClusterInfo {
  subDomain: string;
  assetIds: string[];
  centroid: { x: number; y: number };
}

function groupBySubDomain(assets: HexAsset[]): SubClusterInfo[] {
  const map = new Map<string, string[]>();
  for (const a of assets) {
    if (!a.subDomain) continue;
    if (!map.has(a.subDomain)) map.set(a.subDomain, []);
    map.get(a.subDomain)!.push(a.id);
  }
  return Array.from(map.entries()).map(([subDomain, assetIds]) => ({
    subDomain,
    assetIds,
    centroid: { x: 0, y: 0 }, // filled in after position assignment
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface ClusterLayout {
  clusters: HexCluster[];
  subClusters: Map<string, SubClusterInfo[]>; // clusterId → sub-clusters
  hexSize: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Build the full cluster layout from a flat list of NodeRow records.
 *
 * Nodes without a `domain` field are grouped under "Other".
 */
export function buildClusterLayout(nodes: NodeRow[]): ClusterLayout {
  const size = HEX_SIZE;

  // 1. Group by domain
  const byDomain = new Map<string, NodeRow[]>();
  for (const n of nodes) {
    const d = n.domain ?? 'Other';
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(n);
  }

  // 2. Sort domains by size descending (largest cluster first, easiest to place)
  const domainSizes = Array.from(byDomain.entries())
    .map(([domain, ns]) => ({ domain, count: ns.length }))
    .sort((a, b) => b.count - a.count);

  const allDomains = domainSizes.map(d => d.domain);

  // 3. Layout cluster positions
  const placements = layoutClusters(domainSizes);

  // 4. Build HexCluster objects
  const clusters: HexCluster[] = [];
  const subClustersMap = new Map<string, SubClusterInfo[]>();

  for (const placement of placements) {
    const { domain, positions } = placement;
    const domainNodes = byDomain.get(domain) ?? [];
    const color = domainColor(domain, allDomains);

    // Assign positions to assets
    const assets: HexAsset[] = domainNodes.map((n, i) => ({
      id: n.id,
      name: n.name,
      domain: n.domain ?? 'Other',
      subDomain: n.subDomain,
      qualityScore: n.qualityScore,
      metadata: n.metadata ?? {},
      position: positions[i] ?? { q: 0, r: 0 },
    }));

    const centroid = computeCentroid(positions.slice(0, assets.length), size);
    const clusterId = `cluster:${domain}`;

    clusters.push({
      id: clusterId,
      label: domain,
      domain,
      color,
      assets,
      centroid,
    });

    // Sub-cluster info
    const subs = groupBySubDomain(assets);
    // Compute sub-cluster centroids
    const assetById = new Map(assets.map(a => [a.id, a]));
    for (const sub of subs) {
      const subPositions = sub.assetIds
        .map(id => assetById.get(id)?.position)
        .filter(Boolean) as AxialCoord[];
      if (subPositions.length > 0) {
        sub.centroid = computeCentroid(subPositions, size);
      }
    }
    if (subs.length > 0) subClustersMap.set(clusterId, subs);
  }

  // 5. Global bounding box in pixel space
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const cluster of clusters) {
    for (const asset of cluster.assets) {
      const { x, y } = hexToPixel(asset.position.q, asset.position.r, size);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

  return { clusters, subClusters: subClustersMap, hexSize: size, bounds: { minX, minY, maxX, maxY } };
}
