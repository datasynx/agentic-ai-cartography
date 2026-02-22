import { describe, it, expect } from 'vitest';
import {
  assignColor, assignColors, shadeVariant,
  groupByDomain, layoutClusters, computeCentroid, computeClusterBounds,
} from '../src/cluster.js';
import type { DataAsset } from '../src/types.js';

function makeAsset(id: string, domain: string, subDomain?: string, qualityScore?: number): DataAsset {
  return {
    id,
    name: id,
    domain,
    subDomain,
    qualityScore,
    metadata: {},
    position: { q: 0, r: 0 },
  };
}

describe('assignColor', () => {
  it('returns a valid hex color string', () => {
    const color = assignColor('Marketing', ['Marketing', 'Finance']);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('assigns different colors to different domains', () => {
    const domains = ['Marketing', 'Finance', 'HR', 'Logistics'];
    const colors = domains.map(d => assignColor(d, domains));
    const unique = new Set(colors);
    expect(unique.size).toBe(domains.length);
  });

  it('uses predefined DOMAIN_COLORS if available', () => {
    const color = assignColor('Marketing', ['Marketing']);
    expect(color).toBe('#6a7fb5');
  });
});

describe('assignColors', () => {
  it('returns a color for every domain', () => {
    const domains = ['A', 'B', 'C'];
    const result = assignColors(domains);
    expect(Object.keys(result)).toHaveLength(3);
    for (const d of domains) {
      expect(result[d]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('shadeVariant', () => {
  it('returns a valid hex color', () => {
    expect(shadeVariant('#1a2e5a', 20)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('lightens the color', () => {
    const base = '#1a2e5a';
    const light = shadeVariant(base, 30);
    const bNum = parseInt(base.replace('#', ''), 16);
    const lNum = parseInt(light.replace('#', ''), 16);
    expect(lNum).toBeGreaterThan(bNum);
  });

  it('clamps at 255', () => {
    const result = shadeVariant('#ffffff', 50);
    expect(result).toBe('#ffffff');
  });
});

describe('groupByDomain', () => {
  it('groups assets by domain', () => {
    const assets = [makeAsset('a1', 'Marketing'), makeAsset('a2', 'Marketing'), makeAsset('b1', 'Finance')];
    const groups = groupByDomain(assets);
    expect(groups.get('Marketing')?.length).toBe(2);
    expect(groups.get('Finance')?.length).toBe(1);
  });

  it('empty domain defaults to Other', () => {
    const assets = [makeAsset('x1', '')];
    const groups = groupByDomain(assets);
    expect(groups.has('Other')).toBe(true);
  });
});

describe('layoutClusters', () => {
  it('returns empty layout for no assets', () => {
    const { clusters, assets } = layoutClusters(new Map(), 24);
    expect(clusters).toHaveLength(0);
    expect(assets).toHaveLength(0);
  });

  it('groups into clusters with positions', () => {
    const assets = [
      makeAsset('a1', 'Marketing'),
      makeAsset('a2', 'Marketing'),
      makeAsset('b1', 'Finance'),
    ];
    const groups = groupByDomain(assets);
    const { clusters, assets: positioned } = layoutClusters(groups, 24);

    expect(clusters).toHaveLength(2);
    expect(positioned).toHaveLength(3);

    // Each asset should have a position
    for (const a of positioned) {
      expect(typeof a.position.q).toBe('number');
      expect(typeof a.position.r).toBe('number');
    }
  });

  it('clusters have valid centroids', () => {
    const assets = [makeAsset('m1', 'Marketing'), makeAsset('m2', 'Marketing')];
    const groups = groupByDomain(assets);
    const { clusters } = layoutClusters(groups, 24);
    const c = clusters[0];
    expect(typeof c.centroid.x).toBe('number');
    expect(typeof c.centroid.y).toBe('number');
    expect(isFinite(c.centroid.x)).toBe(true);
  });

  it('clusters have colors', () => {
    const assets = [makeAsset('f1', 'Finance')];
    const groups = groupByDomain(assets);
    const { clusters } = layoutClusters(groups, 24);
    expect(clusters[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('positions all assets in large dataset', () => {
    const assets = Array.from({ length: 50 }, (_, i) =>
      makeAsset(`n${i}`, ['Marketing', 'Finance', 'HR', 'Logistics'][i % 4])
    );
    const groups = groupByDomain(assets);
    const { assets: positioned } = layoutClusters(groups, 24);
    expect(positioned).toHaveLength(50);
  });
});

describe('computeCentroid', () => {
  it('returns origin for empty', () => {
    expect(computeCentroid([], 24)).toEqual({ x: 0, y: 0 });
  });

  it('returns the pixel center', () => {
    const centroid = computeCentroid([{ q: 0, r: 0 }], 24);
    expect(centroid.x).toBeCloseTo(0);
    expect(centroid.y).toBeCloseTo(0);
  });
});

describe('computeClusterBounds', () => {
  it('returns zeros for empty', () => {
    expect(computeClusterBounds([], 24)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('returns bounding box for assets', () => {
    const assets = [
      makeAsset('a', 'X'), makeAsset('b', 'X'),
    ];
    assets[0].position = { q: 0, r: 0 };
    assets[1].position = { q: 2, r: 0 };
    const bounds = computeClusterBounds(assets, 24);
    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
  });
});
