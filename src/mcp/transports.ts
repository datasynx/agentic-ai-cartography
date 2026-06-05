/**
 * Transport bindings for the Cartography MCP server.
 *
 * - **stdio**: the local-first default — zero network, every client supports it.
 * - **Streamable HTTP**: a single `/mcp` endpoint for team/remote use, bound to
 *   localhost with DNS-rebinding protection. The deprecated SSE transport is not used.
 */

import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Connect a server over stdio (resolves when the transport closes). */
export async function runStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export interface HttpOptions {
  port?: number;
  host?: string;
  /** Extra allowed Host headers (defaults to localhost:port variants). */
  allowedHosts?: string[];
  /** Allowed Origin headers (defaults to none → same-origin only). */
  allowedOrigins?: string[];
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}

/**
 * Start a Streamable HTTP server. A fresh MCP server instance is created per
 * session via `factory`, so multiple clients can connect concurrently.
 */
/** Loopback hosts are safe to bind without an explicit Host allowlist. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export async function runHttp(factory: () => McpServer, opts: HttpOptions = {}): Promise<http.Server> {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 3737;

  // CVE-2025-66414: a server reachable beyond loopback must declare which Host
  // headers it trusts, or DNS-rebinding protection cannot do its job. Refuse to
  // start an exposed server with the permissive localhost defaults.
  if (!LOOPBACK_HOSTS.has(host) && opts.allowedHosts === undefined) {
    throw new Error(
      `Refusing to bind a non-loopback host (${host}) without an explicit allowedHosts allowlist. ` +
        `Pass { allowedHosts: ['your.public.host:port'] } to opt in, or bind 127.0.0.1 for local-only use.`,
    );
  }

  const allowedHosts = opts.allowedHosts ?? [`${host}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`];
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    try {
      const url = req.url ?? '';
      if (!url.startsWith('/mcp')) { res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}'); return; }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const existing = sessionId ? transports.get(sessionId) : undefined;

      if (existing) {
        const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
        await existing.handleRequest(req, res, body);
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"missing or unknown mcp-session-id"}');
        return;
      }

      // New session: initialize a transport + server instance.
      const body = await readJsonBody(req);
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: true,
        allowedHosts,
        ...(opts.allowedOrigins ? { allowedOrigins: opts.allowedOrigins } : {}),
        onsessioninitialized: (id: string) => { transports.set(id, transport); },
      });
      transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId); };
      await factory().connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"internal error"}');
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  return httpServer;
}
