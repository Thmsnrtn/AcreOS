/**
 * One deal P&L engine. There were two, and they disagreed about the same deal.
 *
 * Unit 114. `calculateDealPnL` was exported by BOTH `server/services/bookkeeping.ts`
 * and `server/services/financialOSService.ts`, each behind a mounted endpoint —
 * `POST /api/bookkeeping/deal-pnl` and `POST /api/financial/deal-pnl`. Given one
 * deal (bought 100k with 8k of closing/DD costs, sold 140k with 6k of selling
 * costs, unleveraged, held 12 months) they answered:
 *
 *   | field       | bookkeeping | financialOS |
 *   |-------------|-------------|-------------|
 *   | grossProfit |    40,000   |    32,000   |
 *   | netProfit   |    26,000   |    26,000   |
 *   | roi         |    22.81%   |    24.07%   |
 *   | cashOnCash  |    22.81%   |    24.07%   |
 *
 * NOT ROUNDING — different DEFINITIONS:
 *
 *   • `grossProfit` was `salePrice - totalAcquisitionCost` in financialOS, i.e.
 *     already net of acquisition costs. A net figure wearing a gross label.
 *   • `roi` divided by CASH INVESTED rather than total investment — which is the
 *     cash-on-cash question, not the ROI one.
 *   • and so `cashOnCash` was computed by an expression IDENTICAL to `roi`, making
 *     the two fields incapable of differing, while the field's own comment read
 *     "% for financed deals" — precisely the case where they must differ.
 *
 * Only `netProfit` agreed. The bottom line was consistent; every ratio was not.
 *
 * **Founder ruling (picker, 2026-08-15): bookkeeping.ts is canonical.** It also
 * already honoured the `shared/finance/cents.ts` integer-cents house rule, which
 * financialOS did not — it had ZERO cents imports and did raw float arithmetic
 * throughout. financialOS now maps its named cost buckets into the canonical
 * engine's expense vocabulary and keeps only what that engine does not compute:
 * the holding/disposition split, annualisation, the owner-finance projection and
 * the breakdown rows.
 *
 * This file pins the AGREEMENT (so the two can never drift apart again), the
 * cash-on-cash fix (so it cannot collapse back into roi), and single ownership.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { calculateDealPnL as bookkeepingPnl } from "../../server/services/bookkeeping";
import type { DealExpense } from "../../server/services/bookkeeping";
import { calculateDealPnL as financialOsPnl } from "../../server/services/financialOSService";

const ROOT = path.resolve(__dirname, "../..");

/** The worked example from the finding, described in each engine's own vocabulary. */
const PURCHASE = 100_000;
const SALE = 140_000;

function bookkeepingSide(downPaymentReceived?: number) {
  const expenses: DealExpense[] = [
    { category: "title", description: "Closing costs (purchase)", amount: 5_000, date: "" },
    { category: "other", description: "Due diligence", amount: 3_000, date: "" },
    { category: "title", description: "Closing costs (sale)", amount: 6_000, date: "" },
  ];
  return bookkeepingPnl(
    PURCHASE,
    SALE,
    expenses,
    new Date(Date.UTC(2000, 0, 1)),
    new Date(Date.UTC(2001, 0, 1)),
    "flip",
    downPaymentReceived,
  );
}

function financialOsSide(over: Record<string, unknown> = {}) {
  return financialOsPnl({
    purchasePrice: PURCHASE,
    salePrice: SALE,
    closingCostsAtPurchase: 5_000,
    dueDiligenceCosts: 3_000,
    mailingCosts: 0,
    travelCosts: 0,
    lienPayoffs: 0,
    annualTaxes: 0,
    insuranceCost: 0,
    interestPaid: 0,
    closingCostsAtSale: 6_000,
    agentCommission: 0,
    marketingCosts: 0,
    holdingMonths: 12,
    loanAmount: 0,
    isOwnerFinanced: false,
    ...over,
  } as Parameters<typeof financialOsPnl>[0]);
}

