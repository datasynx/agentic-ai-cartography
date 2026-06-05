import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const docs = resolve(__dirname, '..', 'docs');
const html = readFileSync(resolve(docs, 'index.html'), 'utf8');

// The published site is a single self-contained docs/index.html (Datasynx suite
// house style), deployed by uploading docs/ as-is — no framework, no base path.
describe('documentation site (static index.html)', () => {
  it('ships a self-contained index.html and a .nojekyll marker', () => {
    expect(existsSync(resolve(docs, 'index.html'))).toBe(true);
    expect(existsSync(resolve(docs, '.nojekyll'))).toBe(true);
  });

  it('inlines its styles (no external CSS/JS that could 404 on a project sub-path)', () => {
    expect(html).toContain('<style>');
    // no <link rel=stylesheet> / <script src> to absolute-rooted asset bundles
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']\//);
    expect(html).not.toMatch(/<script[^>]+src=["']\/assets\//);
  });

  it('covers the key sections in its in-page nav', () => {
    for (const id of ['overview', 'quickstart', 'install', 'tools', 'clients', 'cli', 'adapters', 'suite', 'faq']) {
      expect(html, `missing #${id}`).toContain(`id="${id}"`);
    }
  });

  it('links the rest of the suite and the GitHub repo', () => {
    expect(html).toContain('github.com/datasynx/agentic-ai-cartography');
    expect(html).toContain('agentic-ai-shadowing');
  });
});
