import { describe, expect, it } from "vitest";
import { FakeEmbeddingsClient } from "./embeddings";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe("FakeEmbeddingsClient", () => {
  it("is deterministic: the same text always embeds to the same vector", async () => {
    const client = new FakeEmbeddingsClient(16);
    const a = await client.embedQuery("the quick brown fox");
    const b = await client.embedQuery("the quick brown fox");
    expect(a).toEqual(b);
  });

  it("produces vectors with the configured dimensionality", async () => {
    const client = new FakeEmbeddingsClient(16);
    const vec = await client.embedQuery("hello world");
    expect(vec).toHaveLength(16);
  });

  it("embeds texts sharing vocabulary closer than unrelated texts", async () => {
    const client = new FakeEmbeddingsClient(64);
    const base = await client.embedQuery("postgres pgvector similarity search");
    const related = await client.embedQuery("pgvector similarity search in postgres");
    const unrelated = await client.embedQuery("banana bread recipe instructions");

    expect(cosine(base, related)).toBeGreaterThan(cosine(base, unrelated));
  });

  it("embedDocuments embeds each text independently and matches embedQuery for the same text", async () => {
    const client = new FakeEmbeddingsClient(16);
    const [docVec] = await client.embedDocuments(["same text"]);
    const queryVec = await client.embedQuery("same text");
    expect(docVec).toEqual(queryVec);
  });

  it("records every text it was asked to embed", async () => {
    const client = new FakeEmbeddingsClient(16);
    await client.embedDocuments(["one", "two"]);
    await client.embedQuery("three");
    expect(client.calls).toEqual(["one", "two", "three"]);
  });
});
