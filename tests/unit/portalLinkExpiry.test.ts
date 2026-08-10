/**
 * X-A slice 1 — borrower portal-link expiry (hardening the ONLY external
 * portal-link mechanism at HEAD: notes.access_token behind /portal/:token).
 *
 * Before this slice the link never expired — and pre-2026-06 tokens were
 * minted with Math.random(), i.e. predictable forever. This suite pins:
 *
 *   1. The pure gate (`portalLinkExpired`): past expiry ⇒ expired; future,
 *      NULL ("no expiry recorded" — migration-safe), and unparseable values
 *      ⇒ valid. NULL fail-open is deliberate: a code-only deploy must never
 *      lock every borrower out before migration 0229 runs.
 *   2. HONEST DEATH, behaviorally: an expired link at POST /api/borrower/verify
 *      answers 410 + error "portal_link_expired" (never a dead 500, never the
 *      generic "not found") and mints NO session. Same for the statement
 *      exchange path. And the info-leak posture survives: expiry is only
 *      revealed AFTER the email matches — a token-guessing probe still sees
 *      the same generic 404 it always did.
 *   3. The rebind path + migration artifacts + the client's re-request screen
 *      (source-derived wiring pins) — built AND wired, both sides.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

const ORG_ID = 7;
const NOTE_ID = 42;
const TOKEN = "note_valid_access_token_abc";
const BORROWER_EMAIL = "borrower@example.com";

/** Mutable per-test: the expiry the note row carries. */
let noteExpiresAt: Date | string | null = null;

const noteRow = () => ({
  id: NOTE_ID,
  organizationId: ORG_ID,
  borrowerId: 99,
  accessToken: TOKEN,
  accessTokenExpiresAt: noteExpiresAt,
  propertyId: null,
  monthlyPayment: "1000.00",
});

const createdSessions: Array<Record<string, unknown>> = [];

vi.mock("../../server/storage", () => {
  const storage = {
    getNoteByAccessToken: async (token: string) =>
      token === TOKEN ? noteRow() : undefined,
    getLead: async (_orgId: number, _leadId: number) => ({
      id: 99,
      firstName: "Maria",
      lastName: "Delgado",
      email: BORROWER_EMAIL,
    }),
    createBorrowerSession: async (session: Record<string, unknown>) => {
      createdSessions.push(session);
      return { id: 1, ...session };
    },
    getPayments: async () => [],
    getProperty: async () => null,
    getOrganization: async (id: number) => ({ id, name: "Acme Lender" }),
  };
  const makeStep: () => any = () => {
    const step: any = {
      from: () => makeStep(),
      where: () => makeStep(),
      limit: () => makeStep(),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve([noteRow()]).then(onFulfilled, onRejected),
    };
    return step;
  };
  return { storage, db: { select: () => makeStep() } };
});

vi.mock("../../server/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const makeStep: () => any = () => {
    const step: any = {
      from: () => makeStep(),
      where: () => makeStep(),
      limit: () => makeStep(),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve([]).then(onFulfilled, onRejected),
    };
    return step;
  };
  return { ...actual, db: { select: () => makeStep() } };
});

import { registerBorrowerRoutes } from "../../server/routes-borrower";
import {
  portalLinkExpired,
  PORTAL_LINK_EXPIRED_ERROR,
} from "../../server/services/portalLink";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

function makeApp() {
  const app = express();
  app.use(express.json());
  registerBorrowerRoutes(app as any);
  return app;
}

beforeEach(() => {
  createdSessions.length = 0;
  noteExpiresAt = null;
});

// ─── 1. The pure gate ───────────────────────────────────────────────────────

describe("portalLinkExpired — the pure expiry gate", () => {
  const NOW = new Date("2026-08-10T12:00:00Z");

  it("a recorded expiry in the past is expired", () => {
    expect(portalLinkExpired({ accessTokenExpiresAt: new Date("2026-08-01T00:00:00Z") }, NOW)).toBe(true);
    expect(portalLinkExpired({ accessTokenExpiresAt: "2026-08-01T00:00:00Z" }, NOW)).toBe(true);
  });

  it("a future expiry is valid, and the exact boundary is NOT expired", () => {
    expect(portalLinkExpired({ accessTokenExpiresAt: new Date("2027-01-01T00:00:00Z") }, NOW)).toBe(false);
    expect(portalLinkExpired({ accessTokenExpiresAt: NOW }, NOW)).toBe(false);
  });

  it("NULL means 'no expiry recorded' and stays VALID (migration-safe fail-open)", () => {
    expect(portalLinkExpired({ accessTokenExpiresAt: null }, NOW)).toBe(false);
    expect(portalLinkExpired({}, NOW)).toBe(false);
  });

  it("an unparseable stored value never locks a borrower out", () => {
    expect(portalLinkExpired({ accessTokenExpiresAt: "not-a-date" }, NOW)).toBe(false);
  });
});

// ─── 2. Honest death at the portal surfaces ─────────────────────────────────

