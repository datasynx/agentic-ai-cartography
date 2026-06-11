#!/usr/bin/env node
// Validate server.json before it ships:
//   (1) version parity with package.json            [hard fail]
//   (2) required-field structure                    [hard fail]
//   (3) JSON-schema validation against $schema       [hard on real violations,
//       warn-and-skip on network/$ref errors so CI never flakes]
// Authoritative schema validation also runs at publish time via mcp-publisher
// (.github/workflows/mcp-publish.yml).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const server = JSON.parse(readFileSync(resolve(root, 'server.json'), 'utf8'));

const fail = (m) => { console.error(`::error::${m}`); process.exitCode = 1; };

// (1) version parity
if (server.version !== pkg.version) {
  fail(`server.json version (${server.version}) != package.json version (${pkg.version})`);
}

// (2) required structure
for (const key of ['$schema', 'name', 'version', 'packages']) {
  if (server[key] === undefined) fail(`server.json missing required field: ${key}`);
}
if (Array.isArray(server.packages)) {
  server.packages.forEach((p, i) => {
    for (const k of ['identifier', 'version', 'transport']) {
      if (p[k] === undefined) fail(`server.json packages[${i}] missing: ${k}`);
    }
  });
} else if (server.packages !== undefined) {
  fail('server.json packages must be an array');
}

// (3) best-effort schema validation
try {
  const { default: Ajv } = await import('ajv');
  const res = await fetch(server.$schema, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`schema fetch ${res.status}`);
  const schema = await res.json();
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);
  if (!validate(server)) {
    for (const e of validate.errors ?? []) fail(`schema: ${e.instancePath || '/'} ${e.message}`);
  }
} catch (err) {
  console.warn(`::warning::Skipped remote schema validation (${err instanceof Error ? err.message : String(err)}); parity + structure checks still enforced.`);
}

if (!process.exitCode) console.log(`server.json OK — version parity + structure (${pkg.version})`);
