import { describe, it, expect } from 'vitest';
import { domainColor, shadeVariant, buildClusterLayout } from '../src/cluster.js';
import type { NodeRow } from '../src/types.js';

function makeNode(id: string, domain?: string, subDomain?: string, qualityScore?: number): NodeRow {
  return {
    id,
    sessionId: 'test',
    type: 'saas_tool',
    name: id,
    discoveredVia: 'test',
    discoveredAt: new Date().toISOString(),
    depth: 0,
    confidence: 1,
    metadata: {},
    tags: [],
    domain,
    subDomain,
    qualityScore,
  };
}

describe('domainColor', () => {
  it('returns a valid hex color string', () => {
    const color = domainColor('Marketing', ['Marketing', 'Finance']);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('assigns different colors to different domains', () => {
    const domains = ['Marketing', 'Finance', 'HR', 'Logistics'];
    const colors = domains.map(d => domainColor(d, domains));
    const unique = new Set(colors);
    expect(unique.size).toBe(domains.length);
  });

  it('is deterministic', () => {
    const domains = ['Sales', 'Finance'];
    expect(domainColor('Sales', domains)).toBe(domainColor('Sales', domains));
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

describe('buildClusterLayout', () => {
  it('returns empty layout for no nodes', () => {
    const layout = buildClusterLayout([]);
    expect(layout.clusters).toHaveLength(0);
  });

  it('groups nodes by domain', () => {
    const nodes = [
      makeNode('a1', 'Marketing'),
      makeNode('a2', 'Marketing'),
      makeNode('b1', 'Finance'),
    ];
    const layout = buildClusterLayout(nodes);
    expect(layout.clusters).toHaveLength(2);
    const marketing = layout.clusters.find(c => c.domain === 'Marketing');
    expect(marketing?.assets).toHaveLength(2);
    const finance = layout.clusters.find(c => c.domain === 'Finance');
    expect(finance?.assets).toHaveLength(1);
  });

  it('nodes without domain go into "Other" cluster', () => {
    const nodes = [makeNode('x1'), makeNode('x2')];
    const layout = buildClusterLayout(nodes);
    const other = layout.clusters.find(c => c.domain === 'Other');
    expect(other).toBeDefined();
    expect(other?.assets).toHaveLength(2);
  });

  it('each asset has a position', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => makeNode(`n${i}`, 'HR'));
    const layout = buildClusterLayout(nodes);
    for (const cluster of layout.clusters) {
      for (const asset of cluster.assets) {
        expect(typeof asset.position.q).toBe('number');
        expect(typeof asset.position.r).toBe('number');
      }
    }
  });

  it('clusters have valid centroids', () => {
    const nodes = [makeNode('m1', 'Marketing'), makeNode('m2', 'Marketing')];
    const layout = buildClusterLayout(nodes);
    const c = layout.clusters[0];
    expect(typeof c.centroid.x).toBe('number');
    expect(typeof c.centroid.y).toBe('number');
    expect(isFinite(c.centroid.x)).toBe(true);
  });

  it('clusters have colors', () => {
    const nodes = [makeNode('f1', 'Finance')];
    const layout = buildClusterLayout(nodes);
    expect(layout.clusters[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('sub-clusters are grouped by subDomain', () => {
    const nodes = [
      makeNode('a', 'Supply Chain', 'Forecast client orders'),
      makeNode('b', 'Supply Chain', 'Forecast client orders'),
      makeNode('c', 'Supply Chain', 'Production Planning'),
    ];
    const layout = buildClusterLayout(nodes);
    const clusterId = layout.clusters[0].id;
    const subs = layout.subClusters.get(clusterId);
    expect(subs).toHaveLength(2);
    const forecast = subs?.find(s => s.subDomain === 'Forecast client orders');
    expect(forecast?.assetIds).toHaveLength(2);
  });

  it('large dataset positions all assets', () => {
    const nodes = Array.from({ length: 100 }, (_, i) =>
      makeNode(`n${i}`, ['Marketing', 'Finance', 'HR', 'Logistics'][i % 4])
    );
    const layout = buildClusterLayout(nodes);
    const totalAssets = layout.clusters.reduce((s, c) => s + c.assets.length, 0);
    expect(totalAssets).toBe(100);
  });
});
