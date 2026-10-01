import mongoose from "mongoose";
import { Pool } from "pg";
import { getAnswerClient, getEmbeddingsClient, PgVectorStore, EMBEDDING_DIMENSIONS } from "@ragforge/core";
import { createApp } from "./app";
import { FirebaseTokenVerifier, type TokenVerifier } from "./auth";

async function main() {
  const port = Number(process.env.PORT ?? 4000);
  const mongoUri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/ragforge";
  const pgUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ragforge";
  const openaiKey = process.env.OPENAI_API_KEY;
  const firebaseServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  await mongoose.connect(mongoUri);

  const pool = new Pool({ connectionString: pgUrl });
  const store = new PgVectorStore(pool, EMBEDDING_DIMENSIONS);
  await store.ensureSchema();

  const embeddings = getEmbeddingsClient(openaiKey);
  const answerClient = getAnswerClient(openaiKey);

  let verifier: TokenVerifier;
  if (firebaseServiceAccount) {
    verifier = new FirebaseTokenVerifier(firebaseServiceAccount);
  } else {
    console.warn(
      "FIREBASE_SERVICE_ACCOUNT_JSON not set -- refusing to start without real auth. " +
        "Set it to a Firebase service account JSON string to run the server for real.",
    );
    process.exit(1);
  }

  const app = createApp({ verifier, embeddings, store, answerClient });
  app.listen(port, () => {
    console.log(`ragforge api listening on :${port}`);
  });
}

main().catch((err) => {
  console.error("failed to start server", err);
  process.exit(1);
});
