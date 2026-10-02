# ragforge

A multi-tenant document Q&A assistant: upload documents, ask questions, get
answers grounded in and cited from your own documents only. Built to
genuinely exercise its stack end to end rather than name-drop it.

- **apps/web** -- Next.js 15 + TypeScript + React. Chat UI, document upload,
  answers rendered with citations linking back to source chunks. Firebase
  Authentication (email/password) gates the app client-side via the Firebase
  JS SDK.
- **apps/api** -- Node.js + Express 5 + TypeScript. Verifies Firebase ID
  tokens server-side with `firebase-admin` (the client is never trusted).
  Routes for uploading documents, listing documents, asking questions (RAG),
  and chat history.
- **packages/core** -- the RAG orchestration: LangChain.js (`@langchain/core`,
  `@langchain/openai`, `@langchain/google-genai`, `@langchain/textsplitters`)
  actually does document splitting, embedding, and answer generation via
  `ChatOpenAI`/`OpenAIEmbeddings` or `ChatGoogleGenerativeAI`/
  `GoogleGenerativeAIEmbeddings` -- not a hand-rolled API client. Chunk +
  embedding storage is PostgreSQL + pgvector.
- **MongoDB** stores document metadata, chat sessions/messages, and user
  profile records -- a real separation of concerns from Postgres, which only
  ever stores chunk text + embeddings.

Everything is scoped by `tenantId` (the Firebase `uid`): documents, chunks,
and chat sessions all carry it, and every query filters by it.

## Why a hand-rolled Postgres wrapper instead of LangChain's `PGVectorStore`

LangChain.js ships `PGVectorStore` (`@langchain/community`), but it assumes
it owns the whole table (creates/drops it, bakes in its own column names),
and has no first-class way to filter similarity search by an arbitrary
tenant id without dropping to a raw SQL filter string that bypasses its own
typed query builder. Since multi-tenant scoping is a hard requirement here, a
thin wrapper directly over `pg` + the `vector` extension
(`packages/core/src/vectorstore.ts`) is more predictable and auditable than
fighting that abstraction. LangChain still does the real orchestration work
-- `RecursiveCharacterTextSplitter`, `OpenAIEmbeddings`, and `ChatOpenAI` are
all real LangChain; only the storage layer is hand-rolled.

## Citations are real

If the model's answer cites a source number it was never actually given
(e.g. `[9]` when only 5 sources were in the prompt), that citation is
dropped rather than mapped to a fabricated source. See
`packages/core/src/answer.ts`'s `extractCitedRefs` and the tests in
`answer.test.ts` / `rag.test.ts` (`"drops a hallucinated citation ... rather
than fabricating a source for it"`).

## Dependency injection / fake clients

