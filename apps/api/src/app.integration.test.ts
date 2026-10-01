import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { FakeAnswerClient, FakeEmbeddingsClient, InMemoryVectorStore } from "@ragforge/core";
import { createApp } from "./app";
import { FakeTokenVerifier, makeFakeIdToken } from "./auth";
import { DocumentMetadataModel, ChatSessionModel } from "./mongo/models";

// Real integration test: a real MongoDB instance via mongodb-memory-server
// (actual mongod binary, real wire protocol), exercised through supertest
// end to end. The vector store is the in-memory fake (not real Postgres) --
// real Postgres/pgvector coverage lives in @ragforge/core's Testcontainers
// suite (packages/core/src/vectorstore.integration.test.ts); duplicating a
// full container spin-up here just to re-test SQL this package doesn't own
// would be slow for no extra signal. LLM/embeddings are the deterministic
// fakes so this suite is hermetic and free, per the project's CI brief.
describe("ragforge api (real Mongo via mongodb-memory-server)", () => {
  let mongod: MongoMemoryServer;
  const store = new InMemoryVectorStore();
  const app = createApp({
    verifier: new FakeTokenVerifier(),
    embeddings: new FakeEmbeddingsClient(32),
    store,
    answerClient: new FakeAnswerClient(),
  });

  const tokenA = makeFakeIdToken("tenant-a", "a@example.com");
  const tokenB = makeFakeIdToken("tenant-b", "b@example.com");

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterEach(async () => {
    await DocumentMetadataModel.deleteMany({});
    await ChatSessionModel.deleteMany({});
    store.clearAll();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/documents");
    expect(res.status).toBe(401);
  });

  it("uploads a document, lists it, then answers a question grounded in it", async () => {
    const upload = await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ filename: "notes.txt", text: "Ragforge stores embeddings in Postgres using pgvector." });
    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe("ready");
    expect(upload.body.chunkCount).toBeGreaterThan(0);

    const list = await request(app).get("/api/documents").set("Authorization", `Bearer ${tokenA}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].filename).toBe("notes.txt");

    const ask = await request(app)
      .post("/api/ask")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ question: "Where does ragforge store embeddings?" });
    expect(ask.status).toBe(200);
    expect(ask.body.sources.length).toBeGreaterThan(0);
    expect(ask.body.chatId).toBeDefined();

    const chats = await request(app).get("/api/chats").set("Authorization", `Bearer ${tokenA}`);
    expect(chats.status).toBe(200);
    expect(chats.body).toHaveLength(1);

    const chat = await request(app)
      .get(`/api/chats/${ask.body.chatId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(chat.status).toBe(200);
    expect(chat.body.messages).toHaveLength(2);
    expect(chat.body.messages[0].role).toBe("user");
    expect(chat.body.messages[1].role).toBe("assistant");
  });

  it("scopes documents, chats, and answers to the authenticated tenant", async () => {
    await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ filename: "a.txt", text: "Tenant A's private document about quarterly revenue figures." });
    await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ filename: "b.txt", text: "Tenant B's private document about unrelated shipping logistics." });

    const listA = await request(app).get("/api/documents").set("Authorization", `Bearer ${tokenA}`);
    const listB = await request(app).get("/api/documents").set("Authorization", `Bearer ${tokenB}`);
    expect(listA.body.map((d: { filename: string }) => d.filename)).toEqual(["a.txt"]);
    expect(listB.body.map((d: { filename: string }) => d.filename)).toEqual(["b.txt"]);

    const askA = await request(app)
      .post("/api/ask")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ question: "What is in the document?" });
    for (const source of askA.body.sources) {
      expect(source.text).toContain("Tenant A");
    }

    const chatsB = await request(app).get("/api/chats").set("Authorization", `Bearer ${tokenB}`);
    expect(chatsB.body).toHaveLength(0);
  });

  it("returns 404 for a chat belonging to a different tenant", async () => {
    await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ filename: "c.txt", text: "Some content for tenant A to chat about." });
    const ask = await request(app)
      .post("/api/ask")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ question: "anything?" });

    const res = await request(app)
      .get(`/api/chats/${ask.body.chatId}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("rejects an upload missing required fields", async () => {
    const res = await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ filename: "no-text.txt" });
    expect(res.status).toBe(400);
  });
});
