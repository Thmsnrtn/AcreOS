/**
 * Fix-and-flip Pax tool family (promised bar item (c), gap-sheet work item 4).
 *
 * Proves: the five tools are registered in every place the pattern registers
 * a tool; every read states its coverage; the org comes from the session and
 * is in the WHERE of every query (decoded from the real drizzle condition,
 * not grepped); the detail read runs the shared variance/timeline math;
 * the flip analysis returns the frozen flip_mao scenario WITH its evidence
 * (assumptions + origins) and states absence instead of reconstructing one;
 * the holding-cost append is append-only, validated, org-scoped and writes
 * one receipt; the exit/realized record is ASK-BEFORE at every stance
 * (APPROVAL_REQUIRED_TOOLS — an unapproved call freezes as an ask and writes
 * nothing; only the trusted replay records it, through the same decision
 * store / write-once update the REST routes use); and NO tool sends
 * anything (FD5) — asserted on the registry AND on what the tool module
 * can reach.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";
import { PgDialect } from "drizzle-orm/pg-core";

const REHAB_ID = "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0f";
const H = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  wheres: [] as Array<{ table: string; cond: unknown }>,
  inserts: [] as Array<{ table: string; values: any }>,
  updates: [] as Array<{ table: string; values: any }>,
  updateRows: [] as unknown[],
  effects: [] as any[],
  proposals: [] as any[],
  recordedDecisions: [] as any[],
  decisions: [] as any[],
}));

vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const make = () => {
    let table = "";
    const chain: any = {
      select: () => chain,
      from: (t: any) => { table = getTableName(t); return chain; },
      where: (c: unknown) => { H.wheres.push({ table, cond: c }); return chain; },
      orderBy: () => chain,
      limit: () => chain,
      then: (res: any, rej: any) => Promise.resolve(H.rows[table] ?? []).then(res, rej),
      insert: (t: any) => ({ values: async (v: any) => { H.inserts.push({ table: getTableName(t), values: v }); } }),
      update: (t: any) => ({
        set: (v: any) => {
          H.updates.push({ table: getTableName(t), values: v });
          return { where: () => ({ returning: async () => H.updateRows }) };
        },
      }),
    };
    return chain;
  };
  return { db: make() };
});
vi.mock("../../server/services/paxReceipts", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordPaxEffect: vi.fn(async (e: any) => { H.effects.push(e); return { written: true }; }),
}));
vi.mock("../../server/services/decisions/decisionStore", () => ({
  decisionsForSubject: vi.fn(async () => H.decisions),
  recordDecision: vi.fn(async (orgId: number, input: any) => {
    H.recordedDecisions.push({ orgId, input });
    return { id: 42 };
  }),
}));
vi.mock("../../server/services/economics/scenarioStore", () => ({
  UnavailableScenarioError: class extends Error {},
}));
vi.mock("../../server/services/approvalKernel", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  proposePendingAction: vi.fn(async (i: any) => {
    H.proposals.push(i);
    return { id: 1, contentHash: "h", expiresAt: new Date("2026-11-24T12:00:00Z"), ...i };
  }),
}));
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

import { executeTool, toolDefinitions, PAUSE_SAFE_TOOLS, APPROVAL_REQUIRED_TOOLS } from "../../server/ai/tools";
import { PAX_TOOL_GROUPS, groupForTool } from "../../shared/pax-controls";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";

const READS = ["get_rehab_projects", "get_rehab_detail", "get_flip_analysis"] as const;
const APPEND = "append_holding_cost_entry" as const;
const ASK_FIRST = "record_exit_facts" as const;
const org = { id: 7, name: "Org", ownerId: "u" } as any;
const rehabRow = {
  id: REHAB_ID, organizationId: 7, propertyId: 3, name: "1247 Cherokee Pl", status: "finishes",
  startedAt: "2026-09-01", plannedListingDate: "2026-12-01", actualListingDate: null, closedAt: null,
  purchasePriceCents: 15000000, purchaseClosingCents: 300000, budgetTotalCents: 6000000,
  spentTotalCents: 5500000, holdingCostMonthlyCents: 120000, arvCents: 26000000, targetMarginCents: null,
  realizedSalePriceCents: null, realizedSellingCostsCents: null, realizedClosingDate: null,
  realizedRecordedBy: null, realizedRecordedAt: null, updatedAt: new Date("2026-11-20"),
};
const scenarioRow = {
  id: 9, organizationId: 7, subjectType: "property", subjectId: 3, label: "Base case",
  engineId: "flip_mao", engineVersion: "1", strategyPackId: "fix_and_flip",
  computedAt: new Date("2026-11-01T00:00:00Z"),
  inputs: { arvCents: 26000000, holdMonths: 4, monthlyHoldingCostCents: 120000 },
  assumptions: [
    { key: "holdingCost", value: 120000, unit: "cents", origin: "user", basis: "Operator's monthly carry" },
    { key: "rule_hold_months", value: 4, origin: "strategy-pack-default", basis: "Pack default hold" },
  ],
  metrics: [
    { id: "profit", value: 3200000, unit: "cents" },
    { id: "roi", value: 0.15, unit: "ratio" },
    { id: "total_cost", value: 21300000, unit: "cents" },
  ],
};
const src = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const params = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).params;

beforeEach(() => {
  H.rows = {}; H.wheres = []; H.inserts = []; H.updates = []; H.updateRows = [];
  H.effects = []; H.proposals = []; H.recordedDecisions = []; H.decisions = [];
});

describe("registration — every place the pattern registers a tool", () => {
  it("defined, and reads are pause-safe while the record changes are not", () => {
    for (const n of [...READS, APPEND, ASK_FIRST]) expect(toolDefinitions[n], n).toBeDefined();
    for (const n of READS) expect(PAUSE_SAFE_TOOLS.has(n), n).toBe(true);
    expect(PAUSE_SAFE_TOOLS.has(APPEND)).toBe(false);
    expect(PAUSE_SAFE_TOOLS.has(ASK_FIRST)).toBe(false);
  });
  it("classified in the controls registry: reads look, the append is a deals-rail change, the exit record waits for a tap", () => {
    for (const n of READS) expect(groupForTool(n), n).toBe("looks_and_drafts");
    expect(groupForTool(APPEND)).toBe("changes_records");
    expect(PAX_TOOL_GROUPS[APPEND]).toBe("changes_records");
    // The waits-for-a-tap group: every APPROVAL_REQUIRED tool is classified
    // there (paxControlsOffered pins that identity).
    expect(groupForTool(ASK_FIRST)).toBe("sends");
    expect(APPROVAL_REQUIRED_TOOLS.has(ASK_FIRST)).toBe(true);
  });
  it("scoped: reads need financial_read, the record changes financial_write, under the finance door", () => {
    for (const n of READS) expect(INTENT_META[n], n).toEqual({ door: "finance", scope: "financial_read" });
    for (const n of [APPEND, ASK_FIRST]) expect(INTENT_META[n], n).toEqual({ door: "finance", scope: "financial_write" });
  });
  it("grouped in the underwriting and documents bundles — in BOTH registries (legacy tools.ts and the appIntents roleAllowList the Pax loop consumes)", () => {
    for (const [label, text] of [["tools.ts", src("server/ai/tools.ts")], ["appIntents/index.ts", src("server/services/appIntents/index.ts")]] as const) {
      for (const bundle of ["underwriting", "documents"]) {
        const lines = text.split("\n");
        const start = lines.findIndex((l) => l.trimStart().startsWith(`${bundle}: [`));
        expect(start, `${label}: ${bundle} bundle`).toBeGreaterThan(-1);
        let end = start;
        while (!/\],?$/.test(lines[end].trimEnd())) end++;
        const body = lines.slice(start, end + 1).join("\n");
        for (const n of [...READS, APPEND, ASK_FIRST]) expect(body, `${label}: ${bundle} lacks ${n}`).toContain(`"${n}"`);
      }
    }
  });
});

describe("FD5 — no send is reachable from Pax", () => {
  it("no flip tool name offers to send anything, and every description says what it does instead", () => {
    for (const n of [...READS, APPEND, ASK_FIRST]) {
      expect(n).not.toMatch(/send|mail|dispatch/i);
      expect(toolDefinitions[n].description).toMatch(/never send|sends nothing|state it|coverage/i);
    }
    expect(Object.keys(toolDefinitions).filter((n) => /(rehab|flip).*(send|notice)|send.*(rehab|contractor)/i.test(n))).toEqual([]);
  });
  it("the tool module cannot reach a mail/SMS lane, a payment rail, or a listing service", () => {
    const code = stripComments(src("server/ai/flipTools.ts"));
    expect(code).not.toMatch(/emailService|smsService|mailLane|stripe\.|mls|listingService|settlementRail/);
  });
});

describe("reads — coverage, org pinning, refusals", () => {
  it("list: states its coverage and filters by the SESSION org, ignoring a model-supplied one", async () => {
    H.rows.rehabs = [rehabRow];
    const r = await executeTool("get_rehab_projects", { organization_id: 999, organizationId: 999 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/THIS account's rehab projects only/);
    expect(r.data.coverage).toMatch(/does not include projects, costs or analyses kept in another system/);
    expect(r.data.projects).toHaveLength(1);
    expect(r.data.projects[0]).toMatchObject({ id: REHAB_ID, name: "1247 Cherokee Pl", status: "finishes" });
    const p = H.wheres.filter((w) => w.table === "rehabs").flatMap((w) => params(w.cond));
    expect(p).toContain(7);
    expect(p).not.toContain(999);
  });
  it("list: an empty account reads as empty, never as on budget", async () => {
    const r = await executeTool("get_rehab_projects", {}, org);
    expect(r.success).toBe(true);
    expect(r.data.projects).toEqual([]);
    expect(r.data.coverage).toMatch(/never as on budget/);
  });
  it("detail: variance, timeline and holding come from the shared math over THIS org's rows", async () => {
    H.rows.rehabs = [rehabRow];
    H.rows.rehab_line_items = [
      { id: "11111111-1111-4111-8111-111111111111", organizationId: 7, rehabId: REHAB_ID, sequence: 0, category: "kitchen", scope: "Kitchen — mid-grade gut", budgetCents: 2000000, committedCents: 1900000, spentCents: 2100000, createdAt: new Date("2026-09-02") },
      { id: "22222222-2222-4222-8222-222222222222", organizationId: 7, rehabId: REHAB_ID, sequence: 1, category: "roof", scope: "Roof replace", budgetCents: 1000000, committedCents: 0, spentCents: 900000, createdAt: new Date("2026-09-03") },
    ];
    H.rows.rehab_baselines = [{
      id: "33333333-3333-4333-8333-333333333333", organizationId: 7, rehabId: REHAB_ID, supersedesId: null,
      plannedStartDate: "2026-09-01", plannedListingDate: "2026-12-01", plannedHoldMonths: 4,
      plannedHoldingMonthlyCents: 120000, phasePlans: [{ phase: "finishes", plannedDate: "2026-11-01" }],
      recordedBy: "u", createdAt: new Date("2026-09-01"),
    }];
    H.rows.rehab_status_transitions = [
      { organizationId: 7, rehabId: REHAB_ID, fromStatus: null, toStatus: "planning", transitionedAt: new Date("2026-09-01") },
      { organizationId: 7, rehabId: REHAB_ID, fromStatus: "drywall", toStatus: "finishes", transitionedAt: new Date("2026-11-10") },
    ];
    H.rows.rehab_holding_cost_entries = [
      { id: "e1", organizationId: 7, rehabId: REHAB_ID, entryDate: "2026-10-01", category: "taxes", amountCents: 50000, note: null, recordedBy: "u" },
      { id: "e2", organizationId: 7, rehabId: REHAB_ID, entryDate: "2026-11-01", category: "insurance", amountCents: 30000, note: null, recordedBy: "u" },
    ];
    H.rows.scenarios = [scenarioRow];
    const r = await executeTool("get_rehab_detail", { rehab_id: REHAB_ID }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/ONE rehab project in THIS account/);
    // Variance: kitchen actual 2,100,000 vs estimate 2,000,000; project actual 3,000,000 vs estimate 3,000,000.
    const kitchen = r.data.variance.lines.find((l: any) => l.category === "kitchen");
    expect(kitchen.actualVsEstimateCents).toBe(100000);
    expect(r.data.variance.project.actualVsEstimateCents).toBe(0);
    expect(r.data.variance.flags.map((f: any) => f.kind)).toContain("line_actual_over_estimate");
    // Timeline: finishes planned 2026-11-01, actual 2026-11-10 → +9 days.
    const finishes = r.data.timeline.schedule.phases.find((p: any) => p.phase === "finishes");
    expect(finishes.varianceDays).toBe(9);
    // Holding: recorded entries total 80,000; the comparison keeps plan and actual apart.
    expect(r.data.holdingEntriesTotalCents).toBe(80000);
    expect(r.data.timeline.holding.actuals.entriesTotalCents).toBe(80000);
    for (const w of H.wheres) expect(params(w.cond)).toContain(7);
  });
  it("a project name is refused as a rehab id, not queried; another account's rehab is refused", async () => {
    const bad = await executeTool("get_rehab_detail", { rehab_id: "1247 Cherokee Pl" }, org);
    expect(bad.success).toBe(false);
    expect(H.wheres).toHaveLength(0);
    H.rows.rehabs = [];
    const none = await executeTool("get_rehab_detail", { rehab_id: REHAB_ID }, org);
    expect(none.success).toBe(false);
    expect(none.refusal?.what).toMatch(/No rehab project with that id/);
  });
  it("flip analysis: the frozen scenario comes back WITH its evidence, org-pinned to flip_mao", async () => {
    H.rows.scenarios = [scenarioRow];
    const r = await executeTool("get_flip_analysis", { property_id: 3 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/as frozen when it was computed/);
    expect(r.data.analysis.id).toBe(9);
    expect(r.data.analysis.metrics).toContainEqual({ id: "profit", value: 3200000, unit: "cents" });
    expect(r.data.analysis.assumptions[0]).toMatchObject({ key: "holdingCost", origin: "user", basis: "Operator's monthly carry" });
    const p = params(H.wheres.at(-1)!.cond);
    expect(p).toContain(7);
    expect(p).toContain("flip_mao");
  });
  it("flip analysis via a rehab id resolves that rehab's property, in the session org", async () => {
    H.rows.rehabs = [rehabRow];
    H.rows.scenarios = [scenarioRow];
    const r = await executeTool("get_flip_analysis", { rehab_id: REHAB_ID }, org);
    expect(r.success).toBe(true);
    expect(r.data.propertyId).toBe(3);
    for (const w of H.wheres) expect(params(w.cond)).toContain(7);
  });
  it("flip analysis: absence is stated, never reconstructed", async () => {
    H.rows.scenarios = [];
    const r = await executeTool("get_flip_analysis", { property_id: 3 }, org);
    expect(r.success).toBe(true);
    expect(r.data.analysis).toBeNull();
    expect(r.data.statement).toMatch(/No flip analysis \(flip_mao\) is recorded/);
    expect(r.data.statement).toMatch(/do not reconstruct/);
  });
});

describe("append_holding_cost_entry — append-only, validated, org-scoped, receipted, never a send", () => {
  const good = { rehab_id: REHAB_ID, entry_date: "2026-11-01", category: "taxes", amount_cents: 50000, note: "County tax bill" };
  it("appends through the holding-entries table for the SESSION org and writes ONE receipt", async () => {
    H.rows.rehabs = [rehabRow];
    const r = await executeTool(APPEND, { ...good, organization_id: 999 }, org, { userId: "u-1", origin: "chat" });
    expect(r.success).toBe(true);
    expect(r.data.message).toMatch(/AcreOS paid nothing and sent nothing/);
    expect(H.inserts).toHaveLength(1);
    expect(H.inserts[0].table).toBe("rehab_holding_cost_entries");
    expect(H.inserts[0].values).toMatchObject({ organizationId: 7, rehabId: REHAB_ID, category: "taxes", amountCents: 50000, recordedBy: "u-1" });
    expect(H.effects).toHaveLength(1);
    expect(H.effects[0]).toMatchObject({ orgId: 7, tool: "append_holding_cost_entry", actor: "pax" });
    expect(H.effects[0].after.entry.amountCents).toBe(50000);
  });
  it("a negative correction entry is a valid append (the original is never edited)", async () => {
    H.rows.rehabs = [rehabRow];
    const r = await executeTool(APPEND, { ...good, amount_cents: -50000, note: "Corrects the 2026-11-01 entry — wrong parcel" }, org, { userId: "u-1" });
    expect(r.success).toBe(true);
    expect(H.inserts[0].values.amountCents).toBe(-50000);
    expect(H.updates).toHaveLength(0);
  });
  it("refuses a future date, a zero amount and an unknown category — nothing written, no receipt", async () => {
    H.rows.rehabs = [rehabRow];
    for (const bad of [{ ...good, entry_date: "2026-12-31" }, { ...good, amount_cents: 0 }, { ...good, category: "lender_fees" }]) {
      const r = await executeTool(APPEND, bad, org, { userId: "u-1" });
      expect(r.success).toBe(false);
    }
    expect(H.inserts).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
  it("another account's rehab: refused, nothing written", async () => {
    H.rows.rehabs = [];
    const r = await executeTool(APPEND, good, org, { userId: "u-1" });
    expect(r.success).toBe(false);
    expect(H.inserts).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
});

describe("record_exit_facts — ask-before at every stance; the replay records through the routes' own writers", () => {
  const exitArgs = {
    rehab_id: REHAB_ID, kind: "exit_decision", exit_kind: "sell",
    expected_price_cents: 26500000, rationale: "The rehab is done and the market is strong.",
  };
  it("an unapproved call freezes as an ask and writes NOTHING — no decision, no update, no receipt", async () => {
    H.rows.rehabs = [{ ...rehabRow, status: "listed" }];
    const r = await executeTool(ASK_FIRST, { ...exitArgs }, org, { userId: "u-1", origin: "chat" });
    expect(r.success).toBe(true);
    expect((r.data as any)?.pendingApproval).toBe(true);
    expect((r.data as any)?.requiresApproval).toBe(true);
    expect(H.proposals).toHaveLength(1);
    expect(H.proposals[0]).toMatchObject({ organizationId: 7, toolName: "record_exit_facts" });
    expect(H.recordedDecisions).toHaveLength(0);
    expect(H.updates).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
  it("the trusted replay records the exit decision through the decision store, pack fix_and_flip, citing the latest scenario", async () => {
    H.rows.rehabs = [{ ...rehabRow, status: "listed" }];
    H.rows.scenarios = [scenarioRow];
    const r = await executeTool(ASK_FIRST, { ...exitArgs }, org, { userId: "u-1", trustedApproval: true, origin: "approval_replay" });
    expect(r.success).toBe(true);
    expect(r.data.decisionId).toBe(42);
    expect(r.data.message).toMatch(/as approved/);
    expect(H.recordedDecisions).toHaveLength(1);
    expect(H.recordedDecisions[0].orgId).toBe(7);
    expect(H.recordedDecisions[0].input).toMatchObject({ subjectType: "property", subjectId: 3, kind: "dispose", strategyPackId: "fix_and_flip", authority: "org_member:flip_exit" });
    expect(H.recordedDecisions[0].input.assumptions[0]).toMatchObject({ key: "exit_kind", value: "sell" });
  });
  it("the replay refuses an exit decision before listing, and a sell with no price", async () => {
    H.rows.rehabs = [rehabRow]; // status "finishes" — not yet listed
    const early = await executeTool(ASK_FIRST, { ...exitArgs }, org, { userId: "u-1", trustedApproval: true });
    expect(early.success).toBe(false);
    expect(early.refusal?.why).toMatch(/from the listing onward/);
    H.rows.rehabs = [{ ...rehabRow, status: "listed" }];
    const noPrice = await executeTool(ASK_FIRST, { ...exitArgs, expected_price_cents: undefined }, org, { userId: "u-1", trustedApproval: true });
    expect(noPrice.success).toBe(false);
    expect(H.recordedDecisions).toHaveLength(0);
  });
  it("the replay records realized facts ONCE on a closed rehab, via the write-once update", async () => {
    H.rows.rehabs = [{ ...rehabRow, status: "closed" }];
    H.updateRows = [{ ...rehabRow, status: "closed", realizedSalePriceCents: 26000000 }];
    const args = { rehab_id: REHAB_ID, kind: "realized", sale_price_cents: 26000000, selling_costs_cents: 1500000, closing_date: "2026-11-20" };
    const r = await executeTool(ASK_FIRST, args, org, { userId: "u-1", trustedApproval: true, origin: "approval_replay" });
    expect(r.success).toBe(true);
    expect(H.updates).toHaveLength(1);
    expect(H.updates[0].table).toBe("rehabs");
    expect(H.updates[0].values).toMatchObject({ realizedSalePriceCents: 26000000, realizedSellingCostsCents: 1500000, realizedClosingDate: "2026-11-20", realizedRecordedBy: "u-1" });
  });
  it("realized facts on a rehab that is not closed, or already recorded, are refused on the replay", async () => {
    H.rows.rehabs = [{ ...rehabRow, status: "listed" }];
    const args = { rehab_id: REHAB_ID, kind: "realized", sale_price_cents: 26000000, selling_costs_cents: 1500000, closing_date: "2026-11-20" };
    const open = await executeTool(ASK_FIRST, args, org, { userId: "u-1", trustedApproval: true });
    expect(open.success).toBe(false);
    H.rows.rehabs = [{ ...rehabRow, status: "closed", realizedRecordedAt: new Date("2026-11-21"), realizedSalePriceCents: 26000000, realizedSellingCostsCents: 1500000, realizedClosingDate: "2026-11-20" }];
    const again = await executeTool(ASK_FIRST, args, org, { userId: "u-1", trustedApproval: true });
    expect(again.success).toBe(false);
    expect(again.refusal?.why).toMatch(/already recorded/);
    expect(H.updates).toHaveLength(0);
  });
});
