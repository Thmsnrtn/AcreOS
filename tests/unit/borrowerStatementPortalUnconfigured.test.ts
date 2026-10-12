/**
 * The borrower statement portal without a usable signing secret.
 *
 * Measured 2026-10-12 against a local production build with
 * BORROWER_SESSION_SECRET unset: a VALID portal link plus the matching email
 * reached POST /api/borrower/auth/exchange, the token and email were checked,
 * and then the signer threw — a 500 "Something broke on our end". Nothing at
 * boot said the portal could not work.
 *
 * Pinned here, against the running route and the boot check themselves:
 *   1. the exchange answers 503 SERVICE_UNAVAILABLE ("not configured") for a
 *      missing AND for a too-short secret, sets no cookie, and looks up no
 *      credential;
 *   2. with a usable secret the same request still mints the cookie (so the
 *      refusal is about configuration, not a broken route);
 *   3. the statement GET does not 500 on a statement cookie while unconfigured;
 *   4. validateEnv reports the condition exactly once, as a structured
 *      warning naming the variable and the problem, and does not exit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const warns: Array<{ msg: unknown; meta?: any }> = [];
const errors: Array<{ msg: unknown; err?: unknown }> = [];
vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: (msg: unknown, meta?: unknown) => {
      warns.push({ msg, meta });
    },
    error: (msg: unknown, err?: unknown) => {
      errors.push({ msg, err });
    },
  },
}));

const lookups: string[] = [];
vi.mock("../../server/storage", () => {
  const storage = {
    getNoteByAccessToken: async (token: string) => {
      lookups.push(`note:${token}`);
      return token === "good-token" ? { id: 5, organizationId: 7, borrowerId: 9 } : null;
    },
    getLead: async (_org: number, id: number) => {
      lookups.push(`lead:${id}`);
      return { id, email: "borrower@example.com" };
    },
    getBorrowerSession: async () => null,
  };
  const db = { select: () => ({ from: () => ({ where: async () => [] }) }) };
  return { storage, db };
});
vi.mock("../../server/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));

import { registerBorrowerRoutes } from "../../server/routes-borrower";
import { validateEnv } from "../../server/utils/validateEnv";

const SAVED = process.env.BORROWER_SESSION_SECRET;
const USABLE = "a-usable-statement-portal-secret-0123456789";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.cookies = {};
    const header = req.headers.cookie as string | undefined;
    if (header) for (const part of header.split(";")) {
      const [k, v] = part.trim().split("=");
      if (k) req.cookies[k] = decodeURIComponent(v ?? "");
    }
    next();
  });
  registerBorrowerRoutes(app);
  return app;
}

const exchange = (app: express.Express) =>
  request(app).post("/api/borrower/auth/exchange").send({ accessToken: "good-token", email: "borrower@example.com" });

beforeEach(() => {
  warns.length = 0;
  errors.length = 0;
  lookups.length = 0;
});
afterEach(() => {
  if (SAVED === undefined) delete process.env.BORROWER_SESSION_SECRET;
  else process.env.BORROWER_SESSION_SECRET = SAVED;
});

describe("statement-portal exchange without a usable secret", () => {
  for (const [label, value] of [["missing", undefined], ["too short", "short-secret"]] as const) {
    it(`${label}: 503 not configured, no cookie, no credential lookup`, async () => {
      if (value === undefined) delete process.env.BORROWER_SESSION_SECRET;
      else process.env.BORROWER_SESSION_SECRET = value;
      const res = await exchange(makeApp());
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("SERVICE_UNAVAILABLE");
      expect(res.body.message).toMatch(/not configured/i);
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(lookups).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  it("with a usable secret the same request mints the statement cookie", async () => {
    process.env.BORROWER_SESSION_SECRET = USABLE;
    const res = await exchange(makeApp());
    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"] ?? "")).toMatch(/borrower_stmt_session=[^;]+\./);
  });

  it("the statement GET does not 500 on a statement cookie while unconfigured", async () => {
    process.env.BORROWER_SESSION_SECRET = USABLE;
    const minted = await exchange(makeApp());
    const cookie = String(minted.headers["set-cookie"]).split(";")[0];
    delete process.env.BORROWER_SESSION_SECRET;
    const res = await request(makeApp()).get("/api/borrower/statements/generate").set("cookie", cookie);
    expect(res.status).toBe(401);
  });
});

describe("validateEnv and the borrower statement secret", () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  const portalWarnings = () => warns.filter((w) => String(w.msg).includes("Borrower statement portal is not configured"));

  for (const [label, value, problem] of [["missing", undefined, "missing"], ["too short", "short-secret", "too_short"]] as const) {
    it(`${label}: one structured warning, no exit`, () => {
      if (value === undefined) delete process.env.BORROWER_SESSION_SECRET;
      else process.env.BORROWER_SESSION_SECRET = value;
      exit.mockClear();
      validateEnv();
      expect(portalWarnings()).toHaveLength(1);
      expect(portalWarnings()[0].meta?.metadata).toMatchObject({ variable: "BORROWER_SESSION_SECRET", problem });
      // validateEnv may exit for OTHER missing variables in this test env; it
      // must never exit on this one — only the hard-error keys exit.
      const hard = errors.map((e) => String(e.msg)).join("\n");
      expect(hard).not.toContain("BORROWER_SESSION_SECRET");
    });
  }

  it("a usable secret: no portal warning", () => {
    process.env.BORROWER_SESSION_SECRET = USABLE;
    validateEnv();
    expect(portalWarnings()).toHaveLength(0);
  });
});
