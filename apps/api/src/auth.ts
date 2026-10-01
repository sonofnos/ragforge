import type { NextFunction, Request, Response } from "express";

/**
 * Firebase ID token verification behind an interface -- same DI pattern used
 * for the LLM/embeddings/vector-store clients in @ragforge/core. The client
 * app signs the user in with the Firebase JS SDK and sends the resulting ID
 * token on every request; this server NEVER trusts that token's claims
 * without verifying its signature server-side via firebase-admin. Tests
 * inject `FakeTokenVerifier` so route/middleware tests don't need a real
 * Firebase project or service account.
 */

export interface VerifiedUser {
  uid: string;
  email: string | undefined;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<VerifiedUser>;
}

/** Real backend: firebase-admin, imported lazily so it's only required when
 * actually instantiated (tests never construct this class). */
export class FirebaseTokenVerifier implements TokenVerifier {
  private app: import("firebase-admin/app").App;

  constructor(serviceAccountJson: string) {
    const { initializeApp, cert, getApps } = require("firebase-admin/app");
    const credentials = JSON.parse(serviceAccountJson);
    this.app =
      getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(credentials) });
  }

  async verify(idToken: string): Promise<VerifiedUser> {
    const { getAuth } = require("firebase-admin/auth");
    const decoded = await getAuth(this.app).verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email };
  }
}

/**
 * Deterministic fake used in tests and local dev without a Firebase
 * project. Accepts tokens of the form `fake:<uid>:<email>` and rejects
 * anything else, so auth-failure paths are exercisable too.
 */
export class FakeTokenVerifier implements TokenVerifier {
  async verify(idToken: string): Promise<VerifiedUser> {
    const match = /^fake:([^:]+):(.*)$/.exec(idToken);
    if (!match) {
      throw new Error("invalid fake token");
    }
    const [, uid, email] = match;
    return { uid, email: email || undefined };
  }
}

export function makeFakeIdToken(uid: string, email?: string): string {
  return `fake:${uid}:${email ?? ""}`;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: VerifiedUser;
    }
  }
}

export function requireAuth(verifier: TokenVerifier) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    const idToken = header.slice("Bearer ".length);
    try {
      req.user = await verifier.verify(idToken);
      next();
    } catch {
      res.status(401).json({ error: "invalid or expired token" });
    }
  };
}
