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
 *   Drill 4 ("Pax told me X"): the capability pin. The T7 tax tools ARE
 *   registered on the chat path (proven by paxTaxCertificateTools.test.ts),
 *   but the support resolver's tool subset contains NONE of them — the
 *   N9-DEF-1 shape, filed as T9-DEF-1 in the record. This pin makes the
 *   gap visible until a cure removes the tools' absence; the drill's live
 *   leg stays UNPROVEN in the record, never rounded up.
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

// ── Drill 4 — "Pax told me X": the support resolver has no tax read ───────

describe("T9 drill 4 — capability pin: the T7 tax tools exist on the chat path but NOT in the support resolver's subset (T9-DEF-1)", () => {
  const root = resolve(__dirname, "../..");
  const read = (p: string) => stripComments(readFileSync(resolve(root, p), "utf8"));
  const TAX_TOOLS = [
    "get_tax_certificates",
    "get_tax_certificate",
    "get_tax_certificate_clock",
    "get_tax_certificate_ledger",
    "record_tax_ledger_entry",
  ];

  it("the chat path registers all five tax tools (T7, proven in paxTaxCertificateTools.test.ts)", () => {
    const toolsSrc = read("server/ai/tools.ts");
    for (const t of TAX_TOOLS) expect(toolsSrc, `chat path is missing ${t}`).toContain(t);
  });

  it("the support resolver's subset contains none of them — a tax ticket cannot be grounded on the support path today", () => {
    const resolverSrc = read("server/ai/paxSupportResolver.ts");
    const block = resolverSrc.match(/RESOLVER_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]/);
    expect(block, "RESOLVER_TOOL_NAMES block not found — the pin must be re-pointed, not deleted").not.toBeNull();
    for (const t of TAX_TOOLS) expect(block![1], `resolver unexpectedly gained ${t} — close T9-DEF-1 and re-drill`).not.toContain(t);
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
