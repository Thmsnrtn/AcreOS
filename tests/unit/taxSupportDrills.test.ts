/**
 * Tax T9 — the support drill set, deterministic legs (drills 1, 2, 3, 5 and
 * the capability pin for drill 4).
 *
 * The T9 record (docs/evidence/2026-11-24/tax-support-drills.md) drills the
 * five scenarios the Tax gap sheet names for bar item (e). This file pins
 * every leg that can be pinned without a live LLM or a database:
 *
 *   Drill 1 (money moment): the T1 walk's own figures — a GA certificate
 *   bought for $6,000 — compute to the walk's redemption amount ($6,000 +
 *   $1,200 first-year premium = $7,200, preliminary); the notice gate is
 *   ready ONLY with recorded notice requirements and that determinable
 *   amount, and refuses fail-closed without either; and a notice the rail
 *   recorded in test mode projects on the ledger as simulated — never as
 *   mailed. No notice is sent anywhere in this file (zero real mail).
 *
 *   Drill 2 (stuck moment — no encoded rule): WY is not one of the ten
 *   states whose redemption math is encoded, so the deadline is null and
 *   the amount is a stated refusal (interest/total null, the reason named)
 *   — never an invented figure.
 *
 *   Drill 3 (data-wrong): (a) the clock mismatch flag — a county procedure
 *   stating 6 months against a 12-month deadline flags `agrees: false` and
 *   leaves the deadline untouched; (b) a wrong county CSV — a non-calendar
 *   sale date and a duplicate parcel are refused row-exactly (field,
 *   column, value, reason named), the good row stays valid, and
 *   `assertNoRowLost` proves every row read is accounted for.
 *
 *   Drill 4 ("Pax told me X"): CLOSED by the T9-DEF-1 cure. The T7 tax
 *   tools ARE registered on the chat path (proven by
 *   paxTaxCertificateTools.test.ts); the cure adds support-only variants
 *   of the four READS (the registries key one dispatch per name, and the
 *   chat names already dispatch through the chat executor) and pins the
 *   resolver subset at the prior 13 generic tools + exactly those four.
 *   The one T7 write (record_tax_ledger_entry) has NO support variant —
 *   the support path stays read-only. The resolver leg itself (mocked
 *   model, real resolver gate) lives in taxSupportDrillsResolver.test.ts;
 *   the real-switch legs for the four reads live below.
 *
 *   Drill 5 (the fence): redemption interest is income on the certificate,
 *   so the drill asks whether DEFECT-0101's fence refuses correctly for
 *   that income line. Two facts decide it, both pinned here: the only
 *   1099-INT generator reads NOTE payments (its source names no tax
 *   certificate, no redemption amount — redemption interest has no path
 *   into it), and the gate itself refuses a customer 422 naming
 *   DEFECT-0101 and fails CLOSED when the flag store throws.
 *
 * Fixtures are synthetic (`SYNTHETIC …`, APNs `T9-*`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";
import {
  computeRedemptionAmount,
  computeRedemptionDeadline,
  STATE_REDEMPTION_RULES,
} from "../../server/services/redemptionClock";
import { redemptionClock, type ClockInput } from "@shared/tax/clock";
import { assessTaxNoticeReadiness, type TaxNoticeGateInput } from "@shared/tax/notice";
import { certificateLedger, type LedgerInput } from "@shared/tax/ledger";
import {
  assertNoRowLost,
  parseDelimited,
  suggestColumnMapping,
  validateLotRows,
} from "../../server/services/taxSaleCsvImport";

// ── Drill 5's gate needs the flag store and founder check mocked, exactly
// as bookkeeping1099.test.ts mocks them (the gate fails closed on error).
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
import { requireQualified1099Output } from "../../server/services/form1099Refusal";

// ── Drill 4's real-switch legs run the REAL executeSupportTool switch and
// the REAL T7 read helpers underneath it. Only the data sources are mocked:
// `db` (certificate + notice-event rows, the paxTaxCertificateTools.test.ts
// pattern, with the clock pinned to drill 1's as-of date so the GA amount
// is the walk's $7,200) and the clock/ledger builders at their service
// seams (the same stubs the T7 suite uses).
const CERT_ID = "6f1c1c1e-2b7a-4c1d-9a55-0e0e0e0e0e0e";
const CERT_ROW = {
  id: CERT_ID, organizationId: 77, state: "GA", county: "Fulton", apn: "T9-1", certificateNumber: null,
  saleType: "redeemable_deed", saleDate: "2025-11-23", status: "active", purchaseAmountCents: 600_000,
  bidDownRateBps: null, redemptionDeadline: "2026-11-23", deadlineSource: "computed_preliminary",
};
const SIM_NOTICE_EVENT = {
  organizationId: 77, certificateId: CERT_ID, eventType: "redemption_notice_recorded",
  eventDate: "2026-11-20", recordedAt: "2026-11-20T10:00:00.000Z",
  detail: { method: "certified mail via AcreOS", sentViaRail: true, providerId: "sim_T9DRILL", testMode: true },
};
const H = vi.hoisted(() => ({
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
      where: (c: unknown) => { H.wheres.push({ table, cond: c }); return chain; },
      orderBy: () => chain,
      limit: () => chain,
      then: (res: any, rej: any) => Promise.resolve(H.rows[table] ?? []).then(res, rej),
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
vi.mock("../../server/services/tax/certificateClock", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  clockForCertificate: vi.fn(async (orgId: number, row: any) => ({ stub: true, orgId, certificateId: row.id })),
}));
vi.mock("../../server/services/tax/taxEvents", () => ({
  latestTaxEvents: vi.fn(async () => ({ redemption_expiry: null })),
}));
vi.mock("../../server/services/tax/certificateLedger", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  buildCertificateLedger: vi.fn(async () => ({ stub: true })),
}));

import { executeSupportTool, PAUSE_SAFE_SUPPORT_TOOLS, supportToolDefinitions } from "../../server/ai/supportAgent";
import { groupForTool } from "@shared/pax-controls";
import { CAPABILITY_ROWS } from "@shared/pax-capabilities";
import { PgDialect } from "drizzle-orm/pg-core";

const SUPPORT_ORG = { id: 77, isFounder: false } as never;
const params = (cond: unknown) => new PgDialect().sqlToQuery(cond as any).params;

// ── Drill 1 — money moment ─────────────────────────────────────────────────

describe("T9 drill 1 — the walk's GA certificate: $6,000 computes to $7,200, preliminary", () => {
  const amt = computeRedemptionAmount({
    state: "GA",
    saleDate: "2025-11-23",
    asOfDate: "2026-11-23",
    purchaseAmountCents: 600_000,
  });

  it("reproduces the T1 walk amount exactly: $6,000 principal + $1,200 interest", () => {
    expect(amt).toMatchObject({
      principalCents: 600_000,
      interestCents: 120_000,
      totalRedemptionCents: 720_000,
      modelUsed: "tiered_yearly",
      refusalReason: null,
    });
  });

  it("the amount is preliminary (no GA rule is attorney-reviewed) — a support answer must say so", () => {
    expect(amt.preliminary).toBe(true);
    expect(STATE_REDEMPTION_RULES.GA.attorneyReviewedAt).toBeNull();
  });
});

describe("T9 drill 1 — the notice gate: ready only on recorded requirements + a determinable amount", () => {
  const gate = (overrides: Partial<TaxNoticeGateInput> = {}): TaxNoticeGateInput => ({
    status: "active",
    procedureFields: {
      noticeRequirements: {
        value: "Notify the owner of record by certified mail before the redemption deadline.",
        source: "SYNTHETIC Fulton County procedure card",
        asOf: "2026-06-01",
        basis: "county_practice",
        verification: "confirmed_with_county",
      },
    },
    today: "2026-11-23",
    computedAmount: { cents: 720_000, citation: "O.C.G.A. §48-4-42" },
    operatorAmount: null,
    ownerName: "SYNTHETIC Owner",
    ownerAddress: { line1: "1 Synthetic Way", city: "Atlanta", state: "GA", zip: "30303" },
    lane: "certified_mail",
    ...overrides,
  });

  it("is ready with the walk amount, and the amount's basis says preliminary in words", () => {
    const r = assessTaxNoticeReadiness(gate());
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect(r.amount).toMatchObject({ cents: 720_000, basis: "computed_preliminary" });
      expect(r.amount.basisText).toMatch(/preliminary, not attorney-reviewed/);
    }
  });

  it("refuses when no notice requirements are recorded — AcreOS never improvises statutory language", () => {
    const r = assessTaxNoticeReadiness(gate({ procedureFields: null }));
    expect(r).toMatchObject({ ready: false, code: "notice_requirements_not_recorded" });
  });

  it("refuses when the amount cannot be determined and none is supplied from the county", () => {
    const wy = computeRedemptionAmount({ state: "WY", saleDate: "2025-11-23", asOfDate: "2026-11-23", purchaseAmountCents: 600_000 });
    const r = assessTaxNoticeReadiness(gate({ computedAmount: { refusalReason: wy.refusalReason! } }));
    expect(r).toMatchObject({ ready: false, code: "amount_not_determinable" });
  });
});

describe("T9 drill 1 — a notice recorded in test mode projects as simulated, never as mailed", () => {
  const input: LedgerInput = {
    purchaseAmountCents: 600_000,
    bidDownRateBps: null,
    redemptionDeadline: "2026-11-23",
    deadlineBasis: "computed by AcreOS from its encoded GA rule — preliminary",
    interest: { interestCents: 120_000, asOfDate: "2026-11-23", refusalReason: null, preliminary: true },
    subsequentTaxRule: null,
    events: [
      {
        eventType: "redemption_notice_recorded",
        eventDate: "2026-11-20",
        ruleCited: { kind: "procedure_object", source: "SYNTHETIC procedure v1" },
        detail: { method: "certified mail via AcreOS", note: null, sentViaRail: true, providerId: "sim_T9DRILL", testMode: true },
        recordedBy: "u",
        recordedAt: "2026-11-20T10:00:00.000Z",
      },
    ],
  };

  it("the ledger carries the simulation marker and the computed interest, in words", () => {
    const l = certificateLedger(input);
    expect(l.notices[0]).toMatchObject({ viaRail: true, providerId: "sim_T9DRILL", simulated: true });
    expect(l.interest).toMatchObject({ status: "computed", cents: 120_000 });
    if (l.interest.status === "computed") expect(l.interest.text).toMatch(/\$1,200\.00 accrued/);
  });
});

// ── Drill 2 — stuck moment: no encoded rule for the state ─────────────────

describe("T9 drill 2 — WY has no encoded rule: deadline and amount refuse instead of inventing", () => {
  it("WY is not among the encoded states (the premise of the drill)", () => {
    expect(Object.keys(STATE_REDEMPTION_RULES).sort()).toEqual(["AL", "AZ", "FL", "GA", "IA", "MS", "NC", "SC", "TN", "TX"]);
    expect(STATE_REDEMPTION_RULES.WY).toBeUndefined();
  });

  it("no deadline is computed for WY", () => {
    expect(computeRedemptionDeadline({ state: "WY", saleDate: "2026-01-15", ownerOccupied: false })).toBeNull();
  });

  it("no amount is computed for WY — interest and total are null and the refusal names the state", () => {
    const amt = computeRedemptionAmount({ state: "WY", saleDate: "2026-01-15", asOfDate: "2026-11-23", purchaseAmountCents: 600_000 });
    expect(amt).toMatchObject({ interestCents: null, totalRedemptionCents: null, appliedRateBps: null, modelUsed: "no_rule" });
    expect(amt.refusalReason).toMatch(/no encoded redemption rule for WY/);
  });
});

// ── Drill 3 — data-wrong ───────────────────────────────────────────────────

describe("T9 drill 3a — the clock mismatch flag (GA Fulton pattern): flagged, never resolved", () => {
  const base: ClockInput = {
    saleType: "redeemable_deed",
    status: "active",
    saleDate: "2026-04-01",
    redemptionDeadline: "2027-04-01",
    deadlineSource: "computed_preliminary",
    deadlineBasis: "computed by AcreOS from its encoded GA rule — preliminary",
    purchaseAmountCents: 600_000,
    today: "2026-11-23",
    procedurePeriod: { months: 6, source: "SYNTHETIC Fulton County procedure", asOf: "2026-06-01", version: 1 },
    quietTitle: null,
  };

  it("a county procedure stating 6 months against a 12-month deadline flags the mismatch", () => {
    const c = redemptionClock(base);
    expect(c.procedureCheck).toMatchObject({ agrees: false, statedMonths: 6, impliedDeadlineFromSale: "2026-10-01" });
  });

  it("the deadline on record is left exactly as it was — the flag does not pick a winner", () => {
    expect(redemptionClock(base).deadline).toBe("2027-04-01");
  });
});

describe("T9 drill 3b — a wrong county CSV: bad rows refused row-exactly, no row lost", () => {
  const csv = [
    "apn,county,state,sale type,total tax owed,sale date,delinquent years",
    "T9-1,Fulton,GA,redeemable_deed,6000,2026-04-01,2025",
    "T9-2,Fulton,GA,redeemable_deed,6000,2026-02-30,2025",
    "T9-1,Fulton,GA,redeemable_deed,6000,2026-04-01,2025",
  ].join("\n");
  const sheet = parseDelimited(csv);
  const { mapping } = suggestColumnMapping(sheet.headers);
  const out = validateLotRows({ headers: sheet.headers, rows: sheet.rows, mapping });

  it("accounts for every row: 1 valid + 2 rejected of 3 read, assertNoRowLost holds", () => {
    expect(out.summary).toMatchObject({ totalRows: 3, validCount: 1, rejectedCount: 2 });
    expect(() => assertNoRowLost(out)).not.toThrow();
  });

  it("the good Fulton row is untouched by the bad rows' refusals", () => {
    expect(out.valid).toHaveLength(1);
    expect(out.valid[0]).toMatchObject({ apn: "T9-1", county: "Fulton", state: "GA" });
  });

  it("the non-calendar sale date is refused naming the field, column, value and reason", () => {
    const bad = out.rejected.find((r) => r.errors.some((e) => e.field === "saleDate"));
    expect(bad).toBeDefined();
    expect(bad!.errors).toEqual([
      expect.objectContaining({ field: "saleDate", column: "sale date", value: "2026-02-30" }),
    ]);
    expect(bad!.errors[0].message).toMatch(/not a real calendar date/);
  });

  it("the duplicate parcel is refused as a duplicate, not silently skipped", () => {
    const dup = out.rejected.find((r) => r.errors.some((e) => /already|also appears/.test(e.message)));
    expect(dup).toBeDefined();
  });
});

// ── Drill 4 — "Pax told me X": T9-DEF-1 cured — the support reads ─────────
//
// The support resolver's subset is not exported (an export with no
// production consumer fails the reachability ratchet); pin it from source,
// the paxPauseSupportGate.test.ts pattern #738 used for the notes cure.
const SUPPORT_TAX_READS = [
  "get_tax_certificates_book",
  "get_tax_certificate_record",
  "get_tax_certificate_clock_view",
  "get_tax_certificate_ledger_view",
] as const;
const SUPPORT_BH_READS = [
  "get_rent_roll_view",
  "get_rental_leases_view",
  "get_lease_ledger_view",
  "get_rental_underwriting_view",
] as const;
const SUPPORT_LAND_READS = [
  "get_parcel_passport_view",
  "get_land_listings_view",
  "get_land_listing_view",
  "get_listing_paste_text_view",
  "get_land_payoff_quote_view",
] as const;
const SUPPORT_WS_READS = [
  "get_wholesale_buy_box_view",
  "get_wholesale_triage_view",
  "get_wholesale_buyers_view",
  "get_wholesale_buyer_matches_view",
  "get_wholesale_assignments_view",
  "get_wholesale_decision_view",
  "get_wholesale_disposition_packet_view",
  "get_wholesale_blasts_view",
] as const;
const SUPPORT_LEASE_VIEWS = [
  "get_lease_abstract_view",
  "get_lease_rent_steps_view",
  "get_lease_cam_status_view",
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
  const src = readFileSync(resolve(__dirname, "../../server/ai/paxSupportResolver.ts"), "utf8");
  const m = /const RESOLVER_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!m) throw new Error("RESOLVER_TOOL_NAMES literal not found in paxSupportResolver.ts");
  return [...m[1].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]);
})();

describe("T9 drill 4 — capability pin, cured: the resolver subset is the prior set + exactly the four support tax reads (composed with the five support land reads, the four support buy-hold reads, the eight support wholesale reads and the three commercial lease views)", () => {
  const root = resolve(__dirname, "../..");
  const read = (p: string) => stripComments(readFileSync(resolve(root, p), "utf8"));
  const CHAT_TAX_TOOLS = [
    "get_tax_certificates",
    "get_tax_certificate",
    "get_tax_certificate_clock",
    "get_tax_certificate_ledger",
    "record_tax_ledger_entry",
  ];

  it("the chat path still registers all five tax tools (T7, proven in paxTaxCertificateTools.test.ts)", () => {
    const toolsSrc = read("server/ai/tools.ts");
    for (const t of CHAT_TAX_TOOLS) expect(toolsSrc, `chat path is missing ${t}`).toContain(t);
  });

  it("the resolver subset is exactly the prior 13 + the five support land reads + the four support tax reads + the four support buy-hold reads + the eight support wholesale reads + the three commercial lease views, in order", () => {
    expect(RESOLVER_TOOL_NAMES).toEqual([
      ...PRIOR_RESOLVER_NAMES.slice(0, 7),
      ...SUPPORT_LAND_READS,
      ...SUPPORT_TAX_READS,
      ...SUPPORT_BH_READS,
      ...SUPPORT_WS_READS,
      ...SUPPORT_LEASE_VIEWS,
      ...PRIOR_RESOLVER_NAMES.slice(7),
    ]);
  });

  it("no chat tax name and no write of any kind entered the subset — the support path stays read-only", () => {
    for (const t of CHAT_TAX_TOOLS) expect(RESOLVER_TOOL_NAMES).not.toContain(t);
    expect(RESOLVER_TOOL_NAMES.some((n) => n.startsWith("record_"))).toBe(false);
  });

  it("every subset name resolves to a real support tool definition (the resolver builds its tool list from these)", () => {
    for (const n of RESOLVER_TOOL_NAMES) expect(supportToolDefinitions, n).toHaveProperty(n);
  });

  it("the four reads are registered everywhere the pattern registers a support tool", () => {
    for (const n of SUPPORT_TAX_READS) {
      expect(supportToolDefinitions[n], n).toBeDefined();
      expect(PAUSE_SAFE_SUPPORT_TOOLS.has(n), n).toBe(true);
      expect(groupForTool(n), n).toBe("looks_and_drafts");
      expect(CAPABILITY_ROWS[n], n).toMatchObject({ dispatch: "executeSupportTool", group: "looks_and_drafts", family: "tax_lien_deed", pauseSafe: true });
    }
  });

  it("there is NO support variant of the ledger write — recording stays off the support path", () => {
    expect(Object.keys(supportToolDefinitions).filter((n) => n.includes("tax") && n.startsWith("record_"))).toEqual([]);
    expect(PAUSE_SAFE_SUPPORT_TOOLS.has("record_tax_ledger_entry")).toBe(false);
  });
});

describe("T9 drill 4 — the real support switch: the four reads run and ground the answer", () => {
  beforeEach(() => {
    H.rows = { tax_certificates: [CERT_ROW], tax_events: [SIM_NOTICE_EVENT] };
    H.wheres = [];
  });

  it("the book read lists the GA certificate with the walk's redemption amount and states coverage", async () => {
    const r = await executeSupportTool("get_tax_certificates_book", {}, SUPPORT_ORG);
    expect(r.success).toBe(true);
    expect(r.data.coverage).toContain("THIS account's tax certificates only (1 matches — status active; 1 shown)");
    expect(r.data.coverage).toContain("does not include tax-sale listings");
    expect(r.data.certificates).toHaveLength(1);
    expect(r.data.certificates[0]).toMatchObject({
      id: CERT_ID, state: "GA", county: "Fulton",
      currentRedemptionAmountCents: 720_000, currentInterestCents: 120_000, preliminary: true,
    });
    // The org comes from the session and is in the WHERE of the query.
    expect(H.wheres.some((w) => w.table === "tax_certificates" && params(w.cond).includes(77))).toBe(true);
  });

  it("the record read returns the one certificate, coverage-stated", async () => {
    const r = await executeSupportTool("get_tax_certificate_record", { certificate_id: CERT_ID }, SUPPORT_ORG);
    expect(r.success).toBe(true);
    expect(r.data.certificate).toMatchObject({ id: CERT_ID, currentRedemptionAmountCents: 720_000 });
  });

  it("the clock read returns the clock for the certificate (the shared clock service, stubbed at its seam)", async () => {
    const r = await executeSupportTool("get_tax_certificate_clock_view", { certificate_id: CERT_ID }, SUPPORT_ORG);
    expect(r.success).toBe(true);
    expect(r.data.clock).toMatchObject({ stub: true, orgId: 77, certificateId: CERT_ID });
    expect(r.data.coverage).toContain("never improvise a date");
  });

  it("the ledger read carries the simulation statement: the test-mode notice was NOT mailed", async () => {
    const r = await executeSupportTool("get_tax_certificate_ledger_view", { certificate_id: CERT_ID }, SUPPORT_ORG);
    expect(r.success).toBe(true);
    expect(r.data.noticeSimulation.statement).toContain("SIMULATED — recorded in test mode, NOT mailed");
    expect(r.data.noticeSimulation.notices).toEqual([
      expect.objectContaining({ providerId: "sim_T9DRILL", viaRail: true, simulated: true }),
    ]);
  });

  it("a non-id is refused in plain words, and an unknown id is refused — no invented certificate", async () => {
    const bad = await executeSupportTool("get_tax_certificate_record", { certificate_id: "C-1042" }, SUPPORT_ORG);
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.refusal ?? bad)).not.toMatch(/get_tax_certificate|certificate_id|snake_case/);
    H.rows = { tax_certificates: [] };
    const missing = await executeSupportTool("get_tax_certificate_record", { certificate_id: CERT_ID }, SUPPORT_ORG);
    expect(missing.success).toBe(false);
  });
});

// ── Drill 5 — the fence: DEFECT-0101 on redemption interest ───────────────

describe("T9 drill 5 — the 1099-INT fence refuses correctly for the redemption-interest line", () => {
  beforeEach(() => {
    flagState.enabled = false;
    flagState.throws = false;
  });

  function fakeRes() {
    const res: any = { statusCode: 200, body: undefined as unknown };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
  }

  it("redemption interest has no path into the generator: bookkeeping's interest report names no certificate or redemption source", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/services/bookkeeping.ts"), "utf8"));
    expect(src).not.toContain("taxCertificates");
    expect(src).not.toContain("computeRedemptionAmount");
    expect(src).not.toContain("redemptionClock");
    // …and what it DOES read is note payments — the direction DEFECT-0101 names.
    expect(src).toContain("generateAnnualInterestReport");
  });

  it("a customer asking for a 1099-INT on the $1,200 of redemption interest is refused 422 naming DEFECT-0101", async () => {
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

  it("the gate fails CLOSED when the flag store throws — a broken gate is a refusal, not a filing", async () => {
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
