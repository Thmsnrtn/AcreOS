/**
 * EL-P1 batch 5 — numbers honesty (A10-01, A8-10, A15-09, A14-05).
 *
 * Behavioural where the code is pure (ROI denominators, uptime detail);
 * source pins where the code is DB-bound (MRR basis contract, trial grant
 * paths), following the batch-2 suite's pin style. Every pin names the
 * defect it guards so a future refactor that reintroduces the defect fails
 * here first.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeMao } from "../../server/services/flipUnderwriting";
import { gradeRealized } from "../../shared/rehab/realized";
import {
  computeUptimeDetail,
  UPTIME_BASIS_LABEL,
  SAMPLE_INTERVAL_MS,
} from "../../server/services/autopilot/uptime";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ── A8-10 — one ROI denominator convention ────────────────────────────────

const maoDefaults = {
  maoRulePct: 70,
  rehabContingencyPct: 10,
  sellingCostPct: 6,
  purchaseClosingPct: 2,
  holdMonths: 6,
  monthlyHoldingCostCents: 100_000, // $1,000/mo × 6 = $6,000 holding
  targetProfitPct: 15,
};

describe("A8-10 forecast ROI denominator includes holding (matches realised)", () => {
  const forecast = computeMao({
    arvCents: 20_000_000, // $200k
    rehabEstimateCents: 2_000_000, // $20k → $22k with 10% contingency
    purchasePriceCents: 10_000_000, // $100k
    defaults: maoDefaults,
  });

  it("totalCashInCents = purchase + rehab + purchase closing + holding", () => {
    // 100,000 + 22,000 + 2,000 (2% closing) + 6,000 holding = 130,000
    expect(forecast.totalCashInCents).toBe(13_000_000);
    expect(forecast.holdingCostCents).toBe(600_000);
  });

  it("net profit is unchanged by the denominator cure (same numerator)", () => {
    // 200,000 − 12,000 selling (6%) − 130,000 cash in = 58,000
    expect(forecast.netProfitCents).toBe(5_800_000);
  });

  it("netRoiPct divides by the holding-inclusive denominator", () => {
    // 58,000 / 130,000 = 44.6% — NOT 58,000 / 124,000 = 46.8% (the old split)
    expect(forecast.netRoiPct).toBe(44.6);
  });

  it("unknown holding ⇒ net/roi stay null and cash-in excludes holding", () => {
    const noHolding = computeMao({
      arvCents: 20_000_000,
      rehabEstimateCents: 2_000_000,
      purchasePriceCents: 10_000_000,
      defaults: { ...maoDefaults, monthlyHoldingCostCents: 0 },
    });
    expect(noHolding.netProfitCents).toBeNull();
    expect(noHolding.netRoiPct).toBeNull();
    expect(noHolding.totalCashInCents).toBe(12_400_000);
  });

  it("forecast and realised grade the SAME deal to the SAME ratio", () => {
    const realised = gradeRealized({
      facts: { salePriceCents: 20_000_000, sellingCostsCents: 1_200_000, closingDate: "2026-06-01" },
      purchasePriceCents: 10_000_000,
      purchaseClosingCents: 200_000,
      rehabSpentCents: 2_200_000,
      rehabLineCount: 4,
      holdingEntriesTotalCents: 600_000,
      holdingEntryCount: 6,
      startedAt: "2025-12-01",
      scenario: {
        arvCents: 20_000_000,
        profitCents: forecast.netProfitCents,
        roiRatio: forecast.netRoiPct === null ? null : forecast.netRoiPct / 100,
        holdMonths: 6,
      },
    });
    expect(realised.investedCents).toBe(forecast.totalCashInCents);
    expect(realised.realizedNetCents).toBe(forecast.netProfitCents);
    // The comparison delta is ~0 (one-decimal rounding on the forecast side
    // is the only residue) — before the cure it was off by the full holding
    // share of the denominator.
    expect(Math.abs(realised.deltas.roiVsScenarioRatio ?? 99)).toBeLessThan(0.001);
  });
});

// ── A14-05 — uptime % is of the measured span, with the unknown labelled ──

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = 1_750_000_000_000;

function beats(startAgoMs: number, endAgoMs: number): number[] {
  const out: number[] = [];
  for (let t = NOW - startAgoMs; t <= NOW - endAgoMs; t += SAMPLE_INTERVAL_MS) out.push(t);
  return out;
}

describe("A14-05 uptime detail exposes the measured-span basis", () => {
  it("samples covering only the last 2 days of a 30-day window report the other 28 days as unknown", () => {
    const d = computeUptimeDetail(beats(2 * DAY, 0), { now: NOW });
    expect(d).not.toBeNull();
    expect(d!.pct).toBe(100);
    expect(d!.basis).toBe("measured_span");
    expect(d!.windowMs).toBe(30 * DAY);
    expect(d!.measuredSpanMs).toBe(2 * DAY);
    expect(d!.unknownMs).toBe(28 * DAY);
    expect(d!.coveragePct).toBe(6.7);
  });

  it("a mid-span gap counts as downtime in the detail pct", () => {
    const samples = [...beats(24 * HOUR, 13 * HOUR), ...beats(11 * HOUR, 0)];
    const d = computeUptimeDetail(samples, { now: NOW });
    expect(d).not.toBeNull();
    expect(d!.pct).toBeLessThan(93);
    expect(d!.pct).toBeGreaterThan(88);
    expect(d!.basis).toBe("measured_span");
  });

  it("null when there is not enough measured span to claim a number", () => {
    expect(computeUptimeDetail([], { now: NOW })).toBeNull();
    expect(computeUptimeDetail(beats(10 * MIN, 0), { now: NOW })).toBeNull();
  });

  it("the canonical label names the basis", () => {
    expect(UPTIME_BASIS_LABEL).toBe("of measured span");
  });

  it("the founder briefing renders the uptime figure with its basis label", () => {
    const src = read("server/services/autopilot/cognitionContext.ts");
    expect(src).toContain("UPTIME_BASIS_LABEL");
    expect(src).toContain("uptime ${raw.uptimePct}% (${UPTIME_BASIS_LABEL})");
  });
});

// ── A10-01 — MRR is list-price arithmetic, labelled at the source ────────

describe("A10-01 list-price MRR basis contract", () => {
  it("the basis and label constants say what the figure is", () => {
    const src = read("server/services/finance/runwayModel.ts");
    expect(src).toContain('MRR_BASIS = "list_price"');
    expect(src).toContain("MRR at list price for active orgs (billed, not collected)");
  });

  it("liveMrrDetail returns the basis as part of its contract", () => {
    const src = read("server/services/finance/runwayModel.ts");
    expect(src).toContain("basis: MRR_BASIS");
    expect(src).toContain("mrrLabel: LIST_PRICE_MRR_LABEL");
  });

  it("founder-facing renders label the figure as list-price, billed not collected", () => {
    const digest = read("server/services/founderDigest.ts");
    expect(digest).toContain("List-price MRR");
    expect(digest).toContain("billed, not collected");
    const cognition = read("server/services/autopilot/cognitionContext.ts");
    expect(cognition).toContain("list-price MRR, billed not collected");
  });
});

// ── A15-09 — one trial per org across all three grant paths ──────────────

describe("A15-09 trials cannot stack", () => {
  it("the org-creation grant marks the trial used (it IS the org's trial)", () => {
    const src = read("server/middleware/getOrCreateOrg.ts");
    expect(src).not.toContain("trialUsed: isFounder ? true : false");
    const insert = src.slice(src.indexOf("tx.insert(organizations)"));
    expect(insert.slice(0, 1200)).toContain("trialUsed: true");
  });

  it("startTrial refuses on ANY prior grant, not only the flag (pre-cure orgs)", () => {
    const src = read("server/services/trialService.ts");
    expect(src).toContain("status.trialUsed || status.trialStartedAt");
  });

  it("Stripe checkout adds no trial days to an org that already had a grant", () => {
    const src = read("server/routes-billing.ts");
    expect(src).toContain("org.trialUsed || org.trialStartedAt ? undefined : 14");
  });

  it("the AI-budget guard no longer reads trialUsed as 'trial over' (ripple of the flag's meaning)", () => {
    const src = read("server/middleware/expensiveEndpointGuard.ts");
    expect(src).not.toContain("if (org.trialUsed) return false");
  });
});
