/**
 * Land — the Pax land tool family (promised bar item (c)).
 *
 * Proves: the six tools are registered in every place the pattern registers
 * a tool; every read states its coverage; the passport names its gap fields
 * (a partial profile is never presented as complete); the org comes from
 * the session and is in the WHERE of every query (decoded from the real
 * drizzle condition, not grepped); the paste-text tool returns text and
 * posts NOTHING; the payoff quote is the serviced book's engine, indicative
 * and unrecorded; mark-listed mirrors the route's refusals and writes one
 * receipt; and NO tool can post to a portal or send anything (FD5 / BYO
 * channel seam) — asserted on the registry AND on what the module can reach.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const H = vi.hoisted(() => ({
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
      where: (c: unknown) => { H.wheres.push({ table, cond: c }); return chain; },
      orderBy: () => chain,
      limit: () => chain,
      then: (res: any, rej: any) => Promise.resolve(H.rows[table] ?? []).then(res, rej),
    };
    return chain;
  };
  const db: any = {
    select: () => makeSelect(),
    update: (t: any) => {
      const table = getTableName(t);
      const chain: any = {
        set: (v: any) => { H.updates.push({ table, values: v }); return chain; },
        where: (c: unknown) => { H.wheres.push({ table, cond: c }); return chain; },
        returning: async () => H.updateReturns[table] ?? [],
      };
      return chain;
    },
  };
  return { db };
});
vi.mock("../../server/services/paxReceipts", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordPaxEffect: vi.fn(async (e: any) => { H.effects.push(e); return { written: true }; }),
}));
vi.mock("../../server/services/landProfile", async () => {
  const { LAND_PROFILE_FIELD_ORDER, LAND_PROFILE_FIELD_LABELS } = await import("../../shared/landProfile");
  return {
    assembleLandProfile: vi.fn((property: any, cached: any, fromCache: boolean) => {
      const present = cached
        ? {
            acreage: { value: 10, source: "County GIS", asOf: "2025", confidence: 95, classification: "authoritative" },
            floodZone: { value: "Zone X", source: "FEMA NFHL", asOf: "2024", confidence: 90, classification: "authoritative" },
            owner: { value: "Recorded Owner", source: "County GIS", asOf: "2025", confidence: 95, classification: "authoritative" },
          }
        : {};
      const gaps = LAND_PROFILE_FIELD_ORDER.filter((k) => !(k in present)).map((k) => ({
        field: k,
        label: LAND_PROFILE_FIELD_LABELS[k],
        reason: cached ? "no_data" : "not_looked_up",
      }));
      return {
        propertyId: property.id, latitude: 0, longitude: 0,
        assembledAt: "2026-11-24T12:00:00.000Z", fromCache,
        fieldsPopulated: Object.keys(present).length, fieldsTotal: LAND_PROFILE_FIELD_ORDER.length,
        gaps, ...present,
      };
    }),
  };
});
vi.mock("../../server/services/listingSyndication", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  buildNormalizedListing: vi.fn(async (property: any, org: any, overrides: any) => ({ propertyId: property.id, organizationId: property.organizationId, title: overrides?.title ?? "t", ...overrides })),
  listingContentForChannels: vi.fn((listing: any) => ({ title: listing.title })),
  syndicateListing: vi.fn(async () => [{ platform: "craigslist", success: true, preformattedText: "PASTE TEXT FOR CRAIGSLIST", manualInstructions: "Post it yourself", deepLinkUrl: "https://albuquerque.craigslist.org/d/land/search/lnd", requiresManualAction: true }]),
}));
vi.mock("../../server/services/notes/servicedNotePayoff", () => ({
  deriveServicedNotePayoffInput: vi.fn(async () => ({ input: { stub: true }, ledgerRowsConsidered: 3, lateFeesCollectedToDateCents: 100 })),
}));
vi.mock("../../server/services/form1098Batch", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  resolveOrgTimeZone: vi.fn(async () => "America/New_York"),
}));
vi.mock("../../server/services/notePaymentMath", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  computePayoffQuote: vi.fn(() => ({
    principalBalanceCents: 5_283_328, accruedInterestCents: 12_000, perDiemInterestCents: 1_450,
    daysAccrued: 9, lateFeesOutstandingCents: 0, totalPayoffCents: 5_295_328,
  })),
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

import { executeTool, toolDefinitions, PAUSE_SAFE_TOOLS } from "../../server/ai/tools";
import { PAX_TOOL_GROUPS, groupForTool } from "../../shared/pax-controls";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";

const READS = ["get_parcel_passport", "get_land_listings", "get_land_listing", "get_listing_paste_text", "get_land_payoff_quote"] as const;
const WRITE = "mark_land_listing_listed" as const;
const org = { id: 7, name: "Org", ownerId: "u" } as any;
const propertyRow = {
  id: 42, organizationId: 7, apn: "100-20-030", county: "Luna", state: "NM",
  enrichmentData: { provenance: { flood: {} } },
};
const listingRow = {
  id: 9, organizationId: 7, propertyId: 42, title: "10 acres in Luna County", description: "Flat, road frontage",
  askingPrice: "45000", minimumPrice: null, status: "draft", sellerFinancingAvailable: true,
  downPaymentMin: "5000", monthlyPaymentMin: null, interestRate: null, termMonths: 120, photos: null,
  syndicationTargets: [{ platform: "craigslist", status: "manual_posting" }],
  viewCount: 0, inquiryCount: 0, publishedAt: null, createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-01"),
};
const noteRow = { id: 5, organizationId: 7, status: "active", currentBalance: "52833.28", interestRate: "10", startDate: new Date("2025-01-01") };
const src = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const params = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).params;

beforeEach(() => {
  H.rows = {}; H.wheres = []; H.updates = []; H.updateReturns = {}; H.effects = [];
});

describe("registration — every place the pattern registers a tool", () => {
  it("defined, and reads are pause-safe while the record change is not", () => {
    for (const n of [...READS, WRITE]) expect(toolDefinitions[n], n).toBeDefined();
    for (const n of READS) expect(PAUSE_SAFE_TOOLS.has(n), n).toBe(true);
    expect(PAUSE_SAFE_TOOLS.has(WRITE)).toBe(false);
  });
  it("classified in the controls registry: reads look, mark-listed is a properties-rail change", () => {
    for (const n of READS) expect(groupForTool(n), n).toBe("looks_and_drafts");
    expect(groupForTool(WRITE)).toBe("changes_records");
    expect(PAX_TOOL_GROUPS[WRITE]).toBe("changes_records");
  });
  it("scoped: passport/listings on deal scopes, payoff on financial_read", () => {
    expect(INTENT_META["get_parcel_passport"]).toEqual({ door: "map", scope: "deal_read" });
    for (const n of ["get_land_listings", "get_land_listing", "get_listing_paste_text"] as const) {
      expect(INTENT_META[n]).toEqual({ door: "deals", scope: "deal_read" });
    }
    expect(INTENT_META["get_land_payoff_quote"]).toEqual({ door: "finance", scope: "financial_read" });
    expect(INTENT_META[WRITE]).toEqual({ door: "deals", scope: "deal_write" });
  });
  it("grouped in the underwriting and documents bundles — in BOTH registries", () => {
    for (const [label, text] of [["tools.ts", src("server/ai/tools.ts")], ["appIntents/index.ts", src("server/services/appIntents/index.ts")]] as const) {
      for (const bundle of ["underwriting", "documents"]) {
        const lines = text.split("\n");
        const start = lines.findIndex((l: string) => l.trimStart().startsWith(`${bundle}: [`));
        expect(start, `${label}: ${bundle} bundle`).toBeGreaterThan(-1);
        let end = start;
        while (!/\],?$/.test(lines[end].trimEnd())) end++;
        const body = lines.slice(start, end + 1).join("\n");
        for (const n of [...READS, WRITE]) expect(body, `${label}: ${bundle} lacks ${n}`).toContain(`"${n}"`);
      }
    }
  });
});

describe("FD5 / BYO seam — no posting or sending is reachable from Pax land tools", () => {
  it("no land tool name offers to post, publish or send", () => {
    for (const n of [...READS, WRITE]) expect(n).not.toMatch(/send|publish|post_to|syndicate_to/i);
    expect(Object.keys(toolDefinitions).filter((n) => /land.*(send|post)|syndicat.*(post|send)/i.test(n))).toEqual([]);
  });
  it("the tool module cannot reach a mail lane, a send service, or the channel credential store", () => {
    const code = stripComments(src("server/ai/landTools.ts"));
    expect(code).not.toMatch(/channelCredentialStore|mailLane|emailService|smsService|settlementRail|sendMail|sendSms/);
  });
});

describe("get_parcel_passport — coverage, gaps, org pinning", () => {
  it("states the field coverage, names every gap, and pins the SESSION org", async () => {
    H.rows.properties = [propertyRow];
    const r = await executeTool("get_parcel_passport", { property_id: 42, organization_id: 999 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/3 of 17 fields/);
    expect(r.data.coverage).toMatch(/gaps, listed by name/);
    expect(r.data.fields.floodZone).toMatchObject({ value: "Zone X", source: "FEMA NFHL" });
    expect(r.data.gaps).toHaveLength(14);
    expect(r.data.gaps.map((g: any) => g.field)).toContain("soilCapabilityClass");
    const p = H.wheres.filter((w) => w.table === "properties").flatMap((w) => params(w.cond));
    expect(p).toContain(7);
    expect(p).not.toContain(999);
  });
  it("a cold parcel is honest all-gaps, never filled in", async () => {
    H.rows.properties = [{ ...propertyRow, enrichmentData: null }];
    const r = await executeTool("get_parcel_passport", { property_id: 42 }, org);
    expect(r.success).toBe(true);
    expect(r.data.fieldsPopulated).toBe(0);
    expect(r.data.gaps).toHaveLength(17);
    expect(r.data.gaps.every((g: any) => g.reason === "not_looked_up")).toBe(true);
  });
  it("an APN is refused, not queried; another account's property is refused", async () => {
    const bad = await executeTool("get_parcel_passport", { property_id: "100-20-030" }, org);
    expect(bad.success).toBe(false);
    expect(H.wheres).toHaveLength(0);
    H.rows.properties = [];
    const none = await executeTool("get_parcel_passport", { property_id: 42 }, org);
    expect(none.success).toBe(false);
    expect(none.refusal?.what).toMatch(/No property/);
  });
});

describe("listings reads — coverage and channel honesty", () => {
  it("list: states coverage and filters by the SESSION org", async () => {
    H.rows.property_listings = [listingRow];
    const r = await executeTool("get_land_listings", { organization_id: 999 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/this account's own land listings only/);
    expect(r.data.coverage).toMatch(/AcreOS has not posted/);
    expect(r.data.listings[0]).toMatchObject({ id: 9, status: "draft" });
    expect(r.data.listings[0].channels).toEqual([{ platform: "craigslist", status: "manual_posting", listingUrl: null, postedAt: null }]);
    const p = H.wheres.filter((w) => w.table === "property_listings").flatMap((w) => params(w.cond));
    expect(p).toContain(7);
    expect(p).not.toContain(999);
  });
  it("one listing: explains listed vs active; another account's listing is refused", async () => {
    H.rows.property_listings = [listingRow];
    const r = await executeTool("get_land_listing", { listing_id: 9 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/operator's own word/);
    H.rows.property_listings = [];
    const none = await executeTool("get_land_listing", { listing_id: 9 }, org);
    expect(none.success).toBe(false);
    expect(none.refusal?.what).toMatch(/No listing/);
  });
  it("paste text: returns text for the customer to post, and posts nothing itself", async () => {
    H.rows.property_listings = [listingRow];
    H.rows.properties = [propertyRow];
    H.rows.organizations = [{ id: 7, name: "Org" }];
    const r = await executeTool("get_listing_paste_text", { listing_id: 9 }, org);
    expect(r.success).toBe(true);
    expect(r.data.pasteText).toBe("PASTE TEXT FOR CRAIGSLIST");
    expect(r.data.coverage).toMatch(/has NOT posted anything/);
    expect(H.updates).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
});

describe("get_land_payoff_quote — serviced book, indicative, unrecorded", () => {
  it("prices the serviced note through the shared engine derivation, org-pinned", async () => {
    H.rows.notes = [noteRow];
    const r = await executeTool("get_land_payoff_quote", { note_id: 5, payoff_date: "2026-12-15", organization_id: 999 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/INDICATIVE/);
    expect(r.data.recorded).toBe(false);
    expect(r.data.totalPayoffCents).toBe(5_295_328);
    expect(r.data.ledgerRowsConsidered).toBe(3);
    const p = H.wheres.filter((w) => w.table === "notes").flatMap((w) => params(w.cond));
    expect(p).toContain(7);
    expect(p).not.toContain(999);
  });
  it("an acquired-book UUID is refused, not priced; a missing note is refused", async () => {
    const bad = await executeTool("get_land_payoff_quote", { note_id: "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e" }, org);
    expect(bad.success).toBe(false);
    H.rows.notes = [];
    const none = await executeTool("get_land_payoff_quote", { note_id: 5 }, org);
    expect(none.success).toBe(false);
    expect(none.refusal?.what).toMatch(/No serviced note/);
  });
});

describe("mark_land_listing_listed — attestation write, receipted, route refusals", () => {
  it("marks a draft listed, touching status + on-market date only, with ONE receipt", async () => {
    H.rows.property_listings = [listingRow];
    H.updateReturns.property_listings = [{ ...listingRow, status: "listed", publishedAt: new Date("2026-11-24T12:00:00Z") }];
    const r = await executeTool(WRITE, { listing_id: 9, organization_id: 999 }, org, { userId: "u-1", origin: "chat" });
    expect(r.success).toBe(true);
    expect(r.data.message).toMatch(/AcreOS did not post it/);
    expect(H.updates).toHaveLength(1);
    expect(H.updates[0].table).toBe("property_listings");
    expect(H.updates[0].values.status).toBe("listed");
    expect(H.updates[0].values).not.toHaveProperty("syndicationTargets");
    expect(H.effects).toHaveLength(1);
    expect(H.effects[0]).toMatchObject({ orgId: 7, tool: "mark_land_listing_listed", actor: "pax" });
    expect(H.effects[0].after.status).toBe("listed");
  });
  it("sold, withdrawn and active listings refuse; nothing written, no receipt", async () => {
    for (const status of ["sold", "withdrawn", "active"]) {
      H.rows.property_listings = [{ ...listingRow, status }];
      const r = await executeTool(WRITE, { listing_id: 9 }, org, { userId: "u-1" });
      expect(r.success, status).toBe(false);
    }
    expect(H.updates).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
  it("re-marking a listed listing is a no-op success — no write of its own", async () => {
    H.rows.property_listings = [{ ...listingRow, status: "listed", publishedAt: new Date("2026-11-01") }];
    const r = await executeTool(WRITE, { listing_id: 9 }, org, { userId: "u-1" });
    expect(r.success).toBe(true);
    expect(r.data.alreadyListed).toBe(true);
    expect(H.updates).toHaveLength(0);
    // The tool writes no receipt of its own for a no-op; the single effect is
    // the executor's generic post-switch receipt every record-change gets.
    expect(H.effects).toHaveLength(1);
    expect(H.effects[0].tool).toBe("mark_land_listing_listed");
    expect(H.effects[0].description ?? "").not.toMatch(/Marked land listing/);
  });
});
