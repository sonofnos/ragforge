import type { AnswerClient, ContextChunk } from "./answer";
import type { EmbeddingsClient } from "./embeddings";
import type { VectorStore } from "./vectorstore";
import { splitText } from "./splitter";
import { randomUUID } from "node:crypto";

export interface IngestResult {
  documentId: string;
  chunkCount: number;
}

/** Splits + embeds a document's text and stores it, scoped to a tenant. */
export async function ingestDocument(params: {
  tenantId: string;
  documentId: string;
  text: string;
  embeddings: EmbeddingsClient;
  store: VectorStore;
  chunkSize?: number;
  chunkOverlap?: number;
}): Promise<IngestResult> {
  const { tenantId, documentId, text, embeddings, store } = params;
  const chunks = await splitText(text, {
    chunkSize: params.chunkSize,
    chunkOverlap: params.chunkOverlap,
  });
  if (chunks.length === 0) {
    return { documentId, chunkCount: 0 };
  }
  const vectors = await embeddings.embedDocuments(chunks);
  await store.upsertChunks(
    tenantId,
    documentId,
    chunks.map((text, i) => ({
      id: randomUUID(),
      documentId,
      chunkIndex: i,
      text,
      embedding: vectors[i],
    })),
  );
  return { documentId, chunkCount: chunks.length };
}

export interface AskResult {
  answer: string;
  sources: Array<{ chunkId: string; documentId: string; text: string; distance: number }>;
}

/**
 * The retrieval chain: embed the question, fetch the top-k nearest chunks
 * for this tenant, number them for the prompt, ask the LLM, then map the
 * refs it actually cited back to their source chunks -- dropping any ref
 * number the model mentions that wasn't genuinely offered as context, so a
 * citation can never point at a source the model wasn't given.
 */
export async function askQuestion(params: {
  tenantId: string;
  question: string;
  embeddings: EmbeddingsClient;
  store: VectorStore;
  answerClient: AnswerClient;
  topK?: number;
}): Promise<AskResult> {
  const { tenantId, question, embeddings, store, answerClient, topK = 5 } = params;
  const queryEmbedding = await embeddings.embedQuery(question);
  const matches = await store.similaritySearch(tenantId, queryEmbedding, topK);

  const context: ContextChunk[] = matches.map((m, i) => ({
    ref: i + 1,
    chunkId: m.id,
    documentId: m.documentId,
    text: m.text,
  }));

  const result = await answerClient.answer(question, context);

  const byRef = new Map(context.map((c) => [c.ref, c]));
  const distanceByChunkId = new Map(matches.map((m) => [m.id, m.distance]));
  const sources = result.citedRefs
    .map((ref) => byRef.get(ref))
    .filter((c): c is ContextChunk => c !== undefined)
    .map((c) => ({
      chunkId: c.chunkId,
      documentId: c.documentId,
      text: c.text,
      distance: distanceByChunkId.get(c.chunkId) ?? 0,
    }));

  return { answer: result.text, sources };
}
