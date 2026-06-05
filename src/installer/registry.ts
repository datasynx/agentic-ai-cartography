/**
 * Registry of supported MCP hosts. The merge engine and CLI are generic; every
 * host-specific detail (config path, format, schema key) lives in a `ClientSpec`
 * here. New hosts are added by appending a spec — no engine changes required.
 */

import { join } from 'node:path';
import { deepMerge } from './merge.js';
import { mcpServerObject } from './shapes.js';
import type { ClientSpec, ResolveContext, ServerEntry } from './types.js';

/** Helper: a host that stores stdio/http servers under a top-level JSON key. */
function jsonKeyedClient(args: {
  id: string;
  label: string;
  key: string;
  globalPath: ClientSpec['path'];
  projectPath?: ClientSpec['path'];
  note?: string;
}): ClientSpec {
  return {
    id: args.id,
    label: args.label,
    format: 'json',
    note: args.note,
    path: (ctx) => (ctx.scope === 'project' ? args.projectPath?.(ctx) : args.globalPath(ctx)),
    apply: (existing, name, entry) =>
      deepMerge(existing, { [args.key]: { [name]: mcpServerObject(entry) } }),
  };
}

// ── Claude Code (reference JSON host) ────────────────────────────────────────
const claudeCode = jsonKeyedClient({
  id: 'claude-code',
  label: 'Claude Code',
  key: 'mcpServers',
  globalPath: (ctx) => join(ctx.home, '.claude.json'),
  projectPath: (ctx) => join(ctx.cwd, '.mcp.json'),
});

// ── Cursor ───────────────────────────────────────────────────────────────────
const cursor = jsonKeyedClient({
  id: 'cursor',
  label: 'Cursor',
  key: 'mcpServers',
  globalPath: (ctx) => join(ctx.home, '.cursor', 'mcp.json'),
  projectPath: (ctx) => join(ctx.cwd, '.cursor', 'mcp.json'),
});

// ── VS Code / GitHub Copilot ─────────────────────────────────────────────────
// Diverges from the norm: the key is `servers` (not `mcpServers`) and stdio
// entries carry an explicit `type: "stdio"`.
function vscodeServerObject(entry: ServerEntry): Record<string, unknown> {
  if (entry.url) return { type: 'http', url: entry.url, ...(entry.env ? { env: entry.env } : {}) };
  return { type: 'stdio', command: entry.command, args: entry.args ?? [], ...(entry.env ? { env: entry.env } : {}) };
}

/** VS Code user-profile directory per OS. */
function vscodeUserDir(ctx: ResolveContext): string {
  if (ctx.os === 'win') return join(ctx.env.APPDATA ?? join(ctx.home, 'AppData', 'Roaming'), 'Code', 'User');
  if (ctx.os === 'mac') return join(ctx.home, 'Library', 'Application Support', 'Code', 'User');
  return join(ctx.home, '.config', 'Code', 'User');
}

const vscode: ClientSpec = {
  id: 'vscode',
  label: 'VS Code (Copilot)',
  format: 'json',
  note: 'Uses the `servers` key (not `mcpServers`) — the most common copy-paste mistake.',
  path: (ctx) => (ctx.scope === 'project' ? join(ctx.cwd, '.vscode', 'mcp.json') : join(vscodeUserDir(ctx), 'mcp.json')),
  apply: (existing, name, entry) => deepMerge(existing, { servers: { [name]: vscodeServerObject(entry) } }),
};

// ── OpenAI Codex CLI ─────────────────────────────────────────────────────────
// TOML, table form `[mcp_servers.<name>]` (NOT `[mcp.servers."name"]`).
const codex: ClientSpec = {
  id: 'codex',
  label: 'Codex CLI',
  format: 'toml',
  note: 'Project scope only loads in "trusted" projects.',
  path: (ctx) => (ctx.scope === 'project' ? join(ctx.cwd, '.codex', 'config.toml') : join(ctx.home, '.codex', 'config.toml')),
  apply: (existing, name, entry) => deepMerge(existing, { mcp_servers: { [name]: mcpServerObject(entry) } }),
};

// ── Windsurf (Codeium) ───────────────────────────────────────────────────────
// Global-only; path is identical across OSes (USERPROFILE === home on Windows).
const windsurf = jsonKeyedClient({
  id: 'windsurf',
  label: 'Windsurf',
  key: 'mcpServers',
  globalPath: (ctx) => join(ctx.home, '.codeium', 'windsurf', 'mcp_config.json'),
});

