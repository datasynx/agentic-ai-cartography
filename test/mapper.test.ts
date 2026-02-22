import { describe, it, expect } from 'vitest';
import { nodesToAssets, edgesToConnections, buildMapData } from '../src/mapper.js';
import type { NodeRow, EdgeRow } from '../src/types.js';

function makeNode(id: string, overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    id,
    sessionId: 'test',
    type: 'saas_tool',
    name: id.split(':').pop() ?? id,
    discoveredVia: 'test',
    discoveredAt: new Date().toISOString(),
    depth: 0,
    confidence: 0.9,
    metadata: {},
    tags: [],
    ...overrides,
  };
}

function makeEdge(sourceId: string, targetId: string): EdgeRow {
  return {
    id: crypto.randomUUID(),
    sessionId: 'test',
    sourceId,
    targetId,
    relationship: 'calls',
    evidence: 'test',
    confidence: 0.8,
    discoveredAt: new Date().toISOString(),
  };
}

describe('nodesToAssets', () => {
  it('converts nodes to assets', () => {
    const nodes = [makeNode('saas_tool:hubspot', { name: 'HubSpot' })];
    const assets = nodesToAssets(nodes);
    expect(assets).toHaveLength(1);
    expect(assets[0].id).toBe('saas_tool:hubspot');
    expect(assets[0].name).toBe('HubSpot');
    expect(assets[0].domain).toBeTruthy();
  });

  it('uses explicit domain if set', () => {
    const nodes = [makeNode('saas_tool:x', { domain: 'Marketing' })];
    const assets = nodesToAssets(nodes);
    expect(assets[0].domain).toBe('Marketing');
  });

  it('falls back to type-based domain', () => {
    const nodes = [makeNode('database_server:pg', { type: 'database_server' })];
    const assets = nodesToAssets(nodes);
    expect(assets[0].domain).toBe('Data Layer');
  });

  it('uses confidence as qualityScore fallback', () => {
    const nodes = [makeNode('host:x', { confidence: 0.75 })];
    const assets = nodesToAssets(nodes);
    expect(assets[0].qualityScore).toBe(75);
  });

  it('prefers explicit qualityScore over confidence', () => {
    const nodes = [makeNode('host:x', { confidence: 0.5, qualityScore: 90 })];
    const assets = nodesToAssets(nodes);
    expect(assets[0].qualityScore).toBe(90);
  });

  it('returns empty array for empty input', () => {
    expect(nodesToAssets([])).toEqual([]);
  });
});

describe('edgesToConnections', () => {
  it('converts edges to connections', () => {
    const edges = [makeEdge('a', 'b')];
    const connections = edgesToConnections(edges);
    expect(connections).toHaveLength(1);
    expect(connections[0].sourceAssetId).toBe('a');
    expect(connections[0].targetAssetId).toBe('b');
    expect(connections[0].type).toBe('calls');
  });

  it('returns empty array for empty input', () => {
    expect(edgesToConnections([])).toEqual([]);
  });
});

describe('buildMapData', () => {
  it('returns complete map data', () => {
    const nodes = [
      makeNode('saas_tool:hubspot', { name: 'HubSpot', domain: 'Marketing' }),
      makeNode('database_server:pg', { name: 'PostgreSQL', type: 'database_server' }),
    ];
    const edges = [makeEdge('saas_tool:hubspot', 'database_server:pg')];
    const mapData = buildMapData(nodes, edges);

    expect(mapData.assets).toHaveLength(2);
    expect(mapData.clusters.length).toBeGreaterThan(0);
    expect(mapData.connections).toHaveLength(1);
    expect(mapData.meta.exportedAt).toBeTruthy();
    expect(mapData.meta.theme).toBe('light');
  });

  it('handles empty input', () => {
    const mapData = buildMapData([], []);
    expect(mapData.assets).toHaveLength(0);
    expect(mapData.clusters).toHaveLength(0);
    expect(mapData.connections).toHaveLength(0);
  });

  it('respects theme option', () => {
    const mapData = buildMapData([], [], { theme: 'dark' });
    expect(mapData.meta.theme).toBe('dark');
  });

  it('assigns positions to all assets', () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      makeNode(`saas_tool:tool-${i}`, { name: `Tool ${i}` })
    );
    const mapData = buildMapData(nodes, []);
    for (const a of mapData.assets) {
      expect(typeof a.position.q).toBe('number');
      expect(typeof a.position.r).toBe('number');
    }
  });
});
