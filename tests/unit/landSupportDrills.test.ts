// Land support drills — deterministic pins for the five scenarios in
// docs/evidence/2026-11-24/land-support-drills.md (land_flipper bar item (e)).
//
// Everything here runs the production code paths: the `executeTool` switch
// in server/ai/tools.ts, the land tool family in server/ai/landTools.ts,
// the genuine LandProfile assembler, and the genuine serviced-note payoff
// engine in server/services/notePaymentMath.ts. Only four seams are
// stubbed (database, receipt writer, syndication text builder, org
// timezone) — the same four PR #744's own tool tests stub.
//
// Scenario map:
//   1  money: payoff quote for a seller-financed note, plus the rule that
//      a replayed payment posting can never land twice.
//   2  stuck: a listing that will not go live — mark-listed behaviour,
//      plain-word refusals, and paste text that sends nothing anywhere.
//   3  quoted figure: a parcel passport at 3 of 17 fields, with sources.
//   4  wrong data: flood and soil on a parcel nobody has looked up yet.
//   5  fences: the DEFECT-0101 1099-INT gate on note interest.
// A final block pins LD-DEF-1: none of the six land tools is in the
// support resolver's tool list, so the live resolver legs of scenarios
// 1–4 stay UNPROVEN in the record.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";

const SEAM = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  wheres: [] as Array<{ table: string; cond: unknown }>,
  updates: [] as Array<{ table: string; values: any }>,
  updateReturns: {} as Record<string, unknown[]>,
  effects: [] as any[],
}));

vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const makeSelect = () => {
    let table = "";
    const chain: any = {
      from: (t: any) => { table = getTableName(t); return chain; },
      where: (c: unknown) => { SEAM.wheres.push({ table, cond: c }); return chain; },
      orderBy: () => chain,
      limit: () => chain,
      then: (res: any, rej: any) => Promise.resolve(SEAM.rows[table] ?? []).then(res, rej),
    };
    return chain;
  };
  const db: any = {
    select: () => makeSelect(),
    update: (t: any) => {
      const table = getTableName(t);
      const chain: any = {
        set: (v: any) => { SEAM.updates.push({ table, values: v }); return chain; },
        where: (c: unknown) => { SEAM.wheres.push({ table, cond: c }); return chain; },
        returning: async () => SEAM.updateReturns[table] ?? [],
      };
      return chain;
    },
  };
  return { db };
});
vi.mock("../../server/services/paxReceipts", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordPaxEffect: vi.fn(async (e: any) => { SEAM.effects.push(e); return { written: true }; }),
}));
vi.mock("../../server/services/listingSyndication", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  buildNormalizedListing: vi.fn(async (property: any, org: any, overrides: any) => ({ propertyId: property.id, organizationId: property.organizationId, title: overrides?.title ?? "t", ...overrides })),
  listingContentForChannels: vi.fn((listing: any) => ({ title: listing.title })),
  syndicateListing: vi.fn(async () => [{ platform: "craigslist", success: true, preformattedText: "PASTE TEXT FOR CRAIGSLIST", manualInstructions: "Post it yourself", deepLinkUrl: "https://albuquerque.craigslist.org/d/land/search/lnd", requiresManualAction: true }]),
}));
// The storage-backed payoff derivation is swapped for the engine's own
// pure derivation over the seeded ledger below. The pricing function
// itself is never stubbed.
vi.mock("../../server/services/notes/servicedNotePayoff", async () => {
  const { payoffInputsFromServicedNote } = await import("../../server/services/notePaymentMath");
  return {
    deriveServicedNotePayoffInput: vi.fn(async ({ note, payoffDate }: any) => ({
      input: payoffInputsFromServicedNote({
        note,
        ledgerRows: [{ paymentDate: "2026-10-25", interestAmount: "420.38" }],
        payoffDate,
      }),
      ledgerRowsConsidered: 1,
      lateFeesCollectedToDateCents: 0,
    })),
  };
});
vi.mock("../../server/services/form1098Batch", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  resolveOrgTimeZone: vi.fn(async () => "America/New_York"),
}));
vi.mock("../../server/utils/clock", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const now = () => new Date("2026-11-24T12:00:00Z");
  return { ...actual, clock: { ...actual.clock, now, nowMs: () => now().getTime() } };
});
vi.mock("../../server/services/paxControls", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getPaxControls: vi.fn(async () => ({
    stance: "ask_before_sending",
    leadScoring: true, borrowerReminders: true, inboxDrafts: true,
    rails: { records: { leads: "act_and_report", properties: "act_and_report", deals: "act_and_report", tasks: "act_and_report", follow_ups: "act_and_report", account: "act_and_report" }, sends: "ask" },
    limits: { asksPerDay: null, creditSpendPerDay: null, browseCallsPerDay: null, batchRowsPerDay: null },
    members: {}, mySites: [], paused: false, pausedUntil: null, pausedBy: null, checkFailed: false, timezone: "America/Chicago",
  })),
}));
vi.mock("../../server/middleware/roleScope", () => ({ userHasScope: vi.fn(async () => true) }));

