import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const doc = readFileSync(resolve(__dirname, '..', 'docs', 'adapters.md'), 'utf8');

describe('native adapter snippets', () => {
  it('covers every targeted non-MCP framework', () => {
    for (const fw of ['LangGraph', 'AutoGen', 'CrewAI', 'Pydantic AI', 'OpenAI Agents SDK', 'Smolagents', 'Vercel AI SDK']) {
      expect(doc, `missing ${fw}`).toContain(fw);
    }
  });

  it('uses the canonical, unambiguous launch command in every snippet', () => {
    // The package exposes two bins, so a bare `npx @datasynx/...` is ambiguous;
    // every snippet must use the explicit `--package ... cartography-mcp` array form.
    const canonical = '"--package", "@datasynx/agentic-ai-cartography", "cartography-mcp"';
    const count = doc.split(canonical).length - 1;
    expect(count).toBeGreaterThanOrEqual(6); // one per framework
    // and never the ambiguous bare form
    expect(doc).not.toContain('npx -y @datasynx/agentic-ai-cartography\n');
  });

  it('flags the documented gotchas', () => {
    expect(doc).toContain('Microsoft Agent Framework'); // AutoGen maintenance note
    expect(doc).toContain('inputSchema'); // Vercel AI SDK v5 rename
    expect(doc.toLowerCase()).toContain('tools only'); // CrewAI / Vercel limitation
  });
});
