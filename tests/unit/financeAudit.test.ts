// ============================================================================
// tests/unit/financeAudit.test.ts
// ----------------------------------------------------------------------------
// LENA #2 — the finance-audit detectors. Drives each detector's run() against
// mock ledger / runway data and asserts the FindingInput it emits (severity +
// dedupe_key + metadata) — the contract the shared E1 substrate records.
//
// Detectors under test:
//   • envelope_overrun  — trailing-30d AI spend vs the SOLENE envelope.
//   • runway_crunch     — downside months-to-zero from the runway model.
//   • tax_reserve       — re-exported exemplar; we confirm it's in the
//                         registry (its own logic is covered by
//                         domainAudit.test.ts).
//
// We mock the modules each detector imports so importing the SUT opens no DB.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// envelope_overrun reads a single SUM(cost_usd) off solene_capital_events.
// We back the select chain with a controllable scalar.
const ENVELOPE = { spentUsd: 0 };

vi.mock("../../server/db", () => {
  const select = (_sel?: unknown) => {
    const step: any = {
      from: () => step,
      where: () => Promise.resolve([{ total: ENVELOPE.spentUsd }]),
    };
    return step;
  };
  return { db: { select } };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    and: (..._p: unknown[]) => ({}),
    eq: () => ({}),
    gte: () => ({}),
    lt: () => ({}),
    sql: (() => {
      const expr = () => {
        const e: any = { op: "sql" };
        e.mapWith = () => e;
        return e;
      };
      const tag: any = (..._a: unknown[]) => expr();
      tag.raw = () => expr();
      return tag;
    })(),
  };
});

vi.mock("@shared/schema", () => ({
  financialLedger: {},
  organizations: {},
}));

vi.mock("@shared/schema/solene-capital", () => ({
  soleneCapitalEvents: { costUsd: {}, occurredAt: {} },
  DEFAULT_MONTHLY_ENVELOPE_USD: 50,
  ENVELOPE_THRESHOLDS: { amberPercent: 70, redPercent: 90 },
}));

// runway_crunch reads computeRunway() — make it controllable.
const RUNWAY = {
  base: 24 as number | null,
  downside: 20 as number | null,
  upside: 30 as number | null,
  cashOnHandUsd: 24_000,
  cashBasis: "ledger" as "ledger" | "founder-declared",
};

vi.mock("../../server/services/finance/runwayModel", () => ({
  computeRunway: vi.fn(async () => ({
    asOf: new Date().toISOString(),
    cashOnHandUsd: RUNWAY.cashOnHandUsd,
    cashBasis: RUNWAY.cashBasis,
    isModeled: true,
    scenarios: {
      base: { monthsToZero: RUNWAY.base },
      downside: { monthsToZero: RUNWAY.downside },
      upside: { monthsToZero: RUNWAY.upside },
    },
    inputs: {},
  })),
}));

// tax_reserve exemplar — stub so the registry import resolves; its own logic
// is covered in domainAudit.test.ts.
vi.mock("../../server/services/audit/detectors/taxReserveDetector", () => ({
  taxReserveDetector: { id: "tax_reserve", domain: "finance", run: vi.fn(async () => []) },
}));

import {
  envelopeOverrunDetector,
  runwayCrunchDetector,
  financeDetectors,
  RUNWAY_WARN_MONTHS,
  RUNWAY_CRITICAL_MONTHS,
} from "../../server/services/lena/financeAudit";

beforeEach(() => {
  ENVELOPE.spentUsd = 0;
  RUNWAY.base = 24;
  RUNWAY.downside = 20;
  RUNWAY.upside = 30;
  RUNWAY.cashOnHandUsd = 24_000;
  RUNWAY.cashBasis = "ledger";
  delete process.env.SOLENE_MONTHLY_ENVELOPE_USD;
});
afterEach(() => vi.clearAllMocks());

// ── envelope_overrun ─────────────────────────────────────────────────────────

describe("envelopeOverrunDetector", () => {
  it("is silent below the amber threshold (70%)", async () => {
    ENVELOPE.spentUsd = 30; // 60% of $50
    const out = await envelopeOverrunDetector.run();
    expect(out).toHaveLength(0);
  });

  it("warns at/above amber but below red (70–90%)", async () => {
    ENVELOPE.spentUsd = 40; // 80% of $50
    const [f] = await envelopeOverrunDetector.run();
    expect(f).toBeDefined();
    expect(f.severity).toBe("warn");
    expect(f.detector).toBe("envelope_overrun");
    expect(f.dedupeKey).toBe("envelope_overrun:ai");
    expect((f.metadata as any).pctUsed).toBeCloseTo(80, 1);
  });

  it("is critical at/above red (90%) and reports the overage", async () => {
    ENVELOPE.spentUsd = 60; // 120% of $50 — over by $10
    const [f] = await envelopeOverrunDetector.run();
    expect(f.severity).toBe("critical");
    expect((f.metadata as any).overByUsd).toBeCloseTo(10, 5);
  });

  it("honours the SOLENE_MONTHLY_ENVELOPE_USD override", async () => {
    process.env.SOLENE_MONTHLY_ENVELOPE_USD = "100";
    ENVELOPE.spentUsd = 60; // 60% of $100 → silent
    expect(await envelopeOverrunDetector.run()).toHaveLength(0);
  });
});

// ── runway_crunch ────────────────────────────────────────────────────────────

describe("runwayCrunchDetector", () => {
  it("is silent when downside runway is comfortable (>= 9mo)", async () => {
    RUNWAY.downside = 12;
    RUNWAY.base = 18;
    expect(await runwayCrunchDetector.run()).toHaveLength(0);
  });

  it(`warns when downside dips below ${RUNWAY_WARN_MONTHS}mo but stays above ${RUNWAY_CRITICAL_MONTHS}`, async () => {
    RUNWAY.downside = 7;
    RUNWAY.base = 10;
    const [f] = await runwayCrunchDetector.run();
    expect(f.severity).toBe("warn");
    expect(f.detector).toBe("runway_crunch");
    expect((f.metadata as any).downsideMonthsToZero).toBe(7);
  });

  it(`is critical when downside drops below ${RUNWAY_CRITICAL_MONTHS}mo`, async () => {
    RUNWAY.downside = 4;
    RUNWAY.base = 6;
    const [f] = await runwayCrunchDetector.run();
    expect(f.severity).toBe("critical");
  });

  it("does not fire when there is no cash basis (null months)", async () => {
    RUNWAY.downside = null;
    RUNWAY.base = null;
    expect(await runwayCrunchDetector.run()).toHaveLength(0);
  });

  it("falls back to the base scenario when downside is null", async () => {
    RUNWAY.downside = null;
    RUNWAY.base = 5; // below critical
    const [f] = await runwayCrunchDetector.run();
    expect(f).toBeDefined();
    expect(f.severity).toBe("critical");
  });
});

// ── registry ─────────────────────────────────────────────────────────────────

describe("financeDetectors registry", () => {
  it("registers the three finance-domain detectors, all domain 'finance'", () => {
    const ids = financeDetectors.map((d) => d.id).sort();
    expect(ids).toEqual(["envelope_overrun", "runway_crunch", "tax_reserve"]);
    expect(financeDetectors.every((d) => d.domain === "finance")).toBe(true);
  });
});
