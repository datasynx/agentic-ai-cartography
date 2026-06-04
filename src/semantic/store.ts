/**
 * Vector store backed by `sqlite-vec`. Stores one embedding per node in a `vec0`
 * virtual table living inside the same SQLite catalog, with incremental indexing
 * (content-hashed) so re-runs only embed what changed.
 */

import type { CartographyDB } from '../db.js';
import type { NodeRow } from '../types.js';
import type { EmbeddingProvider } from './embeddings.js';
import { fnv1a } from './hash.js';

/** Text used to represent a node for embedding. */
export function nodeText(n: NodeRow): string {
  const desc = typeof n.metadata?.['description'] === 'string' ? (n.metadata['description'] as string) : '';
  const category = typeof n.metadata?.['category'] === 'string' ? (n.metadata['category'] as string) : '';
  return [n.name, n.id.replace(/[:_]/g, ' '), `type ${n.type}`, n.domain ?? '', n.subDomain ?? '', category, n.tags.join(' '), desc]
    .filter(Boolean).join(' — ');
}

function hash(s: string): string {
  return fnv1a(s).toString(16);
}

function toBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export class VectorStore {
  private loaded = false;

  constructor(private db: CartographyDB, private embedder: EmbeddingProvider) {}

  /** Load sqlite-vec and ensure the schema exists. Returns false if unavailable. */
  async init(): Promise<boolean> {
    if (this.loaded) return true;
    try {
      const conn = this.db.rawConnection();
      const sqliteVec = await import('sqlite-vec');
      sqliteVec.load(conn);
      conn.exec(`
        CREATE TABLE IF NOT EXISTS vec_index (
          rowid INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          hash TEXT NOT NULL,
          UNIQUE(session_id, node_id)
        );
        CREATE TABLE IF NOT EXISTS vec_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      // Recreate the vector table if the embedding dimensions changed.
      const dimRow = conn.prepare("SELECT value FROM vec_meta WHERE key = 'dims'").get() as { value: string } | undefined;
      const dims = this.embedder.dimensions;
      if (dimRow && Number(dimRow.value) !== dims) {
        conn.exec('DROP TABLE IF EXISTS vec_nodes; DELETE FROM vec_index;');
      }
      conn.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(embedding float[${dims}])`);
      conn.prepare('INSERT OR REPLACE INTO vec_meta(key, value) VALUES (?, ?)').run('dims', String(dims));
      conn.prepare('INSERT OR REPLACE INTO vec_meta(key, value) VALUES (?, ?)').run('embedder', this.embedder.id);
      this.loaded = true;
      return true;
    } catch {
      return false;
    }
  }

  /** Incrementally embed and index any new/changed nodes for a session. */
  async index(sessionId: string): Promise<{ embedded: number; total: number }> {
    if (!(await this.init())) return { embedded: 0, total: 0 };
    const conn = this.db.rawConnection();
    const nodes = this.db.getNodes(sessionId);

    const getRow = conn.prepare('SELECT rowid, hash FROM vec_index WHERE session_id = ? AND node_id = ?');
    const insIndex = conn.prepare('INSERT INTO vec_index (session_id, node_id, hash) VALUES (?, ?, ?)');
    const updHash = conn.prepare('UPDATE vec_index SET hash = ? WHERE rowid = ?');
    const delVec = conn.prepare('DELETE FROM vec_nodes WHERE rowid = ?');
    const insVec = conn.prepare('INSERT INTO vec_nodes (rowid, embedding) VALUES (?, ?)');

    const pending: Array<{ rowid: bigint; text: string }> = [];
    for (const n of nodes) {
      const text = nodeText(n);
      const h = hash(`${this.embedder.id}:${text}`);
      const existing = getRow.get(sessionId, n.id) as { rowid: number; hash: string } | undefined;
      if (existing) {
        if (existing.hash === h) continue;
        updHash.run(h, existing.rowid);
        delVec.run(BigInt(existing.rowid));
        pending.push({ rowid: BigInt(existing.rowid), text });
      } else {
        const info = insIndex.run(sessionId, n.id, h);
        pending.push({ rowid: BigInt(info.lastInsertRowid as number), text });
      }
    }

    if (pending.length > 0) {
      const vectors = await this.embedder.embed(pending.map((p) => p.text));
      const tx = conn.transaction(() => {
        pending.forEach((p, i) => insVec.run(p.rowid, toBuffer(vectors[i]!)));
      });
      tx();
    }
    return { embedded: pending.length, total: nodes.length };
  }

  /** k-nearest-neighbour search within a session. Returns node ids + distances. */
  async search(sessionId: string, query: string, k: number): Promise<Array<{ nodeId: string; distance: number }>> {
    if (!(await this.init())) return [];
    await this.index(sessionId);
    const conn = this.db.rawConnection();
    const [qv] = await this.embedder.embed([query]);
    if (!qv) return [];

    // Pure-vec KNN scan (most compatible form), then map rowids and filter by
    // session in JS. Over-fetch so cross-session neighbours don't crowd out hits.
    const overfetch = Math.max(k * 5, k);
    const knn = conn.prepare(
      'SELECT rowid, distance FROM vec_nodes WHERE embedding MATCH ? ORDER BY distance LIMIT ?',
    ).all(toBuffer(qv), overfetch) as Array<{ rowid: number; distance: number }>;

    const meta = conn.prepare('SELECT node_id AS nodeId, session_id AS sessionId FROM vec_index WHERE rowid = ?');
    const out: Array<{ nodeId: string; distance: number }> = [];
    for (const row of knn) {
      const m = meta.get(row.rowid) as { nodeId: string; sessionId: string } | undefined;
      if (m && m.sessionId === sessionId) out.push({ nodeId: m.nodeId, distance: row.distance });
      if (out.length >= k) break;
    }
    return out;
  }
}
