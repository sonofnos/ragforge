"use client";

import { useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { askQuestion, type AskResponse } from "@/lib/api";

interface Turn {
  role: "user" | "assistant";
  text: string;
  sources?: AskResponse["sources"];
}

export default function ChatPage() {
  return (
    <AuthGate>
      <Chat />
    </AuthGate>
  );
}

function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [chatId, setChatId] = useState<string | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setError(null);
    const q = question;
    setTurns((t) => [...t, { role: "user", text: q }]);
    setQuestion("");
    setAsking(true);
    try {
      const res = await askQuestion(q, chatId);
      setChatId(res.chatId);
      setTurns((t) => [...t, { role: "assistant", text: res.answer, sources: res.sources }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div>
      <h1>Ask your documents</h1>
      {turns.length === 0 ? <p className="muted">Upload a document, then ask a question about it.</p> : null}
      {turns.map((turn, i) => (
        <div className="message" key={i}>
          <div className="role">{turn.role}</div>
          <div className="text">{turn.text}</div>
          {turn.sources && turn.sources.length > 0 ? (
            <div className="sources">
              {turn.sources.map((s) => (
                <div className="source" key={s.chunkId}>
                  <span className="doc">{s.documentId.slice(0, 8)}</span>: {s.text.slice(0, 140)}
                  {s.text.length > 140 ? "..." : ""}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      <form onSubmit={onSubmit} className="form-row">
        <input
          type="text"
          placeholder="Ask a question..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={asking}
        />
        <button type="submit" disabled={asking || !question.trim()}>
          {asking ? "Asking..." : "Ask"}
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
