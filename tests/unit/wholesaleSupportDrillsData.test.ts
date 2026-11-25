/**
 * Wholesale W8 — support drill set, part 3 of 3: drill 4 (data-wrong).
 * Part 1 (wholesaleSupportDrills.test.ts) holds drill 1 and drills 2a/2b;
 * part 2 (wholesaleSupportDrillsStuck.test.ts) holds drills 2c/2d and the
 * drill 3 capability pin. The full record:
 * docs/evidence/2026-11-24/wholesale-support-drills.md.
 *
 * Every leg runs the real wholesale Pax tools through executeTool (the
 * chat path's real switch) — the decision read and the buyer-match read a
 * support answer is built from. Mocks are infrastructure only (the db
 * handle and the decision/outcome stores), the same pattern
 * paxWholesaleTools.test.ts uses. Fixtures are synthetic. Nothing in
 * this file can send anything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  counts: {} as Record<string, number>,
  wheres: [] as Array<{ table: string; cond: unknown }>,
  updates: [] as Array<{ table: string; set: any }>,
  effects: [] as any[],
  decisions: [] as any[],
  outcomes: [] as any[],
}));

vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const make = () => {
    let table = "";
    let fields: Record<string, unknown> | undefined;
    let updating = false;
    const chain: any = {
      select: (f?: Record<string, unknown>) => { fields = f; updating = false; return chain; },
      from: (t: any) => { table = getTableName(t); return chain; },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (c: unknown) => { H.wheres.push({ table, cond: c }); return chain; },
      orderBy: () => chain,
      limit: () => chain,
      update: (t: any) => { table = getTableName(t); updating = true; return chain; },
      set: (v: any) => { H.updates.push({ table, set: v }); return chain; },
      returning: async () => (H.rows[table] ?? []).map((r: any) => ({ ...r, ...(H.updates.at(-1)?.set ?? {}) })),
      then: (res: any, rej: any) => {
        if (updating) return Promise.resolve(undefined).then(res, rej);
        const rows = (fields && "apn" in fields ? H.rows.property_candidates : H.rows[table]) ?? [];
        const out = fields && "total" in fields ? [{ total: H.counts[table] ?? rows.length }] : rows;
        return Promise.resolve(out).then(res, rej);
      },
    };
    return chain;
  };
  return { db: make() };
});
vi.mock("../../server/services/paxReceipts", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordPaxEffect: vi.fn(async (e: any) => { H.effects.push(e); return { written: true }; }),
}));
vi.mock("../../server/services/decisions/decisionStore", () => ({ decisionsForSubject: vi.fn(async () => H.decisions) }));
vi.mock("../../server/services/outcomes/outcomeStore", () => ({ outcomesForDecision: vi.fn(async () => H.outcomes) }));
vi.mock("../../server/utils/clock", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const now = () => new Date("2026-11-23T12:00:00Z");
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

import { executeTool } from "../../server/ai/tools";

const org = { id: 7, name: "Org", ownerId: "u" } as any;
const dealRow = { id: 11, propertyId: 21, type: "acquisition", status: "negotiating" };
const propRow = (over: Record<string, unknown> = {}) => ({ id: 21, address: "1 Main St", state: "TX", county: "Harris", status: "under_contract", ...over });
const seedDeal = (propOver: Record<string, unknown> = {}) => { H.rows.deals = [dealRow]; H.rows.properties = [propRow(propOver)]; };
// The buyer-match read runs the real compliance gate over the seeded
// state rules (routes-wholesaler-rules is not mocked in this file).
const txRule = { state: "TX", status: "unrestricted", licenseRequired: false, advertisingRestricted: false, recommendation: "unrestricted", citation: null, summary: "Permitted in this state.", attorneyReviewedAt: new Date("2026-01-01") };

beforeEach(() => {
  H.rows = {}; H.counts = {}; H.wheres = []; H.updates = []; H.effects = [];
  H.decisions = []; H.outcomes = [];
});

// ── Drill 4 — data-wrong ───────────────────────────────────────────────────

describe("W8 drill 4a — 'your ARV/fee figure is wrong': the decision read reproduces the recorded figures, inputs owned", () => {
  const decision = {
    id: 5, decidedAt: new Date("2026-11-01T00:00:00Z"),
    body: {
      kind: "offer", choice: "offer $90,000", rationale: "fee clears", strategyPackId: "residential_wholesaler", reviewDueAt: null, unknowns: [{}],
      scenarios: [{ engineId: "wholesale_mao", scenarioId: 9, predicted: [{ id: "max_allowable_offer", value: 9_000_000 }, { id: "assignment_fee", value: 1_000_000 }, { id: "profit", value: 1_000_000 }] }],
    },
  };

  it("the figures a support answer quotes are the recorded scenario's, exactly — nothing recomputed, nothing rounded", async () => {
    seedDeal();
    H.decisions = [decision];
    const r = await executeTool("get_wholesale_decision", { deal_id: 11 }, org);
    expect(r.success).toBe(true);
    expect(r.data.decision.decisionId).toBe(5);
    expect(r.data.decision.scenarios[0]).toMatchObject({ engineId: "wholesale_mao", scenarioId: 9 });
    expect(r.data.decision.scenarios[0].predicted).toEqual([
      { id: "max_allowable_offer", value: 9_000_000 },
      { id: "assignment_fee", value: 1_000_000 },
      { id: "profit", value: 1_000_000 },
    ]);
  });

  it("the coverage states verbatim that comps and ARV are the operator's own inputs — AcreOS supplies none", async () => {
    seedDeal();
    H.decisions = [decision];
    const r = await executeTool("get_wholesale_decision", { deal_id: 11 }, org);
    expect(r.data.coverage).toContain("Comps and ARV in it are the operator's own inputs — AcreOS supplies no residential comps.");
  });

  it("no decision recorded → said plainly, never a fabricated figure", async () => {
    seedDeal();
    H.decisions = [];
    const r = await executeTool("get_wholesale_decision", { deal_id: 11 }, org);
    expect(r.data.decision).toBeNull();
    expect(r.data.statement).toMatch(/No wholesale underwriting decision is recorded/);
  });
});

describe("W8 drill 4b — 'your buyer match is wrong': stored scores from the org's OWN list only", () => {
  it("the match read states the own-list coverage verbatim and that asking does not re-run matching", async () => {
    seedDeal({ state: "TX" });
    H.rows.wholesaler_state_rules = [txRule];
    H.rows.buyer_property_matches = [{ buyerProfileId: 3, matchScore: 88, matchReasons: ["TX"], potentialConcerns: [], status: "pending", financialInfo: { financingType: "cash" }, firstName: "SYNTHETIC Ada", lastName: "Cash" }];
    H.counts.buyer_property_matches = 1;
    const r = await executeTool("get_wholesale_buyer_matches", { deal_id: 11 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toContain("It covers this account's OWN buyer list only — buyers you entered or imported here.");
    expect(r.data.coverage).toContain("It does not include any other account's buyers, a shared buyer network, or buyers you have not added.");
    expect(r.data.coverage).toContain("asking does not re-run matching");
    expect(r.data.matches[0]).toMatchObject({ buyerProfileId: 3, matchScore: 88 });
    // No buyer email or phone leaves the read a support answer is built from.
    expect(JSON.stringify(r.data)).not.toMatch(/@/);
  });

  it("no stored matches is said, not guessed — and matching is not run to fill the gap", async () => {
    seedDeal({ state: "TX" });
    H.rows.wholesaler_state_rules = [txRule];
    const r = await executeTool("get_wholesale_buyer_matches", { deal_id: 11 }, org);
    expect(r.data.statement).toMatch(/I cannot tell which, and I did not run it/);
  });
});

describe("W8 drill 4c — 'the dashboard fee looks off': tool and dashboard agree on the same seed figures", () => {
  it("on drill 1's seed ($12,000 signed + $9,000 draft) the counted fee is $12,000 — the draft explains the 'off' feeling, and neither surface counts it", async () => {
    H.rows.deals = [dealRow];
    H.rows.contract_assignments = [
      { id: 1, status: "signed", assignmentFeeCents: 1_200_000, endBuyerName: "SYNTHETIC Ada Cash", endBuyerProfileId: null, originalContractDate: "2026-10-01", notes: null },
      { id: 2, status: "draft", assignmentFeeCents: 900_000, endBuyerName: "SYNTHETIC Bo", endBuyerProfileId: null, originalContractDate: null, notes: null },
    ];
    const r = await executeTool("get_wholesale_assignments", { deal_id: 11 }, org);
    expect(r.success).toBe(true);
    // The dashboard rule (pinned in part 1) sums the same population:
    // signed rows only → 1_200_000, source "assignments".
    const signedOnly = H.rows.contract_assignments.filter((a: any) => a.status === "signed").reduce((s: number, a: any) => s + a.assignmentFeeCents, 0);
    expect(signedOnly).toBe(1_200_000);
    expect(r.data.signedFeeCents).toBe(signedOnly);
    expect(r.data.assignments.find((a: any) => a.status === "draft")?.assignmentFeeCents).toBe(900_000);
  });
});
