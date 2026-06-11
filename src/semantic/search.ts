/**
 * Semantic search backend for the MCP server. Wraps a {@link VectorStore} and
 * degrades gracefully to lexical search when embeddings/sqlite-vec are unavailable
 * or return nothing.
 */

import type { CartographyDB } from '../db.js';
import type { NodeRow } from '../types.js';
import type { SearchFn } from '../mcp/server.js';
import type { EmbeddingProvider } from './embeddings.js';
import { createLocalEmbedder } from './embeddings.js';
import { VectorStore } from './store.js';

const lexical = (db: CartographyDB, sessionId: string, query: string, opts: { types?: readonly string[]; limit: number }) =>
  db.searchNodes(sessionId, query, { types: opts.types, limit: opts.limit }).map((node) => ({ node }));

/** A lexical-only {@link SearchFn} — the fallback when no embedder/vector store is available. */
const lexicalSearch = (): SearchFn => async (d, sid, q, opts) => lexical(d, sid, q, opts);

/** Options for {@link createSemanticSearch}. */
export interface SemanticSearchOptions {
  /** Logger for mode/degradation diagnostics (stderr). No-op if omitted. */
  log?: (msg: string) => void;
}

/**
 * Build a {@link SearchFn} that prefers semantic (vector) search and falls back to
 * lexical. Pass an explicit embedder, or let it lazily load the local transformer
 * (returns a lexical-only function if none is available). Pass `opts.log` to record
 * which mode was resolved — semantic readiness or the reason it degraded to lexical.
 */
export async function createSemanticSearch(
  db: CartographyDB,
  embedder?: EmbeddingProvider,
  opts: SemanticSearchOptions = {},
): Promise<SearchFn> {
  const log = opts.log;
  const provider = embedder ?? (await createLocalEmbedder());
  if (!provider) {
    log?.('semantic search: embeddings unavailable (@huggingface/transformers not installed or failed to load) — using lexical search');
    return lexicalSearch();
  }
  const store = new VectorStore(db, provider);
  const ok = await store.init();
  if (!ok) {
    log?.('semantic search: vector store unavailable (sqlite-vec not installed or failed to load) — using lexical search');
    return lexicalSearch();
  }
  log?.('semantic search: ready');

  return async (d, sid, query, queryOpts): Promise<Array<{ node: NodeRow; score?: number }>> => {
    const hits = await store.search(sid, query, queryOpts.limit);
    if (hits.length === 0) return lexical(d, sid, query, queryOpts);
    // Materialize only the hit nodes, not the whole session.
    const byId = d.getNodesByIds(sid, hits.map((h) => h.nodeId));
    const results: Array<{ node: NodeRow; score?: number }> = [];
    for (const h of hits) {
      const node = byId.get(h.nodeId);
      if (!node) continue; // vector outlived its node (deleted since last index)
      if (queryOpts.types && queryOpts.types.length > 0 && !queryOpts.types.includes(node.type)) continue;
      // cosine distance → similarity score in [0,1]
      results.push({ node, score: Math.max(0, 1 - h.distance / 2) });
    }
    return results.length > 0 ? results : lexical(d, sid, query, queryOpts);
  };
}

export { VectorStore } from './store.js';
export { createLocalEmbedder, createHashEmbedder } from './embeddings.js';
export type { EmbeddingProvider } from './embeddings.js';
