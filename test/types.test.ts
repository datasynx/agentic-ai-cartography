import { describe, it, expect } from 'vitest';
import { NodeSchema, EdgeSchema, defaultConfig } from '../src/types.js';

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
});
