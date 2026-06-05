/**
 * Generic install planning/applying. `planInstall` is pure relative to a provided
 * context (reads the existing file, computes the merged result, never writes) so
 * it powers both `--dry-run` and the real write in `applyInstall`.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { parseConfig, serializeConfig } from './format.js';
import { DEFAULT_SERVER_NAME } from './entry.js';
import type { ClientSpec, ConfigFormat, OsKind, ResolveContext, Scope, ServerEntry } from './types.js';

export interface InstallPlan {
  client: string;
  label: string;
  path: string;
  format: ConfigFormat;
  /** Existing file contents ('' when the file does not exist). */
  before: string;
  /** Contents that would be written. */
  after: string;
  fileExists: boolean;
  changed: boolean;
  note?: string;
}

/** Detect the current OS kind. */
export function currentOs(): OsKind {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

/** Build a real resolve context from the running environment. */
export function defaultContext(scope: Scope): ResolveContext {
  return { scope, os: currentOs(), home: homedir(), cwd: process.cwd(), env: process.env };
}

export interface PlanOptions {
  serverName?: string;
  entry: ServerEntry;
}

/** Compute what installing `entry` into `spec` would change. Reads the config file but never writes. */
export function planInstall(spec: ClientSpec, ctx: ResolveContext, opts: PlanOptions): InstallPlan {
  const path = spec.path(ctx);
  if (!path) {
    throw new Error(`${spec.label} does not support the "${ctx.scope}" scope.`);
  }
  const fileExists = existsSync(path);
  const before = fileExists ? readFileSync(path, 'utf8') : '';
  const existing = parseConfig(before, spec.format);
  const merged = spec.apply(existing, opts.serverName ?? DEFAULT_SERVER_NAME, opts.entry);
  const after = serializeConfig(merged, spec.format);
  return {
    client: spec.id,
    label: spec.label,
    path,
    format: spec.format,
    before,
    after,
    fileExists,
    changed: after !== before,
    ...(spec.note ? { note: spec.note } : {}),
  };
}

/** Write a plan's result to disk, creating parent directories as needed. */
export function applyInstall(plan: InstallPlan): void {
  mkdirSync(dirname(plan.path), { recursive: true });
  writeFileSync(plan.path, plan.after, 'utf8');
}

/** A minimal line-oriented diff for `--dry-run` output. */
export function renderDiff(before: string, after: string): string {
  if (before === after) return '  (no changes)';
  const b = before.length ? before.split('\n') : [];
  const a = after.split('\n');
  const out: string[] = [];
  const max = Math.max(b.length, a.length);
  for (let i = 0; i < max; i++) {
    if (b[i] === a[i]) {
      if (a[i] !== undefined) out.push(`  ${a[i]}`);
    } else {
      if (b[i] !== undefined) out.push(`- ${b[i]}`);
      if (a[i] !== undefined) out.push(`+ ${a[i]}`);
    }
  }
  return out.join('\n');
}
