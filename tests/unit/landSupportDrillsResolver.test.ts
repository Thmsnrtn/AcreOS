/**
 * Land drills 1 through 4 — the live resolver legs, cured under LD-DEF-1.
 *
 * The #766 record left the live resolver legs of drills 1–4 UNPROVEN:
 * the support resolver's tool subset had no land read, so a grounded
 * answer about a payoff, a listing, or a parcel passport was
 * structurally impossible. This file drives the REAL resolver gate
 * (mocked model, mocked db — the paxSupportResolver.test.ts pattern)
 * through each drill's ticket:
 *
 *   Drill 1 (money): the borrower says the payoff is just the $53,100
 *   balance. The model reads get_land_payoff_quote_view, then drafts a
 *   correction: $53,536.44 through 2026-11-24, including $436.44 of
 *   accrued interest — indicative, not a recorded quote.
 *   Drill 2 (stuck): the customer says Pax told them their listing is
 *   "active" on Craigslist. The model reads get_land_listing_view +
 *   get_listing_paste_text_view and corrects it: the listing is
 *   recorded as listed on the operator's own word, AcreOS posted
 *   nothing, and the paste text is theirs to post.
 *   Drill 3 ("Pax told me X"): the ticket quotes a prior Pax answer
 *   presenting the parcel's flood zone as settled fact without its
 *   coverage. The model reads get_parcel_passport_view and restates
 *   the figure WITH its coverage: 3 of 17 fields, Zone X per FEMA NFHL
 *   as of 2024-01-01, the other 14 fields gaps.
 *   Drill 4 (wrong data): the customer asks for the flood zone and
 *   soil class of a parcel nobody has looked up. The passport reads
 *   0 of 17 — the reply names both as gaps, never invents them.
 *
 * executeSupportTool is stubbed at the module seam with payloads
 * carrying the verbatim coverage text the real #744 helpers produce
 * for these fixtures (drills 1–4's own walk figures); the tool
 * implementations themselves — including those statements — are
 * executed for real in landSupportDrills.test.ts. No live LLM, no
 * staging — stated plainly in the drill record addendum.
 *
 * Scope note: mark_land_listing_listed has NO support variant (it is
 * the family's one write — pinned absent in
 * landSupportDrills.test.ts), so nothing in these scenarios records
 * the operator's word or changes a listing; the replies promise none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const RESOLVER_NAMES = [
    "search_knowledge_base", "search_resolved_tickets", "get_similar_resolutions",
    "get_troubleshooting_steps", "diagnose_account", "check_data_integrity",
    "get_account_summary", "get_parcel_passport_view", "get_land_listings_view",
    "get_land_listing_view", "get_listing_paste_text_view", "get_land_payoff_quote_view",
    "query_user_data", "get_user_activity", "estimate_resolution_confidence",
    "recall_user_memory", "draft_customer_response", "escalate_to_human",
  ];
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  let ticket: Record<string, unknown> | null = null;
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    query: { supportTickets: { findFirst: vi.fn(async () => ticket) } },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ orderBy: vi.fn(async () => [] as unknown[]) })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => { inserted.push(v); return undefined; }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        updated.push(v);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  const payoffData = {
    coverage: "Coverage: an INDICATIVE payoff for ONE serviced note in THIS account (a seller-financed note this account originated — the land sell-on-terms book), computed by the same engine as the note payoff calculator from the note's own completed payment ledger. It is not a recorded quote and binds nobody: a payoff a third party will rely on is issued from the note's payoff screen, which records it. It does not include acquired notes or any other account's notes.",
    noteId: 5,
    status: "active",
    payoffDate: "2026-11-24",
    goodThroughDate: "2026-11-24",
    recorded: false,
    principalBalanceCents: 5_310_000,
    accruedInterestCents: 43_644,
    perDiemInterestCents: 1_455,
    daysAccrued: 30,
    lateFeesOutstandingCents: 0,
    lateFeesCollectedToDateCents: 0,
    totalPayoffCents: 5_353_644,
    ledgerRowsConsidered: 1,
  };
  const listingData = {
    coverage: "Coverage: ONE listing in THIS account, with the channel status recorded on it. A status of \"listed\" is the operator's own word that they posted it; \"active\" means a channel accepted a posting through AcreOS. It does not include external MLS listings, marketplace listings, or any other account's listings, and AcreOS has not posted any of these anywhere — a channel status below is exactly what is recorded.",
    listing: { id: 9, propertyId: 42, title: "10 acres in Luna County", askingPrice: "45000", status: "listed", channels: [{ platform: "craigslist", status: "manual_posting", listingUrl: null, postedAt: null }] },
  };
  const pasteData = {
    coverage: "Coverage: ready-to-paste Craigslist text built from THIS account's listing, exactly as the publish screen builds it. AcreOS has NOT posted anything — Craigslist has no posting API here; the customer pastes this themselves, then can ask me to mark the listing as listed.",
    listingId: 9,
    pasteText: "PASTE TEXT FOR CRAIGSLIST",
    manualInstructions: "Post it yourself",
    deepLinkUrl: "https://albuquerque.craigslist.org/d/land/search/lnd",
  };
  const passport3Data = {
    coverage: "Coverage: the parcel passport for ONE property in THIS account — 3 of 17 fields have a recorded value; the other 14 are gaps, listed by name with the reason. State the coverage when you quote any figure from it: a value read here is only as good as its source and date. It does not include parcels in any other account, tax-sale listings, or a fresh data lookup — Pax reads the passport recorded for this account, and fields that were never looked up are listed as gaps, never filled in.",
    propertyId: 42,
    apn: "100-20-030",
    county: "Luna",
    state: "NM",
    fieldsPopulated: 3,
    fieldsTotal: 17,
    fields: {
      acreage: { label: "Acreage", value: 10, source: "County GIS", asOf: "2026-06-01" },
      owner: { label: "Owner", value: "SYNTHETIC Recorded Owner", source: "County GIS", asOf: "2026-06-01" },
      floodZone: { label: "Flood zone", value: "Zone X", source: "FEMA NFHL", asOf: "2024-01-01", classification: "authoritative" },
    },
    gaps: [{ field: "soilCapabilityClass", label: "Soil capability class", reason: "not_looked_up" }],
  };
  const passport0Data = {
    ...passport3Data,
    coverage: "Coverage: the parcel passport for ONE property in THIS account — 0 of 17 fields have a recorded value; the other 17 are gaps, listed by name with the reason. State the coverage when you quote any figure from it: a value read here is only as good as its source and date. It does not include parcels in any other account, tax-sale listings, or a fresh data lookup — Pax reads the passport recorded for this account, and fields that were never looked up are listed as gaps, never filled in.",
    fieldsPopulated: 0,
    fields: {},
    gaps: [
      { field: "floodZone", label: "Flood zone", reason: "not_looked_up" },
      { field: "soilCapabilityClass", label: "Soil capability class", reason: "not_looked_up" },
    ],
  };
  const state = { coldPassport: false };
  return { db, inserted, updated, toolCalls, RESOLVER_NAMES, payoffData, listingData, pasteData, passport3Data, passport0Data, state, setTicket: (t: Record<string, unknown>) => { ticket = t; },
    reset: () => { inserted.length = 0; updated.length = 0; toolCalls.length = 0; ticket = null; state.coldPassport = false; } };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));
vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: { attemptResolution: vi.fn(async () => ({ autoResolved: false })) },
}));
vi.mock("../../server/services/andrei/supportResolverCalibration", () => ({
  recordSupportResolveDecision: vi.fn(async () => undefined),
}));

vi.mock("../../server/ai/supportAgent", () => ({
  PAX_SYSTEM_PROMPT: "You are Pax.",
  getOpenAIClient: () => { throw new Error("no live client in drills"); },
  supportToolDefinitions: Object.fromEntries(mocks.RESOLVER_NAMES.map((name) => [name, {
    name, description: name, parameters: { type: "object", properties: {} },
  }])),
  executeSupportTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
    mocks.toolCalls.push({ name, args });
    if (name === "get_land_payoff_quote_view") return { success: true, data: mocks.payoffData };
    if (name === "get_land_listing_view") return { success: true, data: mocks.listingData };
    if (name === "get_listing_paste_text_view") return { success: true, data: mocks.pasteData };
    if (name === "get_parcel_passport_view") return { success: true, data: mocks.state.coldPassport ? mocks.passport0Data : mocks.passport3Data };
    return { success: true, data: {} };
  }),
}));

import { resolveTicketWithPax } from "../../server/ai/paxSupportResolver";
import type { ChatCompletionFn } from "../../server/ai/paxSupportResolver";
import type { Organization } from "@shared/schema";

const ORG = { id: 7, isFounder: false } as unknown as Organization;

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

/** A model that first calls the given read tools, then drafts `reply` at 95. */
function groundedModel(reads: Array<[string, Record<string, unknown>]>, reply: string): ChatCompletionFn {
  let step = 0;
  return vi.fn(async () => {
    step += 1;
    if (step === 1) {
      return { choices: [{ message: { role: "assistant", content: null,
        tool_calls: reads.map(([name, args], i) => toolCall(`call_${i}`, name, args)) } }] };
    }
    return { choices: [{ message: { role: "assistant", content: null,
      tool_calls: [toolCall("call_draft", "draft_customer_response", {
        response_text: reply, confidence_score: 95, resolution_type: "answer_question",
      })] } }] };
  }) as unknown as ChatCompletionFn;
}

