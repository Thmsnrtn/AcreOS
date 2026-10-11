/**
 * W3 creator revenue share (shared/billing/creatorProgram.ts,
 * server/services/creatorProgram.ts).
 *
 * The properties that cost money if they are wrong:
 *  1. The commission RATE is a founder decision and ships UNSET. While it is
 *     unset nothing is owed, nothing is computed, and a payout is refused.
 *  2. A commission is owed only on a PAID conversion: an invoice with money
 *     actually collected. A $0 invoice (trial, 100% coupon) is not one.
 *  3. Owed = the conversions still owed (not voided by a refund, not already
 *     approved or paid), never a projection.
 *  4. Codes are validated and cannot collide with a customer referral code.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The service half touches the DB; any query reaching it fails the test
// loudly, which is the point of the "before touching the ledger" checks.
vi.mock("../../server/db", () => ({
  db: new Proxy({}, { get: () => () => { throw new Error("db touched"); } }),
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import {
  CREATOR_PROGRAM,
  conversionDecision,
  creatorForSignupCode,
  creatorLedgerRow,
  normalizeCreatorCode,
} from "@shared/billing/creatorProgram";

const savedRate = CREATOR_PROGRAM.commissionBps;
afterEach(() => {
  (CREATOR_PROGRAM as { commissionBps: number | null }).commissionBps = savedRate;
});

describe("the commission rate ships unset", () => {
  it("is null in the shipped config (founder decision pending)", () => {
    expect(CREATOR_PROGRAM.commissionBps).toBeNull();
  });

  it("with no rate, no commission is computed for any amount", () => {
    expect(conversionDecision({ amountPaidCents: 49_00 }, null)).toEqual({ record: true, status: "rate_unset", commissionBps: null, commissionCents: null });
  });

  it("with a rate, the commission is floor(amount × bps / 10,000) — no rounding up of AcreOS's money", () => {
    expect(conversionDecision({ amountPaidCents: 4_999 }, 3_333)).toMatchObject({ commissionCents: 1_666 });
    expect(conversionDecision({ amountPaidCents: 4_900 }, 2_000)).toEqual({ record: true, status: "owed", commissionBps: 2_000, commissionCents: 980 });
  });

  it("refuses a rate outside 0–100%", () => {
    expect(() => conversionDecision({ amountPaidCents: 100 }, -1)).toThrow();
    expect(() => conversionDecision({ amountPaidCents: 100 }, 10_001)).toThrow();
  });
});

describe("only paid conversions count", () => {
  it("a $0 invoice is not a conversion", () => {
    expect(conversionDecision({ amountPaidCents: 0 }, 2_000)).toEqual({ record: false, reason: "nothing_paid" });
    expect(conversionDecision({ amountPaidCents: -5 }, 2_000)).toEqual({ record: false, reason: "nothing_paid" });
  });
});

describe("the ledger", () => {
  const rows = [
    { status: "owed", amountPaidCents: 4_900, commissionCents: 980 },
    { status: "owed", amountPaidCents: 4_900, commissionCents: 980 },
    { status: "void", amountPaidCents: 4_900, commissionCents: 980 },
    { status: "approved", amountPaidCents: 4_900, commissionCents: 980 },
    { status: "paid", amountPaidCents: 49_000, commissionCents: 9_800 },
  ] as const;

  it("owed counts only conversions still owed; void ones count for nothing", () => {
    const l = creatorLedgerRow([...rows], 2_000);
    expect(l.paidConversions).toBe(4);
    expect(l.paidRevenueCents).toBe(4_900 * 3 + 49_000);
    expect(l.owedCents).toBe(1_960);
    expect(l.approvedCents).toBe(980);
    expect(l.paidOutCents).toBe(9_800);
  });

  it("with the rate unset, owed is null (not zero) and conversions awaiting a rate are counted", () => {
    const l = creatorLedgerRow([{ status: "rate_unset", amountPaidCents: 4_900, commissionCents: null }], null);
    expect(l.owedCents).toBeNull();
    expect(l.awaitingRate).toBe(1);
    expect(l.refusal).toMatch(/commission rate is not set/i);
  });
});

describe("codes", () => {
  it("normalizes to upper case and refuses malformed codes", () => {
    expect(normalizeCreatorCode(" landtube ")).toBe("LANDTUBE");
    expect(normalizeCreatorCode("ab")).toBeNull();
    expect(normalizeCreatorCode("has space")).toBeNull();
    expect(normalizeCreatorCode("x".repeat(17))).toBeNull();
  });
});

describe("attribution rule (users.acquisition_utm.ref captured at signup)", () => {
  const creatorsList = [
    { id: 1, code: "LANDTUBE", status: "active", createdAt: new Date("2026-10-01T00:00:00Z") },
    { id: 2, code: "PAUSEDGUY", status: "paused", createdAt: new Date("2026-10-01T00:00:00Z") },
  ];

  it("a signup whose first-touch code is an active creator's belongs to that creator", async () => {
    expect(creatorForSignupCode("landtube", new Date("2026-10-05T00:00:00Z"), creatorsList)).toEqual({ id: 1, code: "LANDTUBE" });
  });

  it("a paused creator, an unknown code, or a code created after the signup attributes nothing", async () => {
    expect(creatorForSignupCode("PAUSEDGUY", new Date("2026-10-05T00:00:00Z"), creatorsList)).toBeNull();
    expect(creatorForSignupCode("NOBODY12", new Date("2026-10-05T00:00:00Z"), creatorsList)).toBeNull();
    expect(creatorForSignupCode("LANDTUBE", new Date("2026-09-01T00:00:00Z"), creatorsList)).toBeNull();
    expect(creatorForSignupCode(undefined, null, creatorsList)).toBeNull();
  });
});

describe("payouts are refused while the rate is unset", () => {
  it("approveCreatorPayout refuses before touching the ledger", async () => {
    const { approveCreatorPayout } = await import("../../server/services/creatorProgram");
    const r = await approveCreatorPayout(1, "founder");
    expect(r).toMatchObject({ ok: false, reason: "rate_unset" });
  });

  it("recordCreatorConversion records nothing for a $0 invoice, before any lookup", async () => {
    const { recordCreatorConversion } = await import("../../server/services/creatorProgram");
    const r = await recordCreatorConversion(1, { id: "in_0", amountPaidCents: 0, paidAt: new Date() });
    expect(r).toEqual({ recorded: false, reason: "nothing_paid" });
  });
});
