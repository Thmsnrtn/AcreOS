/**
 * Lease / commercial Pax tool family (commercial promised bar item (c);
 * the shared lease base buy_and_hold, multifamily, mobile_home and STR
 * cross-credit).
 *
 * Proves: the four chat tools and the three support reads are registered in
 * every place the pattern registers a tool; the support reads dispatch to
 * the IDENTICAL shared helpers as the chat reads; the ONE write has NO
 * support variant (pinned absent, with the reason); every read states its
 * coverage and the org comes from the session; the CAM read discloses thin
 * coverage in plain words and never quotes a balance no statement supports;
 * the sales-report record change performs the sales-report route's own
 * insert (an amendment on re-report), is receipted once, refuses bad input
 * in plain words, and never posts a charge or sends anything (FD5).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";
import { PgDialect } from "drizzle-orm/pg-core";

const LEASE_ID = "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0f";
const H = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  wheres: [] as Array<{ table: string; cond: unknown }>,
  effects: [] as any[],
  inserted: [] as Array<{ table: string; values: any }>,
  conflicts: [] as any[],
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
      insert: (t: any) => { table = getTableName(t); return chain; },
      values: (v: any) => { H.inserted.push({ table, values: v }); return chain; },
      onConflictDoUpdate: (c: any) => { H.conflicts.push(c); return chain; },
      returning: async () => [{ id: "sr-1" }],
      transaction: async (fn: any) => fn(chain),
      then: (res: any, rej: any) => Promise.resolve(H.rows[table] ?? []).then(res, rej),
    };
    return chain;
  };
  return { db: make() };
});
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/services/paxReceipts", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordPaxEffect: vi.fn(async (e: any) => { H.effects.push(e); return { written: true }; }),
}));
vi.mock("../../server/utils/clock", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const now = () => new Date("2026-11-25T12:00:00Z");
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
vi.mock("../../server/middleware/roleScope", () => ({
  userHasScope: vi.fn(async () => true),
}));

import { executeTool, toolDefinitions, PAUSE_SAFE_TOOLS } from "../../server/ai/tools";
import { executeSupportTool, PAUSE_SAFE_SUPPORT_TOOLS, supportToolDefinitions } from "../../server/ai/supportAgent";
import { PAX_TOOL_GROUPS, groupForTool } from "../../shared/pax-controls";
import { CAPABILITY_ROWS } from "../../shared/pax-capabilities";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";

const READS = ["get_lease_abstract", "get_lease_rent_steps", "get_lease_cam_status"] as const;
const VIEWS = ["get_lease_abstract_view", "get_lease_rent_steps_view", "get_lease_cam_status_view"] as const;
const WRITE = "record_tenant_sales_report";
const org = { id: 7, name: "Org", ownerId: "u" } as any;
const supportOrg = { id: 7, isFounder: false } as never;

const leaseRow = {
  id: LEASE_ID, organizationId: 7, propertyId: 3, unitId: "unit-1", unitLabel: "Suite 200", status: "active",
  startDate: "2026-01-01", endDate: "2028-12-31", monthlyRentCents: 500000, rentDueDayOfMonth: 1,
  securityDepositCents: 500000, state: "TX",
  rentableSqft: 5000, leaseType: "nnn", camProRataBps: 1250, camEstimateMonthlyCents: 200000,
  camBaseYearStopCents: null, pctRentBps: 600, pctRentBreakpointType: "natural",
  pctRentArtificialBreakpointCents: null, pctRentFrequency: "annual",
  lateFeeType: "flat", lateFeeFlatCents: 25000, lateFeePctBps: null, lateFeeGraceDays: 10,
  lateFeeMaxCents: null, lateFeePerDayCents: null,
};
const bareLeaseRow = {
  ...leaseRow,
  rentableSqft: null, leaseType: null, camProRataBps: null, camEstimateMonthlyCents: null,
  pctRentBps: null, pctRentBreakpointType: null, pctRentFrequency: null,
  lateFeeType: null, lateFeeFlatCents: null, lateFeeGraceDays: null,
};
const stepRows = [
  { id: "s1", organizationId: 7, leaseId: LEASE_ID, effectiveMonth: "2027-01-01", stepType: "fixed_pct", amountCents: null, pctBps: 300, cpiIndexBase: null, cpiIndexCurrent: null, cpiIndexName: null, cpiIndexPublishedOn: null, floorPctBps: null, ceilingPctBps: null },
  { id: "s2", organizationId: 7, leaseId: LEASE_ID, effectiveMonth: "2028-01-01", stepType: "fixed_amount", amountCents: 545000, pctBps: null, cpiIndexBase: null, cpiIndexCurrent: null, cpiIndexName: null, cpiIndexPublishedOn: null, floorPctBps: null, ceilingPctBps: null },
];
const poolRows = [
  { id: "pool-1", organizationId: 7, propertyId: 3, poolKind: "cam", periodStart: "2026-01-01", periodEnd: "2026-12-31", recoverableCategories: ["landscaping", "snow_removal"], totalRentableSqft: 40000, adminFeeBps: null, grossUpPct: null, capNote: null, exclusionNote: null, status: "reconciling" },
];
const thinReconRows = [
  { id: "rec-1", organizationId: 7, poolId: "pool-1", leaseId: LEASE_ID, periodStart: "2026-01-01", periodEnd: "2026-12-31", proRataBpsUsed: 1250, proRataBasis: "lease_fixed", leasedSqftUsed: 5000, totalRentableSqftUsed: 40000, poolActualCents: 900000, byCategoryCents: null, recoverableShareCents: 112500, estimatedBilledCents: 70500, estimatedBilledBasis: "operator_stated", deltaCents: 42000, coverageMonths: 7, coverageComplete: false, statementMarkdown: null, statementVersion: null, generatedAt: new Date("2026-11-20T00:00:00Z"), generatedBy: null },
];

const src = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const params = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).params;

function resolverNames(): string[] {
  const text = src("server/ai/paxSupportResolver.ts");
  const start = text.indexOf("const RESOLVER_TOOL_NAMES = [");
  const end = text.indexOf("] as const;", start);
  expect(start, "RESOLVER_TOOL_NAMES not found").toBeGreaterThan(-1);
  return [...text.slice(start, end).matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
}
const PRIOR_RESOLVER_NAMES = [
  "search_knowledge_base", "search_resolved_tickets", "get_similar_resolutions",
  "get_troubleshooting_steps", "diagnose_account", "check_data_integrity",
  "get_account_summary", "query_user_data", "get_user_activity",
  "estimate_resolution_confidence", "recall_user_memory",
  "draft_customer_response", "escalate_to_human",
];

beforeEach(() => {
  H.rows = {}; H.wheres = []; H.effects = []; H.inserted = []; H.conflicts = [];
});

describe("registration — every place the pattern registers a tool", () => {
  it("defined, and reads are pause-safe while the record change is not", () => {
    for (const n of [...READS, WRITE]) expect(toolDefinitions[n], n).toBeDefined();
    for (const n of READS) expect(PAUSE_SAFE_TOOLS.has(n), n).toBe(true);
    expect(PAUSE_SAFE_TOOLS.has(WRITE), WRITE).toBe(false);
  });
  it("classified in the controls registry: reads look, the record change is a deals-rail change", () => {
    for (const n of READS) expect(groupForTool(n), n).toBe("looks_and_drafts");
    expect(groupForTool(WRITE), WRITE).toBe("changes_records");
    expect(PAX_TOOL_GROUPS[WRITE]).toBe("changes_records");
  });
  it("scoped: reads financial_read, the record change financial_write, finance door — no tenant-records scope anywhere in this family", () => {
    for (const n of READS) expect(INTENT_META[n], n).toEqual({ door: "finance", scope: "financial_read" });
    expect(INTENT_META[WRITE]).toEqual({ door: "finance", scope: "financial_write" });
  });
  it("grouped in the underwriting and documents bundles — in BOTH registries", () => {
    for (const [label, text] of [["tools.ts", src("server/ai/tools.ts")], ["appIntents/index.ts", src("server/services/appIntents/index.ts")]] as const) {
      for (const bundle of ["underwriting", "documents"]) {
        const lines = text.split("\n");
        const start = lines.findIndex((l) => l.trimStart().startsWith(`${bundle}: [`));
        expect(start, `${label}: ${bundle} bundle`).toBeGreaterThan(-1);
        let end = start;
        while (!/\],?$/.test(lines[end].trimEnd())) end++;
        const body = lines.slice(start, end + 1).join("\n");
        for (const n of [...READS, WRITE]) expect(body, `${label}: ${bundle} lacks ${n}`).toContain(`"${n}"`);
      }
    }
  });
  it("inventoried: chat rows and support rows carry the commercial family and the same not-covered sentence", () => {
    for (const n of READS) {
      expect(CAPABILITY_ROWS[n], n).toMatchObject({ dispatch: "executeTool", group: "looks_and_drafts", family: "commercial", pauseSafe: true, scope: "financial_read", coverage: "single_slice" });
    }
    expect(CAPABILITY_ROWS[WRITE]).toMatchObject({ dispatch: "executeTool", group: "changes_records", family: "commercial", pauseSafe: false, receipt: "own" });
    for (const n of VIEWS) {
      expect(CAPABILITY_ROWS[n], n).toMatchObject({ dispatch: "executeSupportTool", group: "looks_and_drafts", family: "commercial", pauseSafe: true });
      expect(CAPABILITY_ROWS[n].notCovered).toBe(CAPABILITY_ROWS[n.replace(/_view$/, "")].notCovered);
    }
  });
});

describe("support variants — from day one, identical helpers, write pinned absent", () => {
  it("the resolver subset is exactly the prior 13 + the three support reads, after get_account_summary", () => {
    expect(resolverNames()).toEqual([
      ...PRIOR_RESOLVER_NAMES.slice(0, 7),
      ...VIEWS,
      ...PRIOR_RESOLVER_NAMES.slice(7),
    ]);
  });
  it("every subset name resolves to a real support tool definition", () => {
    for (const n of resolverNames()) expect(supportToolDefinitions, n).toHaveProperty(n);
  });
  it("the three reads are registered everywhere the pattern registers a support tool", () => {
    for (const n of VIEWS) {
      expect(supportToolDefinitions[n], n).toBeDefined();
      expect(PAUSE_SAFE_SUPPORT_TOOLS.has(n), n).toBe(true);
      expect(groupForTool(n), n).toBe("looks_and_drafts");
    }
  });
  it("each support case dispatches to the IDENTICAL shared helper as its chat twin", () => {
    const supportSrc = stripComments(src("server/ai/supportAgent.ts"));
    const chatSrc = stripComments(src("server/ai/tools.ts"));
    for (const [view, helper] of [
      ["get_lease_abstract_view", "paxGetLeaseAbstract"],
      ["get_lease_rent_steps_view", "paxGetLeaseRentSteps"],
      ["get_lease_cam_status_view", "paxGetLeaseCamStatus"],
    ] as const) {
      expect(supportSrc, view).toContain(`case "${view}"`);
      expect(supportSrc, view).toContain(helper);
      expect(chatSrc, helper).toContain(helper);
    }
  });
  it("there is NO support variant of the write — recording stays off the support path", () => {
    // THE PIN, with its reason: the support switch's permission ladder runs
    // only for tools classified as side-effecting, and a sales-report write
    // belongs to the chat path's financial_write gate + receipt hook. A
    // support variant would either be ungated or misregistered — so the
    // write has no variant at all, and the resolver prompt promises none.
    const supportNames = Object.keys(supportToolDefinitions);
    expect(supportNames.filter((n) => n.includes("sales"))).toEqual([]);
    expect(supportNames).not.toContain(WRITE);
    expect(resolverNames()).not.toContain(WRITE);
    expect(PAUSE_SAFE_SUPPORT_TOOLS.has(WRITE)).toBe(false);
    expect(stripComments(src("server/ai/supportAgent.ts"))).not.toContain("paxRecordTenantSalesReport");
  });
  it("no read in this family needs a support exclusion: none shapes tenant PII (the module never reads the tenants table)", () => {
    const code = stripComments(src("server/ai/commercialLeaseTools.ts"));
    expect(code).not.toMatch(/from\(tenants\)|from\(leaseTenants\)|firstName|lastName|\.email|\.phone/);
  });
});

describe("FD5 + money fence — no send and no charge is reachable from Pax", () => {
  it("no lease-family tool name or description offers to send anything to a tenant", () => {
    for (const n of [...READS, WRITE]) expect(n).not.toMatch(/send|mail|notify|remind/i);
  });
  it("the tool module cannot reach a mail/SMS lane, a Stripe charge, or the rent-charge ledger", () => {
    const code = stripComments(src("server/ai/commercialLeaseTools.ts"));
    expect(code).not.toMatch(/emailService|smsService|mailLane|stripe\.|rentCharges|paymentIntents\.create|checkout\.sessions/);
  });
  it("the module performs no person-adjacent census read (no lead, skip-trace or parcel-owner surface)", () => {
    const code = stripComments(src("server/ai/commercialLeaseTools.ts"));
    expect(code).not.toMatch(/\.from\(\s*(leads|skipTraces|parcelSnapshots)\s*\)|ownerAddress|mailingAddress|skipTracingService\.trace\(/);
  });
});

describe("chat reads — terms, steps, per-square-foot, org pinning, plain-words refusals", () => {
  it("abstract: commercial terms as recorded, $/sqft from the shared engine, coverage stated, org is the session's", async () => {
    H.rows.rental_leases = [leaseRow];
    H.rows.lease_rent_schedule = stepRows;
    const r = await executeTool("get_lease_abstract", { lease_id: LEASE_ID, organization_id: 999 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/entered or imported into THIS account/);
    expect(r.data.hasCommercialTerms).toBe(true);
    expect(r.data.commercialTerms).toMatchObject({ rentableSqft: 5000, leaseType: "nnn", camProRataBps: 1250, pctRentBps: 600, lateFeeType: "flat" });
    expect(r.data.rentStepCount).toBe(2);
    // $5000/mo on 5,000 sqft = $12.00/sqft/yr base; + $2000/mo CAM estimate = $16.80/sqft/yr occupancy.
    expect(r.data.perSqft).toMatchObject({ baseRentPerSqftAnnualCents: 1200, occupancyCostPerSqftAnnualCents: 1680, occupancyCostBasis: "base_plus_cam_estimate", unavailable: false });
    expect(JSON.stringify(r.data)).not.toMatch(/firstName|lastName|email|phone/);
    for (const w of H.wheres) expect(params(w.cond)).toContain(7);
    expect(H.wheres.flatMap((w) => params(w.cond))).not.toContain(999);
  });

  it("abstract: a lease with no commercial terms recorded is reported as having none, and $/sqft is honestly unavailable", async () => {
    H.rows.rental_leases = [bareLeaseRow];
    H.rows.lease_rent_schedule = [];
    const r = await executeTool("get_lease_abstract", { lease_id: LEASE_ID }, org);
    expect(r.success).toBe(true);
    expect(r.data.hasCommercialTerms).toBe(false);
    expect(r.data.commercialTerms).toBeNull();
    expect(r.data.statement).toMatch(/No commercial terms are recorded for this lease/);
    expect(r.data.perSqft.unavailable).toBe(true);
    expect(r.data.perSqft.baseRentPerSqftAnnualCents).toBeNull();
  });

  it("rent steps: listed in effective order with their kinds; an empty schedule is stated, not escalated by invention", async () => {
    H.rows.rental_leases = [leaseRow];
    H.rows.lease_rent_schedule = stepRows;
    const r = await executeTool("get_lease_rent_steps", { lease_id: LEASE_ID }, org);
    expect(r.success).toBe(true);
    expect(r.data.stepCount).toBe(2);
    expect(r.data.steps[0]).toMatchObject({ effectiveMonth: "2027-01-01", stepType: "fixed_pct", pctBps: 300 });
    expect(r.data.steps[1]).toMatchObject({ effectiveMonth: "2028-01-01", stepType: "fixed_amount", amountCents: 545000 });

    H.rows.lease_rent_schedule = [];
    const none = await executeTool("get_lease_rent_steps", { lease_id: LEASE_ID }, org);
    expect(none.success).toBe(true);
    expect(none.data.statement).toMatch(/No rent steps are recorded for this lease/);
  });

  it("a unit label is refused as a lease id, not queried; another account's lease is refused — in plain words", async () => {
    const bad = await executeTool("get_lease_abstract", { lease_id: "Suite 200" }, org);
    expect(bad.success).toBe(false);
    expect(H.wheres).toHaveLength(0);
    H.rows.rental_leases = [];
    const none = await executeTool("get_lease_cam_status", { lease_id: LEASE_ID }, org);
    expect(none.success).toBe(false);
    expect(none.refusal?.what).toMatch(/No lease with that id/);
    expect(JSON.stringify(none.refusal)).not.toMatch(/get_lease|record_tenant|cam_status/);
  });
});

describe("CAM status — the coverage disclosure is the point", () => {
  it("thin coverage: a statement built on 7 months of expenses is disclosed as thin, in plain words", async () => {
    H.rows.rental_leases = [leaseRow];
    H.rows.cam_expense_pools = poolRows;
    H.rows.cam_reconciliations = thinReconRows;
    const r = await executeTool("get_lease_cam_status", { lease_id: LEASE_ID }, org);
    expect(r.success).toBe(true);
    expect(r.data.camTerms).toMatchObject({ leaseType: "nnn", camProRataBps: 1250, camEstimateMonthlyCents: 200000 });
    expect(r.data.pools).toHaveLength(1);
    expect(r.data.reconciliations[0]).toMatchObject({ coverageMonths: 7, coverageComplete: false, deltaCents: 42000, recoverableShareCents: 112500 });
    expect(r.data.coverageDisclosure).toMatch(/Thin coverage/);
    expect(r.data.coverageDisclosure).toMatch(/7 months of its period/);
    expect(r.data.coverage).toMatch(/the lease itself governs any dispute/);
  });

  it("full coverage: a statement covering every month says exactly that", async () => {
    H.rows.rental_leases = [leaseRow];
    H.rows.cam_expense_pools = poolRows;
    H.rows.cam_reconciliations = [{ ...thinReconRows[0], coverageMonths: 12, coverageComplete: true }];
    const r = await executeTool("get_lease_cam_status", { lease_id: LEASE_ID }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverageDisclosure).toMatch(/every month of its period/);
  });

  it("no statement: CAM status is terms and pools only — no balance is quoted", async () => {
    H.rows.rental_leases = [leaseRow];
    H.rows.cam_expense_pools = poolRows;
    H.rows.cam_reconciliations = [];
    const r = await executeTool("get_lease_cam_status", { lease_id: LEASE_ID }, org);
    expect(r.success).toBe(true);
    expect(r.data.reconciliations).toEqual([]);
    expect(r.data.coverageDisclosure).toMatch(/No CAM statement has been generated for this lease/);
    expect(r.data.coverageDisclosure).toMatch(/do not quote a CAM balance/);
  });
});

describe("the support switch runs the same reads (real executeSupportTool legs)", () => {
  it("abstract view: the recorded commercial terms come back through the support switch", async () => {
    H.rows.rental_leases = [leaseRow];
    H.rows.lease_rent_schedule = stepRows;
    const r = await executeSupportTool("get_lease_abstract_view", { lease_id: LEASE_ID }, supportOrg);
    expect(r.success).toBe(true);
    expect(r.data.commercialTerms).toMatchObject({ leaseType: "nnn", camProRataBps: 1250 });
    expect(r.data.coverage).toMatch(/entered or imported into THIS account/);
  });

  it("CAM view: the thin-coverage disclosure survives the support path verbatim", async () => {
    H.rows.rental_leases = [leaseRow];
    H.rows.cam_expense_pools = poolRows;
    H.rows.cam_reconciliations = thinReconRows;
    const r = await executeSupportTool("get_lease_cam_status_view", { lease_id: LEASE_ID }, supportOrg);
    expect(r.success).toBe(true);
    expect(r.data.coverageDisclosure).toMatch(/Thin coverage/);
    expect(r.data.coverageDisclosure).toMatch(/7 months of its period/);
  });

  it("steps view: a unit label is refused in plain words on the support path too", async () => {
    const bad = await executeSupportTool("get_lease_rent_steps_view", { lease_id: "Suite 200" }, supportOrg);
    expect(bad.success).toBe(false);
    expect(JSON.stringify((bad as any).refusal ?? bad)).not.toMatch(/get_lease|rent_steps_view/);
    expect(H.wheres).toHaveLength(0);
  });
});

describe("record change — the sales-report route's own insert, receipted, record-only", () => {
  const good = { lease_id: LEASE_ID, period_start: "2026-10-01", period_end: "2026-10-31", gross_sales_cents: 12500000, report_source: "tenant_statement" };
  it("records a new report for the SESSION org and writes ONE receipt; no charge is posted", async () => {
    H.rows.rental_leases = [leaseRow];
    H.rows.commercial_sales_reports = [];
    const r = await executeTool(WRITE, { ...good, organization_id: 999 }, org, { userId: "u-1", origin: "chat" });
    expect(r.success).toBe(true);
    expect(r.data.amended).toBe(false);
    expect(r.data.message).toMatch(/posted no charge/);
    expect(H.inserted).toHaveLength(1);
    expect(H.inserted[0].table).toBe("commercial_sales_reports");
    expect(H.inserted[0].values).toMatchObject({ organizationId: 7, leaseId: LEASE_ID, periodStart: "2026-10-01", periodEnd: "2026-10-31", grossSalesCents: 12500000, reportSource: "tenant_statement" });
    expect(H.inserted[0].values.organizationId).not.toBe(999);
    expect(H.effects).toHaveLength(1);
    expect(H.effects[0]).toMatchObject({ orgId: 7, tool: WRITE, actor: "pax" });
  });

  it("re-reporting the same period amends it — the conflict update marks it an amendment, as the route does", async () => {
    H.rows.rental_leases = [leaseRow];
    H.rows.commercial_sales_reports = [{ id: "sr-0", organizationId: 7, leaseId: LEASE_ID, periodStart: "2026-10-01", periodEnd: "2026-10-31", grossSalesCents: 11000000 }];
    const r = await executeTool(WRITE, { lease_id: LEASE_ID, period_start: "2026-10-01", period_end: "2026-10-31", gross_sales_cents: 12500000 }, org, { userId: "u-1", origin: "chat" });
    expect(r.success).toBe(true);
    expect(r.data.amended).toBe(true);
    expect(H.conflicts).toHaveLength(1);
    expect(H.conflicts[0].set).toMatchObject({ grossSalesCents: 12500000, reportSource: "amended" });
    expect(H.effects).toHaveLength(1);
    expect(H.effects[0].description).toMatch(/Amended the tenant sales report/);
  });

  it("refuses a backwards period, a negative figure and a non-date — nothing written, no receipt, plain words", async () => {
    H.rows.rental_leases = [leaseRow];
    for (const badArgs of [
      { ...good, period_end: "2026-09-30" },
      { ...good, gross_sales_cents: -1 },
      { ...good, period_start: "October" },
      { ...good, period_start: "2026-02-30" },
    ]) {
      const r = await executeTool(WRITE, badArgs, org, { userId: "u-1" });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.refusal)).not.toMatch(/record_tenant|sales_report/);
    }
    expect(H.inserted).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });

  it("another account's lease: refused before any insert", async () => {
    H.rows.rental_leases = [];
    const r = await executeTool(WRITE, good, org, { userId: "u-1" });
    expect(r.success).toBe(false);
    expect(H.inserted).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
});