describe("Land drill 1 — money: the support reply corrects the payoff from the shared engine's figures", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.setTicket({ id: 9101, userId: "user-1", subject: "Borrower says the payoff is just the balance", description: "My borrower says the payoff on note 5 is just the $53,100 balance and wants to wire that. Is that the whole amount through November 24?", category: "general", aiResolutionAttempts: 0 });
  });

  it("auto-resolves ONLY after reading the payoff quote, with a reply that adds the accrued interest and marks the quote indicative", async () => {
    const reply =
      "Not quite — the balance is only part of it. Through November 24 the payoff on that note is $53,536.44: " +
      "the $53,100.00 principal plus $436.44 of interest accrued over 30 days at $14.55 a day, from the note's own payment ledger. " +
      "That figure is indicative — it is not a recorded quote, and a payoff a third party will rely on is issued from the note's payoff screen. Nothing has been recorded or charged by this reply.";
    const result = await resolveTicketWithPax(9101, ORG, {
      createCompletion: groundedModel([
        ["get_land_payoff_quote_view", { note_id: 5, payoff_date: "2026-11-24" }],
      ], reply),
      tryGeniusOnEscalate: false,
    });
    expect(mocks.toolCalls.map((c) => c.name)).toEqual(["get_land_payoff_quote_view"]);
    expect(result.autoResolved).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.response).toContain("$53,536.44");
    expect(result.response).toContain("$436.44");
    expect(result.response).not.toMatch(/I('ll| will) (record|send|charge|collect)/i);
    expect(mocks.inserted).toHaveLength(1);
  });
});

