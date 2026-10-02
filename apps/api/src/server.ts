import mongoose from "mongoose";
import { Pool } from "pg";
import { getAnswerClient, getEmbeddingsClient, PgVectorStore } from "@ragforge/core";
import { createApp } from "./app";
import { FirebaseTokenVerifier, type TokenVerifier } from "./auth";

async function main() {
  const port = Number(process.env.PORT ?? 4000);
  const mongoUri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/ragforge";
  const pgUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ragforge";
  // Provider selection: Gemini (GOOGLE_API_KEY, free tier, no card on file)
  // takes priority over OpenAI (OPENAI_API_KEY), which takes priority over
  // the deterministic fakes used when neither is set. See
  // packages/core/src/{embeddings,answer}.ts for the actual selection logic.
  const googleApiKey = process.env.GOOGLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const firebaseServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  await mongoose.connect(mongoUri);

  const embeddings = getEmbeddingsClient({ googleApiKey, openaiApiKey: openaiKey });
  const answerClient = getAnswerClient({ googleApiKey, openaiApiKey: openaiKey });

  // The vector column must be sized to whichever embeddings client is
  // actually active -- Gemini's gemini-embedding-001 is 3072-dimensional,
  // OpenAI's text-embedding-3-small and the deterministic fake are both
  // 1536, so this can't be a hardcoded constant.
  const pool = new Pool({ connectionString: pgUrl });
  const store = new PgVectorStore(pool, embeddings.dimensions);
  await store.ensureSchema();

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
