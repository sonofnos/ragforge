import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export interface SplitOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

/** Thin wrapper around LangChain's RecursiveCharacterTextSplitter so callers
 * don't need to know LangChain's `Document` shape. */
export async function splitText(text: string, options: SplitOptions = {}): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.chunkSize ?? 1000,
    chunkOverlap: options.chunkOverlap ?? 150,
  });
  const chunks = await splitter.splitText(text);
  return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
}