describe("Land drill 2 — stuck: the support reply separates 'listed' from 'active' and hands over the paste text", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.setTicket({ id: 9102, userId: "user-1", subject: "Pax said my listing is active but nobody can find it", description: "Pax told me my Luna County listing is active on Craigslist, but I can't find it anywhere and nobody has called. Is it live?", category: "general", aiResolutionAttempts: 0 });
  });

  it("auto-resolves ONLY after reading the listing and the paste text, with a reply that corrects 'active' and posts nothing", async () => {
    const reply =
      "It is not active, and AcreOS has not posted it anywhere. Your listing is recorded as listed — that is your own word that you posted it — " +
      "while 'active' would mean a channel accepted a posting through AcreOS, which has not happened. Craigslist is posted by hand: " +
      "the ready-to-paste text for this listing is built from the listing exactly as the publish screen builds it, and once you have pasted it the listing is live under your own account. Nothing has been posted or changed by this reply.";
    const result = await resolveTicketWithPax(9102, ORG, {
      createCompletion: groundedModel([
        ["get_land_listing_view", { listing_id: 9 }],
        ["get_listing_paste_text_view", { listing_id: 9 }],
      ], reply),
      tryGeniusOnEscalate: false,
    });
    expect(mocks.toolCalls.map((c) => c.name)).toEqual(["get_land_listing_view", "get_listing_paste_text_view"]);
    expect(result.autoResolved).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.response).toContain("not active");
    expect(result.response).not.toMatch(/I('ll| will) (post|mark|record|send)/i);
    expect(mocks.inserted).toHaveLength(1);
  });
});

