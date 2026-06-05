import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'mcpb', 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

describe('.mcpb manifest', () => {
  it('declares the required top-level fields (mcpb schema v0.3)', () => {
    for (const key of ['name', 'version', 'description', 'author', 'server']) {
      expect(manifest[key], `missing ${key}`).toBeDefined();
    }
    expect(manifest.manifest_version).toBe('0.3');
    expect(manifest.author.name).toBeTruthy();
  });

  it('defines a node server entry consistent with the launcher', () => {
    expect(manifest.server.type).toBe('node');
    expect(manifest.server.entry_point).toBe('server/launch.mjs');
    expect(manifest.server.mcp_config.command).toBe('node');
    expect(manifest.server.mcp_config.args).toContain('${__dirname}/server/launch.mjs');
  });

  it('keeps the manifest version in lockstep with package.json', () => {
    // build:mcpb syncs these; guard against drift landing in a commit.
    expect(manifest.version).toBe(pkg.version);
  });
});
