/**
 * The Cartography MCP server — the package's primary, LLM-agnostic interface.
 *
 * It exposes the discovered infrastructure topology as Model Context Protocol
 * **Resources** (read-only context, progressive disclosure), a small set of query
 * **Tools** (parameterized lookups), and reusable **Prompts**. Any MCP host —
 * Claude Code, Cursor, Cline, Windsurf, the Vercel AI SDK, LangGraph — can drive
 * it; the package never needs to know which model is in use.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CartographyDB } from '../db.js';
import type { GraphSummary } from '../db.js';
import { defaultConfig, NODE_TYPES, NODE_TYPE_GROUPS } from '../types.js';
import type { NodeRow } from '../types.js';

const SERVER_NAME = 'cartography';
const SERVER_VERSION = '2.0.0';

const SERVICE_TYPES = NODE_TYPE_GROUPS.web;
const DATA_TYPES = NODE_TYPE_GROUPS.data;

/** A pluggable search backend; defaults to lexical search, can be upgraded to semantic. */
export type SearchFn = (
  db: CartographyDB,
  sessionId: string,
  query: string,
  opts: { types?: readonly string[]; limit: number },
) => Promise<Array<{ node: NodeRow; score?: number }>>;

/** A pluggable discovery backend invoked by the `run_discovery` tool. */
export type DiscoveryFn = (
  db: CartographyDB,
  sessionId: string,
  opts: { hint?: string },
) => Promise<{ nodes: number; edges: number }>;

export interface CreateMcpServerOptions {
  /** Database instance. If omitted, one is opened at `config.dbPath`. */
  db?: CartographyDB;
  /** Path to the SQLite catalog (used when `db` is not provided). */
  dbPath?: string;
  /** Session to serve: a session id, or `'latest'` (default) for the newest discovery. */
  session?: string | 'latest';
  /** Semantic/lexical search backend. Defaults to lexical `searchNodes`. */
  search?: SearchFn;
  /** Discovery backend for `run_discovery`/`refresh`. Optional. */
  discovery?: DiscoveryFn;
}

const lexicalSearch: SearchFn = async (db, sessionId, query, opts) =>
  db.searchNodes(sessionId, query, { types: opts.types, limit: opts.limit }).map((node) => ({ node }));

