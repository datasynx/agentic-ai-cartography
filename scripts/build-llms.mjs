#!/usr/bin/env node
/**
 * Generate llms.txt (a curated, LLM-friendly navigation map) and llms-full.txt
 * (the full documentation text in one file) from the docs/ sources, per the
 * llmstxt.org convention. Canonical output lives at the repo root so the files
 * ship in the npm package and are agent-discoverable; `docs:build` also copies
 * them into docs/public so the site serves them at its domain root.
 *
 * Run via `npm run docs:llms`. Kept in lockstep with the docs by a drift test.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://datasynx.github.io/agentic-ai-cartography';

/** Curated documentation index. Links point to anchors on the single-page site. */
const SECTIONS = [
  {
    heading: 'Getting started',
    pages: [
      { file: 'docs/tutorials/index.md', url: `${SITE}/#quickstart`, title: 'Quickstart', desc: 'From zero to an agent that knows your system.' },
      { file: 'docs/how-to/install.md', url: `${SITE}/#install`, title: 'Install into a client', desc: 'Write the MCP config for any supported host.' },
    ],
  },
  {
    heading: 'Reference',
    pages: [
      { file: 'docs/reference/mcp.md', url: `${SITE}/#tools`, title: 'MCP tools & resources', desc: 'Resources, tools and prompts the server exposes.' },
      { file: 'docs/reference/cli.md', url: `${SITE}/#cli`, title: 'CLI', desc: 'datasynx-cartography commands and flags.' },
      { file: 'docs/reference/clients.md', url: `${SITE}/#clients`, title: 'Supported clients', desc: 'The host install matrix.' },
      { file: 'docs/adapters.md', url: `${SITE}/#adapters`, title: 'Non-MCP frameworks', desc: 'LangGraph, CrewAI, Vercel AI SDK and more.' },
    ],
  },
  {
    heading: 'Explanation',
    pages: [{ file: 'docs/explanation/index.md', url: `${SITE}/#architecture`, title: 'Why MCP-first', desc: 'The design rationale.' }],
  },
];

const stripFrontmatter = (s) => s.replace(/^---\n[\s\S]*?\n---\n/, '');

/** Pure: build both files' contents from the docs sources. Side-effect free. */
export function generate() {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const SUMMARY = pkg.description;

  const llms = [`# ${pkg.name}`, '', `> ${SUMMARY}`, ''];
  llms.push(
    'Cartography discovers your services, databases, SaaS tools and dependencies',
    '(read-only, deterministic) and exposes the topology over the Model Context',
    'Protocol. Install once and any MCP host or agent framework can query it.',
    '',
  );
  for (const section of SECTIONS) {
    llms.push(`## ${section.heading}`, '');
    for (const p of section.pages) llms.push(`- [${p.title}](${p.url}): ${p.desc}`);
    llms.push('');
  }
  const llmsTxt = llms.join('\n');

  const full = [`# ${pkg.name} — full documentation`, '', `> ${SUMMARY}`, ''];
  for (const section of SECTIONS) {
    for (const p of section.pages) {
      full.push('', '---', '', `<!-- source: ${p.file} -->`, '', stripFrontmatter(readFileSync(resolve(root, p.file), 'utf8')).trim(), '');
    }
  }
  const llmsFullTxt = full.join('\n') + '\n';
  return { llmsTxt, llmsFullTxt };
}

/** Write the canonical root files and mirror them into docs/ so Pages serves them at its root. */
export function write() {
  const { llmsTxt, llmsFullTxt } = generate();
  writeFileSync(resolve(root, 'llms.txt'), llmsTxt);
  writeFileSync(resolve(root, 'llms-full.txt'), llmsFullTxt);
  copyFileSync(resolve(root, 'llms.txt'), resolve(root, 'docs', 'llms.txt'));
  copyFileSync(resolve(root, 'llms-full.txt'), resolve(root, 'docs', 'llms-full.txt'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  write();
  console.log('✓ Wrote llms.txt and llms-full.txt (+ docs/public mirror)');
}
