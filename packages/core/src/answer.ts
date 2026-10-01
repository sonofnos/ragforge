/**
 * Answer generation behind an `AnswerClient` interface -- same DI pattern as
 * docwise's `backend/agent/llm.py`: production code depends on this
 * interface, not on `@langchain/openai`'s `ChatOpenAI` directly, so the test
 * suite can inject a deterministic `FakeAnswerClient` and run with no
 * network access and no API key.
 */

export interface ContextChunk {
  /** 1-based reference number used in the prompt so the model can cite it back as [N]. */
  ref: number;
  chunkId: string;
  documentId: string;
  text: string;
}

export interface AnswerResult {
  text: string;
  /** Refs the model actually cited AND that were genuinely offered as context. */
  citedRefs: number[];
}

export interface AnswerClient {
  answer(question: string, context: ContextChunk[]): Promise<AnswerResult>;
}

const CITATION_RE = /\[(\d+)\]/g;

export const SYSTEM_PROMPT =
  "You are ragforge, a document question-answering assistant. Answer the " +
  "question using only the numbered source excerpts provided. Cite every " +
  "claim with the bracketed source number it came from, e.g. [1]. If the " +
  "excerpts do not contain the answer, say so plainly instead of guessing.";

export function buildPrompt(question: string, context: ContextChunk[]): string {
  const sources = context.map((c) => `[${c.ref}] ${c.text}`).join("\n\n");
  return (
    `Sources:\n${sources}\n\n` +
    `Question: ${question}\n\n` +
    "Answer using only the sources above, citing each claim as [N]."
  );
}

/**
 * Parses `[N]` markers out of model output, keeping only refs that were
 * actually offered as context. A model can hallucinate a marker number that
 * was never in the prompt (e.g. citing [9] when only 5 sources were given);
 * silently trusting that would let a citation point at nothing, so anything
 * outside `validRefs` is dropped rather than surfaced -- same rule as
 * docwise's `extract_cited_refs`.
 */
export function extractCitedRefs(text: string, validRefs: Set<number>): number[] {
  const seen: number[] = [];
  const seenSet = new Set<number>();
  for (const match of text.matchAll(CITATION_RE)) {
    const ref = Number(match[1]);
    if (validRefs.has(ref) && !seenSet.has(ref)) {
      seen.push(ref);
      seenSet.add(ref);
    }
  }
  return seen;
}

/** Real backend, using LangChain's ChatOpenAI. */
export class ChatOpenAIAnswerClient implements AnswerClient {
  private model: import("@langchain/openai").ChatOpenAI;

  constructor(apiKey: string, modelName = "gpt-4o-mini") {
    const { ChatOpenAI } = require("@langchain/openai");
    this.model = new ChatOpenAI({ apiKey, model: modelName, temperature: 0 });
  }

  async answer(question: string, context: ContextChunk[]): Promise<AnswerResult> {
    if (context.length === 0) {
      return { text: "I don't have any relevant source material to answer that.", citedRefs: [] };
    }
    const response = await this.model.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(question, context) },
    ]);
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const validRefs = new Set(context.map((c) => c.ref));
    return { text, citedRefs: extractCitedRefs(text, validRefs) };
  }
}

/**
 * Deterministic test double. Cites every context chunk it was given (in
 * order) and echoes a snippet of each, so citation-mapping tests can assert
 * on exact chunk ids without depending on network access. Optionally takes
 * canned text, including text engineered to hallucinate out-of-range
 * citations, to exercise the dropping behavior.
 */
export class FakeAnswerClient implements AnswerClient {
  public lastQuestion: string | undefined;
  public lastContext: ContextChunk[] = [];
  constructor(private cannedText?: string) {}

  async answer(question: string, context: ContextChunk[]): Promise<AnswerResult> {
    this.lastQuestion = question;
    this.lastContext = context;
    if (context.length === 0) {
      return { text: "No relevant sources were found.", citedRefs: [] };
    }
    const validRefs = new Set(context.map((c) => c.ref));
    if (this.cannedText !== undefined) {
      return { text: this.cannedText, citedRefs: extractCitedRefs(this.cannedText, validRefs) };
    }
    const parts = ["Based on the sources, here is what I found:"];
    for (const c of context) {
      const snippet = c.text.slice(0, 40).trim();
      parts.push(`${snippet}... [${c.ref}]`);
    }
    const text = parts.join(" ");
    return { text, citedRefs: context.map((c) => c.ref) };
  }
}

export function getAnswerClient(apiKey: string | undefined): AnswerClient {
  if (apiKey) {
    return new ChatOpenAIAnswerClient(apiKey);
  }
  return new FakeAnswerClient();
}
