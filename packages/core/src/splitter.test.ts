import { describe, expect, it } from "vitest";
import { splitText } from "./splitter";

describe("splitText", () => {
  it("splits long text into multiple chunks within the configured size", async () => {
    const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(40);
    const chunks = await splitText(paragraph, { chunkSize: 200, chunkOverlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(220);
    }
  });

  it("returns a single chunk for short text", async () => {
    const chunks = await splitText("A short sentence.", { chunkSize: 1000, chunkOverlap: 100 });
    expect(chunks).toEqual(["A short sentence."]);
  });

  it("returns no chunks for empty text", async () => {
    const chunks = await splitText("   ", { chunkSize: 1000 });
    expect(chunks).toEqual([]);
  });
});
