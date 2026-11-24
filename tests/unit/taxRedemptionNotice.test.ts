/**
 * T-P1 (P3-2 Tax transplant) — the statutory redemption notice on the
 * Settlement & Documents Rail. Pure-function proof:
 *
 *   1. The fail-closed gate (shared/tax/notice.ts): every refusal fires —
 *      not redeemable, no recorded notice requirements, stale requirements,
 *      no determinable amount (the no-encoded-rule case), incomplete
 *      recipient on a mail lane — and the ready paths carry exactly the
 *      recorded facts (computed amount with its citation, or the
 *      operator-supplied amount with its source; download needs no
 *      recipient).
 *   2. The generator (buildTaxRedemptionNotice) renders ONLY the model it
 *      is given: the deadline on record with its basis, the amount with
 *      its basis, the county's recorded notice requirements quoted with
 *      their source, and the no-custody line (redemption is paid to the
 *      county; AcreOS never holds it).
 *   3. The ledger projection tells a rail-sent notice (provider receipt)
 *      apart from an operator-recorded one.
 */
import { describe, it, expect } from "vitest";
import { assessTaxNoticeReadiness, type TaxNoticeGateInput } from "@shared/tax/notice";
import type { ProcedureFields } from "@shared/tax/procedure";
import { buildTaxRedemptionNotice, type TaxRedemptionNoticeModel } from "../../server/services/settlementRail/documents";
import { certificateLedger, type LedgerInput } from "@shared/tax/ledger";

const TODAY = "2026-11-18";

function fields(overrides: Partial<ProcedureFields> = {}): ProcedureFields {
  return {
    noticeRequirements: {
      value: "Notify the owner of record by certified mail at least 60 days before the redemption deadline.",
      source: "Fla. Stat. §197.522",
      asOf: "2026-06-01",
      basis: "state_law",
      verification: "checked_against_statute",
    },
    ...overrides,
  };
}

function gateInput(overrides: Partial<TaxNoticeGateInput> = {}): TaxNoticeGateInput {
  return {
    status: "active",
    procedureFields: fields(),
    today: TODAY,
    computedAmount: { cents: 152_340, citation: "Fla. Stat. §197.542" },
    operatorAmount: null,
    ownerName: "Pat Owner",
    ownerAddress: { line1: "12 Palm Way", city: "Tampa", state: "FL", zip: "33602" },
    lane: "certified_mail",
    ...overrides,
  };
}

describe("T-P1 gate — fail-closed refusals", () => {
  it("refuses a certificate that is no longer redeemable", () => {
    const r = assessTaxNoticeReadiness(gateInput({ status: "redeemed" }));
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.code).toBe("not_redeemable");
  });

  it("refuses when no procedure is recorded for the county at all", () => {
    const r = assessTaxNoticeReadiness(gateInput({ procedureFields: null }));
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.code).toBe("notice_requirements_not_recorded");
  });

  it("refuses when the procedure records no notice requirements", () => {
    const r = assessTaxNoticeReadiness(gateInput({ procedureFields: fields({ noticeRequirements: undefined }) }));
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.code).toBe("notice_requirements_not_recorded");
  });

  it("refuses on stale notice requirements (source older than 12 months)", () => {
    const stale = fields();
    stale.noticeRequirements = { ...stale.noticeRequirements!, asOf: "2025-10-01" };
    const r = assessTaxNoticeReadiness(gateInput({ procedureFields: stale }));
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.code).toBe("notice_requirements_stale");
  });

  it("refuses when no amount is determinable — the no-encoded-rule case (T-P2 case b)", () => {
    const r = assessTaxNoticeReadiness(
      gateInput({ computedAmount: { refusalReason: "AcreOS has no encoded redemption rule for WY, so it does not compute an amount. Get the redemption amount from the county." } }),
    );
    expect(r.ready).toBe(false);
    if (!r.ready) {
      expect(r.code).toBe("amount_not_determinable");
      expect(r.message).toContain("no encoded redemption rule for WY");
    }
  });

  it("refuses a mail lane without a complete owner address, but a download drafts", () => {
    const noZip = gateInput({ ownerAddress: { line1: "12 Palm Way", city: "Tampa", state: "FL" } });
    const mailed = assessTaxNoticeReadiness(noZip);
    expect(mailed.ready).toBe(false);
    if (!mailed.ready) expect(mailed.code).toBe("recipient_incomplete");
    const downloaded = assessTaxNoticeReadiness({ ...noZip, lane: "download" });
    expect(downloaded.ready).toBe(true);
    if (downloaded.ready) expect(downloaded.recipient).toBeNull();
  });
});