// ── Cline & Roo Code (VS Code globalStorage hosts) ───────────────────────────
/** `<VS Code user dir>/globalStorage/<extensionId>/settings/cline_mcp_settings.json`. */
function codeGlobalStorage(ctx: ResolveContext, extensionId: string): string {
  return join(vscodeUserDir(ctx), 'globalStorage', extensionId, 'settings', 'cline_mcp_settings.json');
}

const cline: ClientSpec = {
  id: 'cline',
  label: 'Cline',
  format: 'json',
  path: (ctx) => (ctx.scope === 'project' ? undefined : codeGlobalStorage(ctx, 'saoudrizwan.claude-dev')),
  // Cline augments the standard object with its own auto-approve/disable flags.
  apply: (existing, name, entry) =>
    deepMerge(existing, { mcpServers: { [name]: { ...mcpServerObject(entry), alwaysAllow: [], disabled: false } } }),
};

const roo: ClientSpec = {
  id: 'roo',
  label: 'Roo Code',
  format: 'json',
  note: 'Project .roo/mcp.json takes precedence over the global settings.',
  path: (ctx) => (ctx.scope === 'project' ? join(ctx.cwd, '.roo', 'mcp.json') : codeGlobalStorage(ctx, 'rooveterinaryinc.roo-cline')),
  apply: (existing, name, entry) => deepMerge(existing, { mcpServers: { [name]: mcpServerObject(entry) } }),
};

// ── Zed ──────────────────────────────────────────────────────────────────────
// Key is `context_servers`; manual entries require `"source": "custom"`.
const zed: ClientSpec = {
  id: 'zed',
  label: 'Zed',
  format: 'json',
  note: 'Manual servers need "source": "custom"; remote uses an mcp-remote bridge.',
  path: (ctx) => {
    if (ctx.scope === 'project') return join(ctx.cwd, '.zed', 'settings.json');
    if (ctx.os === 'win') return join(ctx.env.APPDATA ?? join(ctx.home, 'AppData', 'Roaming'), 'Zed', 'settings.json');
    return join(ctx.home, '.config', 'zed', 'settings.json');
  },
  apply: (existing, name, entry) => {
    const inner = entry.url
      ? { source: 'custom', url: entry.url }
      : { source: 'custom', command: entry.command, args: entry.args ?? [], ...(entry.env ? { env: entry.env } : {}) };
    return deepMerge(existing, { context_servers: { [name]: inner } });
  },
};

// ── JetBrains AI Assistant / Junie ───────────────────────────────────────────
const junie: ClientSpec = {
  id: 'junie',
  label: 'JetBrains / Junie',
  format: 'json',
  path: (ctx) => (ctx.scope === 'project' ? join(ctx.cwd, '.junie', 'mcp', 'mcp.json') : join(ctx.home, '.junie', 'mcp', 'mcp.json')),
  apply: (existing, name, entry) => deepMerge(existing, { mcpServers: { [name]: mcpServerObject(entry) } }),
};

// ── Gemini CLI ───────────────────────────────────────────────────────────────
// stdio: command/args/env; HTTP uses the `httpUrl` key (not `url`).
const gemini: ClientSpec = {
  id: 'gemini',
  label: 'Gemini CLI',
  format: 'json',
  path: (ctx) => (ctx.scope === 'project' ? join(ctx.cwd, '.gemini', 'settings.json') : join(ctx.home, '.gemini', 'settings.json')),
  apply: (existing, name, entry) => {
    const inner = entry.url
      ? { httpUrl: entry.url, ...(entry.env ? { env: entry.env } : {}) }
      : mcpServerObject(entry);
    return deepMerge(existing, { mcpServers: { [name]: inner } });
  },
};

/** All registered clients, in display order. Extended by later milestones. */
export const CLIENTS: ClientSpec[] = [claudeCode, cursor, vscode, codex, windsurf, cline, roo, zed, junie, gemini];

export function getClient(id: string): ClientSpec | undefined {
  return CLIENTS.find((c) => c.id === id);
}

export function listClients(): ReadonlyArray<Pick<ClientSpec, 'id' | 'label' | 'format' | 'note'>> {
  return CLIENTS.map(({ id, label, format, note }) => ({ id, label, format, note }));
}
