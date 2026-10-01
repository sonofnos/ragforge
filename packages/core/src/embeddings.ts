/**
 * Embeddings behind a narrow interface, mirroring the AnswerClient /
 * AnswerClient-style DI pattern used elsewhere in these portfolio repos
 * (docwise's backend/agent/llm.py): production code depends on
 * `EmbeddingsClient`, never on `OpenAIEmbeddings` directly, so tests and
 * local dev run with zero API key and zero network access via
 * `FakeEmbeddingsClient`, falling back to the real OpenAI-backed
 * implementation only when `OPENAI_API_KEY` is set.
 */

export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingsClient {
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

/**
 * Real backend: LangChain's OpenAIEmbeddings (text-embedding-3-small),
 * imported lazily so `@langchain/openai` is only touched when this class is
 * actually instantiated.
 */
export class OpenAIEmbeddingsClient implements EmbeddingsClient {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private embeddings: import("@langchain/openai").OpenAIEmbeddings;

  constructor(apiKey: string, model = "text-embedding-3-small") {
    const { OpenAIEmbeddings } = require("@langchain/openai");
    this.embeddings = new OpenAIEmbeddings({ apiKey, model, dimensions: this.dimensions });
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }
}

/**
 * Deterministic fake: hashes each text into a fixed-length vector so
 * identical/similar inputs produce similar (even identical, for exact
 * matches) vectors, which is enough for retrieval-ordering tests without
 * ever calling out to OpenAI.
 */
export class FakeEmbeddingsClient implements EmbeddingsClient {
  readonly dimensions: number;
  public readonly calls: string[] = [];

  constructor(dimensions = 32) {
    this.dimensions = dimensions;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embed(t));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  private embed(text: string): number[] {
    this.calls.push(text);
    const normalized = text.toLowerCase().trim();
    const vec = new Array(this.dimensions).fill(0);
    // Bag-of-words hashing: each token nudges a handful of deterministic
    // dimensions, so texts sharing vocabulary end up with higher cosine
    // similarity than unrelated texts -- enough signal for similarity-order
    // assertions in tests.
    const tokens = normalized.split(/\W+/).filter(Boolean);
    for (const token of tokens) {
      let h = 2166136261;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % this.dimensions;
      vec[idx] += 1;
      vec[(idx + 7) % this.dimensions] += 0.5;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

export function getEmbeddingsClient(apiKey: string | undefined): EmbeddingsClient {
  if (apiKey) {
    return new OpenAIEmbeddingsClient(apiKey);
  }
  return new FakeEmbeddingsClient(EMBEDDING_DIMENSIONS);
}
