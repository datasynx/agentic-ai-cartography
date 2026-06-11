// Consumer smoke test (ESM): proves the built ESM bundle loads and exposes the
// public API surface a downstream `import` relies on. Run after `npm run build`.
import assert from 'node:assert/strict';
import * as pkg from '../../dist/index.js';

const expected = [
  'CartographyDB',
  'createMcpServer',
  'runStdio',
  'runHttp',
  'runLocalDiscovery',
  'localDiscoveryFn',
  'createSemanticSearch',
  'VectorStore',
  'safetyHook',
  'checkReadOnly',
  'runDiscovery',
  'exportAll',
  'diffTopology',
  'generateDiffMermaid',
  'defaultConfig',
];

for (const name of expected) {
  assert.equal(typeof pkg[name], 'function', `ESM export missing or not callable: ${name}`);
}

// defaultConfig() must return a usable config object.
const cfg = pkg.defaultConfig();
assert.equal(typeof cfg, 'object', 'defaultConfig() should return an object');

console.log(`consumer-esm: OK (${expected.length} exports verified)`);
