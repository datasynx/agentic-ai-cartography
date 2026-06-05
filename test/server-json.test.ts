import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const server = JSON.parse(readFileSync(resolve(root, 'server.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

describe('server.json (MCP registry manifest)', () => {
  it('targets the current 2025-12-11 schema', () => {
    expect(server.$schema).toBe('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
  });

  it('declares the schema-required fields within their limits', () => {
    expect(server.name).toBeTruthy();
    expect(server.description).toBeTruthy();
    expect(server.description.length).toBeLessThanOrEqual(100); // schema maxLength
    expect(server.version).toBeTruthy();
  });

  it('uses a reverse-DNS name that matches package.json mcpName (ownership verification)', () => {
    expect(server.name).toMatch(/^[a-z0-9.-]+\/[a-z0-9.-]+$/);
    expect(server.name).toBe(pkg.mcpName);
  });

  it('keeps version and npm package identifier in lockstep with package.json', () => {
    expect(server.version).toBe(pkg.version);
    const npm = server.packages.find((p: any) => p.registryType === 'npm');
    expect(npm.identifier).toBe(pkg.name);
    expect(npm.version).toBe(pkg.version);
  });
});
