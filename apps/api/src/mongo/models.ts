import { Schema, model, type InferSchemaType } from "mongoose";

/**
 * MongoDB holds metadata and conversational state -- the things that are
 * naturally document-shaped and don't need relational joins or vector
 * search. PostgreSQL/pgvector (see @ragforge/core's PgVectorStore) holds the
 * document chunks + embeddings, which genuinely benefit from pgvector's
 * similarity index. That's the real separation of concerns: Mongo never
 * stores embeddings, Postgres never stores chat transcripts.
 */

const DocumentMetadataSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    documentId: { type: String, required: true, unique: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    chunkCount: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ["processing", "ready", "failed"], default: "processing" },
  },
  { timestamps: true },
);
DocumentMetadataSchema.index({ tenantId: 1, documentId: 1 });

const ChatMessageSchema = new Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    text: { type: String, required: true },
    sources: {
      type: [
        new Schema(
          {
            chunkId: String,
            documentId: String,
            text: String,
            distance: Number,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true, _id: true },
);

const ChatSessionSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    title: { type: String, default: "New chat" },
    messages: { type: [ChatMessageSchema], default: [] },
  },
  { timestamps: true },
);
ChatSessionSchema.index({ tenantId: 1, updatedAt: -1 });

const UserProfileSchema = new Schema(
  {
    tenantId: { type: String, required: true, unique: true },
    email: { type: String },
    displayName: { type: String },
    lastSeenAt: { type: Date },
  },
  { timestamps: true },
);

export type DocumentMetadata = InferSchemaType<typeof DocumentMetadataSchema>;
export type ChatSession = InferSchemaType<typeof ChatSessionSchema>;
export type UserProfile = InferSchemaType<typeof UserProfileSchema>;

export const DocumentMetadataModel = model("DocumentMetadata", DocumentMetadataSchema);
export const ChatSessionModel = model("ChatSession", ChatSessionSchema);
export const UserProfileModel = model("UserProfile", UserProfileSchema);
