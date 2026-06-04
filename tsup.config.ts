import { defineConfig } from 'tsup';

export default defineConfig([
  // Executables (ESM with shebang)
  {
    entry: { cli: 'src/cli.ts', 'mcp-bin': 'src/mcp-bin.ts' },
    format: ['esm'],
    target: 'node20',
    clean: true,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  // Library — dual ESM/CJS with type declarations
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    target: 'node20',
    dts: true,
    sourcemap: true,
  },
]);
