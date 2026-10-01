"use client";

import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";
import { Nav } from "./Nav";

/**
 * Gates the app behind Firebase email/password auth, client-side, via the
 * Firebase JS SDK. This is a convenience gate for the UI only -- every API
 * request still carries the resulting ID token, and the server verifies it
 * with firebase-admin rather than trusting anything the client asserts.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="layout">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginForm />;
  }

  return (
    <>
      <Nav />
      <div className="layout">{children}</div>
    </>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="layout">
      <h1>ragforge</h1>
      <p className="muted">Sign in to ask questions over your documents.</p>
      <form onSubmit={onSubmit} className="card">
        <div style={{ marginBottom: 12 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="form-row">
          <button type="submit" disabled={submitting}>
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            style={{ background: "transparent", color: "#1a1a1a", borderColor: "#ccc" }}
          >
            {mode === "signin" ? "Need an account?" : "Have an account?"}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </div>
  );
}
