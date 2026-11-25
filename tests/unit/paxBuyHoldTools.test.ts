/**
 * Buy-and-hold Pax tool family (promised bar item (c)).
 *
 * Proves: the seven tools are registered in every place the pattern
 * registers a tool; every read states its coverage; the org comes from the
 * session and is in the WHERE of every query; tenant PII appears ONLY in
 * get_tenants, which is held to the tenant_pii_read PII scope, and even it
 * never shapes screening/DOB/ID fields; the rent roll counts a never-leased
 * unit as vacant and an empty roll as empty; the two record changes go
 * through the existing service writers, refuse future dates, write one
 * receipt each, and never charge or send anything (money fence + FD5).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";
import { PgDialect } from "drizzle-orm/pg-core";

const LEASE_ID = "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0f";
const TENANT_ID = "7f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0f";
const H = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  wheres: [] as Array<{ table: string; cond: unknown }>,
  effects: [] as any[],
  paymentInputs: [] as any[],
  generateInputs: [] as any[],
  emits: [] as string[],
  scopeAllowed: true,
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
      transaction: async (fn: any) => fn(chain),
      then: (res: any, rej: any) => Promise.resolve(H.rows[table] ?? []).then(res, rej),
    };
    return chain;
  };
  return { db: make() };
});
vi.mock("../../server/services/paxReceipts", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordPaxEffect: vi.fn(async (e: any) => { H.effects.push(e); return { written: true }; }),
}));
vi.mock("../../server/services/rental/paymentPosting", () => ({
  PartialPaymentUnderNoticeError: class extends Error {
    code = "PARTIAL_PAYMENT_VOIDS_NOTICE";
    chargeId = "c1"; chargedForMonth = "2026-01-01"; balanceAfterCents = 1;
  },
  recordRentPayment: vi.fn(async (_tx: unknown, input: any) => {
    H.paymentInputs.push(input);
    return {
      payment: { id: "pay-1" },
      allocation: { appliedCents: input.amountCents, unappliedCents: 0, allocations: [{ chargeId: "c1" }], explanation: "stub", orderRule: "stub" },
      charges: [{ chargeId: "c1", chargedForMonth: "2026-01-01", dueDate: "2026-01-01", paidCents: input.amountCents, balanceCents: 0, legalPosture: "ok", clearedByThisPayment: true }],
      firstCharge: { chargeId: "c1", chargedForMonth: "2026-01-01", dueDate: "2026-01-01", paidCents: input.amountCents, balanceCents: 0, legalPosture: "ok", clearedByThisPayment: true },
      firstChargeAmountCents: input.amountCents,
      isPartial: false,
    };
  }),
}));
vi.mock("../../server/services/rental/rentChargeGenerator", () => ({
  generateScheduledCharges: vi.fn(async (input: any) => {
    H.generateInputs.push(input);
    return { leasesConsidered: 1, inserted: 2, skippedDuplicate: 0, skippedPartialPeriods: [], insertedTotalCents: 300000 };
  }),
}));
vi.mock("../../server/services/rentalEvents", () => ({
  emitRentPaymentReceived: vi.fn(() => { H.emits.push("payment.received"); }),
  emitRentReceived: vi.fn(() => { H.emits.push("rent.received"); }),
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
vi.mock("../../server/middleware/roleScope", () => ({
  userHasScope: vi.fn(async () => H.scopeAllowed),
}));

import { executeTool, toolDefinitions, PAUSE_SAFE_TOOLS } from "../../server/ai/tools";
import { PAX_TOOL_GROUPS, groupForTool } from "../../shared/pax-controls";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";

const READS = ["get_rent_roll", "get_rental_leases", "get_tenants", "get_lease_ledger", "get_rental_underwriting_decision"] as const;
const WRITES = ["record_rent_payment", "generate_scheduled_rent_charges"] as const;
const org = { id: 7, name: "Org", ownerId: "u" } as any;
const leaseRow = {
  id: LEASE_ID, organizationId: 7, propertyId: 3, unitId: "unit-1", unitLabel: "3B", status: "active",
  startDate: "2026-01-01", endDate: null, monthlyRentCents: 150000, rentDueDayOfMonth: 1,
  securityDepositCents: 150000, state: "TX",
};
const src = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const params = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).params;

beforeEach(() => {
  H.rows = {}; H.wheres = []; H.effects = []; H.paymentInputs = []; H.generateInputs = []; H.emits = [];
  H.scopeAllowed = true;
});

describe("registration — every place the pattern registers a tool", () => {
  it("defined, and reads are pause-safe while the record changes are not", () => {
    for (const n of [...READS, ...WRITES]) expect(toolDefinitions[n], n).toBeDefined();
    for (const n of READS) expect(PAUSE_SAFE_TOOLS.has(n), n).toBe(true);
    for (const n of WRITES) expect(PAUSE_SAFE_TOOLS.has(n), n).toBe(false);
  });
  it("classified in the controls registry: reads look, the record changes are deals-rail changes", () => {
    for (const n of READS) expect(groupForTool(n), n).toBe("looks_and_drafts");
    for (const n of WRITES) {
      expect(groupForTool(n), n).toBe("changes_records");
      expect(PAX_TOOL_GROUPS[n]).toBe("changes_records");
    }
  });
  it("scoped: tenant list needs tenant_pii_read, other reads financial_read, writes financial_write, finance door", () => {
    expect(INTENT_META["get_tenants"]).toEqual({ door: "finance", scope: "tenant_pii_read" });
    for (const n of READS.filter((x) => x !== "get_tenants")) {
      expect(INTENT_META[n], n).toEqual({ door: "finance", scope: "financial_read" });
    }
    for (const n of WRITES) expect(INTENT_META[n], n).toEqual({ door: "finance", scope: "financial_write" });
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
        for (const n of [...READS, ...WRITES]) expect(body, `${label}: ${bundle} lacks ${n}`).toContain(`"${n}"`);
      }
    }
  });
});

describe("FD5 + money fence — no send and no charge is reachable from Pax", () => {
  it("no buy-and-hold tool name or description offers to send anything to a tenant", () => {
    for (const n of [...READS, ...WRITES]) expect(n).not.toMatch(/send|mail|notify|remind/i);
    expect(Object.keys(toolDefinitions).filter((n) => /(tenant|rent).*(send|notice|remind)|send.*(tenant|rent)/i.test(n))).toEqual([]);
  });
  it("the tool module cannot reach a mail/SMS lane, a Stripe charge, or the rent-collection session builder", () => {
    const code = stripComments(src("server/ai/buyHoldTools.ts"));
    expect(code).not.toMatch(/emailService|smsService|mailLane|stripe\.|createRentCheckout|checkout\.sessions|paymentIntents\.create/);
  });
});

describe("reads — coverage, org pinning, PII discipline", () => {
  it("rent roll: a never-leased unit counts as vacant; coverage names entered/imported only; org is the session's", async () => {
    H.rows.rental_units = [
      { id: "unit-1", organizationId: 7, propertyId: 3, label: "3B", kind: "unit", status: "active", marketRentCents: 155000 },
      { id: "unit-2", organizationId: 7, propertyId: 3, label: "3C", kind: "unit", status: "active", marketRentCents: 140000 },
    ];
    H.rows.rental_leases = [leaseRow];
    H.rows.rent_charges = [
      { id: "c1", organizationId: 7, leaseId: LEASE_ID, chargedForMonth: "2026-11-01", dueDate: "2026-11-01", amountCents: 150000, lateFeeCents: 0, paidCents: 0, balanceCents: 150000, chargeType: "base_rent", legalPosture: "late", legalPostureAt: null },
    ];
    H.rows.properties = [{ id: 3, organizationId: 7, address: "12 Oak St" }];
    const r = await executeTool("get_rent_roll", { organization_id: 999 }, org);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toMatch(/entered or imported into THIS account/);
    expect(r.data.occupancy).toMatchObject({ rentableUnits: 2, occupiedUnits: 1, vacantUnits: 1, occupancyPct: 50 });
    expect(r.data.totalOverdueCents).toBe(150000);
    expect(JSON.stringify(r.data)).not.toMatch(/firstName|email|phone/);
    for (const w of H.wheres) expect(params(w.cond)).toContain(7);
    expect(H.wheres.flatMap((w) => params(w.cond))).not.toContain(999);
  });

  it("rent roll: an empty account reads as empty, never as fully occupied or paid", async () => {
    const r = await executeTool("get_rent_roll", {}, org);
    expect(r.success).toBe(true);
    expect(r.data.occupancy).toMatchObject({ rentableUnits: 0, occupiedUnits: 0, occupancyPct: null });
    expect(r.data.coverage).toMatch(/never as fully paid/);
  });

  it("tenants: identity/contact only — no DOB, ID fragment or screening fields are shaped", async () => {
    H.rows.tenants = [{
      id: TENANT_ID, organizationId: 7, firstName: "Ada", lastName: "Reyes", isEntity: false, companyName: null,
      email: "ada@example.test", phone: "555-0100", status: "current", smsConsent: false,
      dateOfBirth: "1990-01-01", governmentIdLast4: "1234", screeningCreditScore: 612,
      screeningHasPriorEviction: true, screeningHasCriminalRecord: false,
    }];
    const r = await executeTool("get_tenants", {}, org, { userId: "u-1" });
    expect(r.success).toBe(true);
    expect(r.data.tenants[0]).toMatchObject({ displayName: "Ada Reyes", email: "ada@example.test", status: "current" });
    const flat = JSON.stringify(r.data.tenants[0]);
    expect(flat).not.toMatch(/1990-01-01|governmentId|screeningCreditScore|612/);
    expect(flat).not.toContain("1234");
  });

  it("tenants: a caller without tenant_pii_read is refused by the PII scope gate, even unidentified", async () => {
    H.scopeAllowed = false;
    const identified = await executeTool("get_tenants", {}, org, { userId: "u-va" });
    expect(identified.success).toBe(false);
    expect((identified as any).requiredScope).toBe("tenant_pii_read");
    const anonymous = await executeTool("get_tenants", {}, org);
    expect(anonymous.success).toBe(false);
    expect((anonymous as any).requiredScope).toBe("tenant_pii_read");
    expect(H.wheres).toHaveLength(0);
  });

  it("leases list carries no tenant PII; ledger shows charges, payments, allocations and late posture", async () => {
    H.rows.rental_leases = [leaseRow];
    const list = await executeTool("get_rental_leases", {}, org);
    expect(list.success).toBe(true);
    expect(JSON.stringify(list.data)).not.toMatch(/firstName|email|phone/);

    H.rows.rent_charges = [
      { id: "c1", organizationId: 7, leaseId: LEASE_ID, chargedForMonth: "2026-11-01", dueDate: "2026-11-01", amountCents: 150000, lateFeeCents: 5000, paidCents: 50000, balanceCents: 105000, chargeType: "base_rent", legalPosture: "late", legalPostureAt: null },
    ];
    H.rows.rent_payments = [
      { id: "pay-1", organizationId: 7, leaseId: LEASE_ID, amountCents: 50000, receivedAt: "2026-11-10", method: "ach", payorType: "tenant", isPartial: true, allocatedCents: 50000, unappliedCents: 0 },
    ];
    H.rows.rent_payment_allocations = [
      { paymentId: "pay-1", rentChargeId: "c1", leaseId: LEASE_ID, sequence: 1, appliedCents: 50000, appliedToRentCents: 45000, appliedToLateFeeCents: 5000, balanceAfterCents: 105000 },
    ];
    const ledger = await executeTool("get_lease_ledger", { lease_id: LEASE_ID }, org);
    expect(ledger.success).toBe(true);
    expect(ledger.data.totals).toMatchObject({ openBalanceCents: 105000, overdueCents: 105000 });
    expect(ledger.data.charges[0].legalPosture).toBe("late");
    expect(ledger.data.allocations[0].appliedToLateFeeCents).toBe(5000);
    for (const w of H.wheres) expect(params(w.cond)).toContain(7);
  });

  it("a unit label is refused as a lease id, not queried; another account's lease is refused", async () => {
    const bad = await executeTool("get_lease_ledger", { lease_id: "3B" }, org);
    expect(bad.success).toBe(false);
    expect(H.wheres).toHaveLength(0);
    H.rows.rental_leases = [];
    const none = await executeTool("get_lease_ledger", { lease_id: LEASE_ID }, org);
    expect(none.success).toBe(false);
    expect(none.refusal?.what).toMatch(/No lease with that id/);
  });

  it("underwriting decision: the frozen rental_acquisition prediction is returned; absence is stated, not reconstructed", async () => {
    H.rows.decision_snapshots = [{
      id: 9, organizationId: 7, subjectType: "property", subjectId: 3, strategyPackId: "buy_and_hold",
      kind: "acquire", choice: "acquire", rationale: "Numbers work", decidedAt: new Date("2026-11-01"), reviewDueAt: new Date("2026-11-15"),
      scenarios: [{ scenarioId: 1, label: "BH", engineId: "rental_acquisition", engineVersion: "1", predicted: [{ key: "cap_rate", value: 0.07 }] }],
    }];
    const r = await executeTool("get_rental_underwriting_decision", { property_id: 3 }, org);
    expect(r.success).toBe(true);
    expect(r.data.decision.choice).toBe("acquire");
    expect(r.data.decision.scenario.predicted[0]).toMatchObject({ key: "cap_rate" });
    expect(params(H.wheres.at(-1)!.cond)).toContain("buy_and_hold");

    H.rows.decision_snapshots = [];
    const none = await executeTool("get_rental_underwriting_decision", { property_id: 3 }, org);
    expect(none.success).toBe(true);
    expect(none.data.decision).toBeNull();
    expect(none.data.statement).toMatch(/No buy-and-hold underwriting decision is recorded/);
  });
});

describe("record changes — through the existing writers, receipted, record-only", () => {
  const good = { lease_id: LEASE_ID, amount_cents: 150000, received_at: "2026-11-10", method: "ach" };
  it("record_rent_payment posts through paymentPosting for the SESSION org and writes ONE receipt", async () => {
    H.rows.rental_leases = [leaseRow];
    const r = await executeTool("record_rent_payment", { ...good, organization_id: 999 }, org, { userId: "u-1", origin: "chat" });
    expect(r.success).toBe(true);
    expect(r.data.message).toMatch(/AcreOS charged nothing and holds nothing/);
    expect(H.paymentInputs).toHaveLength(1);
    expect(H.paymentInputs[0]).toMatchObject({ organizationId: 7, leaseId: LEASE_ID, amountCents: 150000 });
    expect("stripePaymentIntentId" in H.paymentInputs[0]).toBe(false);
    expect(H.paymentInputs[0].organizationId).not.toBe(999);
    expect(H.emits).toEqual(["payment.received", "rent.received"]);
    expect(H.effects).toHaveLength(1);
    expect(H.effects[0]).toMatchObject({ orgId: 7, tool: "record_rent_payment", actor: "pax" });
  });
  it("record_rent_payment refuses a future date and a non-positive amount — nothing written, no receipt", async () => {
    H.rows.rental_leases = [leaseRow];
    for (const bad of [{ ...good, received_at: "2026-12-31" }, { ...good, amount_cents: 0 }, { ...good, amount_cents: -5 }]) {
      const r = await executeTool("record_rent_payment", bad, org, { userId: "u-1" });
      expect(r.success).toBe(false);
    }
    expect(H.paymentInputs).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
  it("generate_scheduled_rent_charges goes through the one generator and writes ONE receipt", async () => {
    H.rows.rental_leases = [leaseRow];
    const r = await executeTool("generate_scheduled_rent_charges", { lease_id: LEASE_ID, through_date: "2026-12-01" }, org, { userId: "u-1", origin: "chat" });
    expect(r.success).toBe(true);
    expect(r.data.inserted).toBe(2);
    expect(r.data.message).toMatch(/no tenant was contacted/);
    expect(H.generateInputs[0]).toMatchObject({ organizationId: 7, leaseId: LEASE_ID, throughDate: "2026-12-01" });
    expect(H.effects).toHaveLength(1);
    expect(H.effects[0]).toMatchObject({ orgId: 7, tool: "generate_scheduled_rent_charges" });
  });
  it("generate for another account's lease: refused, generator never called", async () => {
    H.rows.rental_leases = [];
    const r = await executeTool("generate_scheduled_rent_charges", { lease_id: LEASE_ID }, org, { userId: "u-1" });
    expect(r.success).toBe(false);
    expect(H.generateInputs).toHaveLength(0);
    expect(H.effects).toHaveLength(0);
  });
});
