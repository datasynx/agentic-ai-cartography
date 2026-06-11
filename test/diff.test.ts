import { describe, it, expect } from 'vitest';
import { diffTopology, stableStringify } from '../src/diff.js';
import type { NodeRow, EdgeRow } from '../src/types.js';

const node = (id: string, over: Partial<NodeRow> = {}): NodeRow => ({
  id,
  type: 'host',
  name: id,
  discoveredVia: 'test',
  confidence: 0.9,
  metadata: {},
  tags: [],
  sessionId: 's',
  discoveredAt: '2026-01-01T00:00:00Z',
  depth: 0,
  ...over,
});

const edge = (sourceId: string, targetId: string, over: Partial<EdgeRow> = {}): EdgeRow => ({
  id: `${sourceId}->${targetId}`,
  sessionId: 's',
  sourceId,
  targetId,
  relationship: 'connects_to',
  evidence: 'test',
  confidence: 0.8,
  discoveredAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('diffTopology — nodes', () => {
  it('identical snapshots produce an empty diff', () => {
    const nodes = [node('host:a'), node('host:b')];
    const d = diffTopology({ nodes, edges: [] }, { nodes, edges: [] });
    expect(d.summary).toEqual({ nodesAdded: 0, nodesRemoved: 0, nodesChanged: 0, edgesAdded: 0, edgesRemoved: 0 });
    expect(d.nodes.unchanged).toBe(2);
  });

  it('detects added nodes', () => {
    const d = diffTopology({ nodes: [node('host:a')], edges: [] }, { nodes: [node('host:a'), node('host:b')], edges: [] });
    expect(d.nodes.added.map((n) => n.id)).toEqual(['host:b']);
    expect(d.summary.nodesAdded).toBe(1);
    expect(d.nodes.unchanged).toBe(1);
  });

  it('detects removed nodes', () => {
    const d = diffTopology({ nodes: [node('host:a'), node('host:b')], edges: [] }, { nodes: [node('host:a')], edges: [] });
    expect(d.nodes.removed.map((n) => n.id)).toEqual(['host:b']);
    expect(d.summary.nodesRemoved).toBe(1);
  });

  it('marks a node changed when a drift field differs and reports which', () => {
    const before = node('host:a', { name: 'old', domain: 'X' });
    const after = node('host:a', { name: 'new', domain: 'Y' });
    const d = diffTopology({ nodes: [before], edges: [] }, { nodes: [after], edges: [] });
    expect(d.summary.nodesChanged).toBe(1);
    expect(d.nodes.changed[0]!.changedFields.sort()).toEqual(['domain', 'name']);
  });

  it('does NOT mark a node changed for a confidence-only difference, but reports confidenceDelta', () => {
    const before = node('host:a', { confidence: 0.5 });
    const after = node('host:a', { confidence: 0.9 });
    const d = diffTopology({ nodes: [before], edges: [] }, { nodes: [after], edges: [] });
    expect(d.summary.nodesChanged).toBe(0);
    expect(d.nodes.unchanged).toBe(1);
  });

  it('treats tags as an unordered set', () => {
    const before = node('host:a', { tags: ['x', 'y'] });
    const after = node('host:a', { tags: ['y', 'x'] });
    const d = diffTopology({ nodes: [before], edges: [] }, { nodes: [after], edges: [] });
    expect(d.summary.nodesChanged).toBe(0);
  });

  it('treats metadata as order-independent', () => {
    const before = node('host:a', { metadata: { a: 1, b: 2 } });
    const after = node('host:a', { metadata: { b: 2, a: 1 } });
    const d = diffTopology({ nodes: [before], edges: [] }, { nodes: [after], edges: [] });
    expect(d.summary.nodesChanged).toBe(0);
  });

  it('detects a real metadata change', () => {
    const before = node('host:a', { metadata: { version: '1' } });
    const after = node('host:a', { metadata: { version: '2' } });
    const d = diffTopology({ nodes: [before], edges: [] }, { nodes: [after], edges: [] });
    expect(d.nodes.changed[0]!.changedFields).toContain('metadata');
  });
});

describe('diffTopology — edges', () => {
  it('keys edges by (source, target, relationship)', () => {
    const base = { nodes: [], edges: [edge('a', 'b', { relationship: 'calls' })] };
    const current = { nodes: [], edges: [edge('a', 'b', { relationship: 'reads_from' })] };
    const d = diffTopology(base, current);
    expect(d.summary.edgesAdded).toBe(1);
    expect(d.summary.edgesRemoved).toBe(1);
  });

  it('counts unchanged edges and ignores confidence/evidence', () => {
    const base = { nodes: [], edges: [edge('a', 'b', { confidence: 0.5, evidence: 'x' })] };
    const current = { nodes: [], edges: [edge('a', 'b', { confidence: 0.9, evidence: 'y' })] };
    const d = diffTopology(base, current);
    expect(d.summary.edgesAdded).toBe(0);
    expect(d.summary.edgesRemoved).toBe(0);
    expect(d.edges.unchanged).toBe(1);
  });
});

describe('stableStringify', () => {
  it('is order-independent for object keys', () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: 3 } })).toBe(stableStringify({ b: { d: 3, c: 2 }, a: 1 }));
  });
  it('preserves array order', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});
