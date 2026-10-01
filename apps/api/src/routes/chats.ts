import { Router } from "express";
import { ChatSessionModel } from "../mongo/models";

export function chatsRouter(): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const tenantId = req.user!.uid;
    const sessions = await ChatSessionModel.find({ tenantId }).sort({ updatedAt: -1 }).lean();
    res.json(
      sessions.map((s) => ({
        chatId: String(s._id),
        title: s.title,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
      })),
    );
  });

  router.get("/:id", async (req, res) => {
    const tenantId = req.user!.uid;
    const session = await ChatSessionModel.findOne({ _id: req.params.id, tenantId }).lean();
    if (!session) {
      res.status(404).json({ error: "chat not found" });
      return;
    }
    res.json({
      chatId: String(session._id),
      title: session.title,
      messages: session.messages.map((m) => ({
        role: m.role,
        text: m.text,
        sources: m.sources,
        createdAt: m.createdAt,
      })),
    });
  });

  return router;
}