describe("Land drill 3 — 'Pax told me X': the support reply restates the passport figure WITH its coverage", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.setTicket({ id: 9103, userId: "user-1", subject: "Pax told me the flood zone is settled for my parcel", description: "Pax told me my Luna County parcel is in Zone X, full stop. My lender is asking what that is based on and what else is known about the parcel. What do we actually have?", category: "general", aiResolutionAttempts: 0 });
  });

  it("auto-resolves ONLY after reading the passport, with a reply that states 3 of 17 and the figure's source and date", async () => {
    const reply =
      "Here is exactly what is recorded. The passport for that parcel has values for 3 of its 17 fields; the other 14 are gaps that were never looked up. " +
      "The flood zone is one of the three: Zone X, from FEMA NFHL as of January 1, 2024. The acreage (10) and the recorded owner come from County GIS as of June 1, 2026. " +
      "Nothing here is a fresh lookup — it is the passport recorded for this account, and the soil class is one of the gaps. Nothing has been changed by this reply.";
    const result = await resolveTicketWithPax(9103, ORG, {
      createCompletion: groundedModel([
        ["get_parcel_passport_view", { property_id: 42 }],
      ], reply),
      tryGeniusOnEscalate: false,
    });
    expect(mocks.toolCalls.map((c) => c.name)).toEqual(["get_parcel_passport_view"]);
    expect(result.autoResolved).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.response).toContain("3 of its 17 fields");
    expect(result.response).toContain("Zone X");
    expect(mocks.inserted).toHaveLength(1);
  });
});

describe("Land drill 4 — wrong data: the support reply names unlooked-up fields as gaps, never as facts", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.setTicket({ id: 9104, userId: "user-1", subject: "What are the flood zone and soil class for my new parcel?", description: "I just added a parcel and need its flood zone and soil class for a buyer. What are they?", category: "general", aiResolutionAttempts: 0 });
  });

  it("auto-resolves ONLY after reading the passport, with a reply that says both fields are gaps — 0 of 17 recorded", async () => {
    mocks.state.coldPassport = true;
    const reply =
      "We do not have them yet. The passport recorded for that parcel has values for 0 of its 17 fields — the flood zone and the soil class are both gaps " +
      "that were never looked up, so I will not guess at either. Once the parcel's diligence lookup has run, both will appear here with their source and date. Nothing has been changed by this reply.";
    const result = await resolveTicketWithPax(9104, ORG, {
      createCompletion: groundedModel([
        ["get_parcel_passport_view", { property_id: 42 }],
      ], reply),
      tryGeniusOnEscalate: false,
    });
    expect(mocks.toolCalls.map((c) => c.name)).toEqual(["get_parcel_passport_view"]);
    expect(result.autoResolved).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.response).toContain("0 of its 17 fields");
    expect(result.response).not.toMatch(/Zone [A-Z]/);
    expect(mocks.inserted).toHaveLength(1);
  });
});
