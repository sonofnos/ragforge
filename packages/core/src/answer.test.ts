import { describe, expect, it } from "vitest";
import { extractCitedRefs, FakeAnswerClient, buildPrompt, type ContextChunk } from "./answer";

const chunks: ContextChunk[] = [
  { ref: 1, chunkId: "a", documentId: "doc1", text: "The sky is blue because of Rayleigh scattering." },
  { ref: 2, chunkId: "b", documentId: "doc1", text: "Water boils at 100C at sea level." },
];

describe("extractCitedRefs", () => {
  it("keeps refs that were actually offered as context", () => {
    const refs = extractCitedRefs("The sky is blue [1] and water boils at 100C [2].", new Set([1, 2]));
    expect(refs).toEqual([1, 2]);
  });

  it("drops a hallucinated citation that was never in the prompt rather than fabricating a source for it", () => {
    const refs = extractCitedRefs("The sky is blue [1], and also [9] says something unrelated.", new Set([1, 2]));
    expect(refs).toEqual([1]);
  });

  it("dedupes repeated citations to the same ref", () => {
    const refs = extractCitedRefs("[1] and again [1]", new Set([1, 2]));
    expect(refs).toEqual([1]);
  });

  it("returns an empty list when nothing valid is cited", () => {
    const refs = extractCitedRefs("No citations here, or a bogus one [42].", new Set([1, 2]));
    expect(refs).toEqual([]);
  });
});

describe("buildPrompt", () => {
  it("numbers sources matching their ref and includes the question", () => {
    const prompt = buildPrompt("Why is the sky blue?", chunks);
    expect(prompt).toContain("[1] The sky is blue");
    expect(prompt).toContain("[2] Water boils");
    expect(prompt).toContain("Why is the sky blue?");
  });
});

describe("FakeAnswerClient", () => {
  it("cites every chunk it was given, in order, when no canned text is set", async () => {
    const client = new FakeAnswerClient();
    const result = await client.answer("why?", chunks);
    expect(result.citedRefs).toEqual([1, 2]);
    expect(result.text).toContain("[1]");
    expect(result.text).toContain("[2]");
  });

  it("records the question and context it was called with", async () => {
    const client = new FakeAnswerClient();
    await client.answer("why is the sky blue?", chunks);
    expect(client.lastQuestion).toBe("why is the sky blue?");
    expect(client.lastContext).toEqual(chunks);
  });

  it("returns no sources when given no context", async () => {
    const client = new FakeAnswerClient();
    const result = await client.answer("anything?", []);
    expect(result.citedRefs).toEqual([]);
  });

  it("with canned text, still drops a hallucinated out-of-range citation", async () => {
    const client = new FakeAnswerClient("Per [1] and the fabricated source [99], the sky is blue.");
    const result = await client.answer("why?", chunks);
    expect(result.citedRefs).toEqual([1]);
  });
});
