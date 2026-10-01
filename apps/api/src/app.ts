import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import type { AnswerClient, EmbeddingsClient, VectorStore } from "@ragforge/core";
import type { TokenVerifier } from "./auth";
import { requireAuth } from "./auth";
import { documentsRouter } from "./routes/documents";
import { askRouter } from "./routes/ask";
import { chatsRouter } from "./routes/chats";

export interface AppDeps {
  verifier: TokenVerifier;
  embeddings: EmbeddingsClient;
  store: VectorStore;
  answerClient: AnswerClient;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  const auth = requireAuth(deps.verifier);
  app.use("/api/documents", auth, documentsRouter({ embeddings: deps.embeddings, store: deps.store }));
  app.use(
    "/api/ask",
    auth,
    askRouter({ embeddings: deps.embeddings, store: deps.store, answerClient: deps.answerClient }),
  );
  app.use("/api/chats", auth, chatsRouter());

  // Centralized error handler so a thrown error in any async route becomes a
  // clean 500 instead of an unhandled rejection / Express's default HTML page.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
