/**
 * DEFECT-0062 — a rate limiter may key on identity only where identity exists.
 *
 * The defect as filed ("duplicate limiters double the allowed rate") was
 * backwards: stacked limiters each count every request, so the stricter one
 * wins. The live defect was that server/index.ts mounted its limiters before
 * Clerk had populated req.auth, keyed them `getClerkAuth(req)?.userId ||
 * req.ip`, and so keyed every request on req.ip — the Cloudflare EDGE address
 * behind trust-proxy=1. The general API, AI, export and auth budgets were per
 * Cloudflare edge node, shared across customers. routes.ts mounted a second,
 * same-named set keyed on req.user, which no global mount can see either.
 *
 * This file holds both halves of the fix:
 *   1. behaviour — the per-user limiters, mounted after a Clerk stand-in,
 *      give two users behind one address separate budgets, and give two
 *      clients behind one edge address separate budgets;
 *   2. population — every limiter in index.ts (which runs entirely before
 *      Clerk) is free of identity reads and of bare req.ip, and routes.ts
 *      mounts the per-user set exactly once, after Clerk and before the first
 *      /api/auth route.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { mountIdentityRateLimiters, identityRateLimitKey } from "../../server/middleware/identityRateLimiters";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => stripComments(readFileSync(resolve(ROOT, p), "utf8"));

/** App shaped like production: Clerk stand-in first, then the per-user set. */
function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use((req, _res, next) => {
    const user = req.headers["x-test-user"];
    if (typeof user === "string") {
      (req as unknown as { auth: { userId: string } }).auth = { userId: user };
    }
    next();
  });
  mountIdentityRateLimiters(app);
  app.get("/api/leads/export", (_req, res) => res.json({ ok: true }));
  return app;
}

// Every request arrives from the same Cloudflare edge, as in production.
const EDGE = "203.0.113.9";

describe("DEFECT-0062 behaviour — per-user budgets are per user", () => {
  beforeAll(() => {
    delete process.env.E2E_TEST_AUTH;
  });

  it("two signed-in users behind one address do not share the export cap", async () => {
    const app = buildApp();
    const hit = (user: string) =>
      request(app).get("/api/leads/export").set("X-Forwarded-For", EDGE).set("CF-Connecting-IP", "198.51.100.7").set("x-test-user", user);
    for (let i = 0; i < 5; i++) expect((await hit("user_a")).status).toBe(200);
    expect((await hit("user_a")).status).toBe(429);
    expect((await hit("user_b")).status).toBe(200);
  });

  it("two anonymous clients behind one Cloudflare edge do not share a bucket", async () => {
    const app = buildApp();
    const hit = (client: string) =>
      request(app).get("/api/leads/export").set("X-Forwarded-For", EDGE).set("CF-Connecting-IP", client);
    for (let i = 0; i < 5; i++) expect((await hit("198.51.100.20")).status).toBe(200);
    expect((await hit("198.51.100.20")).status).toBe(429);
    expect((await hit("198.51.100.21")).status).toBe(200);
  });

  it("the key is the verified user, else the real client IP — never the edge", () => {
    const withUser = { auth: { userId: "user_x" }, headers: { "cf-connecting-ip": "198.51.100.30" }, ip: EDGE };
    const anon = { headers: { "cf-connecting-ip": "198.51.100.30" }, ip: EDGE };
    expect(identityRateLimitKey(withUser as never)).toBe("user:user_x");
    expect(identityRateLimitKey(anon as never)).toContain("198.51.100.30");
    expect(identityRateLimitKey(anon as never)).not.toContain(EDGE);
  });
});

/** Every `rateLimit({ ... })` config object in a source, brace-matched. */
function rateLimitConfigs(src: string): string[] {
  const out: string[] = [];
  const re = /\brateLimit\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let end = -1;
    for (let k = m.index + m[0].length - 1; k < src.length; k++) {
      if (src[k] === "{") depth++;
      else if (src[k] === "}" && --depth === 0) { end = k; break; }
    }
    // A config whose end cannot be found is COUNTED as a finding, never skipped.
    out.push(end === -1 ? "<<UNTERMINATED rateLimit config>> req.user" : src.slice(m.index, end + 1));
  }
  return out;
}

describe("DEFECT-0062 population — index.ts runs before Clerk, so it may not read identity", () => {
  const index = read("server/index.ts");

  it("index.ts installs no Clerk middleware (the premise of this rule)", () => {
    expect(index).not.toMatch(/clerkMiddleware\s*\(/);
  });

  it("finds every limiter config in index.ts (vacuity floor)", () => {
    // authAttempt, webhook, import, per-IP API floor, MCP.
    expect(rateLimitConfigs(index).length).toBeGreaterThanOrEqual(5);
  });

  it("no index.ts limiter reads identity or keys on the edge address", () => {
    const offenders = rateLimitConfigs(index).filter((cfg) =>
      /getClerkAuth\s*\(|\breq\.(user|auth|organization|organizationId)\b|\breq\.ip\b/.test(cfg),
    );
    expect(offenders).toEqual([]);
  });

  it("every index.ts limiter names its key (the library default is req.ip)", () => {
    const unkeyed = rateLimitConfigs(index).filter((cfg) => !/keyGenerator\s*:/.test(cfg));
    expect(unkeyed).toEqual([]);
  });
});

describe("DEFECT-0062 population — routes.ts mounts the per-user set once, after Clerk", () => {
  const routes = read("server/routes.ts");
  const rateLimitSrc = read("server/middleware/rateLimit.ts");

  it("mountIdentityRateLimiters(app) is called exactly once, after Clerk and before the /api/auth routes", () => {
    const calls = routes.match(/mountIdentityRateLimiters\(app\)/g) ?? [];
    expect(calls).toHaveLength(1);
    const at = routes.indexOf("mountIdentityRateLimiters(app)");
    const clerk = routes.indexOf("clerkMw(req, res");
    const authRoutes = routes.indexOf("registerAuthRoutes(app)");
    expect(clerk).toBeGreaterThan(-1);
    expect(authRoutes).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(clerk);
    expect(at).toBeLessThan(authRoutes);
  });

  it("no global app.use in routes.ts mounts a user-keyed limiter from rateLimit.ts", () => {
    const importLine = routes.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\/middleware\/rateLimit["']/);
    const imported = (importLine?.[1] ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean);
    const userKeyed = imported.filter((name) =>
      new RegExp(`export const ${name}\\s*=\\s*(createAuthenticatedRateLimiter|createOrgTieredRateLimiter)\\(`).test(rateLimitSrc),
    );
    const globallyMounted = userKeyed.filter((name) =>
      new RegExp(`app\\.use\\([^;]*\\b${name}\\b`).test(routes),
    );
    expect(globallyMounted).toEqual([]);
  });
});
