import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const docs = resolve(__dirname, '..', 'docs');

describe('Diátaxis documentation structure', () => {
  it('has a VitePress config and a home page', () => {
    expect(existsSync(resolve(docs, '.vitepress', 'config.ts'))).toBe(true);
    expect(existsSync(resolve(docs, 'index.md'))).toBe(true);
  });

  it('keeps the four Diátaxis types as separate sections', () => {
    for (const section of ['tutorials', 'how-to', 'reference', 'explanation']) {
      expect(existsSync(resolve(docs, section, 'index.md')), `missing ${section}/index.md`).toBe(true);
    }
  });

  it('has the reference pages the sidebar links to', () => {
    for (const page of ['mcp.md', 'cli.md', 'clients.md']) {
      expect(existsSync(resolve(docs, 'reference', page)), `missing reference/${page}`).toBe(true);
    }
  });
});