const flagState = vi.hoisted(() => ({ enabled: false, throws: false }));
vi.mock("../../server/services/featureFlags", () => ({
  featureFlagService: {
    isEnabled: vi.fn(async () => {
      if (flagState.throws) throw new Error("flag store down");
      return flagState.enabled;
    }),
  },
  buildFlagContext: (req: any) => ({
    userId: req.user?.id,
    tier: req.organization?.subscriptionTier,
    isFounder: !!req.isFounder,
    email: req.user?.email,
  }),
}));
vi.mock("../../server/services/founder", () => ({
  isFounderEmail: () => false,
}));

import { executeTool } from "../../server/ai/tools";
import {
  computePayoffQuote,
  insertPaymentIdempotentCents,
  payoffInputsFromServicedNote,
} from "../../server/services/notePaymentMath";
import { requireQualified1099Output } from "../../server/services/form1099Refusal";

const ORG = { id: 7, name: "Org", ownerId: "u" } as any;

// Seeded parcel: recorded bundle covering 3 of the 17 passport fields
// (county acreage and owner; FEMA flood zone) — the journey walk's shape.
const parcelRow = {
  id: 42, organizationId: 7, apn: "100-20-030", county: "Luna", state: "NM",
  latitude: null, longitude: null, sizeAcres: null, legalDescription: null,
  enrichmentData: {
    provenance: {
      parcel_data: { source: "County GIS", asOf: "2026-06-01", fromCache: true },
      flood_zone: { source: "FEMA NFHL", asOf: "2024-01-01", fromCache: true },
    },
    parcel: { acreage: 10, owner: "SYNTHETIC Recorded Owner" },
    hazards: { floodZone: "Zone X" },
  },
};
const listingRow = {
  id: 9, organizationId: 7, propertyId: 42, title: "10 acres in Luna County", description: "Flat, road frontage",
  askingPrice: "45000", minimumPrice: null, status: "draft", sellerFinancingAvailable: true,
  downPaymentMin: "5000", monthlyPaymentMin: null, interestRate: null, termMonths: 120, photos: null,
  syndicationTargets: [{ platform: "craigslist", status: "manual_posting" }],
  viewCount: 0, inquiryCount: 0, publishedAt: null, createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-01"),
};
// Seeded seller-financed note: $53,100.00 at 10%, opened 2026-09-25; the
// one completed payment (2026-10-25) settled $420.38 of interest.
const noteRow = {
  id: 5, organizationId: 7, status: "active",
  currentBalance: "53100.00", interestRate: "10", startDate: new Date("2026-09-25"),
};

beforeEach(() => {
  SEAM.rows = {}; SEAM.wheres = []; SEAM.updates = []; SEAM.updateReturns = {}; SEAM.effects = [];
  flagState.enabled = false; flagState.throws = false;
});