describe("T-P1 gate — ready paths carry recorded facts only", () => {
  it("computed amount: carries the cents, the citation, and the full recipient", () => {
    const r = assessTaxNoticeReadiness(gateInput());
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect(r.amount).toMatchObject({ cents: 152_340, basis: "computed_preliminary" });
      expect(r.amount.basisText).toContain("Fla. Stat. §197.542");
      expect(r.recipient).toEqual({ name: "Pat Owner", address: { line1: "12 Palm Way", city: "Tampa", state: "FL", zip: "33602" } });
      expect(r.noticeRequirements.source).toBe("Fla. Stat. §197.522");
    }
  });

  it("no encoded rule + operator-supplied county amount with source: ready on that basis", () => {
    const r = assessTaxNoticeReadiness(
      gateInput({
        computedAmount: { refusalReason: "AcreOS has no encoded redemption rule for WY, so it does not compute an amount. Get the redemption amount from the county." },
        operatorAmount: { cents: 98_001, source: "county payoff quote dated 2026-11-10" },
      }),
    );
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect(r.amount).toMatchObject({ cents: 98_001, basis: "operator_supplied" });
      expect(r.amount.basisText).toContain("county payoff quote dated 2026-11-10");
    }
  });
});

function noticeModel(overrides: Partial<TaxRedemptionNoticeModel> = {}): TaxRedemptionNoticeModel {
  return {
    holderName: "Sunshine Lien Holdings LLC",
    ownerName: "Pat Owner",
    county: "Hillsborough",
    state: "FL",
    apn: "A-12-34-56",
    certificateNumber: "2024-1187",
    saleDate: "2024-06-01",
    purchaseAmountCents: 120_000,
    redemptionDeadline: "2026-06-01",
    deadlineBasis: "computed by AcreOS from its encoded FL rule (Fla. Stat. §197.482) — preliminary, not attorney-reviewed; confirm with the county",
    amountCents: 152_340,
    amountBasisText: "computed by AcreOS from its encoded state rule (Fla. Stat. §197.542) — preliminary, not attorney-reviewed; confirm with the county",
    noticeRequirements: "Notify the owner of record by certified mail at least 60 days before the redemption deadline.",
    noticeRequirementsSource: "Fla. Stat. §197.522",
    noticeRequirementsAsOf: "2026-06-01",
    ...overrides,
  };
}

describe("T-P1 generator — renders the record, nothing else", () => {
  it("states the deadline + basis, the amount + basis, and quotes the recorded requirements with their source", () => {
    const a = buildTaxRedemptionNotice(noticeModel());
    expect(a.kind).toBe("tax_redemption_notice");
    // The HTML is the mail lane's print source and carries every figure;
    // the PDF renders the same model (jsPDF output is compressed, so its
    // text is not string-searchable — the payoff-letter suite pins the
    // same HTML-side discipline).
    for (const needle of ["2026-06-01", "Fla. Stat. §197.482", "$1,523.40", "Fla. Stat. §197.542", "Notify the owner of record by certified mail", "Fla. Stat. §197.522", "A-12-34-56"]) {
      expect(a.html).toContain(needle);
    }
    expect(a.pdf.length).toBeGreaterThan(500);
    // No-custody honesty: redemption is paid to the county, never to AcreOS.
    expect(a.html).toContain("never receives or holds them");
    expect(a.filename).toContain("A-12-34-56");
  });

  it("escapes owner-supplied text in the HTML lane", () => {
    const a = buildTaxRedemptionNotice(noticeModel({ ownerName: "Pat <script>alert(1)</script>" }));
    expect(a.html).not.toContain("<script>alert(1)</script>");
    expect(a.html).toContain("&lt;script&gt;");
  });
});

describe("T-P1 ledger projection — rail-sent vs operator-recorded", () => {
  const base: LedgerInput = {
    purchaseAmountCents: 120_000,
    bidDownRateBps: null,
    redemptionDeadline: "2026-06-01",
    deadlineBasis: "computed",
    interest: { interestCents: null, asOfDate: TODAY, refusalReason: "no rule", preliminary: true },
    subsequentTaxRule: null,
    events: [],
  };

  it("a rail-sent entry surfaces viaRail + the provider id; an operator entry does not", () => {
    const ledger = certificateLedger({
      ...base,
      events: [
        {
          eventType: "redemption_notice_recorded",
          eventDate: "2026-11-18",
          ruleCited: { kind: "procedure_object", source: "Fla. Stat. §197.522" },
          detail: { method: "certified mail via AcreOS", sentViaRail: true, providerId: "ltr_123" },
          recordedBy: "user-1",
          recordedAt: "2026-11-18T05:00:00.000Z",
        },
        {
          eventType: "redemption_notice_recorded",
          eventDate: "2026-10-01",
          ruleCited: { kind: "county_record", source: "operator's mailing log" },
          detail: { method: "certified mail", sentByOperator: true },
          recordedBy: "user-1",
          recordedAt: "2026-10-01T05:00:00.000Z",
        },
      ],
    });
    expect(ledger.notices).toHaveLength(2);
    const rail = ledger.notices.find((n) => n.sentOn === "2026-11-18")!;
    expect(rail.viaRail).toBe(true);
    expect(rail.providerId).toBe("ltr_123");
    const op = ledger.notices.find((n) => n.sentOn === "2026-10-01")!;
    expect(op.viaRail).toBe(false);
    expect(op.providerId).toBeNull();
  });
});
