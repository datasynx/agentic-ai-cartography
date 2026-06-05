import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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

describe('top-5 client specs', () => {
  const entry = defaultServerEntry();
  const httpEntry = defaultServerEntry({ transport: 'http', url: 'http://127.0.0.1:3737/mcp' });

  it('Cursor: mcpServers in ~/.cursor/mcp.json (global) and .cursor/mcp.json (project)', () => {
    const spec = getClient('cursor')!;
    const g = planInstall(spec, ctx(), { entry });
    expect(g.path).toBe(join(dir, '.cursor', 'mcp.json'));
    expect((parseConfig(g.after, 'json') as any).mcpServers.cartography.command).toBe('npx');
    const p = planInstall(spec, ctx({ scope: 'project' }), { entry });
    expect(p.path).toBe(join(dir, '.cursor', 'mcp.json'));
  });

  it('VS Code: uses `servers` (not mcpServers) with explicit stdio type', () => {
    const spec = getClient('vscode')!;
    const p = planInstall(spec, ctx({ scope: 'project' }), { entry });
    expect(p.path).toBe(join(dir, '.vscode', 'mcp.json'));
    const parsed = parseConfig(p.after, 'json') as any;
    expect(parsed.mcpServers).toBeUndefined();
    expect(parsed.servers.cartography.type).toBe('stdio');
    expect(parsed.servers.cartography.command).toBe('npx');
  });

  it('VS Code: http entry carries type http and url', () => {
    const spec = getClient('vscode')!;
    const p = planInstall(spec, ctx({ scope: 'project' }), { entry: httpEntry });
    const parsed = parseConfig(p.after, 'json') as any;
    expect(parsed.servers.cartography).toEqual({ type: 'http', url: 'http://127.0.0.1:3737/mcp' });
  });

  it('Codex CLI: TOML [mcp_servers.<name>] in ~/.codex/config.toml', () => {
    const spec = getClient('codex')!;
    const g = planInstall(spec, ctx(), { entry });
    expect(g.path).toBe(join(dir, '.codex', 'config.toml'));
    expect(g.format).toBe('toml');
    const parsed = parseConfig(g.after, 'toml') as any;
    expect(parsed.mcp_servers.cartography.command).toBe('npx');
    // merges with an existing server
    mkdirSync(join(dir, '.codex'), { recursive: true });
    writeFileSync(g.path, '[mcp_servers.keep]\ncommand = "foo"\n');
    const merged = planInstall(spec, ctx(), { entry });
    const p2 = parseConfig(merged.after, 'toml') as any;
    expect(p2.mcp_servers.keep.command).toBe('foo');
    expect(p2.mcp_servers.cartography.command).toBe('npx');
  });

  it('Windsurf: mcpServers in ~/.codeium/windsurf/mcp_config.json', () => {
    const spec = getClient('windsurf')!;
    const g = planInstall(spec, ctx(), { entry });
    expect(g.path).toBe(join(dir, '.codeium', 'windsurf', 'mcp_config.json'));
    expect((parseConfig(g.after, 'json') as any).mcpServers.cartography.command).toBe('npx');
  });

  it('exposes all five hosts in list-clients', () => {
    const ids = listClients().map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['claude-code', 'cursor', 'vscode', 'codex', 'windsurf']));
  });
});

