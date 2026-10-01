import { auth } from "./firebase";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new Error("not signed in");
  }
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
  });
}

export interface Source {
  chunkId: string;
  documentId: string;
  text: string;
  distance: number;
}

export interface AskResponse {
  chatId: string;
  answer: string;
  sources: Source[];
}

export interface DocumentSummary {
  documentId: string;
  filename: string;
  chunkCount: number;
  status: "processing" | "ready" | "failed";
  createdAt: string;
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const res = await authedFetch("/api/documents");
  if (!res.ok) throw new Error("failed to list documents");
  return res.json();
}

export async function uploadDocument(filename: string, text: string): Promise<DocumentSummary> {
  const res = await authedFetch("/api/documents", {
    method: "POST",
    body: JSON.stringify({ filename, text }),
  });
  if (!res.ok) throw new Error("failed to upload document");
  return res.json();
}

export async function askQuestion(question: string, chatId?: string): Promise<AskResponse> {
  const res = await authedFetch("/api/ask", {
    method: "POST",
    body: JSON.stringify({ question, chatId }),
  });
  if (!res.ok) throw new Error("failed to ask question");
  return res.json();
}