// Scenario 1 — money: the payoff quote.
describe("scenario 1 — payoff: one engine behind the route and the tool", () => {
  it("both surfaces derive and price through the same two functions (source pin)", () => {
    const root = resolve(__dirname, "../..");
    const route = stripComments(readFileSync(resolve(root, "server/routes-notes.ts"), "utf8"));
    const tool = stripComments(readFileSync(resolve(root, "server/ai/landTools.ts"), "utf8"));
    for (const [label, src] of [["route", route], ["tool", tool]] as const) {
      expect(src, `${label} must call deriveServicedNotePayoffInput`).toContain("deriveServicedNotePayoffInput");
      expect(src, `${label} must call computePayoffQuote`).toContain("computePayoffQuote");
    }
  });

  it("engine figures for the seeded note: 30 days at 10% on $53,100.00", () => {
    const input = payoffInputsFromServicedNote({
      note: noteRow as never,
      ledgerRows: [{ paymentDate: "2026-10-25", interestAmount: "420.38" }],
      payoffDate: new Date("2026-11-24T00:00:00.000Z"),
    });
    expect(input.accrualStartDate.toISOString().slice(0, 10)).toBe("2026-10-25");
    const q = computePayoffQuote(input);
    expect(q).toMatchObject({
      principalBalanceCents: 5_310_000,
      daysAccrued: 30,
      accruedInterestCents: 43_644,
      perDiemInterestCents: 1_455,
      totalPayoffCents: 5_353_644,
      dayCountConvention: "actual/365_fixed",
    });
  });

  it("via the tool switch the quote matches the engine, is marked indicative, and records nothing", async () => {
    SEAM.rows.notes = [noteRow];
    const r = await executeTool("get_land_payoff_quote", { note_id: 5, payoff_date: "2026-11-24" }, ORG);
    expect(r.success).toBe(true);
    expect(r.data.totalPayoffCents).toBe(5_353_644);
    expect(r.data.accruedInterestCents).toBe(43_644);
    expect(r.data.recorded).toBe(false);
    expect(r.data.coverage).toMatch(/INDICATIVE/);
    expect(SEAM.updates).toHaveLength(0);
  });
});

describe("scenario 1 — a payment reported twice still posts once", () => {
  const existing = { id: 101, transactionId: "txn_LD1" };

  it("a duplicate transaction id hands back the row already there (created: false)", async () => {
    const out = await insertPaymentIdempotentCents({
      transactionId: "txn_LD1",
      insertOnConflict: async () => null,
      fetchExisting: async () => existing,
    });
    expect(out).toEqual({ row: existing, created: false });
  });

  it("a new transaction id creates its one row", async () => {
    const row = { id: 102, transactionId: "txn_LD2" };
    const out = await insertPaymentIdempotentCents({
      transactionId: "txn_LD2",
      insertOnConflict: async () => row,
      fetchExisting: async () => { throw new Error("fetchExisting must not run on the create path"); },
    });
    expect(out).toEqual({ row, created: true });
  });

  it("a conflict with nothing behind it raises instead of swallowing the payment", async () => {
    await expect(insertPaymentIdempotentCents({
      transactionId: "txn_LD3",
      insertOnConflict: async () => null,
      fetchExisting: async () => null,
    })).rejects.toThrow(/conflict reported but no existing row/);
  });
});