describe('stage-2 JSON host specs (#30)', () => {
  const entry = defaultServerEntry();
  const httpEntry = defaultServerEntry({ transport: 'http', url: 'http://127.0.0.1:3737/mcp' });

  it('Cline: mcpServers with alwaysAllow/disabled in VS Code globalStorage', () => {
    const spec = getClient('cline')!;
    const g = planInstall(spec, ctx(), { entry });
    expect(g.path).toBe(join(dir, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
    const s = (parseConfig(g.after, 'json') as any).mcpServers.cartography;
    expect(s.command).toBe('npx');
    expect(s.alwaysAllow).toEqual([]);
    expect(s.disabled).toBe(false);
  });

  it('Roo Code: project .roo/mcp.json and global rooveterinaryinc storage', () => {
    const spec = getClient('roo')!;
    expect(planInstall(spec, ctx({ scope: 'project' }), { entry }).path).toBe(join(dir, '.roo', 'mcp.json'));
    expect(planInstall(spec, ctx(), { entry }).path).toContain(join('globalStorage', 'rooveterinaryinc.roo-cline'));
  });

  it('Zed: context_servers with source custom in ~/.config/zed/settings.json', () => {
    const spec = getClient('zed')!;
    const g = planInstall(spec, ctx(), { entry });
    expect(g.path).toBe(join(dir, '.config', 'zed', 'settings.json'));
    const parsed = parseConfig(g.after, 'json') as any;
    expect(parsed.mcpServers).toBeUndefined();
    expect(parsed.context_servers.cartography.source).toBe('custom');
    expect(parsed.context_servers.cartography.command).toBe('npx');
    expect(planInstall(spec, ctx({ scope: 'project' }), { entry }).path).toBe(join(dir, '.zed', 'settings.json'));
  });

  it('JetBrains/Junie: mcpServers in .junie/mcp/mcp.json (project)', () => {
    const spec = getClient('junie')!;
    const p = planInstall(spec, ctx({ scope: 'project' }), { entry });
    expect(p.path).toBe(join(dir, '.junie', 'mcp', 'mcp.json'));
    expect((parseConfig(p.after, 'json') as any).mcpServers.cartography.command).toBe('npx');
  });

  it('Gemini CLI: mcpServers in ~/.gemini/settings.json; http uses httpUrl', () => {
    const spec = getClient('gemini')!;
    const g = planInstall(spec, ctx(), { entry });
    expect(g.path).toBe(join(dir, '.gemini', 'settings.json'));
    expect((parseConfig(g.after, 'json') as any).mcpServers.cartography.command).toBe('npx');
    const h = planInstall(spec, ctx(), { entry: httpEntry });
    expect((parseConfig(h.after, 'json') as any).mcpServers.cartography).toEqual({ httpUrl: 'http://127.0.0.1:3737/mcp' });
  });

  it('lists all stage-2 JSON hosts', () => {
    const ids = listClients().map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['cline', 'roo', 'zed', 'junie', 'gemini']));
  });
});

describe('Goose (YAML) + OpenHands (TOML) (#31)', () => {
  const entry = defaultServerEntry();
  const httpEntry = defaultServerEntry({ transport: 'http', url: 'http://127.0.0.1:3737/mcp' });

  it('Goose: extensions entry in ~/.config/goose/config.yaml, preserving builtins', () => {
    const spec = getClient('goose')!;
    const file = join(dir, '.config', 'goose', 'config.yaml');
    mkdirSync(join(dir, '.config', 'goose'), { recursive: true });
    writeFileSync(file, 'extensions:\n  developer:\n    type: builtin\n    enabled: true\n');
    const g = planInstall(spec, ctx(), { entry });
    expect(g.path).toBe(file);
    expect(g.format).toBe('yaml');
    const parsed = parseConfig(g.after, 'yaml') as any;
    expect(parsed.extensions.developer.type).toBe('builtin'); // builtin untouched
    expect(parsed.extensions.cartography.command).toBe('npx');
    expect(parsed.extensions.cartography.type).toBe('stdio');
    expect(parsed.extensions.cartography.enabled).toBe(true);
  });

  it('OpenHands: appends to [mcp].stdio_servers, idempotent, preserving existing', () => {
    const spec = getClient('openhands')!;
    const g = planInstall(spec, ctx(), { entry });
    expect(g.format).toBe('toml');
    const parsed = parseConfig(g.after, 'toml') as any;
    expect(Array.isArray(parsed.mcp.stdio_servers)).toBe(true);
    expect(parsed.mcp.stdio_servers[0].name).toBe('cartography');
    expect(parsed.mcp.stdio_servers[0].command).toBe('npx');

    // pre-existing array entry is preserved; re-install does not duplicate
    mkdirSync(join(dir, '.openhands'), { recursive: true });
    writeFileSync(g.path, '[mcp]\nstdio_servers = [{ name = "fetch", command = "uvx", args = ["mcp-server-fetch"] }]\n');
    const merged = planInstall(spec, ctx(), { entry });
    const p2 = parseConfig(merged.after, 'toml') as any;
    const names = p2.mcp.stdio_servers.map((s: any) => s.name);
    expect(names).toEqual(expect.arrayContaining(['fetch', 'cartography']));
    applyInstall(merged);
    const again = planInstall(spec, ctx(), { entry });
    expect(again.changed).toBe(false); // idempotent
  });

  it('OpenHands: http entry goes to shttp_servers', () => {
    const spec = getClient('openhands')!;
    const h = planInstall(spec, ctx(), { entry: httpEntry });
    const parsed = parseConfig(h.after, 'toml') as any;
    expect(parsed.mcp.shttp_servers[0].url).toBe('http://127.0.0.1:3737/mcp');
  });

  it('lists goose and openhands', () => {
    const ids = listClients().map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['goose', 'openhands']));
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
