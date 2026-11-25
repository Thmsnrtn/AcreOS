/**
 * Buy-and-Hold BH — the support drill set, deterministic legs (drills 1, 2,
 * 4, 5 and drill 3 as closed by the BH-DEF-1 cure).
 *
 * The BH record (docs/evidence/2026-11-24/buy-hold-support-drills.md) drills
 * the scenarios the buy_and_hold gap sheet names for bar item (e). This file
 * pins every leg that can be pinned without a live LLM or a database,
 * through the REAL service functions the product itself calls — the same
 * allocation rule the one payment writer uses, the real money-routing
 * resolver (through its designed injectable-deps seam), the real late-fee
 * proposal/netting rule — never a mock of them:
 *
 *   Drill 1 (money moment): a payment allocates oldest-charge-first, rent
 *   before late fees, through `allocatePayment` — the exact pure rule
 *   `recordRentPayment` (server/services/rental/paymentPosting.ts) calls
 *   inside its transaction. A partial $500 against $1,500 rent + a $50 late
 *   fee leaves $1,050 open, all of it rent; an overpayment is an explicit
 *   unapplied credit, never clamped away. And the Pax writer's call into
 *   that one writer is FIELD-FOR-FIELD the REST route's call
 *   (POST /api/leases/:id/payments) — same keys, same writer, so a payment
 *   recorded by Pax and a payment recorded on the page land identically.
 *
 *   Drill 2 (stuck moment): `resolveOrgCardProcessor` refuses in plain
 *   words — no connected account, charges not enabled
 *   (`processor_charges_disabled`), card capability inactive — and there is
 *   NO platform fallback in any refusal: the only `ok` carries the
 *   landlord's OWN connected account id.
 *
 *   Drill 3 ("Pax told me X"): CLOSED by the BH-DEF-1 cure. The seven #737
 *   buy-and-hold tools ARE registered on the chat path (proven by
 *   paxBuyHoldTools.test.ts); the cure adds support-only variants of the
 *   four non-PII READS (the registries key one dispatch per name, and the
 *   chat names already dispatch through the chat executor) and pins the
 *   resolver subset at the prior 13 generic tools + exactly those four.
 *   The two writes (record_rent_payment, generate_scheduled_rent_charges)
 *   have NO support variant — the support path stays read-only. And
 *   get_tenants has NO support variant either, deliberately: its
 *   tenant_pii_read fence cannot be carried onto the support path without
 *   weakening it (the full reason is pinned in drill 3's block below), so
 *   tenant PII stays chat-path-only behind the ladder. The resolver leg
 *   itself (mocked model, real resolver gate) lives in
 *   buyHoldSupportDrillsResolver.test.ts; the real-switch legs for the
 *   four reads live below.
 *
 *   Drill 4 (the PII fence): tenant identity/contact is shaped ONLY by
 *   `paxGetTenants`, whose intent scope is `tenant_pii_read`; every other
 *   tool in the family is shaped without tenant names, emails or phones,
 *   and even `paxGetTenants` never shapes date of birth, government-id or
 *   screening fields.
 *
 *   Drill 5 (data-wrong): (a) a late fee never stacks past the rule's
 *   total — the real proposal + netting rule the rent-ledger route uses;
 *   (b) an empty rent roll reads as empty: occupancy percentage is null
 *   when there are no rentable units, and the coverage words say an empty
 *   roll is never reported as fully paid or fully occupied.
 *
 * Fixtures are synthetic (unit labels `BH-*`, the P3-3 walk's own amounts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";
import {
  ALLOCATION_ORDER_RULE,
  allocatePayment,
  assertAllocationBalances,
  type OpenChargeForAllocation,
} from "@shared/rental/paymentAllocation";
import { PartialPaymentUnderNoticeError } from "../../server/services/rental/paymentPosting";
import {
  resolveOrgCardProcessor,
  type CustomerMoneyRoutingDeps,
} from "../../server/services/customerMoneyRouting";
import { netOfLateFeesAlreadyCharged, proposeLateFee, type LateFeeRuleData } from "@shared/rental/lateFeeProposal";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";

const root = resolve(__dirname, "../..");
const read = (p: string) => stripComments(readFileSync(resolve(root, p), "utf8"));

// ── Drill 1 — money moment ─────────────────────────────────────────────────

const charge = (over: Partial<OpenChargeForAllocation> = {}): OpenChargeForAllocation => ({
  id: "BH-C1",
  chargedForMonth: "2026-11-01",
  dueDate: "2026-11-01",
  amountCents: 150_000,
  lateFeeCents: 5_000,
  paidCents: 0,
  balanceCents: 155_000,
  ...over,
});

describe("BH drill 1 — a partial payment leaves the rest open, rent first (the walk's Leg 7 shape)", () => {
  const r = allocatePayment(50_000, [charge()]);

  it("applies the whole $500 to rent and leaves $1,050 open — nothing vanishes, nothing is invented", () => {
    expect(r.appliedCents).toBe(50_000);
    expect(r.unappliedCents).toBe(0);
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0]).toMatchObject({
      appliedToRentCents: 50_000,
      appliedToLateFeeCents: 0,
      balanceAfterCents: 105_000,
    });
    expect(() => assertAllocationBalances(50_000, r)).not.toThrow();
  });

  it("the explanation answers 'where did the money go' in words, with the remainder named", () => {
    expect(r.explanation).toMatch(/\$500\.00 applied oldest-charge-first, rent before late fees/);
    expect(r.explanation).toMatch(/\$1,050\.00 left/);
  });

  it("a full payment clears rent AND fee, in that order, to a zero balance", () => {
    const full = allocatePayment(155_000, [charge()]);
    expect(full.allocations[0]).toMatchObject({
      appliedToRentCents: 150_000,
      appliedToLateFeeCents: 5_000,
      balanceAfterCents: 0,
    });
    expect(full.unappliedCents).toBe(0);
  });
});

describe("BH drill 1 — oldest charge first across months; overpayment is a credit, never clamped", () => {
  const oct = charge({ id: "BH-C0", chargedForMonth: "2026-10-01", dueDate: "2026-10-01", lateFeeCents: 0, balanceCents: 150_000 });
  const nov = charge();

  it("a $1,600 payment clears October before touching November (input order does not matter)", () => {
    const r = allocatePayment(160_000, [nov, oct]);
    expect(r.orderRule).toBe(ALLOCATION_ORDER_RULE);
    expect(r.allocations.map((a) => a.chargeId)).toEqual(["BH-C0", "BH-C1"]);
    expect(r.allocations[0]).toMatchObject({ appliedCents: 150_000, balanceAfterCents: 0 });
    expect(r.allocations[1]).toMatchObject({ appliedToRentCents: 10_000, balanceAfterCents: 145_000 });
    expect(() => assertAllocationBalances(160_000, r)).not.toThrow();
  });

  it("money past every open charge is held as an unapplied credit, in words — the old max(0,…) swallow is gone", () => {
    const r = allocatePayment(200_000, [charge({ lateFeeCents: 0, balanceCents: 150_000 })]);
    expect(r.appliedCents).toBe(150_000);
    expect(r.unappliedCents).toBe(50_000);
    expect(r.explanation).toMatch(/\$500\.00 held as an unapplied credit/);
  });

  it("a non-integer cent amount is refused before it can reach a ledger", () => {
    expect(() => allocatePayment(100.5, [charge()])).toThrow(RangeError);
  });
});

describe("BH drill 1 — the Pax payment call is field-for-field the REST route's call into the one writer", () => {
  const callKeys = (src: string): string[] => {
    const start = src.indexOf("recordRentPayment(tx, {");
    expect(start, "recordRentPayment(tx, { call not found — re-point the pin, do not delete it").toBeGreaterThan(-1);
    const lines = src.slice(start).split("\n").slice(1);
    const keys: string[] = [];
    for (const line of lines) {
      if (/^\s*\}/.test(line)) break;
      const m = line.match(/^\s+(\w+)\s*[:,]/);
      if (m) keys.push(m[1]);
    }
    return keys.sort();
  };

  it("buyHoldTools.ts and routes-rent-ledger.ts pass the identical field set to recordRentPayment", () => {
    const paxKeys = callKeys(read("server/ai/buyHoldTools.ts"));
    const restKeys = callKeys(read("server/routes-rent-ledger.ts"));
    expect(paxKeys).toEqual(restKeys);
    expect(paxKeys).toEqual([
      "acceptedDespitePartial",
      "amountCents",
      "leaseId",
      "method",
      "notes",
      "operationKey",
      "organizationId",
      "payorTenantId",
      "payorType",
      "receivedAt",
      "referenceNumber",
    ]);
  });

  it("a partial payment that would void a notice to vacate refuses with the shortfall named in cents", () => {
    const err = new PartialPaymentUnderNoticeError({
      chargeId: "BH-C1",
      chargedForMonth: "2026-11-01",
      balanceAfterCents: 70_000,
    });
    expect(err.code).toBe("PARTIAL_PAYMENT_VOIDS_NOTICE");
    expect(err.message).toMatch(/leaves the 2026-11 charge short by 70000 cents/);
    expect(err.message).toMatch(/notice to vacate/);
  });
});

// ── Drill 2 — stuck moment: no usable processor on the landlord's own account ──

describe("BH drill 2 — rent collection refuses in plain words, with no platform fallback", () => {
  const deps = (over: Partial<CustomerMoneyRoutingDeps> = {}): CustomerMoneyRoutingDeps => ({
    getConnectedAccountId: async () => "acct_SYNTHETIC_LANDLORD",
    getAccountStatus: async () => ({ chargesEnabled: true, cardPayments: "active" }),
    isSimulated: () => false,
    ...over,
  });

  it("the healthy path resolves ONLY to the landlord's own connected account", async () => {
    const r = await resolveOrgCardProcessor(7, deps());
    expect(r).toEqual({ ok: true, processor: { accountId: "acct_SYNTHETIC_LANDLORD" } });
  });

  it("no connected account → processor_not_connected, and the operator words say AcreOS never collects into its own account", async () => {
    const r = await resolveOrgCardProcessor(7, deps({ getConnectedAccountId: async () => null }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("processor_not_connected");
      expect(r.operatorMessage).toMatch(/AcreOS never collects your customers' payments into its own account/);
      expect(r.borrowerMessage).toMatch(/No card was charged/);
    }
  });

  it("Stripe onboarding unfinished → processor_charges_disabled (the gap sheet's stuck moment, typed)", async () => {
    const r = await resolveOrgCardProcessor(7, deps({ getAccountStatus: async () => ({ chargesEnabled: false, cardPayments: "pending" }) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("processor_charges_disabled");
      expect(r.operatorMessage).toMatch(/isn't cleared to take charges yet/);
      expect(r.borrowerMessage).toMatch(/No card was charged/);
    }
  });

  it("charges enabled but card capability not active → card_capability_inactive, naming the state", async () => {
    const r = await resolveOrgCardProcessor(7, deps({ getAccountStatus: async () => ({ chargesEnabled: true, cardPayments: "pending" }) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("card_capability_inactive");
      expect(r.operatorMessage).toMatch(/capability state: pending/);
    }
  });

  it("a status check that throws refuses as processor_check_failed — a broken check is a refusal, not a charge", async () => {
    const r = await resolveOrgCardProcessor(7, deps({
      getAccountStatus: async () => { throw new Error("stripe down"); },
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("processor_check_failed");
  });
});

// ── Drill 3 — "Pax told me X": BH-DEF-1 cured — the support reads ─────────
//
// Drill 3's real-switch legs run the REAL executeSupportTool switch and the
// REAL #737 read helpers underneath it. Only the data source is mocked:
// `db` (rental rows, the paxBuyHoldTools.test.ts pattern, with the clock
// pinned to 2026-11-23 so the November charge is overdue) and `storage`
// (the tax drills' seam — the switch's module graph loads it, no leg here
// reaches it).
const BH_LEASE_ID = "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e";
const BH = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  wheres: [] as Array<{ table: string; cond: unknown }>,
}));
vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const make = () => {
    let table = "";
    const chain: any = {
      select: () => chain,
      from: (t: any) => { table = getTableName(t); return chain; },
      where: (c: unknown) => { BH.wheres.push({ table, cond: c }); return chain; },
      orderBy: () => chain,
      limit: () => chain,
      then: (res: any, rej: any) => Promise.resolve(BH.rows[table] ?? []).then(res, rej),
    };
    return chain;
  };
  return { db: make() };
});
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/utils/clock", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const now = () => new Date("2026-11-23T12:00:00Z");
  return { ...actual, clock: { ...actual.clock, now, nowMs: () => now().getTime() } };
});

import { executeSupportTool, PAUSE_SAFE_SUPPORT_TOOLS, supportToolDefinitions } from "../../server/ai/supportAgent";
import { groupForTool } from "@shared/pax-controls";
import { CAPABILITY_ROWS } from "@shared/pax-capabilities";
import { PgDialect } from "drizzle-orm/pg-core";

const SUPPORT_ORG = { id: 77, isFounder: false } as never;
const bhParams = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).params;
const bhLeaseRow = {
  id: BH_LEASE_ID, organizationId: 77, propertyId: 3, unitId: "unit-1", unitLabel: "3B", status: "active",
  startDate: "2026-01-01", endDate: null, monthlyRentCents: 150_000, rentDueDayOfMonth: 1,
  securityDepositCents: 150_000, state: "TX",
};

// The support resolver's subset is not exported (an export with no
// production consumer fails the reachability ratchet); pin it from source,
// the paxPauseSupportGate.test.ts pattern #738/#742 used.
const SUPPORT_BH_READS = [
  "get_rent_roll_view",
  "get_rental_leases_view",
  "get_lease_ledger_view",
  "get_rental_underwriting_view",
] as const;
const PRIOR_RESOLVER_NAMES = [
  "search_knowledge_base",
  "search_resolved_tickets",
  "get_similar_resolutions",
  "get_troubleshooting_steps",
  "diagnose_account",
  "check_data_integrity",
  "get_account_summary",
  "query_user_data",
  "get_user_activity",
  "estimate_resolution_confidence",
  "recall_user_memory",
  "draft_customer_response",
  "escalate_to_human",
];
const RESOLVER_TOOL_NAMES: string[] = (() => {
  const src = readFileSync(resolve(root, "server/ai/paxSupportResolver.ts"), "utf8");
  const m = /const RESOLVER_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!m) throw new Error("RESOLVER_TOOL_NAMES literal not found in paxSupportResolver.ts");
  return [...m[1].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]);
})();

describe("BH drill 3 — capability pin, cured: the resolver subset is the prior set + exactly the four support buy-hold reads", () => {
  const BH_TOOLS = [
    "get_rent_roll",
    "get_rental_leases",
    "get_tenants",
    "get_lease_ledger",
    "get_rental_underwriting_decision",
    "record_rent_payment",
    "generate_scheduled_rent_charges",
  ];

  it("the chat path still registers all seven buy-and-hold tools (#737, proven in paxBuyHoldTools.test.ts)", () => {
    const toolsSrc = read("server/ai/tools.ts");
    for (const t of BH_TOOLS) expect(toolsSrc, `chat path is missing ${t}`).toContain(t);
  });

  it("the resolver subset is exactly the prior 13 + the four support reads + the three commercial lease views, in order", () => {
    // The commercial lease family (#787 successor) composes at the same
    // point, after these four reads — the subset is pinned whole so any
    // further silent addition fails here.
    expect(RESOLVER_TOOL_NAMES).toEqual([
      ...PRIOR_RESOLVER_NAMES.slice(0, 7),
      ...SUPPORT_BH_READS,
      "get_lease_abstract_view",
      "get_lease_rent_steps_view",
      "get_lease_cam_status_view",
      ...PRIOR_RESOLVER_NAMES.slice(7),
    ]);
  });

  it("no chat buy-hold name and no write of any kind entered the subset — the support path stays read-only", () => {
    for (const t of BH_TOOLS) expect(RESOLVER_TOOL_NAMES).not.toContain(t);
    expect(RESOLVER_TOOL_NAMES.some((n) => n.startsWith("record_") || n.startsWith("generate_"))).toBe(false);
  });

  it("every subset name resolves to a real support tool definition (the resolver builds its tool list from these)", () => {
    for (const n of RESOLVER_TOOL_NAMES) expect(supportToolDefinitions, n).toHaveProperty(n);
  });

  it("the four reads are registered everywhere the pattern registers a support tool", () => {
    for (const n of SUPPORT_BH_READS) {
      expect(supportToolDefinitions[n], n).toBeDefined();
      expect(PAUSE_SAFE_SUPPORT_TOOLS.has(n), n).toBe(true);
      expect(groupForTool(n), n).toBe("looks_and_drafts");
      expect(CAPABILITY_ROWS[n], n).toMatchObject({ dispatch: "executeSupportTool", group: "looks_and_drafts", family: "buy_and_hold", pauseSafe: true });
    }
  });

  it("there is NO support variant of either write — recording and generating stay off the support path", () => {
    const supportNames = Object.keys(supportToolDefinitions);
    expect(supportNames.filter((n) => n.includes("rent") && (n.startsWith("record_") || n.startsWith("generate_")))).toEqual([]);
    expect(PAUSE_SAFE_SUPPORT_TOOLS.has("record_rent_payment")).toBe(false);
    expect(PAUSE_SAFE_SUPPORT_TOOLS.has("generate_scheduled_rent_charges")).toBe(false);
  });

  it("get_tenants has NO support variant — the tenant_pii_read fence is not carried onto a path that cannot hold it identically", () => {
    // THE EXCLUSION, with its reason. On the chat path the permission
    // ladder checks get_tenants against tenant_pii_read for every caller
    // (tools.ts: the check runs for PII scopes even while paused, even
    // unidentified). On the support path the ladder runs ONLY for tools
    // classified as side-effecting (executeSupportTool's `if (!pauseSafe)`
    // gate over SUPPORT_TOOL_SCOPES) — and a read cannot enter that
    // classification truthfully: looks_and_drafts is pinned to the
    // pause-safe set exactly (paxControlsOffered.test.ts), the remaining
    // groups are changes_records (a record domain; this changes nothing)
    // and sends (this sends nothing), and a pause-safe tool's capability
    // row derives scope null, so a pause-safe tenants variant would be
    // UNGATED and misregistered at once. Rather than weaken the fence to
    // complete the drill, the tenant list stays chat-path-only behind the
    // ladder, and a support ticket that turns on tenant details escalates
    // (the resolver prompt says exactly that). A gated-read classification
    // in the registry system is the architecture change that would reopen
    // this — it is not a drill-lane call.
    const supportNames = Object.keys(supportToolDefinitions);
    expect(supportNames.filter((n) => n.includes("tenant"))).toEqual([]);
    expect(RESOLVER_TOOL_NAMES.some((n) => n.includes("tenant"))).toBe(false);
    expect(INTENT_META["get_tenants"], "the chat-path fence itself is unchanged").toEqual({ door: "finance", scope: "tenant_pii_read" });
    const resolverSrc = read("server/ai/paxSupportResolver.ts");
    expect(resolverSrc).toMatch(/Tenant names and contact details are NOT\s+available on this path/);
  });
});

describe("BH drill 3 — the real support switch: the four reads run and ground the answer", () => {
  beforeEach(() => {
    BH.rows = {
      rental_units: [
        { id: "unit-1", organizationId: 77, propertyId: 3, label: "3B", kind: "unit", status: "active", marketRentCents: 155_000 },
        { id: "unit-2", organizationId: 77, propertyId: 3, label: "3C", kind: "unit", status: "active", marketRentCents: 140_000 },
      ],
      rental_leases: [bhLeaseRow],
      rent_charges: [
        { id: "c1", organizationId: 77, leaseId: BH_LEASE_ID, chargedForMonth: "2026-11-01", dueDate: "2026-11-01", amountCents: 150_000, lateFeeCents: 5_000, paidCents: 50_000, balanceCents: 105_000, chargeType: "base_rent", legalPosture: "late", legalPostureAt: null },
      ],
      rent_payments: [
        { id: "pay-1", organizationId: 77, leaseId: BH_LEASE_ID, amountCents: 50_000, receivedAt: "2026-11-10", method: "ach", payorType: "tenant", isPartial: true, allocatedCents: 50_000, unappliedCents: 0 },
      ],
      rent_payment_allocations: [
        { paymentId: "pay-1", rentChargeId: "c1", leaseId: BH_LEASE_ID, sequence: 1, appliedCents: 50_000, appliedToRentCents: 45_000, appliedToLateFeeCents: 5_000, balanceAfterCents: 105_000 },
      ],
      properties: [{ id: 3, organizationId: 77, address: "12 Oak St" }],
      decision_snapshots: [{
        id: 9, organizationId: 77, subjectType: "property", subjectId: 3, strategyPackId: "buy_and_hold",
        kind: "acquire", choice: "acquire", rationale: "Numbers work", decidedAt: new Date("2026-11-01"), reviewDueAt: null,
        scenarios: [{ scenarioId: 1, label: "BH", engineId: "rental_acquisition", engineVersion: "1", predicted: [{ key: "cap_rate", value: 0.07 }] }],
      }],
    };
    BH.wheres = [];
  });

  it("the rent roll read: a never-leased unit counts as vacant, the November balance is open and overdue, coverage stated", async () => {
    const r = await executeSupportTool("get_rent_roll_view", {}, SUPPORT_ORG);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toContain("entered or imported into THIS account");
    expect(r.data.occupancy).toMatchObject({ rentableUnits: 2, occupiedUnits: 1, vacantUnits: 1, occupancyPct: 50 });
    expect(r.data.totalOpenBalanceCents).toBe(105_000);
    expect(r.data.totalOverdueCents).toBe(105_000);
    expect(JSON.stringify(r.data)).not.toMatch(/firstName|lastName|\bemail\b|\bphone\b/);
    // The org comes from the session and is in the WHERE of the queries.
    expect(BH.wheres.some((w) => w.table === "rental_units" && bhParams(w.cond).includes(77))).toBe(true);
  });

  it("the leases read lists the lease with NO tenant PII shaped", async () => {
    const r = await executeSupportTool("get_rental_leases_view", {}, SUPPORT_ORG);
    expect(r.success).toBe(true);
    expect(r.data.leases).toHaveLength(1);
    expect(r.data.leases[0]).toMatchObject({ id: BH_LEASE_ID, unitLabel: "3B", monthlyRentCents: 150_000 });
    expect(JSON.stringify(r.data)).not.toMatch(/firstName|lastName|\bemail\b|\bphone\b/);
  });

  it("the ledger read shows drill 1's walk figures on the support path: $500 paid, $1,050 open", async () => {
    const r = await executeSupportTool("get_lease_ledger_view", { lease_id: BH_LEASE_ID }, SUPPORT_ORG);
    expect(r.success).toBe(true);
    expect(r.data.totals).toMatchObject({ chargedCents: 155_000, paidCents: 50_000, openBalanceCents: 105_000, overdueCents: 105_000 });
    expect(r.data.allocations[0]).toMatchObject({ appliedToRentCents: 45_000, appliedToLateFeeCents: 5_000 });
    expect(r.data.coverage).toContain("not money that may have moved outside AcreOS");
  });

  it("the underwriting read returns the frozen decision; absence is stated, not reconstructed", async () => {
    const r = await executeSupportTool("get_rental_underwriting_view", { property_id: 3 }, SUPPORT_ORG);
    expect(r.success).toBe(true);
    expect(r.data.decision).toMatchObject({ choice: "acquire" });
    BH.rows = { decision_snapshots: [] };
    const none = await executeSupportTool("get_rental_underwriting_view", { property_id: 3 }, SUPPORT_ORG);
    expect(none.success).toBe(true);
    expect(none.data.decision).toBeNull();
    expect(none.data.statement).toMatch(/No buy-and-hold underwriting decision is recorded/);
  });

  it("a unit label is refused as a lease id in plain words, and an unknown id is refused — no invented lease", async () => {
    const bad = await executeSupportTool("get_lease_ledger_view", { lease_id: "3B" }, SUPPORT_ORG);
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.refusal ?? bad)).not.toMatch(/get_lease_ledger|lease_id|snake_case/);
    BH.rows = { rental_leases: [] };
    const missing = await executeSupportTool("get_lease_ledger_view", { lease_id: BH_LEASE_ID }, SUPPORT_ORG);
    expect(missing.success).toBe(false);
  });
});

// ── Drill 4 — the PII fence ────────────────────────────────────────────────

describe("BH drill 4 — tenant PII is reachable ONLY via get_tenants under tenant_pii_read", () => {
  it("the intent scopes fence the family: tenants = tenant_pii_read, other reads financial_read, writes financial_write", () => {
    expect(INTENT_META["get_tenants"]).toEqual({ door: "finance", scope: "tenant_pii_read" });
    for (const n of ["get_rent_roll", "get_rental_leases", "get_lease_ledger", "get_rental_underwriting_decision"]) {
      expect(INTENT_META[n], n).toEqual({ door: "finance", scope: "financial_read" });
    }
    for (const n of ["record_rent_payment", "generate_scheduled_rent_charges"]) {
      expect(INTENT_META[n], n).toEqual({ door: "finance", scope: "financial_write" });
    }
  });

  const src = read("server/ai/buyHoldTools.ts");
  const bodyOf = (name: string): string => {
    const start = src.indexOf(`export async function ${name}`);
    expect(start, `${name} not found in buyHoldTools.ts`).toBeGreaterThan(-1);
    const rest = src.slice(start + 10);
    const next = rest.indexOf("\nexport ");
    return next === -1 ? rest : rest.slice(0, next);
  };

  it("only paxGetTenants reads the tenants table, and only its shape carries name/email/phone fields", () => {
    expect(src.match(/from\(tenants\)/g)).toHaveLength(1);
    const tenantsBody = bodyOf("paxGetTenants");
    expect(tenantsBody).toContain("from(tenants)");
    expect(tenantsBody).toMatch(/displayName/);
    for (const other of ["paxGetRentRoll", "paxGetRentalLeases", "paxGetLeaseLedger", "paxGetRentalUnderwritingDecision", "paxRecordRentPayment", "paxGenerateScheduledRentCharges"]) {
      const body = bodyOf(other);
      expect(body, `${other} must carry zero tenant name/contact fields`).not.toMatch(/firstName|lastName|displayName|\bemail\b|\bphone\b/);
    }
  });

  it("even paxGetTenants never shapes date of birth, government-id or screening fields", () => {
    const tenantsBody = bodyOf("paxGetTenants");
    expect(tenantsBody).not.toMatch(/dateOfBirth|governmentId|creditScore|eviction/i);
  });

  it("FD5: no tool in the family sends anything to a tenant (no send-shaped name exists in the family)", () => {
    for (const n of ["get_rent_roll", "get_rental_leases", "get_tenants", "get_lease_ledger", "get_rental_underwriting_decision", "record_rent_payment", "generate_scheduled_rent_charges"]) {
      expect(n).not.toMatch(/send|mail|notify|remind/i);
    }
  });
});

// ── Drill 5 — data-wrong ───────────────────────────────────────────────────

describe("BH drill 5a — a late fee never stacks past the rule's total (the rentLedgerLateFeeNoStacking rule)", () => {
  // The no-stacking fixture's own rule: TX, 10% small-property cap on
  // $1,400 rent → the rule's TOTAL for the charge is $140.00.
  const rule: LateFeeRuleData = {
    state: "TX",
    capPctSmallProperty: 0.1,
    capPctLargeProperty: 0.12,
    capFlatCents: null,
    graceDays: 2,
    initialFeeCents: 5_000,
    perDayCents: 500,
    citation: "Tex. Prop. Code §92.019",
  };
  const proposal = proposeLateFee({ rule, monthlyRentCents: 140_000, daysLate: 40, knownUnitCountFloor: 1, state: "TX" });

  it("the fixture is what it claims: the rule's total for the charge is $140.00", () => {
    expect(proposal.status).toBe("proposed");
    expect(proposal.proposedFeeCents).toBe(14_000);
  });

  it("with $50 already on the charge, only the $90 remainder is proposed — the total is not added again", () => {
    const netted = netOfLateFeesAlreadyCharged(proposal, 5_000);
    expect(netted.status).toBe("proposed");
    expect(netted.proposedFeeCents).toBe(9_000);
    expect(netted.explanation).toMatch(/\$50\.00 in late fees is already on this charge/);
  });

  it("with the full $140 already on the charge, nothing further is proposed", () => {
    const netted = netOfLateFeesAlreadyCharged(proposal, 14_000);
    expect(netted.status).toBe("already_charged");
    expect(netted.proposedFeeCents).toBe(0);
  });
});

describe("BH drill 5b — an empty rent roll reads as empty, never as paid or occupied", () => {
  const src = read("server/ai/buyHoldTools.ts");

  it("occupancy percentage is null when there are no rentable units — no invented 100%", () => {
    expect(src).toContain("occupancyPct: rentable.length === 0 ? null :");
  });

  it("the coverage words a support answer quotes say exactly that, up front", () => {
    expect(src).toMatch(/An empty rent roll is reported as empty, never as fully paid or fully occupied/);
  });
});
