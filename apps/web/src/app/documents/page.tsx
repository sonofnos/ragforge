"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { listDocuments, uploadDocument, type DocumentSummary } from "@/lib/api";

export default function DocumentsPage() {
  return (
    <AuthGate>
      <Documents />
    </AuthGate>
  );
}

function Documents() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setDocs(await listDocuments());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load documents");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!filename.trim() || !text.trim()) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(filename, text);
      setFilename("");
      setText("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <h1>Documents</h1>
      <form onSubmit={onUpload} className="card">
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Filename (e.g. handbook.txt)"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <input
            type="file"
            accept=".txt,.md"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFilename((f) => f || file.name);
              setText(await file.text());
            }}
          />
        </div>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
          Only plain text/markdown content is ingested (no PDF/DOCX parsing). Pick a .txt/.md file above, or paste
          text below.
        </p>
        <div style={{ marginBottom: 12 }}>
          <textarea
            placeholder="Paste document text to ingest"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <button type="submit" disabled={uploading || !filename.trim() || !text.trim()}>
          {uploading ? "Uploading..." : "Upload"}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>

      <h2>Your documents</h2>
      {docs.length === 0 ? <p className="muted">No documents yet.</p> : null}
      {docs.map((doc) => (
        <div className="card" key={doc.documentId}>
          <strong>{doc.filename}</strong>
          <div className="muted">
            {doc.status} &middot; {doc.chunkCount} chunks
          </div>
        </div>
      ))}
    </div>
  );
}
