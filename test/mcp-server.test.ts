import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { CartographyDB } from '../src/db.js';
import { defaultConfig } from '../src/types.js';
import { createMcpServer } from '../src/mcp/server.js';

const DB_PATH = join(tmpdir(), `cartography-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
let db: CartographyDB;
let client: Client;

async function connect(opts = {}) {
  const server = createMcpServer({ db, ...opts });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
}

beforeEach(() => {
  db = new CartographyDB(DB_PATH);
  const sid = db.createSession('discover', defaultConfig());
  const mk = (id: string, type: string, name: string, domain?: string) =>
    db.upsertNode(sid, { id, type: type as never, name, discoveredVia: 'test', confidence: 0.9, metadata: {}, tags: [], domain });
  mk('saas_tool:app', 'saas_tool', 'App', 'Engineering');
  mk('web_service:api', 'web_service', 'API', 'Engineering');
  mk('database_server:pg', 'database_server', 'Postgres', 'Data Layer');
  db.insertEdge(sid, { sourceId: 'saas_tool:app', targetId: 'web_service:api', relationship: 'calls' as never, evidence: 'x', confidence: 0.9 });
  db.insertEdge(sid, { sourceId: 'web_service:api', targetId: 'database_server:pg', relationship: 'writes_to' as never, evidence: 'x', confidence: 0.9 });
});

afterEach(async () => {
  await client?.close();
  db.close();
  if (existsSync(DB_PATH)) rmSync(DB_PATH);
});

describe('Cartography MCP server', () => {
  it('lists resources and resource templates', async () => {
    await connect();
    const resources = await client.listResources();
    const uris = resources.resources.map((r) => r.uri);
    expect(uris).toContain('cartography://graph/summary');
    expect(uris).toContain('cartography://services');
    const templates = await client.listResourceTemplates();
    const tUris = templates.resourceTemplates.map((t) => t.uriTemplate);
    expect(tUris).toContain('cartography://nodes/{id}');
    expect(tUris).toContain('cartography://dependencies/{id}');
  });

  it('reads the low-token summary resource', async () => {
    await connect();
    const r = await client.readResource({ uri: 'cartography://graph/summary' });
    const text = (r.contents[0] as { text: string }).text;
    expect(text).toContain('3 nodes, 2 edges');
    expect(text).toContain('Most connected');
  });

  it('reads a node detail template with incident edges', async () => {
    await connect();
    const r = await client.readResource({ uri: 'cartography://nodes/web_service:api' });
    const data = JSON.parse((r.contents[0] as { text: string }).text);
    expect(data.node.id).toBe('web_service:api');
    expect(data.edges).toHaveLength(2);
  });

  it('lists tools and runs query_infrastructure', async () => {
    await connect();
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['get_summary', 'query_infrastructure', 'get_dependencies', 'list_services', 'get_node', 'search_topology']));

    const res = await client.callTool({ name: 'query_infrastructure', arguments: { query: 'postgres' } });
    const out = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(out.results.map((n: { id: string }) => n.id)).toContain('database_server:pg');
  });

  it('runs get_dependencies via tool', async () => {
    await connect();
    const res = await client.callTool({ name: 'get_dependencies', arguments: { id: 'saas_tool:app', direction: 'downstream' } });
    const out = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    const ids = out.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain('web_service:api');
    expect(ids).toContain('database_server:pg');
  });

  it('exposes prompts', async () => {
    await connect();
    const prompts = await client.listPrompts();
    const names = prompts.prompts.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['audit-attack-surface', 'map-service-dependencies', 'onboard-to-system']));
    const p = await client.getPrompt({ name: 'map-service-dependencies', arguments: { service: 'api' } });
    expect((p.messages[0].content as { text: string }).text).toContain('api');
  });

  it('annotates every read-only tool with readOnlyHint and a title', async () => {
    await connect();
    const tools = await client.listTools();
    const readOnly = ['get_summary', 'query_infrastructure', 'search_topology', 'list_services', 'get_node', 'get_dependencies'];
    for (const name of readOnly) {
      const t = tools.tools.find((x) => x.name === name);
      expect(t, `tool ${name} present`).toBeDefined();
      expect(t!.annotations?.readOnlyHint, `${name} readOnlyHint`).toBe(true);
      expect(t!.annotations?.title ?? t!.title, `${name} has a title`).toBeTruthy();
    }
  });

  it('marks run_discovery as a non-read-only, non-destructive tool', async () => {
    await connect({ discovery: async () => ({ nodes: 1, edges: 0 }) });
    const tools = await client.listTools();
    const t = tools.tools.find((x) => x.name === 'run_discovery');
    expect(t?.annotations?.readOnlyHint).toBe(false);
    expect(t?.annotations?.destructiveHint).toBe(false);
  });

  it('registers run_discovery only when a discovery backend is supplied', async () => {
    await connect({ discovery: async () => ({ nodes: 1, edges: 0 }) });
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('run_discovery');
    const res = await client.callTool({ name: 'run_discovery', arguments: {} });
    const out = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(out.nodes).toBe(1);
  });
});
