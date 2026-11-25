/**
 * Wholesale W8 — support drill set, part 1 of 3: drill 1 (the money
 * moment) and drills 2a/2b (the stuck moment, through the compliance
 * gate). Part 2 (wholesaleSupportDrillsStuck.test.ts) holds drills 2c/2d
 * and the drill 3 capability pin; part 3
 * (wholesaleSupportDrillsData.test.ts) holds drill 4 (data-wrong). The
 * full record: docs/evidence/2026-11-24/wholesale-support-drills.md.
 *
 * Every leg runs the real paths a support answer is built from: the
 * wholesale Pax tools through executeTool (the chat path's real switch)
 * and the real checkAssignmentCompliance the REST blast itself calls.
 * Mocks are infrastructure only — the db handle, the packet derivation
 * service (its call count proves a blocked gate derives nothing) and the
 * decision/outcome stores — the same pattern paxWholesaleTools.test.ts
 * uses. No tool, gate or refusal under drill is mocked. Fixtures are
 * synthetic. Nothing in this file can send anything.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { stripComments } from "../helpers/stripComments";

const RECIPIENT_ID = "8a2d2d2e-3c8b-4d2e-8b66-1f1f1f1f1f1f";
const H = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  counts: {} as Record<string, number>,
  wheres: [] as Array<{ table: string; cond: unknown }>,
  updates: [] as Array<{ table: string; set: any }>,
  effects: [] as any[],
  packetCalls: 0,
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
// Deliberately NOT mocked: routes-wholesaler-rules. Drill 2 runs the real
// checkAssignmentCompliance against seeded wholesaler_state_rules rows,
// and the packet tool runs the real offerComplianceGate over it.
vi.mock("../../server/services/wholesale/disposition", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  buildDispositionPacket: vi.fn(async (_org: number, propertyId: number) => {
    H.packetCalls += 1;
    return { propertyId, dealId: 11, decisionId: 5, scenarioId: 9, derivedAt: "2026-11-23T12:00:00.000Z", price: { contractPriceCents: 9_000_000, targetFeeCents: 1_000_000, buyerPriceCents: 10_000_000, buyerSideMaoCents: 11_000_000, withinBuyerCeiling: true }, subject: "Assignment: 1 Main St — $100,000", html: "<p>x</p>" };
  }),
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
import { checkAssignmentCompliance } from "../../server/routes-wholesaler-rules";

const org = { id: 7, name: "Org", ownerId: "u" } as any;
const root = resolve(__dirname, "../..");
const read = (p: string) => stripComments(readFileSync(resolve(root, p), "utf8"));
const readRaw = (p: string) => readFileSync(resolve(root, p), "utf8");
const params = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).params;

const dealRow = { id: 11, propertyId: 21, type: "acquisition", status: "negotiating" };
const propRow = (over: Record<string, unknown> = {}) => ({ id: 21, address: "1 Main St", state: "TX", county: "Harris", status: "under_contract", ...over });
const seedDeal = (propOver: Record<string, unknown> = {}) => { H.rows.deals = [dealRow]; H.rows.properties = [propRow(propOver)]; };
const txRule = { state: "TX", status: "unrestricted", licenseRequired: false, advertisingRestricted: false, recommendation: "unrestricted", citation: null, summary: "Permitted in this state.", attorneyReviewedAt: new Date("2026-01-01") };
const ilRule = { state: "IL", status: "license_required", licenseRequired: true, advertisingRestricted: true, recommendation: "license_required", citation: "735 ILCS 455/20", summary: "Assignment advertising is blocked in IL.", attorneyReviewedAt: new Date("2026-01-01") };
const seedAssignments = () => {
  H.rows.deals = [dealRow];
  H.rows.contract_assignments = [
    { id: 1, status: "signed", assignmentFeeCents: 1_200_000, endBuyerName: "SYNTHETIC Ada Cash", endBuyerProfileId: null, originalContractDate: "2026-10-01", notes: null },
    { id: 2, status: "draft", assignmentFeeCents: 900_000, endBuyerName: "SYNTHETIC Bo", endBuyerProfileId: null, originalContractDate: null, notes: null },
  ];
};

beforeEach(() => {
  H.rows = {}; H.counts = {}; H.wheres = []; H.updates = []; H.effects = [];
  H.packetCalls = 0; H.decisions = []; H.outcomes = [];
});

// ── Drill 1 — money moment ─────────────────────────────────────────────────

describe("W8 drill 1 — 'where's my money': the signed fee is a record; only signed counts", () => {
  it("the tool counts the $12,000 signed fee and NOT the $9,000 draft, on this account only", async () => {
    seedAssignments();
    const r = await executeTool("get_wholesale_assignments", { deal_id: 11, organization_id: 999 }, org);
    expect(r.success).toBe(true);
    expect(r.data.signedCount).toBe(1);
    expect(r.data.signedFeeCents).toBe(1_200_000);
    expect(r.data.signedFee).toBe("$12,000");
    expect(r.data.assignments).toHaveLength(2);
    const p = H.wheres.filter((w) => w.table === "contract_assignments").flatMap((w) => params(w.cond));
    expect(p).toContain(7);
    expect(p).not.toContain(999);
  });

  it("the coverage a support answer quotes states the no-custody truth verbatim", async () => {
    seedAssignments();
    const r = await executeTool("get_wholesale_assignments", { deal_id: 11 }, org);
    expect(r.data.coverage).toContain("An assignment fee is a RECORD of the fee in the contract — AcreOS holds and moves no money.");
    expect(r.data.coverage).toContain("Only a signed assignment counts toward the fee total.");
  });

  it("no signed assignment → the tool says so plainly instead of quoting the draft as money", async () => {
    H.rows.deals = [dealRow];
    H.rows.contract_assignments = [
      { id: 2, status: "draft", assignmentFeeCents: 900_000, endBuyerName: "SYNTHETIC Bo", endBuyerProfileId: null, originalContractDate: null, notes: null },
    ];
    const r = await executeTool("get_wholesale_assignments", { deal_id: 11 }, org);
    expect(r.data.signedFeeCents).toBe(0);
    expect(r.data.statement).toMatch(/No assignment on this deal is signed yet, so no fee is counted/);
  });
});

describe("W8 drill 1 — the dashboard route reproduces the same figure by the same rule (no proxy)", () => {
  const src = read("server/routes-wholesaler-dashboard.ts");

  it("the dashboard sums contract_assignments filtered to status 'signed' — the tool's population", () => {
    expect(src).toContain('eq(contractAssignments.status, "signed")');
    expect(src).toContain("SUM(${contractAssignments.assignmentFeeCents})");
  });

  it("the wire carries the source, and the fee is null — not zero, not an estimate — when none is signed", () => {
    expect(src).toContain("assignmentFeeSource,");
    expect(src).toContain('assignmentFeeSource === "assignments" ? totalAssignmentFeesCents : null');
    // Founder call B-6 (#699): no netProfit proxy may feed the fee fields.
    const feeBlock = src.slice(src.indexOf("assignmentFeeSource"), src.indexOf("speedToCloseDays ="));
    expect(feeBlock).not.toContain("netProfit");
    expect(feeBlock).not.toContain("analysisResults");
  });
});

describe("W8 drill 1 — EMD: an append-only record about someone else's escrow, never a balance", () => {
  it("the schema's own words: the deposit is held by a licensed third party; the amount is a recorded fact", () => {
    const schema = readRaw("shared/schema/earnest-money-events.ts");
    expect(schema).toContain("HELD BY LICENSED THIRD PARTIES");
    expect(schema).toContain("not a balance AcreOS holds");
  });

  it("the one writer only ever INSERTs into earnest_money_events (append-only discipline)", () => {
    const route = readRaw("server/routes-earnest-money.ts");
    expect(route).toContain("INSERT INTO earnest_money_events");
    expect(route).toContain("this helper is the ONLY write path to the events");
    expect(route).not.toMatch(/UPDATE\s+earnest_money_events|DELETE\s+FROM\s+earnest_money_events/i);
  });
});

// ── Drill 2 — stuck moment (gate legs) ─────────────────────────────────────

describe("W8 drill 2a — a blocked state refuses the packet through the REAL gate, before anything is derived", () => {
  it("IL (license_required): plain refusal naming the rule and its citation; the packet is never built", async () => {
    seedDeal({ state: "IL" });
    H.rows.wholesaler_state_rules = [ilRule];
    const r = await executeTool("get_wholesale_disposition_packet", { deal_id: 11 }, org, { userId: "u-1" });
    expect(r.success).toBe(false);
    expect(r.refusal?.what).toMatch(/did not prepare a disposition packet/);
    expect(r.refusal?.why).toMatch(/blocked in IL/);
    expect(r.refusal?.why).toMatch(/735 ILCS 455\/20/);
    expect(r.refusal?.why).toMatch(/same state rule that blocks the buyer blast/);
    expect(H.packetCalls).toBe(0);
    expect(H.updates).toHaveLength(0);
  });

  it("the same REAL gate surfaces as blocked on the buyer-match read — support sees the block before composing", async () => {
    seedDeal({ state: "IL" });
    H.rows.wholesaler_state_rules = [ilRule];
    const r = await executeTool("get_wholesale_buyer_matches", { deal_id: 11 }, org);
    expect(r.success).toBe(true);
    expect(r.data.blastGate.status).toBe("blocked");
  });

  it("a clear state's gate statement says what the check is — a rule check on seeded states, not legal advice", async () => {
    seedDeal({ state: "TX" });
    H.rows.wholesaler_state_rules = [txRule];
    const r = await executeTool("get_wholesale_buyer_matches", { deal_id: 11 }, org);
    expect(r.data.blastGate.status).toBe("clear");
    expect(r.data.blastGate.statement).toMatch(/not legal advice/);
  });
});

describe("W8 drill 2b — an unseeded state is blocked by the REAL compliance check, the reason named", () => {
  it("no rule on file for WY → blocked, double-close/counsel named, never silently allowed", async () => {
    H.rows.wholesaler_state_rules = [];
    const r = await checkAssignmentCompliance("WY");
    expect(r.blocked).toBe(true);
    expect(r.warn).toBe(false);
    expect(r.recommendation).toBe("double_close_only");
    expect(r.summary).toMatch(/No rule entry on file for WY/);
    expect(r.summary).toMatch(/blocks assignment-template generation in unseeded states/);
  });

  it("a license_required rule blocks with its citation; an unrestricted rule clears", async () => {
    H.rows.wholesaler_state_rules = [ilRule];
    const il = await checkAssignmentCompliance("IL");
    expect(il).toMatchObject({ blocked: true, citation: "735 ILCS 455/20", attorneyReviewed: true });
    H.rows.wholesaler_state_rules = [txRule];
    const tx = await checkAssignmentCompliance("TX");
    expect(tx).toMatchObject({ blocked: false, warn: false });
  });
});

// The blast-recipient record path itself is proven in
// paxWholesaleTools.test.ts and is not re-drilled in this part.
void RECIPIENT_ID;
