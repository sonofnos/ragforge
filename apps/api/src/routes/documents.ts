import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { EmbeddingsClient, VectorStore } from "@ragforge/core";
import { ingestDocument } from "@ragforge/core";
import { DocumentMetadataModel } from "../mongo/models";

export interface DocumentsRouteDeps {
  embeddings: EmbeddingsClient;
  store: VectorStore;
}

/**
 * Accepts plain text (or markdown) content directly rather than parsing
 * uploaded binary files (PDF/DOCX). Real file-format parsing (pdf-parse,
 * mammoth, etc.) was out of scope for the time available here; documented
 * plainly rather than implied -- see README.
 */
export function documentsRouter(deps: DocumentsRouteDeps): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const { filename, text } = req.body as { filename?: string; text?: string };
    if (!filename || !text || typeof text !== "string") {
      res.status(400).json({ error: "filename and text are required" });
      return;
    }
    const tenantId = req.user!.uid;
    const documentId = randomUUID();

    const meta = await DocumentMetadataModel.create({
      tenantId,
      documentId,
      filename,
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(text, "utf8"),
      status: "processing",
    });

    try {
      const result = await ingestDocument({
        tenantId,
        documentId,
        text,
        embeddings: deps.embeddings,
        store: deps.store,
      });
      meta.chunkCount = result.chunkCount;
      meta.status = "ready";
      await meta.save();
    } catch (err) {
      meta.status = "failed";
      await meta.save();
      throw err;
    }

    res.status(201).json({
      documentId,
      filename,
      chunkCount: meta.chunkCount,
      status: meta.status,
    });
  });

  router.get("/", async (req, res) => {
    const tenantId = req.user!.uid;
    const docs = await DocumentMetadataModel.find({ tenantId }).sort({ createdAt: -1 }).lean();
    res.json(
      docs.map((d) => ({
        documentId: d.documentId,
        filename: d.filename,
        chunkCount: d.chunkCount,
        status: d.status,
        createdAt: d.createdAt,
      })),
    );
  });

  return router;
}