// Scenario 2 — stuck: the listing that will not go live.
describe("scenario 2 — mark-listed records the operator's word and posts nothing itself", () => {
  it("a draft becomes listed by one write that leaves channel records alone", async () => {
    SEAM.rows.property_listings = [listingRow];
    SEAM.updateReturns.property_listings = [{ ...listingRow, status: "listed", publishedAt: new Date("2026-11-24T12:00:00Z") }];
    const r = await executeTool("mark_land_listing_listed", { listing_id: 9 }, ORG, { userId: "u-1", origin: "chat" });
    expect(r.success).toBe(true);
    expect(r.data.message).toMatch(/AcreOS did not post it/);
    expect(SEAM.updates).toHaveLength(1);
    expect(SEAM.updates[0].values.status).toBe("listed");
    expect(SEAM.updates[0].values).not.toHaveProperty("syndicationTargets");
  });

  it("sold, withdrawn and active each refuse in plain words; nothing is written", async () => {
    for (const status of ["sold", "withdrawn", "active"]) {
      SEAM.rows.property_listings = [{ ...listingRow, status }];
      const r = await executeTool("mark_land_listing_listed", { listing_id: 9 }, ORG, { userId: "u-1" });
      expect(r.success, status).toBe(false);
      expect(r.refusal?.what, status).toMatch(/was not marked as listed/);
      expect(r.refusal?.why, status).toMatch(new RegExp(status === "active" ? "already active" : `It is ${status}`));
      expect(r.refusal?.unlock, status).toBeTruthy();
      const spoken = `${r.refusal?.what} ${r.refusal?.why} ${r.refusal?.unlock}`;
      expect(spoken).not.toMatch(/DEFECT-|syndication|attestation/i);
    }
    expect(SEAM.updates).toHaveLength(0);
    expect(SEAM.effects).toHaveLength(0);
  });

  it("the single-listing read keeps listed and active distinct in its own words", async () => {
    SEAM.rows.property_listings = [{ ...listingRow, status: "listed", publishedAt: new Date("2026-11-01") }];
    const r = await executeTool("get_land_listing", { listing_id: 9 }, ORG);
    expect(r.success).toBe(true);
    expect(r.data.listing.status).toBe("listed");
    expect(r.data.coverage).toMatch(/"listed" is the operator's own word/);
    expect(r.data.coverage).toMatch(/"active" means a channel accepted/);
  });
});

describe("scenario 2 — paste text sends nothing anywhere", () => {
  it("returns text for the customer to post; zero writes, zero receipts", async () => {
    SEAM.rows.property_listings = [listingRow];
    SEAM.rows.properties = [parcelRow];
    SEAM.rows.organizations = [{ id: 7, name: "Org" }];
    const r = await executeTool("get_listing_paste_text", { listing_id: 9 }, ORG);
    expect(r.success).toBe(true);
    expect(r.data.pasteText).toBe("PASTE TEXT FOR CRAIGSLIST");
    expect(r.data.coverage).toMatch(/has NOT posted anything/);
    expect(r.data.manualInstructions).toMatch(/Post it yourself/);
    expect(SEAM.updates).toHaveLength(0);
    expect(SEAM.effects).toHaveLength(0);
  });

  it("the land tool module cannot reach any sending machinery (source pin)", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/ai/landTools.ts"), "utf8"));
    expect(src).not.toMatch(/channelCredentialStore|mailLane|emailService|smsService|sendMail|sendSms/);
  });
});

// Scenario 3 — a quoted parcel figure, checked.
describe("scenario 3 — the passport shows its coverage and sources every figure", () => {
  it("3 of 17 populated; each carries source and date; the remaining 14 are named gaps", async () => {
    SEAM.rows.properties = [parcelRow];
    const r = await executeTool("get_parcel_passport", { property_id: 42 }, ORG);
    expect(r.success).toBe(true);
    expect(r.data.fieldsPopulated).toBe(3);
    expect(r.data.fieldsTotal).toBe(17);
    expect(r.data.coverage).toMatch(/3 of 17 fields/);
    expect(r.data.fields.floodZone).toMatchObject({ value: "Zone X", source: "FEMA NFHL", asOf: "2024-01-01", classification: "authoritative" });
    expect(r.data.fields.acreage).toMatchObject({ value: 10, source: "County GIS", asOf: "2026-06-01" });
    expect(r.data.fields.owner).toMatchObject({ value: "SYNTHETIC Recorded Owner", source: "County GIS" });
    expect(r.data.gaps).toHaveLength(14);
    for (const g of r.data.gaps) {
      expect(g.field, "each gap is named").toBeTruthy();
      expect(g.reason, `gap ${g.field} explains itself`).toBeTruthy();
    }
    expect(r.data.gaps.map((g: any) => g.field)).toContain("soilCapabilityClass");
  });
});

