import { describe, expect, it } from "vitest";
import { FakeEmbeddingsClient } from "./embeddings";
import { FakeAnswerClient } from "./answer";
import { InMemoryVectorStore } from "./vectorstore";
import { ingestDocument, askQuestion } from "./rag";

describe("ingestDocument + askQuestion", () => {
  it("retrieves only chunks belonging to the asking tenant", async () => {
    const embeddings = new FakeEmbeddingsClient(64);
    const store = new InMemoryVectorStore();

    await ingestDocument({
      tenantId: "tenant-a",
      documentId: "doc-a",
      text: "Ragforge uses LangChain.js to orchestrate retrieval augmented generation over tenant documents.",
      embeddings,
      store,
      chunkSize: 60,
      chunkOverlap: 0,
    });
    await ingestDocument({
      tenantId: "tenant-b",
      documentId: "doc-b",
      text: "Bananas are a good source of potassium and grow in tropical climates.",
      embeddings,
      store,
      chunkSize: 60,
      chunkOverlap: 0,
    });

    const result = await askQuestion({
      tenantId: "tenant-a",
      question: "What does ragforge use for RAG orchestration?",
      embeddings,
      store,
      answerClient: new FakeAnswerClient(),
    });

    expect(result.sources.length).toBeGreaterThan(0);
    for (const source of result.sources) {
      expect(source.documentId).toBe("doc-a");
    }
  });

  it("drops a hallucinated citation end to end instead of returning a fabricated source", async () => {
    const embeddings = new FakeEmbeddingsClient(32);
    const store = new InMemoryVectorStore();

    await ingestDocument({
      tenantId: "tenant-a",
      documentId: "doc-a",
      text: "Only one real fact lives in this short document about pgvector.",
      embeddings,
      store,
      chunkSize: 1000,
      chunkOverlap: 0,
    });

    // Canned answer cites ref [1] (real) and [7] (never offered as context).
    const answerClient = new FakeAnswerClient("The fact is X [1], and also fabricated fact Y [7].");

    const result = await askQuestion({
      tenantId: "tenant-a",
      question: "What is the fact?",
      embeddings,
      store,
      answerClient,
      topK: 1,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].documentId).toBe("doc-a");
  });

  it("returns no sources when the store has nothing for that tenant", async () => {
    const embeddings = new FakeEmbeddingsClient(16);
    const store = new InMemoryVectorStore();
    const result = await askQuestion({
      tenantId: "empty-tenant",
      question: "anything?",
      embeddings,
      store,
      answerClient: new FakeAnswerClient(),
    });
    expect(result.sources).toEqual([]);
  });
});
