import { describe, it, expect } from 'vitest';
import {
  generateTopologyMermaid,
  generateDependencyMermaid,
  exportBackstageYAML,
  exportCartographyMap,
  exportJGF,
  exportHTML,
} from '../src/exporter.js';
import type { NodeRow, EdgeRow } from '../src/types.js';

const mockNodes: NodeRow[] = [
  {
    id: 'web_service:localhost:3000',
    type: 'web_service',
    name: 'express',
    discoveredVia: 'ss',
    confidence: 0.9,
    metadata: {},
    tags: [],
    sessionId: 'test-session',
    discoveredAt: new Date().toISOString(),
    depth: 0,
  },
  {
    id: 'database_server:localhost:5432',
    type: 'database_server',
    name: 'postgres',
    discoveredVia: 'ss',
    confidence: 0.9,
    metadata: {},
    tags: [],
    sessionId: 'test-session',
    discoveredAt: new Date().toISOString(),
    depth: 1,
  },
];

const mockEdges: EdgeRow[] = [
  {
    id: 'edge-1',
    sessionId: 'test-session',
    sourceId: 'web_service:localhost:3000',
    targetId: 'database_server:localhost:5432',
    relationship: 'reads_from',
    evidence: 'env var DATABASE_URL',
    confidence: 0.8,
    discoveredAt: new Date().toISOString(),
  },
];

describe('generateTopologyMermaid', () => {
  it('starts with graph TB', () => {
    const result = generateTopologyMermaid(mockNodes, mockEdges);
    expect(result).toContain('graph TB');
  });

  it('includes node labels', () => {
    const result = generateTopologyMermaid(mockNodes, mockEdges);
    expect(result).toContain('express');
    expect(result).toContain('postgres');
  });

  it('includes edge with label', () => {
    const result = generateTopologyMermaid(mockNodes, mockEdges);
    expect(result).toContain('reads');
  });
});

describe('generateDependencyMermaid', () => {
  it('starts with graph LR', () => {
    const result = generateDependencyMermaid(mockNodes, mockEdges);
    expect(result).toContain('graph LR');
  });

  it('only includes dependency edges', () => {
    const result = generateDependencyMermaid(mockNodes, mockEdges);
    // reads_from is included in dep edges
    expect(result).toContain('reads');
  });
});

describe('exportBackstageYAML', () => {
  it('produces valid YAML structure', () => {
    const result = exportBackstageYAML(mockNodes, mockEdges);
    expect(result).toContain('apiVersion: backstage.io/v1alpha1');
    expect(result).toContain('kind: Component');
    expect(result).toContain('kind: Resource');
  });

  it('includes org as owner when provided', () => {
    const result = exportBackstageYAML(mockNodes, mockEdges, 'my-org');
    expect(result).toContain('owner: my-org');
  });
});

describe('exportCartographyMap', () => {
  it('generates valid HTML with canvas', () => {
    const result = exportCartographyMap(mockNodes, mockEdges);
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('<canvas');
    expect(result).toContain('Data Cartography Map');
  });

  it('embeds asset data as JSON', () => {
    const result = exportCartographyMap(mockNodes, mockEdges);
    expect(result).toContain('"assets"');
    expect(result).toContain('"clusters"');
    expect(result).toContain('"connections"');
  });

  it('contains UI controls', () => {
    const result = exportCartographyMap(mockNodes, mockEdges);
    expect(result).toContain('search-input');
    expect(result).toContain('zoom-in');
    expect(result).toContain('zoom-out');
    expect(result).toContain('detail-panel');
    expect(result).toContain('connect-btn');
  });

  it('handles empty input', () => {
    const result = exportCartographyMap([], []);
    expect(result).toContain('No data assets available');
  });

  it('supports dark theme', () => {
    const result = exportCartographyMap(mockNodes, mockEdges, { theme: 'dark' });
    expect(result).toContain('class="dark"');
  });

  it('supports light theme', () => {
    const result = exportCartographyMap(mockNodes, mockEdges, { theme: 'light' });
    expect(result).toContain('class="light"');
  });

  it('includes accessibility attributes', () => {
    const result = exportCartographyMap(mockNodes, mockEdges);
    expect(result).toContain('aria-label');
    expect(result).toContain('role="tooltip"');
    expect(result).toContain('sr-only');
  });
});

describe('exportJGF', () => {
  it('produces valid JSON Graph Format', () => {
    const result = exportJGF(mockNodes, mockEdges);
    const parsed = JSON.parse(result);
    expect(parsed.graph).toBeDefined();
    expect(parsed.graph.directed).toBe(true);
    expect(parsed.graph.type).toBe('cartography');
  });

  it('includes all nodes keyed by id', () => {
    const result = JSON.parse(exportJGF(mockNodes, mockEdges));
    expect(result.graph.nodes['web_service:localhost:3000']).toBeDefined();
    expect(result.graph.nodes['database_server:localhost:5432']).toBeDefined();
    expect(result.graph.nodes['web_service:localhost:3000'].label).toBe('express');
  });

  it('includes edges with source, target, relation', () => {
    const result = JSON.parse(exportJGF(mockNodes, mockEdges));
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0].source).toBe('web_service:localhost:3000');
    expect(result.graph.edges[0].target).toBe('database_server:localhost:5432');
    expect(result.graph.edges[0].relation).toBe('reads_from');
  });

  it('handles empty graph', () => {
    const result = JSON.parse(exportJGF([], []));
    expect(result.graph.nodes).toEqual({});
    expect(result.graph.edges).toEqual([]);
  });

  it('includes metadata in nodes', () => {
    const result = JSON.parse(exportJGF(mockNodes, mockEdges));
    const node = result.graph.nodes['web_service:localhost:3000'];
    expect(node.metadata.type).toBe('web_service');
    expect(node.metadata.confidence).toBe(0.9);
    expect(node.metadata.layer).toBe('web');
  });
});

describe('exportHTML', () => {
  it('produces valid HTML document', () => {
    const result = exportHTML(mockNodes, mockEdges);
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('<html');
    expect(result).toContain('</html>');
  });

  it('embeds D3.js script reference', () => {
    const result = exportHTML(mockNodes, mockEdges);
    expect(result).toContain('d3js.org');
  });

  it('embeds graph data as JSON', () => {
    const result = exportHTML(mockNodes, mockEdges);
    expect(result).toContain('express');
    expect(result).toContain('postgres');
    expect(result).toContain('reads_from');
  });

  it('handles empty graph', () => {
    const result = exportHTML([], []);
    expect(result).toContain('<!DOCTYPE html>');
  });
});

describe('generateTopologyMermaid edge cases', () => {
  it('handles empty nodes and edges', () => {
    const result = generateTopologyMermaid([], []);
    expect(result).toContain('graph TB');
  });

  it('handles nodes without edges', () => {
    const result = generateTopologyMermaid(mockNodes, []);
    expect(result).toContain('express');
    expect(result).toContain('postgres');
  });

  it('applies correct subgraph layers', () => {
    const result = generateTopologyMermaid(mockNodes, mockEdges);
    expect(result).toContain('subgraph');
  });
});

describe('exportBackstageYAML edge cases', () => {
  it('uses default owner when none provided', () => {
    const result = exportBackstageYAML(mockNodes, mockEdges);
    expect(result).toContain('owner:');
  });

  it('maps database_server to Resource kind', () => {
    const result = exportBackstageYAML(mockNodes, mockEdges);
    expect(result).toContain('kind: Resource');
  });

  it('maps web_service to Component kind', () => {
    const result = exportBackstageYAML(mockNodes, mockEdges);
    expect(result).toContain('kind: Component');
  });
});
