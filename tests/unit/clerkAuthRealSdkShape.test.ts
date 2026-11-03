/**
 * getClerkAuth against the shape the REAL @clerk/express middleware installs.
 *
 * clerkAuthV2Shape.test.ts builds `req.auth` by hand. That models the SDK; it
 * does not prove it. Here nothing in @clerk/express or @clerk/backend is
 * mocked: the real `clerkMiddleware` runs on a real Express request and
 * installs `req.auth` itself, from an auth object built by @clerk/backend's
 * own `signedInAuthObject` / `signedOutAuthObject`. Only the network step is
 * stubbed — `clerkClient.authenticateRequest`, which would otherwise verify a
 * token against Clerk — through the middleware's documented `clerkClient`
 * option.
 *
 * So if a future @clerk/* release changes what `req.auth` is (a property
 * again, a getter, a renamed field), this file goes red instead of the
 * hand-built model quietly agreeing with the old shape.
 */
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { clerkMiddleware } from "@clerk/express";
import { signedInAuthObject, signedOutAuthObject } from "@clerk/backend/internal";
import { getClerkAuth } from "../../server/types/request";

// A well-formed (fake) development publishable key: pk_test_ + base64("<fapi host>$").
const PUBLISHABLE_KEY = `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`;

type Verdict = "signed-in" | "signed-out";

function stubClerkClient(verdict: Verdict) {
  const claims = {
    sub: "user_real_sdk",
    sid: "sess_real_sdk",
    fva: [4, 0],
    iss: "https://example.clerk.accounts.dev",
    exp: Math.floor(Date.now() / 1000) + 60,
    iat: Math.floor(Date.now() / 1000),
    nbf: Math.floor(Date.now() / 1000),
    azp: "http://localhost",
  };
  return {
    authenticateRequest: async () => ({
      status: verdict,
      headers: new Headers(),
      toAuth: () =>
        verdict === "signed-in"
          ? signedInAuthObject({ secretKey: "sk_test_x", apiUrl: "https://api.clerk.com" } as never, "token", claims as never)
          : signedOutAuthObject(),
    }),
  };
}

async function observe(verdict: Verdict) {
  const app = express();
  app.use(clerkMiddleware({ publishableKey: PUBLISHABLE_KEY, secretKey: "sk_test_x", clerkClient: stubClerkClient(verdict) as never }));
  app.get("/probe", (req, res) => {
    const raw = (req as unknown as { auth?: unknown }).auth;
    res.json({
      authType: typeof raw,
      objectRead: (raw as { userId?: unknown } | undefined)?.userId ?? "undefined",
      normalized: getClerkAuth(req) ?? null,
    });
  });
  const r = await request(app).get("/probe");
  expect(r.status).toBe(200);
  return r.body as { authType: string; objectRead: unknown; normalized: Record<string, unknown> | null };
}

describe("real @clerk/express middleware → getClerkAuth", () => {
  it("installs req.auth as a function; the object read is undefined; the helper reads the signed-in verdict", async () => {
    const out = await observe("signed-in");
    expect(out.authType).toBe("function");
    expect(out.objectRead).toBe("undefined"); // the pre-Fix-B read, against the real SDK
    expect(out.normalized).toEqual({
      userId: "user_real_sdk",
      sessionId: "sess_real_sdk",
      factorVerificationAge: [4, 0],
    });
  });

  it("a signed-out verdict normalizes to no userId — so hydrateUser's JWT fallback still runs", async () => {
    const out = await observe("signed-out");
    expect(out.authType).toBe("function");
    expect(out.normalized).toEqual({ factorVerificationAge: null });
    expect(out.normalized?.userId).toBeUndefined();
  });
});
