import { describe, it, expect } from 'vitest';
import {
  NodeSchema, EdgeSchema, DataAssetSchema, ConnectionSchema,
  defaultConfig, NODE_TYPES, EDGE_RELATIONSHIPS,
} from '../src/types.js';

describe('NodeSchema', () => {
  it('validates a valid node', () => {
    const result = NodeSchema.safeParse({
      id: 'database_server:localhost:5432',
      type: 'database_server',
      name: 'postgres',
      discoveredVia: 'ss -tlnp',
      confidence: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it('applies defaults', () => {
    const result = NodeSchema.parse({
      id: 'web_service:localhost:3000',
      type: 'web_service',
      name: 'express',
      discoveredVia: 'ss',
      confidence: 0.9,
    });
    expect(result.metadata).toEqual({});
    expect(result.tags).toEqual([]);
  });

  it('rejects invalid type', () => {
    const result = NodeSchema.safeParse({
      id: 'foo:bar',
      type: 'invalid_type',
      name: 'test',
      discoveredVia: 'test',
      confidence: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence > 1', () => {
    const result = NodeSchema.safeParse({
      id: 'foo:bar',
      type: 'host',
      name: 'test',
      discoveredVia: 'test',
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence < 0', () => {
    const result = NodeSchema.safeParse({
      id: 'host:test',
      type: 'host',
      name: 'test',
      discoveredVia: 'test',
      confidence: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts confidence = 0 (boundary)', () => {
    const result = NodeSchema.safeParse({
      id: 'host:test',
      type: 'host',
      name: 'test',
      discoveredVia: 'test',
      confidence: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts confidence = 1 (boundary)', () => {
    const result = NodeSchema.safeParse({
      id: 'host:test',
      type: 'host',
      name: 'test',
      discoveredVia: 'test',
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid node types', () => {
    for (const type of NODE_TYPES) {
      const result = NodeSchema.safeParse({
        id: `${type}:test`,
        type,
        name: 'test',
        discoveredVia: 'test',
        confidence: 0.5,
      });
      expect(result.success, `type ${type} should be valid`).toBe(true);
    }
  });

  it('accepts metadata with nested values', () => {
    const result = NodeSchema.parse({
      id: 'host:test',
      type: 'host',
      name: 'test',
      discoveredVia: 'test',
      confidence: 0.5,
      metadata: { nested: { deep: true }, arr: [1, 2, 3] },
    });
    expect(result.metadata).toEqual({ nested: { deep: true }, arr: [1, 2, 3] });
  });

  it('rejects missing required fields', () => {
    expect(NodeSchema.safeParse({}).success).toBe(false);
    expect(NodeSchema.safeParse({ id: 'test' }).success).toBe(false);
  });
});

describe('NodeSchema hex fields', () => {
  it('accepts domain, subDomain, qualityScore', () => {
    const result = NodeSchema.safeParse({
      id: 'saas_tool:hubspot',
      type: 'saas_tool',
      name: 'HubSpot',
      discoveredVia: 'manual',
      confidence: 1,
      domain: 'Marketing',
      subDomain: 'Client Lifetime Value',
      qualityScore: 85,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe('Marketing');
      expect(result.data.subDomain).toBe('Client Lifetime Value');
      expect(result.data.qualityScore).toBe(85);
    }
  });

  it('rejects qualityScore > 100', () => {
    const result = NodeSchema.safeParse({
      id: 'saas_tool:x',
      type: 'saas_tool',
      name: 'X',
      discoveredVia: 'manual',
      confidence: 1,
      qualityScore: 150,
    });
    expect(result.success).toBe(false);
  });

  it('rejects qualityScore < 0', () => {
    const result = NodeSchema.safeParse({
      id: 'saas_tool:x',
      type: 'saas_tool',
      name: 'X',
      discoveredVia: 'manual',
      confidence: 1,
      qualityScore: -1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts qualityScore = 0 (boundary)', () => {
    const result = NodeSchema.safeParse({
      id: 'host:test',
      type: 'host',
      name: 'test',
      discoveredVia: 'test',
      confidence: 0.5,
      qualityScore: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts qualityScore = 100 (boundary)', () => {
    const result = NodeSchema.safeParse({
      id: 'host:test',
      type: 'host',
      name: 'test',
      discoveredVia: 'test',
      confidence: 0.5,
      qualityScore: 100,
    });
    expect(result.success).toBe(true);
  });

  it('allows missing domain/subDomain/qualityScore', () => {
    const result = NodeSchema.safeParse({
      id: 'host:server1',
      type: 'host',
      name: 'server1',
      discoveredVia: 'ping',
      confidence: 0.8,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBeUndefined();
      expect(result.data.qualityScore).toBeUndefined();
    }
  });
});

describe('DataAssetSchema', () => {
  it('validates a data asset', () => {
    const result = DataAssetSchema.safeParse({
      id: 'asset-1',
      name: 'Test Asset',
      domain: 'Marketing',
      qualityScore: 75,
      position: { q: 0, r: 0 },
    });
    expect(result.success).toBe(true);
  });

  it('applies default metadata', () => {
    const result = DataAssetSchema.parse({
      id: 'asset-1',
      name: 'Test',
      domain: 'Other',
      position: { q: 1, r: 2 },
    });
    expect(result.metadata).toEqual({});
  });
});

describe('EdgeSchema', () => {
  it('validates a valid edge', () => {
    const result = EdgeSchema.safeParse({
      sourceId: 'web_service:localhost:3000',
      targetId: 'database_server:localhost:5432',
      relationship: 'reads_from',
      evidence: 'env var DATABASE_URL',
      confidence: 0.8,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid relationships', () => {
    for (const rel of EDGE_RELATIONSHIPS) {
      const result = EdgeSchema.safeParse({
        sourceId: 'a',
        targetId: 'b',
        relationship: rel,
        evidence: 'test',
        confidence: 0.5,
      });
      expect(result.success, `relationship ${rel} should be valid`).toBe(true);
    }
  });

  it('rejects invalid relationship', () => {
    const result = EdgeSchema.safeParse({
      sourceId: 'a',
      targetId: 'b',
      relationship: 'invalid_rel',
      evidence: 'test',
      confidence: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('accepts self-referential edge', () => {
    const result = EdgeSchema.safeParse({
      sourceId: 'node-a',
      targetId: 'node-a',
      relationship: 'depends_on',
      evidence: 'self dependency',
      confidence: 0.5,
    });
    expect(result.success).toBe(true);
  });
});

describe('ConnectionSchema', () => {
  it('validates a connection', () => {
    const result = ConnectionSchema.safeParse({
      id: 'conn-1',
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-b',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional type field', () => {
    const result = ConnectionSchema.safeParse({
      id: 'conn-1',
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-b',
      type: 'lineage',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('lineage');
    }
  });
});

describe('defaultConfig', () => {
  it('returns valid defaults', () => {
    const config = defaultConfig();
    expect(config.maxTurns).toBe(50);
    expect(config.maxDepth).toBe(8);
    expect(config.entryPoints).toEqual(['localhost']);
  });

  it('applies overrides', () => {
    const config = defaultConfig({ verbose: true });
    expect(config.verbose).toBe(true);
  });

  it('applies multiple overrides without affecting other defaults', () => {
    const config = defaultConfig({ maxDepth: 3, maxTurns: 10 });
    expect(config.maxDepth).toBe(3);
    expect(config.maxTurns).toBe(10);
    expect(config.verbose).toBe(false);
    expect(config.entryPoints).toEqual(['localhost']);
  });

  it('sets dbPath based on HOME', () => {
    const config = defaultConfig();
    expect(config.dbPath).toContain('.cartography');
    expect(config.dbPath).toContain('cartography.db');
  });

  it('sets default agentModel', () => {
    const config = defaultConfig();
    expect(config.agentModel).toContain('claude');
  });

  it('allows overriding dbPath', () => {
    const config = defaultConfig({ dbPath: '/custom/path.db' });
    expect(config.dbPath).toBe('/custom/path.db');
  });
});

describe('constant arrays', () => {
  it('NODE_TYPES contains expected types', () => {
    expect(NODE_TYPES).toContain('host');
    expect(NODE_TYPES).toContain('database_server');
    expect(NODE_TYPES).toContain('saas_tool');
    expect(NODE_TYPES).toContain('unknown');
    expect(NODE_TYPES.length).toBeGreaterThan(10);
  });

  it('EDGE_RELATIONSHIPS contains expected relationships', () => {
    expect(EDGE_RELATIONSHIPS).toContain('connects_to');
    expect(EDGE_RELATIONSHIPS).toContain('reads_from');
    expect(EDGE_RELATIONSHIPS).toContain('writes_to');
    expect(EDGE_RELATIONSHIPS).toContain('calls');
    expect(EDGE_RELATIONSHIPS).toContain('contains');
    expect(EDGE_RELATIONSHIPS).toContain('depends_on');
  });
});
