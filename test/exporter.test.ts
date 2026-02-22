import { describe, it, expect } from 'vitest';
import {
  generateTopologyMermaid,
  generateDependencyMermaid,
  generateWorkflowMermaid,
  exportSOPMarkdown,
  exportBackstageYAML,
  exportCartographyMap,
} from '../src/exporter.js';
import type { NodeRow, EdgeRow, SOP } from '../src/types.js';

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

const mockSOP: SOP = {
  title: 'Deploy Check',
  description: 'Check deployment status',
  steps: [
    { order: 1, instruction: 'Check pods', tool: 'kubectl', target: 'k8s:cluster', notes: 'All should be Running' },
    { order: 2, instruction: 'Check health', tool: 'curl', target: 'express:3000' },
  ],
  involvedSystems: ['kubernetes', 'express:3000'],
  estimatedDuration: '~5 Minuten',
  frequency: '3x täglich',
  confidence: 0.85,
};

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

describe('generateWorkflowMermaid', () => {
  it('starts with flowchart TD', () => {
    const result = generateWorkflowMermaid(mockSOP);
    expect(result).toContain('flowchart TD');
  });

  it('includes step nodes', () => {
    const result = generateWorkflowMermaid(mockSOP);
    expect(result).toContain('S1');
    expect(result).toContain('S2');
  });
});

describe('exportSOPMarkdown', () => {
  it('includes title', () => {
    const result = exportSOPMarkdown(mockSOP);
    expect(result).toContain('# Deploy Check');
  });

  it('includes confidence', () => {
    const result = exportSOPMarkdown(mockSOP);
    expect(result).toContain('0.85');
  });

  it('includes steps', () => {
    const result = exportSOPMarkdown(mockSOP);
    expect(result).toContain('Check pods');
    expect(result).toContain('Check health');
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