describe("POST /api/borrower/verify — an expired link dies honestly", () => {
  it("expired link + correct email ⇒ 410 portal_link_expired and NO session minted", async () => {
    noteExpiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const res = await request(makeApp())
      .post("/api/borrower/verify")
      .send({ accessToken: TOKEN, email: BORROWER_EMAIL });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe(PORTAL_LINK_EXPIRED_ERROR);
    // The message is honest about what happened and what to do — not a 500,
    // not a generic not-found.
    expect(res.body.message).toMatch(/expired/i);
    expect(res.body.message).toMatch(/lender/i);
    expect(createdSessions).toHaveLength(0);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("valid (future) expiry ⇒ 200 and a session is minted", async () => {
    noteExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const res = await request(makeApp())
      .post("/api/borrower/verify")
      .send({ accessToken: TOKEN, email: BORROWER_EMAIL });

    expect(res.status).toBe(200);
    expect(createdSessions).toHaveLength(1);
  });

  it("NULL expiry (pre-migration row) keeps working — never a code-only lockout", async () => {
    noteExpiresAt = null;
    const res = await request(makeApp())
      .post("/api/borrower/verify")
      .send({ accessToken: TOKEN, email: BORROWER_EMAIL });

    expect(res.status).toBe(200);
    expect(createdSessions).toHaveLength(1);
  });

  it("info-leak posture survives: wrong email on an EXPIRED link still sees the generic 404", async () => {
    noteExpiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const res = await request(makeApp())
      .post("/api/borrower/verify")
      .send({ accessToken: TOKEN, email: "attacker@example.com" });

    // The expiry state is only revealed to the token+email holder.
    expect(res.status).toBe(404);
    expect(res.body.error).not.toBe(PORTAL_LINK_EXPIRED_ERROR);
    expect(createdSessions).toHaveLength(0);
  });
});

describe("POST /api/borrower/auth/exchange — the statement path dies honestly too", () => {
  it("expired link + correct email ⇒ 410 portal_link_expired, no cookie", async () => {
    noteExpiresAt = new Date(Date.now() - 60 * 1000);
    const res = await request(makeApp())
      .post("/api/borrower/auth/exchange")
      .send({ accessToken: TOKEN, email: BORROWER_EMAIL });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe(PORTAL_LINK_EXPIRED_ERROR);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("wrong email on an expired link stays a generic 401 (no expiry oracle)", async () => {
    noteExpiresAt = new Date(Date.now() - 60 * 1000);
    const res = await request(makeApp())
      .post("/api/borrower/auth/exchange")
      .send({ accessToken: TOKEN, email: "attacker@example.com" });

    expect(res.status).toBe(401);
    expect(res.body.error).not.toBe(PORTAL_LINK_EXPIRED_ERROR);
  });
});

// ─── 3. Wiring pins — rebind path, migration artifacts, client screen ───────

describe("wiring pins — expiry is built AND wired at every seam", () => {
  it("the rebind endpoint exists and delegates to the SHARED rebind core (services/portalLink.ts)", () => {
    const src = read("server/routes-borrower.ts");
    expect(src).toContain('"/api/notes/:id/portal-link/refresh"');
    expect(src).toMatch(/portal-link\/refresh[\s\S]{0,1200}rebindPortalLink\(org\.id, noteId\)/);

    // The core itself: crypto-strong rotation (historical tokens were
    // Math.random), trust-tier TTL stamp, and session revocation — a rebind
    // that left old sessions breathing would be rotation theater.
    const core = read("server/services/portalLink.ts");
    expect(core).toMatch(/crypto\.randomBytes\(32\)/);
    expect(core).toMatch(/resolveOrgTrustCaps\(tier\)\.portalLinkTtlDays/);
    expect(core).toMatch(/db\.delete\(borrowerSessions\)/);
  });

  it("financeAgent rotates an EXPIRED link before embedding it in a notice — the sunset can never strand a serviced borrower", () => {
    // Fleet-6 verifier catch: expiry shipped with a refresh endpoint no UI
    // calls, while every emailed reminder embedded the same (possibly
    // expired) token — a scheduled lockout. The notice builder now ensures
    // liveness (rotate-if-expired) before building the portal URL, so "ask
    // your lender to send a fresh link" is true by construction.
    const agent = read("server/services/financeAgent.ts");
    expect(agent).toMatch(/ensureLivePortalLink\(note\)/);
    expect(agent).toMatch(/this\.borrowerPortalUrl\(liveNote\)/);

    const core = read("server/services/portalLink.ts");
    // Live tokens pass through untouched — no rotation churn on routine sends.
    expect(core).toMatch(/if \(!note\.accessToken \|\| !portalLinkExpired\(note\)\) return note;/);
  });

  it("schema + BOTH migration artifacts carry access_token_expires_at (the canonical-defect check)", () => {
    const schema = read("shared/schema.ts");
    expect(schema).toContain('accessTokenExpiresAt: timestamp("access_token_expires_at")');

    // migrations/*.sql — the numbered artifact…
    const migration = read("migrations/0229_org_trust_tier_and_portal_link_expiry.sql");
    expect(migration).toMatch(/ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "access_token_expires_at" timestamp/);
    expect(migration).toMatch(/UPDATE "notes" SET "access_token_expires_at" = now\(\) \+ interval '90 days'/);
    expect(migration).toMatch(/SET DEFAULT \(now\(\) \+ interval '365 days'\)/);

    // …AND the release_command mirror (scripts/migrate.mjs is what prod runs).
    const migrate = read("scripts/migrate.mjs");
    expect(migrate).toContain('ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "access_token_expires_at" timestamp');
    expect(migrate).toContain(`ALTER TABLE "notes" ALTER COLUMN "access_token_expires_at" SET DEFAULT (now() + interval '365 days')`);
  });

  it("the client renders a re-request screen on portal_link_expired — never a dead form", () => {
    const page = read("client/src/pages/borrower-portal.tsx");
    expect(page).toContain('"portal_link_expired"');
    expect(page).toContain("setLinkExpired(true)");
    expect(page).toContain("card-portal-link-expired");
    // The screen tells the borrower the honest path forward.
    expect(page).toMatch(/Ask your lender to send you a fresh portal link/);
  });
});
