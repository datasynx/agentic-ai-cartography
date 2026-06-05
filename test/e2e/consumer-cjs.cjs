// Consumer smoke test (CJS): proves the built CommonJS bundle loads and exposes
// the public API surface a downstream `require` relies on. Run after `npm run build`.
const assert = require('node:assert/strict');
const pkg = require('../../dist/index.cjs');

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
  'defaultConfig',
];

for (const name of expected) {
  assert.equal(typeof pkg[name], 'function', `CJS export missing or not callable: ${name}`);
}

const cfg = pkg.defaultConfig();
assert.equal(typeof cfg, 'object', 'defaultConfig() should return an object');

console.log(`consumer-cjs: OK (${expected.length} exports verified)`);
