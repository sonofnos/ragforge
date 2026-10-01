import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PgVectorStore } from "./vectorstore";

// Real integration test against a real Postgres + pgvector container
// (Testcontainers). Skipped automatically if Docker isn't available in the
// environment (e.g. some sandboxed CI runners) -- see README for how CI
// runs this with a service container instead of Testcontainers' own
// docker-in-docker, which was flakier under GitHub Actions.
describe("PgVectorStore (real Postgres + pgvector)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let store: PgVectorStore;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    store = new PgVectorStore(pool, 8);
    await store.ensureSchema();
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it("creates the vector extension and table idempotently", async () => {
    await expect(store.ensureSchema()).resolves.not.toThrow();
  });

  it("scopes similarity search to the requesting tenant", async () => {
    const docA = randomUUID();
    const docB = randomUUID();

    await store.upsertChunks("tenant-a", docA, [
      { id: randomUUID(), documentId: docA, chunkIndex: 0, text: "alpha chunk", embedding: [1, 0, 0, 0, 0, 0, 0, 0] },
    ]);
    await store.upsertChunks("tenant-b", docB, [
      { id: randomUUID(), documentId: docB, chunkIndex: 0, text: "beta chunk", embedding: [1, 0, 0, 0, 0, 0, 0, 0] },
    ]);

    const resultsA = await store.similaritySearch("tenant-a", [1, 0, 0, 0, 0, 0, 0, 0], 10);
    expect(resultsA).toHaveLength(1);
    expect(resultsA[0].documentId).toBe(docA);

    const resultsB = await store.similaritySearch("tenant-b", [1, 0, 0, 0, 0, 0, 0, 0], 10);
    expect(resultsB).toHaveLength(1);
    expect(resultsB[0].documentId).toBe(docB);
  });

  it("orders results by cosine distance, nearest first", async () => {
    const doc = randomUUID();
    const tenant = `tenant-${randomUUID()}`;
    await store.upsertChunks(tenant, doc, [
      { id: randomUUID(), documentId: doc, chunkIndex: 0, text: "exact match", embedding: [1, 0, 0, 0, 0, 0, 0, 0] },
      { id: randomUUID(), documentId: doc, chunkIndex: 1, text: "orthogonal", embedding: [0, 1, 0, 0, 0, 0, 0, 0] },
      {
        id: randomUUID(),
        documentId: doc,
        chunkIndex: 2,
        text: "close match",
        embedding: [0.9, 0.1, 0, 0, 0, 0, 0, 0],
      },
    ]);

    const results = await store.similaritySearch(tenant, [1, 0, 0, 0, 0, 0, 0, 0], 3);
    expect(results.map((r) => r.text)).toEqual(["exact match", "close match", "orthogonal"]);
    expect(results[0].distance).toBeLessThan(results[1].distance);
    expect(results[1].distance).toBeLessThan(results[2].distance);
  });

  it("deleteDocument removes only that document's chunks", async () => {
    const tenant = `tenant-${randomUUID()}`;
    const keepDoc = randomUUID();
    const dropDoc = randomUUID();
    await store.upsertChunks(tenant, keepDoc, [
      { id: randomUUID(), documentId: keepDoc, chunkIndex: 0, text: "keep me", embedding: [1, 0, 0, 0, 0, 0, 0, 0] },
    ]);
    await store.upsertChunks(tenant, dropDoc, [
      { id: randomUUID(), documentId: dropDoc, chunkIndex: 0, text: "drop me", embedding: [1, 0, 0, 0, 0, 0, 0, 0] },
    ]);

    await store.deleteDocument(tenant, dropDoc);

    const remaining = await store.similaritySearch(tenant, [1, 0, 0, 0, 0, 0, 0, 0], 10);
    expect(remaining.map((r) => r.documentId)).toEqual([keepDoc]);
  });

  it("upserting a chunk with the same id replaces its text and embedding", async () => {
    const tenant = `tenant-${randomUUID()}`;
    const doc = randomUUID();
    const chunkId = randomUUID();
    await store.upsertChunks(tenant, doc, [
      { id: chunkId, documentId: doc, chunkIndex: 0, text: "original", embedding: [1, 0, 0, 0, 0, 0, 0, 0] },
    ]);
    await store.upsertChunks(tenant, doc, [
      { id: chunkId, documentId: doc, chunkIndex: 0, text: "updated", embedding: [0, 1, 0, 0, 0, 0, 0, 0] },
    ]);

    const results = await store.similaritySearch(tenant, [0, 1, 0, 0, 0, 0, 0, 0], 10);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("updated");
  });
});
