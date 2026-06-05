/**
 * Registry of supported MCP hosts. The merge engine and CLI are generic; every
 * host-specific detail (config path, format, schema key) lives in a `ClientSpec`
 * here. New hosts are added by appending a spec — no engine changes required.
 */

import { join } from 'node:path';
import { deepMerge } from './merge.js';
import { mcpServerObject } from './shapes.js';
import type { ClientSpec } from './types.js';

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

/** All registered clients, in display order. Extended by later milestones. */
export const CLIENTS: ClientSpec[] = [claudeCode];

export function getClient(id: string): ClientSpec | undefined {
  return CLIENTS.find((c) => c.id === id);
}

export function listClients(): ReadonlyArray<Pick<ClientSpec, 'id' | 'label' | 'format' | 'note'>> {
  return CLIENTS.map(({ id, label, format, note }) => ({ id, label, format, note }));
}
