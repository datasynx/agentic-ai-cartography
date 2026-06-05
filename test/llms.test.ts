import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generate } from '../scripts/build-llms.mjs';

const root = resolve(__dirname, '..');
const { llmsTxt, llmsFullTxt } = generate();

describe('llms.txt / llms-full.txt', () => {
  it('follows the llmstxt.org shape: H1 title then a blockquote summary', () => {
    const lines = llmsTxt.split('\n');
    expect(lines[0]).toMatch(/^# /);
    expect(llmsTxt).toMatch(/\n> .+/);
    // curated link list with descriptions
    expect(llmsTxt).toMatch(/- \[.+\]\(https?:\/\/.+\): .+/);
  });

  it('llms-full.txt embeds the full text of each curated page', () => {
    expect(llmsFullTxt).toContain('Tutorial: from zero');
    expect(llmsFullTxt).toContain('How to install Cartography');
    expect(llmsFullTxt).toContain('Why MCP-first');
  });

  it('the committed root files are up to date (run `npm run docs:llms`)', () => {
    expect(readFileSync(resolve(root, 'llms.txt'), 'utf8')).toBe(llmsTxt);
    expect(readFileSync(resolve(root, 'llms-full.txt'), 'utf8')).toBe(llmsFullTxt);
  });
});