// Scenario 4 — wrong data: flood and soil nobody has looked up.
describe("scenario 4 — unlooked-up fields stay gaps; recorded values pass through untouched", () => {
  it("a parcel with no recorded lookup: 0 of 17, and no flood zone or soil class appears", async () => {
    SEAM.rows.properties = [{ ...parcelRow, enrichmentData: null }];
    const r = await executeTool("get_parcel_passport", { property_id: 42 }, ORG);
    expect(r.success).toBe(true);
    expect(r.data.fieldsPopulated).toBe(0);
    expect(r.data.fields.floodZone).toBeUndefined();
    expect(r.data.fields.soilCapabilityClass).toBeUndefined();
    expect(r.data.gaps).toHaveLength(17);
    expect(r.data.gaps.every((g: any) => g.reason === "not_looked_up")).toBe(true);
  });

  it("flood recorded and soil not: flood reads exactly as recorded, soil stays a gap", async () => {
    SEAM.rows.properties = [parcelRow];
    const r = await executeTool("get_parcel_passport", { property_id: 42 }, ORG);
    expect(r.success).toBe(true);
    expect(r.data.fields.floodZone.value).toBe("Zone X");
    expect(r.data.fields.soilCapabilityClass).toBeUndefined();
    expect(r.data.gaps.map((g: any) => g.field)).toContain("soilCapabilityClass");
  });
});

// LD-DEF-1 — the support resolver cannot see any land tool.
describe("capability pin — land tools are on the chat path, absent from the resolver subset (LD-DEF-1)", () => {
  const root = resolve(__dirname, "../..");
  const read = (p: string) => stripComments(readFileSync(resolve(root, p), "utf8"));
  const LAND_TOOLS = [
    "get_parcel_passport",
    "get_land_listings",
    "get_land_listing",
    "get_listing_paste_text",
    "get_land_payoff_quote",
    "mark_land_listing_listed",
  ];

  it("the chat registry names all six (PR #744)", () => {
    const toolsSrc = read("server/ai/tools.ts");
    for (const t of LAND_TOOLS) expect(toolsSrc, `chat path is missing ${t}`).toContain(t);
  });

  it("the resolver subset names none of the six", () => {
    const resolverSrc = read("server/ai/paxSupportResolver.ts");
    const block = resolverSrc.match(/RESOLVER_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]/);
    expect(block, "RESOLVER_TOOL_NAMES block not found — re-point this pin, do not delete it").not.toBeNull();
    for (const t of LAND_TOOLS) expect(block![1], `resolver unexpectedly gained ${t} — close LD-DEF-1 and re-drill`).not.toContain(t);
  });
});

// Scenario 5 — the DEFECT-0101 fence on note interest.
describe("scenario 5 — the 1099-INT gate refuses on the land book's interest line", () => {
  function fakeRes() {
    const res: any = { statusCode: 200, body: undefined as unknown };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
  }

  it("a customer request is refused 422 and the refusal names DEFECT-0101", async () => {
    const res = fakeRes();
    const next = vi.fn();
    await requireQualified1099Output()(
      { user: { id: "u1", email: "owner@synthetic.test" }, organization: { id: 7 } } as any,
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ error: "not_qualified_filing_output", details: { defect: "DEFECT-0101" } });
  });

  it("when the flag store throws, the gate still refuses (fails closed)", async () => {
    flagState.throws = true;
    const res = fakeRes();
    const next = vi.fn();
    await requireQualified1099Output()(
      { user: { id: "u1", email: "owner@synthetic.test" }, organization: { id: 7 } } as any,
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
  });
});
