import type { Pool } from "pg";

/**
 * Chunk + embedding storage on Postgres/pgvector.
 *
 * LangChain.js ships `PGVectorStore` (`@langchain/community`), but it
 * assumes it owns the whole table (it creates/drops it, bakes in its own
 * column names, and has no first-class way to filter similarity search by
 * an arbitrary tenant id without dropping to a raw SQL filter string that
 * bypasses its own typed query builder). Since multi-tenant scoping is a
 * hard requirement here, a thin wrapper directly over `pg` + the `vector`
 * extension is more predictable and auditable than fighting that
 * abstraction. This is the "write a thin wrapper" fallback the project
 * brief anticipates. LangChain is still doing the real orchestration work
 * (loading, splitting, embedding, the retrieval+answer chain) --
 * `RecursiveCharacterTextSplitter`, `OpenAIEmbeddings`, and `ChatOpenAI`
 * from `@langchain/openai` / `@langchain/textsplitters` are all real
 * LangChain, just the storage layer is hand-rolled.
 */

export interface ChunkRecord {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

export interface SimilarityResult {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  /** Cosine distance: 0 = identical, 2 = opposite. Lower is more similar. */
  distance: number;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export interface VectorStore {
  upsertChunks(tenantId: string, documentId: string, chunks: ChunkRecord[]): Promise<void>;
  deleteDocument(tenantId: string, documentId: string): Promise<void>;
  similaritySearch(tenantId: string, queryEmbedding: number[], k?: number): Promise<SimilarityResult[]>;
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

/** Pure in-memory VectorStore for fast unit tests that don't need a real
 * Postgres/pgvector instance. Mirrors PgVectorStore's tenant scoping and
 * cosine-distance ordering so RAG orchestration logic can be unit tested in
 * isolation; the real SQL (`embedding <=> $1`, the extension, the index) is
 * only exercised by the integration suite against a real container. */
export class InMemoryVectorStore implements VectorStore {
  private rows: (ChunkRecord & { tenantId: string })[] = [];

  async upsertChunks(tenantId: string, documentId: string, chunks: ChunkRecord[]): Promise<void> {
    for (const chunk of chunks) {
      const idx = this.rows.findIndex((r) => r.id === chunk.id);
      const row = { ...chunk, tenantId, documentId };
      if (idx >= 0) this.rows[idx] = row;
      else this.rows.push(row);
    }
  }

  async deleteDocument(tenantId: string, documentId: string): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.tenantId === tenantId && r.documentId === documentId));
  }

  /** Test helper: wipes every tenant's chunks. Not part of the VectorStore
   * interface since PgVectorStore has no equivalent "drop everything" op in
   * production use. */
  clearAll(): void {
    this.rows = [];
  }

  async similaritySearch(tenantId: string, queryEmbedding: number[], k = 5): Promise<SimilarityResult[]> {
    return this.rows
      .filter((r) => r.tenantId === tenantId)
      .map((r) => ({
        id: r.id,
        documentId: r.documentId,
        chunkIndex: r.chunkIndex,
        text: r.text,
        distance: cosineDistance(queryEmbedding, r.embedding),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }
}

export class PgVectorStore implements VectorStore {
  constructor(
    private pool: Pool,
    private dimensions: number,
  ) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        chunk_index INT NOT NULL,
        text TEXT NOT NULL,
        embedding VECTOR(${this.dimensions}) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS document_chunks_tenant_idx ON document_chunks (tenant_id, document_id)",
    );
  }

  async upsertChunks(tenantId: string, documentId: string, chunks: ChunkRecord[]): Promise<void> {
    if (chunks.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO document_chunks (id, tenant_id, document_id, chunk_index, text, embedding)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding`,
          [chunk.id, tenantId, documentId, chunk.chunkIndex, chunk.text, toVectorLiteral(chunk.embedding)],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteDocument(tenantId: string, documentId: string): Promise<void> {
    await this.pool.query("DELETE FROM document_chunks WHERE tenant_id = $1 AND document_id = $2", [
      tenantId,
      documentId,
    ]);
  }

  async similaritySearch(tenantId: string, queryEmbedding: number[], k = 5): Promise<SimilarityResult[]> {
    const { rows } = await this.pool.query(
      `SELECT id, document_id, chunk_index, text, embedding <=> $1 AS distance
       FROM document_chunks
       WHERE tenant_id = $2
       ORDER BY embedding <=> $1
       LIMIT $3`,
      [toVectorLiteral(queryEmbedding), tenantId, k],
    );
    return rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      chunkIndex: r.chunk_index,
      text: r.text,
      distance: Number(r.distance),
    }));
  }
}