Every external, costed, or networked dependency sits behind a narrow
interface, mirroring the pattern used in this author's other portfolio repos
(docwise's `backend/agent/llm.py`):

- `EmbeddingsClient` -- real: `GeminiEmbeddingsClient` (LangChain's
  `GoogleGenerativeAIEmbeddings`, Gemini's `gemini-embedding-001`, free tier)
  or `OpenAIEmbeddingsClient` (LangChain's `OpenAIEmbeddings`). Fake:
  `FakeEmbeddingsClient`, a deterministic hash-based embedder (same text ->
  same vector, shared vocabulary -> closer vectors) so retrieval-order tests
  are meaningful with zero API calls.
- `AnswerClient` -- real: `GeminiAnswerClient` (LangChain's
  `ChatGoogleGenerativeAI`, Gemini's `gemini-2.5-flash`, free tier) or
  `ChatOpenAIAnswerClient` (LangChain's `ChatOpenAI`). Fake:
  `FakeAnswerClient`, which cites every chunk it's given, or takes canned
  text (including deliberately hallucinated citations, for testing the
  dropping behavior).
- `TokenVerifier` -- real: `FirebaseTokenVerifier` (`firebase-admin`). Fake:
  `FakeTokenVerifier`, which accepts tokens of the form `fake:<uid>:<email>`.

`getEmbeddingsClient({ googleApiKey, openaiApiKey })` /
`getAnswerClient({ googleApiKey, openaiApiKey })` pick, in order: Gemini if
`GOOGLE_API_KEY` is set, OpenAI if `OPENAI_API_KEY` is set, else the
deterministic fake -- so tests and local dev run free and offline by
default. Gemini is checked first because it's the provider that doesn't
require a card on file.

### Gemini path -- rate limits and what was actually verified

- **Env var:** `GOOGLE_API_KEY`. This is the exact variable name
  `@langchain/google-genai` reads internally (confirmed by reading its
  source, not guessed) -- `GEMINI_API_KEY` is not read by this package, so
  don't set that instead.
- **Models:** `gemini-2.5-flash` for answers, `gemini-embedding-001` for
  embeddings. The obvious first picks -- `gemini-2.0-flash` and
  `text-embedding-004` -- are both already gone as of this writing
  (2026-10-02): `text-embedding-004` was shut down January 14 2026, and
  `gemini-2.0-flash` shut down June 1 2026. `gemini-embedding-001` defaults
  to 3072-dimensional vectors; the installed LangChain wrapper
  (`@langchain/google-genai` 0.2.x) doesn't expose the Gemini API's
  `outputDimensionality` truncation parameter, so the Postgres vector column
  is sized dynamically from `embeddings.dimensions` (3072 for Gemini, 1536
  for OpenAI/the fake) rather than a hardcoded constant -- see
  `apps/api/src/server.ts`.
- **Free-tier rate limits (checked Oct 2026, not assumed):** sources
  disagree on the exact number -- somewhere between roughly 500 and 1,500
  requests/day for `gemini-2.5-flash`, with a tighter per-minute cap (around
  10 RPM) -- and Google has changed these limits multiple times through
  2026, so treat any specific number here as approximate and re-check
  Google's current quota page before relying on it.
- **Not verified against a real key.** No `GOOGLE_API_KEY` was available
  while building this; `GeminiAnswerClient`/`GeminiEmbeddingsClient` are
  written against the documented `@langchain/google-genai` API (whose
  source was read directly, including to confirm the env var name and the
  absence of dimension-truncation support) and typecheck/build cleanly, and
  the fake-backed path was exercised by the full test suite, but no real
  Gemini API call was made. Say so plainly rather than claiming it works:
  it's untested against the live API until a real key is set.

## Tests

```
packages/core:  20 unit tests (vitest)      + 5 integration tests (Testcontainers, real Postgres/pgvector)
apps/api:        3 unit tests (vitest)      + 5 integration tests (mongodb-memory-server, real MongoDB)
```

33 tests total, all passing locally and in CI.

- Unit tests cover citation extraction/dropping, the deterministic fake
  embeddings' similarity behavior, the text splitter, and the full
  ingest-then-ask RAG flow with an in-memory vector store (tenant isolation,
  hallucinated-citation dropping end to end).
- `packages/core/src/vectorstore.integration.test.ts` runs against a real
  `pgvector/pgvector:pg16` container via Testcontainers: schema creation,
  tenant-scoped similarity search, cosine-distance ordering, delete, and
  upsert-replaces-existing-row.
- `apps/api/src/app.integration.test.ts` runs the real Express app through
  `supertest` against a real MongoDB (via `mongodb-memory-server`, an actual
  `mongod` binary, not a mock): upload -> list -> ask -> chat history,
  cross-tenant isolation, and a 404 for a chat that belongs to a different
  tenant. The vector store in this suite is the in-memory fake, not real
  Postgres -- real Postgres/pgvector coverage already lives in
  `packages/core`'s Testcontainers suite, and spinning up a second container
  just to re-test SQL this package doesn't own wasn't worth the time. The
  LLM/embeddings clients are the deterministic fakes throughout, so CI is
  hermetic and has zero OpenAI cost.

Run everything:

```
npm install
npm run build -w @ragforge/core   # packages/core must be built before apps/api can resolve it
npm run typecheck --workspaces
npm run lint --workspaces
npm run test --workspaces         # unit tests
npm run test:integration -w @ragforge/core   # needs Docker
npm run test:integration -w @ragforge/api    # downloads a mongod binary on first run
```

## Real bugs hit while building this

- **`@ragforge/core` not resolvable from `apps/api` until built.** The
  workspace package's `main` points at `dist/index.js`; before running
  `tsc -p packages/core/tsconfig.json` at least once, Vite/vitest in
  `apps/api` failed with `Failed to resolve entry for package
  "@ragforge/core"`. Fixed by making CI build `packages/core` explicitly
  before anything that depends on it.
- **Test pollution from a module-level `InMemoryVectorStore` shared across
  `it()` blocks.** `apps/api`'s integration suite builds the Express `app`
  once in `describe()` for speed, but the in-memory vector store isn't reset
  between tests the way Mongo collections are in `afterEach`. A later test
  asserting its answer's sources only mentioned "Tenant A" failed because an
  earlier test's chunks about a different topic were still in the shared
  store and got retrieved. Fixed by adding `InMemoryVectorStore.clearAll()`
  and calling it in `afterEach`.
- **Express 4's async route handlers don't reach the error middleware.**
  Started with Express 4; an exception thrown inside an `async (req, res) =>
  {...}` handler becomes an unhandled promise rejection, not a call into
  `next(err)`, so the centralized error handler in `app.ts` never ran. Rather
  than wrapping every handler in a `try/catch`-and-`next(err)` helper,
  switched to Express 5, which forwards a rejected handler promise to the
  error middleware automatically.
- **`next build` fails with `auth/invalid-api-key` when no real Firebase
  project is configured.** Next.js imports every page module during its
  "Collecting page data" build step (even for pages later marked dynamic),
  which runs `apps/web/src/lib/firebase.ts`'s module-level `getAuth(app)` --
  and Firebase's Auth SDK validates the API key's format synchronously, so
  an empty/missing `NEXT_PUBLIC_FIREBASE_API_KEY` fails the whole build, not
  just auth at runtime. Fixed by falling back to a syntactically-valid
  placeholder Firebase config when the real env vars aren't set, so
  `npm run build` (and CI) stay green with no real Firebase project. Real
  sign-in only works once real `NEXT_PUBLIC_FIREBASE_*` values are provided
  at build time.

## What was NOT verified for real (gaps, stated plainly)

- **Firebase Admin token verification was never run against a real Firebase
  project.** That needs an actual Firebase project + a real service account
  + a real ID token minted by signing in through the Firebase JS SDK against
  that project. None of that was set up here. `FirebaseTokenVerifier`
  (`apps/api/src/auth.ts`) is written against the documented `firebase-admin`
  API and typechecks, but it has not been exercised end to end with a live
  token. Only `FakeTokenVerifier` is exercised by the test suite.
- **`ChatOpenAIAnswerClient` / `OpenAIEmbeddingsClient` were never called
  against the real OpenAI API.** No `OPENAI_API_KEY` was used anywhere in
  this build; the LangChain wiring (`ChatOpenAI`, `OpenAIEmbeddings`) is
  correct against the documented LangChain.js API and compiles, but a real
  OpenAI call was never made.
- **`GeminiAnswerClient` / `GeminiEmbeddingsClient` were never called
  against the real Gemini API either**, for the same reason: no
  `GOOGLE_API_KEY` was available while building this. See "Gemini path"
  above.
- **No deployment.** No Vercel/Render/Neon/Atlas/Firebase Hosting setup was
  done -- this repo is the application and its tests only, as scoped.
- **File upload is plain text/markdown only.** `apps/api`'s `/api/documents`
  route accepts raw text (pasted or read from a `.txt`/`.md` file client-side
  via `FileReader`), not binary PDF/DOCX parsing. Real file-format parsing
  (`pdf-parse`, `mammoth`, etc.) was out of scope for the time available;
  documented here rather than left to be discovered.

## Local development

```
docker compose up -d        # Postgres+pgvector and MongoDB
cp apps/api/.env.example apps/api/.env       # fill in FIREBASE_SERVICE_ACCOUNT_JSON to run the real server
cp apps/web/.env.example apps/web/.env.local # fill in a real Firebase web config to actually sign in

npm install
npm run build -w @ragforge/core
npm run dev -w @ragforge/api   # :4000
npm run dev -w @ragforge/web   # :3000
```

Without `GOOGLE_API_KEY` or `OPENAI_API_KEY` set on the API, ask/upload
still work end to end using the deterministic fake LLM/embeddings -- useful
for exercising the UI without any cost. Set `GOOGLE_API_KEY` to a real
Gemini API key (free tier, no card required) to use the real Gemini-backed
clients; it's checked before `OPENAI_API_KEY`.
