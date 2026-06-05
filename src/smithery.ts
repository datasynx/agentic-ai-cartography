/**
 * Smithery deployment entry. Smithery's TypeScript runtime imports the default
 * export — a factory that receives the user's parsed `config` and returns an MCP
 * server — plus the optional `configSchema` (Zod) that drives Smithery's config UI.
 *
 * Hosted Smithery instances have no local discovery catalog, so the database
 * defaults to an in-memory store (no filesystem side-effects); point `config.db`
 * at a real catalog to serve previously-discovered topology.
 */

import { z } from 'zod';
import { createMcpServer } from './mcp/server.js';

export const configSchema = z.object({
  db: z.string().optional().describe('Path to the SQLite catalog (defaults to in-memory)'),
  session: z.string().optional().describe("Session id to serve, or 'latest'"),
});

export type SmitheryConfig = z.infer<typeof configSchema>;

/** Default export consumed by Smithery's TypeScript runtime. */
export default function createServer({ config }: { config?: SmitheryConfig } = {}) {
  const server = createMcpServer({
    dbPath: config?.db ?? ':memory:',
    ...(config?.session ? { session: config.session } : {}),
  });
  return server.server;
}
