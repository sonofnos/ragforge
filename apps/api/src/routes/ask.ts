import { Router } from "express";
import type { AnswerClient, EmbeddingsClient, VectorStore } from "@ragforge/core";
import { askQuestion } from "@ragforge/core";
import { ChatSessionModel } from "../mongo/models";

export interface AskRouteDeps {
  embeddings: EmbeddingsClient;
  store: VectorStore;
  answerClient: AnswerClient;
}

export function askRouter(deps: AskRouteDeps): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const { question, chatId } = req.body as { question?: string; chatId?: string };
    if (!question || typeof question !== "string") {
      res.status(400).json({ error: "question is required" });
      return;
    }
    const tenantId = req.user!.uid;

    const result = await askQuestion({
      tenantId,
      question,
      embeddings: deps.embeddings,
      store: deps.store,
      answerClient: deps.answerClient,
    });

    let session = chatId ? await ChatSessionModel.findOne({ _id: chatId, tenantId }) : null;
    if (!session) {
      session = await ChatSessionModel.create({
        tenantId,
        title: question.slice(0, 60),
        messages: [],
      });
    }
    session.messages.push({ role: "user", text: question, sources: [] });
    session.messages.push({ role: "assistant", text: result.answer, sources: result.sources });
    await session.save();

    res.json({
      chatId: session.id,
      answer: result.answer,
      sources: result.sources,
    });
  });

  return router;
}