describe("the two surfaces answer the same about the same deal", () => {
  const a = bookkeepingSide();
  const b = financialOsSide();

  it("grossProfit agrees (it was 40,000 vs 32,000)", () => {
    expect(b.grossProfit).toBeCloseTo(a.grossProfit, 2);
    // And it is the CONVENTIONAL meaning: sale minus purchase, before costs.
    // If this becomes 32,000 again, financialOS has gone back to netting
    // acquisition costs into a field called "gross".
    expect(a.grossProfit).toBeCloseTo(SALE - PURCHASE, 2);
  });

  it("netProfit agrees (it always did — the bottom line was never the problem)", () => {
    expect(b.netProfit).toBeCloseTo(a.netProfit, 2);
  });

  it("roi agrees (it was 22.81% vs 24.07%)", () => {
    expect(b.roi).toBeCloseTo(a.roi, 2);
  });

  it("and roi is measured against TOTAL INVESTMENT, not cash invested", () => {
    // The definitional half. netProfit / (purchase + all costs).
    const totalInvestment = PURCHASE + 5_000 + 3_000 + 6_000;
    expect(a.roi).toBeCloseTo((a.netProfit / totalInvestment) * 100, 2);
  });
});

describe("cash-on-cash is no longer ROI wearing a different name", () => {
  it("differs from roi as soon as the deal is financed", () => {
    // THE FIX. The old expression was character-for-character the same as roi's,
    // so these two fields could not differ for any input — on a field labelled
    // "% for financed deals".
    const financed = financialOsSide({ loanAmount: 70_000 });
    expect(
      financed.cashOnCash,
      "cashOnCash collapsed back into roi. They must differ when there is a loan: " +
        "roi measures the DEAL, cash-on-cash measures the money you actually put in.",
    ).not.toBeCloseTo(financed.roi, 2);
    expect(financed.cashOnCash).toBeGreaterThan(financed.roi); // leverage amplifies
  });

  it("coincides with roi only when there is no financing", () => {
    const unleveraged = financialOsSide({ loanAmount: 0 });
    expect(unleveraged.cashOnCash).toBeCloseTo(unleveraged.roi, 2);
  });

  it("leverage does not move ROI (the guard that the two are really distinct)", () => {
    // If a loan changed roi, the split would be cosmetic — one number renamed
    // twice rather than two different questions.
    expect(financialOsSide({ loanAmount: 70_000 }).roi).toBeCloseTo(
      financialOsSide({ loanAmount: 0 }).roi,
      2,
    );
  });

  it("a down payment received also comes out of the cash denominator", () => {
    const withDown = financialOsSide({ isOwnerFinanced: true, downPaymentReceived: 20_000 });
    const without = financialOsSide({ isOwnerFinanced: true, downPaymentReceived: 0 });
    expect(withDown.cashOnCash).toBeGreaterThan(without.cashOnCash);
  });
});

describe("there is one owner", () => {
  const fin = fs.readFileSync(path.join(ROOT, "server/services/financialOSService.ts"), "utf8");

  it("financialOSService delegates rather than recomputing", () => {
    expect(
      fin,
      "financialOSService no longer calls the canonical engine. It used to compute " +
        "grossProfit/netProfit/roi itself and disagreed with bookkeeping.ts about " +
        "all three on the same deal.",
    ).toContain("bookkeepingDealPnL(");
  });

  it("and it no longer defines the disputed figures itself", () => {
    const strip = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const code = strip(fin);
    expect(code, "financialOS is computing grossProfit again").not.toMatch(
      /const\s+grossProfit\s*=/,
    );
    expect(code, "financialOS is computing netProfit again").not.toMatch(/const\s+netProfit\s*=/);
  });

  it("it uses the integer-cents house rule it previously ignored", () => {
    // It had ZERO shared/finance/cents imports and did raw float arithmetic on
    // money throughout, while the canonical engine has used sumCents since W3.3.
    expect(fin).toMatch(/from\s+["']@shared\/finance\/cents["']/);
    expect(fin).toContain("sumCents(");
  });

  it("the detectors would notice (guards against vacuous passes)", () => {
    expect(/const\s+grossProfit\s*=/.test("  const grossProfit = a - b;")).toBe(true);
    expect(fin.length).toBeGreaterThan(1000);
  });
});
