#!/usr/bin/env node
/**
 * Build the Claude Desktop one-click bundle: keep `mcpb/manifest.json` in sync
 * with package.json's version, then pack `mcpb/` into `dist/cartography.mcpb`
 * using the official @anthropic-ai/mcpb CLI.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const manifestPath = resolve(root, 'mcpb', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Single source of truth: the npm version drives the manifest version.
if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Synced manifest version → ${pkg.version}`);
}

mkdirSync(resolve(root, 'dist'), { recursive: true });
const out = resolve(root, 'dist', 'cartography.mcpb');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(npx, ['mcpb', 'validate', manifestPath], { stdio: 'inherit', cwd: root });
execFileSync(npx, ['mcpb', 'pack', resolve(root, 'mcpb'), out], { stdio: 'inherit', cwd: root });
console.log(`\n✓ Wrote ${out}`);
