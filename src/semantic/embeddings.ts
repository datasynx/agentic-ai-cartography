/**
 * Embedding providers for semantic search.
 *
 * The default provider runs a small sentence-transformer locally via
 * `@huggingface/transformers` (no API key, offline after first download), keeping
 * the package LLM-agnostic. Everything is a lazy import so installs that never use
 * semantic search pay no cost and need no native model.
 */

/** Produces fixed-dimension embeddings for a batch of texts. */
export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

/**
 * Local sentence-transformer embedder (Xenova/all-MiniLM-L6-v2, 384 dims).
 * Returns `undefined` if `@huggingface/transformers` is not installed or the
 * model cannot be loaded, so callers can fall back to lexical search.
 */
export async function createLocalEmbedder(
  model = 'Xenova/all-MiniLM-L6-v2',
): Promise<EmbeddingProvider | undefined> {
  try {
    const tf = await import('@huggingface/transformers');
    const extractor = await tf.pipeline('feature-extraction', model);
    return {
      id: `local:${model}`,
      dimensions: 384,
      async embed(texts: string[]): Promise<Float32Array[]> {
        const out: Float32Array[] = [];
        for (const text of texts) {
          const tensor = await extractor(text, { pooling: 'mean', normalize: true });
          out.push(Float32Array.from(tensor.data as Iterable<number>));
        }
        return out;
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * A deterministic, dependency-free hashing embedder (bag-of-character-ngrams).
 * Not as good as a transformer, but offline, instant, and useful as a fallback
 * and for tests. Produces L2-normalized vectors.
 */
export function createHashEmbedder(dimensions = 256): EmbeddingProvider {
  return {
    id: `hash:${dimensions}`,
    dimensions,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => hashEmbed(text, dimensions));
    },
  };
}

function hashEmbed(text: string, dim: number): Float32Array {
  const v = new Float32Array(dim);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    // hash the token and its char trigrams into buckets
    for (const gram of [tok, ...trigrams(tok)]) {
      const h = fnv1a(gram);
      v[h % dim] += 1;
    }
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] = v[i]! / norm;
  return v;
}

function trigrams(s: string): string[] {
  if (s.length < 3) return [];
  const out: string[] = [];
  for (let i = 0; i <= s.length - 3; i++) out.push(s.slice(i, i + 3));
  return out;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
