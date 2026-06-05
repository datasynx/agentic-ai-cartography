import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import createServer, { configSchema } from '../src/smithery.js';

describe('Smithery entry', () => {
  it('configSchema accepts an empty config and the documented keys', () => {
    expect(configSchema.parse({})).toEqual({});
    const parsed = configSchema.parse({ db: ':memory:', session: 'latest' });
    expect(parsed.db).toBe(':memory:');
    expect(parsed.session).toBe('latest');
  });

  it('default export returns a connectable MCP server exposing the Cartography tools', async () => {
    const server = createServer({ config: { db: ':memory:' } });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['get_summary', 'query_infrastructure', 'get_dependencies']),
    );
    await client.close();
  });

  it('works with no config argument at all', async () => {
    const server = createServer({});
    expect(server).toBeDefined();
    await server.close();
  });
});
