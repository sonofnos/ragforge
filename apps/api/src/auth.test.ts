import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { FakeTokenVerifier, makeFakeIdToken, requireAuth } from "./auth";

function buildProtectedApp() {
  const app = express();
  app.get("/protected", requireAuth(new FakeTokenVerifier()), (req, res) => {
    res.json({ uid: req.user?.uid, email: req.user?.email });
  });
  return app;
}

describe("requireAuth", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await request(buildProtectedApp()).get("/protected");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed bearer token", async () => {
    const res = await request(buildProtectedApp()).get("/protected").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("accepts a valid fake token and attaches the verified user to the request", async () => {
    const token = makeFakeIdToken("user-123", "chris@example.com");
    const res = await request(buildProtectedApp()).get("/protected").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ uid: "user-123", email: "chris@example.com" });
  });
});
