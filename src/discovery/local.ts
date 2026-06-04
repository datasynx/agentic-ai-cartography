/**
 * Deterministic, LLM-free local discovery.
 *
 * Runs every applicable scanner from a {@link ScannerRegistry}, deduplicates and
 * persists the resulting nodes/edges, and returns counts. This is what powers the
 * MCP `run_discovery` tool without requiring any model — the host LLM can then
 * enrich the catalog via the read tools. (The Claude-driven loop in agent.ts
 * remains available as the optional, richer turnkey path.)
 */

import type { CartographyDB } from '../db.js';
import type { DiscoveryNode, DiscoveryEdge } from '../types.js';
import { PLATFORM, run } from '../platform.js';
import { defaultRegistry, ScannerRegistry } from '../scanners/registry.js';
import type { ScanContext } from '../scanners/types.js';

export interface LocalDiscoveryOptions {
  hint?: string;
  registry?: ScannerRegistry;
  /** Called after each scanner with a short progress line. */
  onProgress?: (line: string) => void;
}

export async function runLocalDiscovery(
  db: CartographyDB,
  sessionId: string,
  opts: LocalDiscoveryOptions = {},
): Promise<{ nodes: number; edges: number; scanners: string[] }> {
  const registry = opts.registry ?? defaultRegistry();
  const ctx: ScanContext = { hint: opts.hint, platform: PLATFORM, run };

  const nodes = new Map<string, DiscoveryNode>();
  const edges: DiscoveryEdge[] = [];
  const ran: string[] = [];

  for (const scanner of registry.forPlatform(PLATFORM)) {
    try {
      if (!(await scanner.detect(ctx))) continue;
      const result = await scanner.scan(ctx);
      ran.push(scanner.id);
      for (const node of result.nodes) {
        // Keep the highest-confidence record on id collision.
        const prev = nodes.get(node.id);
        if (!prev || node.confidence > prev.confidence) nodes.set(node.id, node);
      }
      edges.push(...result.edges);
      opts.onProgress?.(`${scanner.title}: +${result.nodes.length} nodes`);
    } catch (err) {
      opts.onProgress?.(`${scanner.title}: failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  for (const node of nodes.values()) db.upsertNode(sessionId, node);
  // Only persist edges whose endpoints exist.
  for (const edge of edges) {
    if (nodes.has(edge.sourceId) && nodes.has(edge.targetId)) db.insertEdge(sessionId, edge);
  }

  return { nodes: nodes.size, edges: edges.length, scanners: ran };
}

/** Adapter matching the MCP `DiscoveryFn` signature. */
export function localDiscoveryFn(registry?: ScannerRegistry) {
  return async (db: CartographyDB, sessionId: string, opts: { hint?: string }) => {
    const r = await runLocalDiscovery(db, sessionId, { hint: opts.hint, registry });
    return { nodes: r.nodes, edges: r.edges };
  };
}
