import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseConfig, serializeConfig, deepMerge, mcpServerObject, defaultServerEntry,
  planInstall, applyInstall, getClient, listClients,
} from '../src/installer/index.js';
import type { ClientSpec, ResolveContext } from '../src/installer/index.js';

let dir: string;
const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  scope: 'global', os: 'linux', home: dir, cwd: dir, env: {}, ...over,
});

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cartography-install-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('format roundtrip', () => {
  const obj = { mcpServers: { cartography: { command: 'npx', args: ['-y', 'pkg'] } } };
  it.each(['json', 'toml', 'yaml'] as const)('round-trips %s', (fmt) => {
    const text = serializeConfig(obj, fmt);
    expect(parseConfig(text, fmt)).toEqual(obj);
  });
  it('treats empty input as an empty object', () => {
    expect(parseConfig('', 'json')).toEqual({});
    expect(parseConfig('   \n', 'toml')).toEqual({});
    expect(parseConfig('', 'yaml')).toEqual({});
  });
});

describe('deepMerge', () => {
  it('preserves unrelated keys and merges nested objects', () => {
    const out = deepMerge({ a: 1, nested: { x: 1 } }, { nested: { y: 2 }, b: 3 });
    expect(out).toEqual({ a: 1, b: 3, nested: { x: 1, y: 2 } });
  });
  it('does not mutate its inputs', () => {
    const target = { nested: { x: 1 } };
    deepMerge(target, { nested: { y: 2 } });
    expect(target).toEqual({ nested: { x: 1 } });
  });
});

describe('mcpServerObject', () => {
  it('shapes stdio entries', () => {
    expect(mcpServerObject({ command: 'npx', args: ['-y', 'pkg'] })).toEqual({ command: 'npx', args: ['-y', 'pkg'] });
  });
  it('shapes http entries', () => {
    expect(mcpServerObject({ url: 'http://x/mcp' })).toEqual({ type: 'http', url: 'http://x/mcp' });
  });
});

describe('planInstall — Claude Code (JSON)', () => {
  const spec = getClient('claude-code')!;
  const entry = defaultServerEntry();

  it('writes mcpServers into the global config path', () => {
    const plan = planInstall(spec, ctx(), { entry });
    expect(plan.path).toBe(join(dir, '.claude.json'));
    expect(plan.changed).toBe(true);
    const parsed = parseConfig(plan.after, 'json') as any;
    expect(parsed.mcpServers.cartography.command).toBe('npx');
    expect(parsed.mcpServers.cartography.args).toContain('cartography-mcp');
  });

  it('uses .mcp.json for the project scope', () => {
    const plan = planInstall(spec, ctx({ scope: 'project' }), { entry });
    expect(plan.path).toBe(join(dir, '.mcp.json'));
  });

  it('merges without clobbering an existing server and is idempotent', () => {
    const file = join(dir, '.claude.json');
    writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'foo' } }, unrelated: true }, null, 2));
    const plan1 = planInstall(spec, ctx(), { entry });
    applyInstall(plan1);
    const after1 = JSON.parse(readFileSync(file, 'utf8'));
    expect(after1.mcpServers.other).toEqual({ command: 'foo' });
    expect(after1.mcpServers.cartography).toBeDefined();
    expect(after1.unrelated).toBe(true);
    // second run = no change
    const plan2 = planInstall(spec, ctx(), { entry });
    expect(plan2.changed).toBe(false);
  });

  it('dry-run via planInstall does not touch the filesystem', () => {
    const plan = planInstall(spec, ctx(), { entry });
    expect(existsSync(plan.path)).toBe(false); // planInstall never writes
  });

  it('supports a custom server name and package args', () => {
    const plan = planInstall(spec, ctx(), { serverName: 'cg', entry: defaultServerEntry({ packageArgs: ['--db', '/tmp/x.db'] }) });
    const parsed = parseConfig(plan.after, 'json') as any;
    expect(parsed.mcpServers.cg.args).toEqual(['-y', '--package', '@datasynx/agentic-ai-cartography', 'cartography-mcp', '--db', '/tmp/x.db']);
  });
});

describe('parse-merge engine across TOML and YAML (synthetic specs)', () => {
  const tomlSpec: ClientSpec = {
    id: 'toml-host', label: 'TOML Host', format: 'toml',
    path: (c) => join(c.home, 'config.toml'),
    apply: (existing, name, entry) => deepMerge(existing, { mcp_servers: { [name]: mcpServerObject(entry) } }),
  };
  const yamlSpec: ClientSpec = {
    id: 'yaml-host', label: 'YAML Host', format: 'yaml',
    path: (c) => join(c.home, 'config.yaml'),
    apply: (existing, name, entry) => deepMerge(existing, { extensions: { [name]: mcpServerObject(entry) } }),
  };

  it('writes and merges TOML, preserving existing tables', () => {
    const file = join(dir, 'config.toml');
    writeFileSync(file, 'title = "x"\n\n[mcp_servers.keep]\ncommand = "foo"\n');
    const plan = planInstall(tomlSpec, ctx(), { entry: defaultServerEntry() });
    applyInstall(plan);
    const parsed = parseConfig(readFileSync(file, 'utf8'), 'toml') as any;
    expect(parsed.title).toBe('x');
    expect(parsed.mcp_servers.keep.command).toBe('foo');
    expect(parsed.mcp_servers.cartography.command).toBe('npx');
  });

  it('writes and merges YAML, preserving existing extensions', () => {
    const file = join(dir, 'config.yaml');
    writeFileSync(file, 'extensions:\n  keep:\n    command: foo\n');
    const plan = planInstall(yamlSpec, ctx(), { entry: defaultServerEntry() });
    applyInstall(plan);
    const parsed = parseConfig(readFileSync(file, 'utf8'), 'yaml') as any;
    expect(parsed.extensions.keep.command).toBe('foo');
    expect(parsed.extensions.cartography.command).toBe('npx');
  });
});

describe('registry', () => {
  it('lists at least the reference client', () => {
    expect(listClients().map((c) => c.id)).toContain('claude-code');
  });
  it('throws a clear error for an unsupported scope', () => {
    const noProject: ClientSpec = { id: 'x', label: 'X', format: 'json', path: (c) => (c.scope === 'project' ? undefined : '/tmp/x'), apply: (e) => e };
    expect(() => planInstall(noProject, ctx({ scope: 'project' }), { entry: defaultServerEntry() })).toThrow(/project/);
  });
});
