/**
 * Domain-based clustering and hex grid positioning.
 * Groups data assets by domain, assigns organic hex positions via spiral fill,
 * computes cluster centroids and assigns colors from the domain palette.
 */

import { hexSpiral, hexToPixel, hexDistance, type AxialCoord } from './hex.js';
import type { DataAsset, Cluster } from './types.js';
import { DOMAIN_COLORS, DOMAIN_PALETTE } from './types.js';

// ── Color Assignment ──────────────────────────────────────────────────────────

/**
 * Assign a deterministic color from the palette to a domain name.
 * Uses the predefined DOMAIN_COLORS map first, then falls back to the palette.
 */
export function assignColor(domain: string, allDomains: string[]): string {
  if (DOMAIN_COLORS[domain]) return DOMAIN_COLORS[domain];
  const idx = allDomains.indexOf(domain);
  return DOMAIN_PALETTE[idx % DOMAIN_PALETTE.length];
}

/**
 * Assign colors to all domains in the dataset.
 */
export function assignColors(domains: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const d of domains) {
    result[d] = assignColor(d, domains);
  }
  return result;
}

/**
 * Generate a slightly lighter shade of a hex color string.
 */
export function shadeVariant(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ── Grouping ──────────────────────────────────────────────────────────────────

/**
 * Group assets by their `domain` field.
 */
export function groupByDomain(assets: DataAsset[]): Map<string, DataAsset[]> {
  const map = new Map<string, DataAsset[]>();
  for (const a of assets) {
    const d = a.domain || 'Other';
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(a);
  }
  return map;
}

// ── Cluster Layout ────────────────────────────────────────────────────────────

const CLUSTER_GAP = 3; // min hex distance between cluster borders

/**
 * Arrange domain clusters on the hex grid without overlap.
 * Places largest clusters first at the origin, subsequent clusters spiral outward.
 */
export function layoutClusters(
  groups: Map<string, DataAsset[]>,
  hexSize: number,
): { clusters: Cluster[]; assets: DataAsset[] } {
  const allDomains = Array.from(groups.keys());
  const colors = assignColors(allDomains);

  // Sort domains by size descending (largest first → center)
  const sorted = Array.from(groups.entries())
    .sort((a, b) => b[1].length - a[1].length);

  const occupied = new Set<string>();
  const key = (q: number, r: number) => `${q},${r}`;

  const clusters: Cluster[] = [];
  const allAssets: DataAsset[] = [];

  for (const [domain, domainAssets] of sorted) {
    // Find a free origin for this cluster
    const origin = clusters.length === 0
      ? { q: 0, r: 0 }
      : findFreeOrigin(occupied, domainAssets.length, CLUSTER_GAP);

    // Pack assets in a spiral around the origin
    const positions = hexSpiral(origin, domainAssets.length);

    const assetIds: string[] = [];
    for (let i = 0; i < domainAssets.length; i++) {
      const asset = domainAssets[i];
      asset.position = positions[i];
      assetIds.push(asset.id);
      occupied.add(key(positions[i].q, positions[i].r));
      allAssets.push(asset);
    }

    const centroid = computeCentroid(positions, hexSize);

    clusters.push({
      id: `cluster:${domain}`,
      label: domain,
      domain,
      color: colors[domain],
      assetIds,
      centroid,
    });
  }

  return { clusters, assets: allAssets };
}

/**
 * Find a cluster origin that doesn't overlap any occupied hexes.
 */
function findFreeOrigin(
  occupied: Set<string>,
  count: number,
  gap: number,
): AxialCoord {
  const key = (q: number, r: number) => `${q},${r}`;

  // Search in expanding rings around the global origin
  for (let searchRadius = 1; searchRadius < 100; searchRadius++) {
    const candidates = hexSpiral({ q: 0, r: 0 }, 1 + 6 * searchRadius * (searchRadius + 1) / 2);

    for (const candidate of candidates) {
      const testPositions = hexSpiral(candidate, count);
      let fits = true;

      for (const tp of testPositions) {
        // Check that the cell itself and its gap neighbors are free
        if (occupied.has(key(tp.q, tp.r))) { fits = false; break; }

        for (const oKey of occupied) {
          const [oq, or] = oKey.split(',').map(Number);
          if (hexDistance(tp, { q: oq, r: or }) < gap) {
            fits = false;
            break;
          }
        }
        if (!fits) break;
      }

      if (fits) return candidate;
    }
  }

  // Fallback
  return { q: occupied.size * 5, r: 0 };
}

// ── Centroid ──────────────────────────────────────────────────────────────────

export function computeCentroid(positions: AxialCoord[], hexSize: number): { x: number; y: number } {
  if (positions.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const { q, r } of positions) {
    const { x, y } = hexToPixel(q, r, hexSize);
    sx += x;
    sy += y;
  }
  return { x: sx / positions.length, y: sy / positions.length };
}

// ── Cluster Bounds ────────────────────────────────────────────────────────────

export function computeClusterBounds(
  assets: DataAsset[],
  hexSize: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (assets.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const a of assets) {
    const { x, y } = hexToPixel(a.position.q, a.position.r, hexSize);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
