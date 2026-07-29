/**
 * W2.1 — Free-tier capped first send (the activation wedge).
 *
 * The free tier gets FREE_TIER_LIFETIME_PIECES (5) of direct mail, lifetime,
 * so "send your first mailer" is reachable before paying. These tests lock
 * the gate's semantics on POST /api/outreach/mail/queue:
 *
 *   1. fresh free org, small audience     → 201, shipment queued
 *   2. free org, allowance fully spent    → 429 reason "free_send_spent",
 *                                           NO pool debit attempted
 *   3. free org, audience > remaining     → 429 reason "free_send_cap"
 *                                           with the honest remaining count
 *   4. paid org                           → cap never consulted, 201
 *   5. founder on a free org              → cap bypassed
 *
 * The mail-shipments piece count is the source of truth (cancelled excluded
 * — a cancel inside the hold window gives pieces back). Witnessed-send /
 * live-send interlocks are untouched by the wedge and not exercised here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { leads, mailShipments } from "@shared/schema";

// ── Mutable state the mocks read (reset per test) ───────────────────────────
const state = {
  orgTier: "free" as string,
  isFounder: false,
  /** lifetime non-cancelled pieces already committed */
  piecesUsed: 0,
  /** how many leads resolveAudience finds */
  audienceSize: 3,
  poolDebitCalls: 0,
  txInserts: 0,
  /** per-piece QR stamp updates inside the queue transaction */
  txPieceUpdates: 0,
};

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", claims: { sub: "user-1" } };
    next();
  },
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 42, name: "Test Org", subscriptionTier: state.orgTier };
    req.organizationId = 42;
    req.isFounder = state.isFounder;
    next();
  },
}));

// getUserId reads req.user via types/request helpers — the real module works
// against the stubbed req, no mock needed.

vi.mock("../../server/db", () => {
  const makeLeadRows = () =>
    Array.from({ length: state.audienceSize }, (_, i) => ({
      id: i + 1,
      firstName: "Lee",
      lastName: `Owner${i + 1}`,
      address: "1 Dirt Rd",
      city: "Llano",
      state: "TX",
      zip: "78643",
      lastContactedAt: null,
    }));
  const chainFor = (table: unknown) => {
    const rows =
      table === leads
        ? makeLeadRows()
        : table === mailShipments
          ? [{ used: state.piecesUsed }]
          : [];
    const chain: any = {
      where: () => chain,
      limit: async () => rows,
      then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
    };
    return chain;
  };
  return {
    db: {
      select: () => ({ from: (table: unknown) => chainFor(table) }),
      transaction: async (cb: any) =>
        cb({
          insert: () => ({
            values: (vals: any) => {
              state.txInserts += 1;
              const p: any = Promise.resolve([]);
              p.returning = async () => [{ id: 777 }];
              return p;
            },
          }),
          // The queue transaction also stamps each piece's QR short code
          // (mail_shipment_pieces.qr_code) after the insert assigns ids —
          // the code is an HMAC over the piece id, so it cannot be minted
          // before then. The gate under test runs well upstream of this;
          // the double just has to exist so the tx completes.
          update: () => ({
            set: () => ({
              where: async () => {
                state.txPieceUpdates += 1;
              },
            }),
          }),
        }),
    },
  };
});

vi.mock("../../server/services/mail/router", () => ({
  // Empty quote list → route falls back to retail estimates; enough for the gate.
  mailRouter: { quote: async () => [] },
}));

vi.mock("../../server/services/creditPool", () => ({
  poolDebit: async () => {
    state.poolDebitCalls += 1;
    return {
      allowed: true,
      debitedCents: 96,
      remaining: 100,
      poolMonthly: 2500,
      ledgerRowId: 1,
      overPool: false,
    };
  },
  refundPoolDebit: async () => {},
  poolRefusalDetails: () => ({ reason: "pool_exhausted" }),
}));

vi.mock("../../server/services/activation", () => ({
  recordActivationEventAsync: vi.fn(),
}));

import { registerOutreachMailRoutes, FREE_TIER_LIFETIME_PIECES } from "../../server/routes-outreach-mail";

const QUEUE_BODY = {
  audienceFilter: { states: ["TX"] },
  pieceType: "letter_10",
  speed: "standard",
};

function makeApp() {
  const app = express();
  app.use(express.json());
  registerOutreachMailRoutes(app);
  return app;
}

beforeEach(() => {
  state.orgTier = "free";
  state.isFounder = false;
  state.piecesUsed = 0;
  state.audienceSize = 3;
  state.poolDebitCalls = 0;
  state.txInserts = 0;
  state.txPieceUpdates = 0;
});

describe("POST /api/outreach/mail/queue — free-tier first-send wedge (W2.1)", () => {
  it("lets a fresh free org queue a small first send", async () => {
    const res = await request(makeApp()).post("/api/outreach/mail/queue").send(QUEUE_BODY);
    expect(res.status).toBe(201);
    expect(res.body.shipmentId).toBe(777);
    expect(state.poolDebitCalls).toBe(1);
  });

  it("refuses with free_send_spent once the lifetime allowance is used — no pool debit", async () => {
    state.piecesUsed = FREE_TIER_LIFETIME_PIECES;
    const res = await request(makeApp()).post("/api/outreach/mail/queue").send(QUEUE_BODY);
    expect(res.status).toBe(429);
    expect(res.body.details?.reason).toBe("free_send_spent");
    expect(res.body.details?.upgradeUrl).toBe("/settings#billing");
    expect(state.poolDebitCalls).toBe(0);
    expect(state.txInserts).toBe(0);
  });

  it("refuses with free_send_cap when the audience exceeds the remaining allowance", async () => {
    state.piecesUsed = 2; // 3 remaining
    state.audienceSize = 4; // wants 4
    const res = await request(makeApp()).post("/api/outreach/mail/queue").send(QUEUE_BODY);
    expect(res.status).toBe(429);
    expect(res.body.details?.reason).toBe("free_send_cap");
    expect(res.body.details?.remainingPieces).toBe(3);
    expect(res.body.details?.requestedPieces).toBe(4);
    expect(state.poolDebitCalls).toBe(0);
  });

  it("never consults the cap for paid tiers", async () => {
    state.orgTier = "starter";
    state.piecesUsed = 500;
    state.audienceSize = 40;
    const res = await request(makeApp()).post("/api/outreach/mail/queue").send(QUEUE_BODY);
    expect(res.status).toBe(201);
    expect(state.poolDebitCalls).toBe(1);
  });

  it("bypasses the cap for founder requests", async () => {
    state.isFounder = true;
    state.piecesUsed = 500;
    const res = await request(makeApp()).post("/api/outreach/mail/queue").send(QUEUE_BODY);
    expect(res.status).toBe(201);
  });
});
