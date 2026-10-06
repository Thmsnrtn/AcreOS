/**
 * DEFECT-0276 (8) — Today's sample-parcel read was not wrapped like its
 * neighbouring derivations. That read is what separates the customer's real
 * book from the demo one (DEFECT-0229), so when it throws there are only two
 * wrong answers available, and the route used to give one of them:
 *
 *   - a 500 — the whole Today page (queue, receipts, brief) lost for the sake
 *     of a filter; or
 *   - "everything is real" — the sample deals and notes counted as the
 *     customer's pipeline value and projected note income.
 *
 * The honest answer is the third: the queue still renders, and every figure
 * that depends on the split — open-deal value and count, projected 30/90-day
 * note income, the late count, the open-deal sparkline — is UNAVAILABLE
 * (null), with the reason named, and the brief prints no money.
 *
 * Driven through the real route with the reads mocked: one real deal and one
 * deal on a SAMPLE parcel, one real note and one sample note.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const H = vi.hoisted(() => {
  // A Drizzle stand-in: every chain method returns the chain, and awaiting it
  // yields no rows. Today's own SQL reads (receipts, history, counters) are
  // not what this suite is about.
  const chain: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop) {
      if (prop === "then") return (f: (v: unknown) => unknown) => Promise.resolve([]).then(f);
      return () => proxy;
    },
  };
  const proxy: Record<string, unknown> = new Proxy(chain, handler);
  return {
    db: proxy,
    sampleRead: async (): Promise<Set<number>> => new Set([900]),
    warn: vi.fn(),
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: H.warn, error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/storage", () => ({
  db: H.db,
  storage: {
    getTasks: async () => [],
    getProperty: async () => undefined,
  },
}));
vi.mock("../../server/storage/wholeBookReads", () => ({
  readAllDeals: async () => [
    // A real deal and a demo one, both open.
    { id: 1, organizationId: 7, propertyId: 100, status: "offer_sent", offerAmount: "20000", createdAt: new Date("2026-01-01"), updatedAt: new Date() },
    { id: 2, organizationId: 7, propertyId: 900, status: "negotiating", offerAmount: "45000", createdAt: new Date("2026-01-01"), updatedAt: new Date() },
  ],
  readAllNotes: async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000);
    return [
      { id: 1, organizationId: 7, propertyId: 100, status: "active", monthlyPayment: "300", nextPaymentDate: soon },
      { id: 2, organizationId: 7, propertyId: 900, status: "late", monthlyPayment: "700", nextPaymentDate: soon },
    ];
  },
}));
vi.mock("../../server/storage/wholeOrgReadsF", () => ({
  bookPresence: async () => ({ hasLeads: true, hasProperties: true }),
  oldestListedProperties: async () => [],
  stalledLeadCount: async () => 0,
  staleFollowUpLeads: async () => [],
}));
vi.mock("../../server/services/onboarding/sampleFilters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/onboarding/sampleFilters")>();
  return { ...actual, samplePropertyIds: () => H.sampleRead() };
});
vi.mock("../../server/services/portfolioHealth", () => ({
  runPortfolioHealthJob: async () => undefined,
  getActiveAlerts: async () => [],
}));
vi.mock("../../server/services/aiRouter", () => ({
  routeAITask: vi.fn(async () => null),
  TaskComplexity: { SIMPLE: "simple" },
}));

async function app(persona: string) {
  const { default: router } = await import("../../server/routes-today");
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as any).organization = { id: 7 };
    (req as any).organizationId = 7;
    (req as any).user = { id: "u1", persona };
    next();
  });
  a.use("/api/today", router);
  return a;
}

beforeEach(() => {
  H.warn.mockClear();
  H.sampleRead = async () => new Set([900]);
});

describe("Today when the sample/real split can be read", () => {
  it("counts the real book only", async () => {
    const r = await request(await app("note_investor")).get("/api/today");
    expect(r.status).toBe(200);
    expect(r.body.cash).toMatchObject({
      openDealsValue: 20000,
      openDealsCount: 1,
      pendingPayments30: 300,
      cashOnHand: 300,
      lateCount: 0,
      unavailableReason: null,
    });
    expect(r.body.brief).toContain("$300");
  });
});

describe("Today when the sample-parcel read fails", () => {
  beforeEach(() => {
    H.sampleRead = async () => {
      throw new Error("connection reset");
    };
  });

  it("still answers 200 — the queue is not lost for a filter", async () => {
    const r = await request(await app("note_investor")).get("/api/today");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.queue)).toBe(true);
  });

  it("answers every split-dependent figure as unavailable — never the sample rows as money", async () => {
    const r = await request(await app("note_investor")).get("/api/today");
    expect(r.body.cash).toMatchObject({
      openDealsValue: null,
      openDealsCount: null,
      pendingPayments30: null,
      cashOnHand: null,
      lateCount: null,
      openDealsValueHistory: [],
      unavailableReason: "sample_parcels_unreadable",
    });
    expect(H.warn).toHaveBeenCalledWith(expect.stringMatching(/sample-parcel read failed/), expect.anything());
  });

  it.each(["note_investor", "note_servicer", "landlord", "fix_flipper", "note_originator", undefined])(
    "the %s brief prints no money and no late count it cannot know",
    async (persona) => {
      const r = await request(await app(persona as string)).get("/api/today");
      expect(r.status).toBe(200);
      // The signals it DOES know, and nothing else.
      expect(r.body.brief).toMatch(/^\d+ Pax signals? overnight/);
      expect(r.body.brief).not.toMatch(/\$/);
      expect(r.body.brief).not.toMatch(/Quiet morning/);
      expect(r.body.brief).not.toMatch(/null|NaN|undefined/);
    },
  );
});