/** Compact projection of a node for tool results (token-economical). */
function compactNode(n: NodeRow): Record<string, unknown> {
  return {
    id: n.id,
    type: n.type,
    name: n.name,
    confidence: n.confidence,
    ...(n.domain ? { domain: n.domain } : {}),
    ...(n.tags.length ? { tags: n.tags } : {}),
  };
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function summaryText(s: GraphSummary): string {
  const lines = [
    `# Infrastructure topology — session ${s.sessionId}`,
    ``,
    `Totals: ${s.totals.nodes} nodes, ${s.totals.edges} edges`,
    ``,
    `Nodes by type:`,
    ...Object.entries(s.nodesByType).sort((a, b) => b[1] - a[1]).map(([t, c]) => `  - ${t}: ${c}`),
    ``,
    `Nodes by domain:`,
    ...Object.entries(s.nodesByDomain).sort((a, b) => b[1] - a[1]).map(([d, c]) => `  - ${d}: ${c}`),
    ``,
    `Edges by relationship:`,
    ...Object.entries(s.edgesByRelationship).sort((a, b) => b[1] - a[1]).map(([r, c]) => `  - ${r}: ${c}`),
    ``,
    `Most connected:`,
    ...s.topConnected.map((n) => `  - ${n.id} (${n.type}) — degree ${n.degree}`),
    ``,
    `Read cartography://nodes/{id} or cartography://dependencies/{id} for detail.`,
  ];
  return lines.join('\n');
}

/**
 * Build a fully-configured Cartography MCP server. Call `.connect(transport)` to run it.
 */
export function createMcpServer(opts: CreateMcpServerOptions = {}): McpServer {
  const db = opts.db ?? new CartographyDB(opts.dbPath ?? defaultConfig().dbPath);
  const search = opts.search ?? lexicalSearch;

  /** Resolve the served session id at call time (so late discoveries are picked up). */
  const resolveSession = (): string | undefined => {
    if (opts.session && opts.session !== 'latest') return opts.session;
    return db.getLatestSession('discover')?.id ?? db.getLatestSession()?.id;
  };

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { resources: { subscribe: true, listChanged: true }, tools: {}, prompts: {}, logging: {} },
      instructions:
        'Cartography exposes a discovered infrastructure/SaaS topology. Start by reading ' +
        'cartography://graph/summary for a low-token overview, then drill into specific nodes ' +
        'via cartography://nodes/{id} or query with the query_infrastructure / get_dependencies tools.',
    },
  );

  // ── Resources (read-only context, progressive disclosure) ──────────────────

  server.registerResource(
    'graph-summary',
    'cartography://graph/summary',
    { title: 'Topology summary', description: 'Low-token aggregate index of the whole landscape — read this first.', mimeType: 'text/markdown' },
    (uri) => {
      const sid = resolveSession();
      if (!sid) return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: 'No discovery session found. Run discovery first.' }] };
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: summaryText(db.getGraphSummary(sid)) }] };
    },
  );

  server.registerResource(
    'nodes-index',
    'cartography://nodes',
    { title: 'Node index', description: 'Lightweight list of all nodes (id, type, name only).', mimeType: 'application/json' },
    (uri) => {
      const sid = resolveSession();
      const nodes = sid ? db.getNodes(sid) : [];
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ count: nodes.length, nodes: nodes.map((n) => ({ id: n.id, type: n.type, name: n.name })) }, null, 2) }] };
    },
  );

  server.registerResource(
    'node-detail',
    new ResourceTemplate('cartography://nodes/{id}', { list: undefined }),
    { title: 'Node detail', description: 'Full node record plus its incident edges.', mimeType: 'application/json' },
    (uri, variables) => {
      const sid = resolveSession();
      const id = decodeURIComponent(String(variables['id']));
      const node = sid ? db.getNode(sid, id) : undefined;
      if (!node) return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: `node not found: ${id}` }) }] };
      const edges = db.getEdges(sid!).filter((e) => e.sourceId === id || e.targetId === id);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ node, edges }, null, 2) }] };
    },
  );

  const typedListResource = (name: string, uri: string, title: string, types: readonly string[]) =>
    server.registerResource(name, uri, { title, description: `Nodes of type: ${types.join(', ')}.`, mimeType: 'application/json' }, (u) => {
      const sid = resolveSession();
      const nodes = sid ? db.getNodesByType(sid, types) : [];
      return { contents: [{ uri: u.href, mimeType: 'application/json', text: JSON.stringify({ count: nodes.length, nodes: nodes.map(compactNode) }, null, 2) }] };
    });

  typedListResource('services', 'cartography://services', 'Services', SERVICE_TYPES);
  typedListResource('databases', 'cartography://databases', 'Data stores', DATA_TYPES);

  server.registerResource(
    'dependencies',
    new ResourceTemplate('cartography://dependencies/{id}', { list: undefined }),
    { title: 'Dependencies', description: 'Transitive downstream dependencies of a node.', mimeType: 'application/json' },
    (uri, variables) => {
      const sid = resolveSession();
      const id = decodeURIComponent(String(variables['id']));
      if (!sid) return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'no session' }) }] };
      const r = db.getDependencies(sid, id, { direction: 'downstream', maxDepth: 8 });
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ root: id, count: r.nodes.length, nodes: r.nodes.map((n) => ({ ...compactNode(n), depth: n.depth })) }, null, 2) }] };
    },
  );

  server.registerResource(
    'sessions',
    'cartography://sessions',
    { title: 'Discovery sessions', description: 'All discovery sessions in the catalog.', mimeType: 'application/json' },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(db.getSessions(), null, 2) }] }),
  );

  // ── Tools (model-controlled queries) ───────────────────────────────────────

  /** Annotations shared by every read-only query tool (untrusted hints, never a security boundary). */
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    'get_summary',
    { title: 'Get topology summary', description: 'Low-token overview of the whole landscape (counts, types, domains, most-connected).', inputSchema: {}, annotations: readOnly },
    () => {
      const sid = resolveSession();
      if (!sid) return json({ error: 'No discovery session found.' });
      return json(db.getGraphSummary(sid));
    },
  );

  server.registerTool(
    'query_infrastructure',
    {
      title: 'Query infrastructure',
      description: 'Search the topology by name/id/domain (optionally filtered by node type). Returns compact node records.',
      inputSchema: {
        query: z.string().describe('Free-text query, e.g. "postgres", "auth", "github"'),
        types: z.array(z.enum(NODE_TYPES)).optional().describe('Restrict to these node types'),
        limit: z.number().int().min(1).max(200).default(25).optional(),
      },
      annotations: readOnly,
    },
    async (args) => {
      const sid = resolveSession();
      if (!sid) return json({ error: 'No discovery session found.' });
      const results = await search(db, sid, args.query, { types: args.types, limit: args.limit ?? 25 });
      return json({ count: results.length, results: results.map((r) => ({ ...compactNode(r.node), ...(r.score !== undefined ? { score: r.score } : {}) })) });
    },
  );

  server.registerTool(
    'search_topology',
    {
      title: 'Search topology (semantic)',
      description: 'Find nodes related to a concept by meaning (semantic search when available, lexical otherwise).',
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(100).default(10).optional() },
      annotations: readOnly,
    },
    async (args) => {
      const sid = resolveSession();
      if (!sid) return json({ error: 'No discovery session found.' });
      const results = await search(db, sid, args.query, { limit: args.limit ?? 10 });
      return json({ count: results.length, results: results.map((r) => ({ ...compactNode(r.node), ...(r.score !== undefined ? { score: r.score } : {}) })) });
    },
  );

  server.registerTool(
    'list_services',
    {
      title: 'List services',
      description: 'List discovered services or data stores.',
      inputSchema: { kind: z.enum(['services', 'databases', 'all']).default('all').optional() },
      annotations: readOnly,
    },
    (args) => {
      const sid = resolveSession();
      if (!sid) return json({ error: 'No discovery session found.' });
      const kind = args.kind ?? 'all';
      const types = kind === 'services' ? SERVICE_TYPES : kind === 'databases' ? DATA_TYPES : [...SERVICE_TYPES, ...DATA_TYPES];
      return json(db.getNodesByType(sid, types).map(compactNode));
    },
  );

  server.registerTool(
    'get_node',
    { title: 'Get node', description: 'Fetch a single node with its incident edges.', inputSchema: { id: z.string() }, annotations: readOnly },
    (args) => {
      const sid = resolveSession();
      if (!sid) return json({ error: 'No discovery session found.' });
      const node = db.getNode(sid, args.id);
      if (!node) return json({ error: `node not found: ${args.id}` });
      const edges = db.getEdges(sid).filter((e) => e.sourceId === args.id || e.targetId === args.id);
      return json({ node, edges });
    },
  );

  server.registerTool(
    'get_dependencies',
    {
      title: 'Get dependencies',
      description: 'Traverse the dependency graph from a node (downstream/upstream/both) with a depth limit.',
      inputSchema: {
        id: z.string(),
        direction: z.enum(['downstream', 'upstream', 'both']).default('downstream').optional(),
        maxDepth: z.number().int().min(1).max(64).default(8).optional(),
      },
      annotations: readOnly,
    },
    (args) => {
      const sid = resolveSession();
      if (!sid) return json({ error: 'No discovery session found.' });
      const r = db.getDependencies(sid, args.id, { direction: args.direction ?? 'downstream', maxDepth: args.maxDepth ?? 8 });
      return json({
        root: r.root ? compactNode(r.root) : null,
        direction: r.direction,
        count: r.nodes.length,
        nodes: r.nodes.map((n) => ({ ...compactNode(n), depth: n.depth })),
        edges: r.edges.map((e) => ({ from: e.sourceId, to: e.targetId, rel: e.relationship })),
      });
    },
  );

  if (opts.discovery) {
    const discovery = opts.discovery;
    server.registerTool(
      'run_discovery',
      {
        title: 'Run discovery',
        description: 'Scan the local system (read-only) and update the catalog. Returns counts of nodes/edges found.',
        inputSchema: { hint: z.string().optional().describe('Optional focus, e.g. tool names to look for') },
        // Scans read-only but writes results to the local catalog, so not a read-only tool; never destructive.
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      async (args) => {
        let sid = resolveSession();
        if (!sid) sid = db.createSession('discover', defaultConfig());
        const result = await discovery(db, sid, { hint: args.hint });
        server.server.sendResourceUpdated({ uri: 'cartography://graph/summary' }).catch((err: unknown) => {
          process.stderr.write(`[cartography-mcp] resource update notification failed: ${err instanceof Error ? err.message : String(err)}\n`);
        });
        server.server.sendResourceListChanged?.();
        return json({ session: sid, ...result });
      },
    );
  }

  // ── Prompts (user-controlled templates) ────────────────────────────────────

  server.registerPrompt(
    'audit-attack-surface',
    { title: 'Audit attack surface', description: 'Review the discovered topology for externally-reachable services and risky dependencies.' },
    () => ({
      messages: [{
        role: 'user', content: { type: 'text', text:
          'Read cartography://graph/summary and cartography://services. Identify externally-reachable ' +
          'services, data stores with broad inbound dependencies, and any node with low confidence that ' +
          'warrants verification. Use get_dependencies to assess blast radius. Summarize the attack surface ' +
          'and concrete hardening recommendations.' } }],
    }),
  );

  server.registerPrompt(
    'map-service-dependencies',
    {
      title: 'Map service dependencies',
      description: 'Produce a dependency map for a given service.',
      argsSchema: { service: z.string().describe('Service node id or name') },
    },
    (args) => ({
      messages: [{
        role: 'user', content: { type: 'text', text:
          `Use query_infrastructure to locate "${args.service}", then get_dependencies (direction=both) to ` +
          `map everything it depends on and everything that depends on it. Present the result as a clear ` +
          `dependency tree and call out single points of failure.` } }],
    }),
  );

  server.registerPrompt(
    'onboard-to-system',
    { title: 'Onboard to system', description: 'Explain the system landscape to a new engineer.' },
    () => ({
      messages: [{
        role: 'user', content: { type: 'text', text:
          'Read cartography://graph/summary, then cartography://services and cartography://databases. ' +
          'Write a concise onboarding briefing for a new engineer: what the major systems are, how they ' +
          'connect, which data stores are central, and where to look first.' } }],
    }),
  );

  return server;
}
