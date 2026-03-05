import { describe, it, expect } from 'vitest';

describe('index re-exports', () => {
  it('exports CartographyDB', async () => {
    const mod = await import('../src/index.js');
    expect(mod.CartographyDB).toBeDefined();
    expect(typeof mod.CartographyDB).toBe('function');
  });

  it('exports stripSensitive', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.stripSensitive).toBe('function');
  });

  it('exports safetyHook', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.safetyHook).toBe('function');
  });

  it('exports runDiscovery', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.runDiscovery).toBe('function');
  });

  it('exports exporter functions', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.exportAll).toBe('function');
    expect(typeof mod.exportJSON).toBe('function');
    expect(typeof mod.exportJGF).toBe('function');
    expect(typeof mod.exportBackstageYAML).toBe('function');
    expect(typeof mod.exportDiscoveryApp).toBe('function');
    expect(typeof mod.generateTopologyMermaid).toBe('function');
    expect(typeof mod.generateDependencyMermaid).toBe('function');
  });

  it('exports hex functions', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.hexToPixel).toBe('function');
    expect(typeof mod.pixelToHex).toBe('function');
    expect(typeof mod.hexCorners).toBe('function');
    expect(typeof mod.hexNeighbors).toBe('function');
    expect(typeof mod.hexDistance).toBe('function');
    expect(typeof mod.hexRing).toBe('function');
    expect(typeof mod.hexSpiral).toBe('function');
  });

  it('exports cluster functions', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.groupByDomain).toBe('function');
    expect(typeof mod.layoutClusters).toBe('function');
    expect(typeof mod.assignColors).toBe('function');
    expect(typeof mod.computeCentroid).toBe('function');
    expect(typeof mod.computeClusterBounds).toBe('function');
    expect(typeof mod.shadeVariant).toBe('function');
  });

  it('exports mapper functions', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.nodesToAssets).toBe('function');
    expect(typeof mod.edgesToConnections).toBe('function');
    expect(typeof mod.buildMapData).toBe('function');
  });

  it('exports defaultConfig', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.defaultConfig).toBe('function');
    const cfg = mod.defaultConfig();
    expect(cfg.maxTurns).toBe(50);
  });

  it('exports checkPrerequisites', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.checkPrerequisites).toBe('function');
  });

  it('exports CartographyDB as default', async () => {
    const mod = await import('../src/index.js');
    expect(mod.default).toBe(mod.CartographyDB);
  });
});
