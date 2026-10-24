/**
 * P1 false-claims sweep — no tax position on rate tables for another year.
 *
 * taxOptimizer.ts carries 2024 single-filer brackets and estimates with a flat
 * 15% / 24% "simplified estimate", and returned that as the user's tax
 * position for whatever year was asked — 2026 by default. This drives the REAL
 * service: a year the tables do not cover is refused before any data is read
 * (both the year-end position and the per-deal estimate), and a covered year
 * states its table year and basis alongside the non-advice disclaimer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  select: vi.fn(),
  rowsFor: [] as unknown[][],
}));

vi.mock("../../server/db", () => ({
  db: {
    select: h.select,
  },
}));
vi.mock("../../server/services/aiRouter", () => ({ generateWithAutoRouting: vi.fn(async () => ({ content: "x" })) }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  taxOptimizerService,
  TaxTableNotOnFileError,
  TAX_TABLE_YEARS,
} from "../../server/services/taxOptimizer";
import { TAX_ADVISORY_COPY } from "../../server/utils/taxAdvisory";

/** db.select().from().where() resolving the queued row sets in order. */
function queueRows(...sets: unknown[][]) {
  const queue = [...sets];
  h.select.mockImplementation(() => ({
    from: () => ({ where: async () => queue.shift() ?? [] }),
  }));
}

beforeEach(() => {
  h.select.mockReset();
});

describe("tax optimizer refuses years its tables do not cover", () => {
  it("has a table year on file (vacuity), and it is not every year", () => {
    expect(TAX_TABLE_YEARS.length).toBeGreaterThan(0);
    expect(TAX_TABLE_YEARS).not.toContain(2026);
  });

  for (const year of [2026, 2025, 2023]) {
    if (TAX_TABLE_YEARS.includes(year)) continue;
    it(`refuses a ${year} year-end position before reading any data`, async () => {
      queueRows([], []);
      await expect(taxOptimizerService.analyzeYearEndPosition(7, year)).rejects.toBeInstanceOf(TaxTableNotOnFileError);
      expect(h.select).not.toHaveBeenCalled();
    });
  }

  it("refuses the AI planning report for an uncovered year (it rests on the position)", async () => {
    queueRows([], []);
    await expect(taxOptimizerService.generateTaxPlanningReport(7, 2026)).rejects.toBeInstanceOf(TaxTableNotOnFileError);
  });

  it("refuses a per-deal estimate whose sale falls in an uncovered year", async () => {
    queueRows([{ id: 1, organizationId: 7, acceptedAmount: "100000", closingDate: new Date("2026-03-01"), createdAt: new Date("2024-01-01"), analysisResults: { purchasePrice: "40000" }, closingCosts: "0" }]);
    await expect(taxOptimizerService.estimateDealTax(7, 1)).rejects.toBeInstanceOf(TaxTableNotOnFileError);
  });

  it("a covered year states the table year, the basis, and the non-advice disclaimer", async () => {
    const year = TAX_TABLE_YEARS[0];
    queueRows([], []);
    const pos = await taxOptimizerService.analyzeYearEndPosition(7, year);
    expect(pos.taxTable.year).toBe(year);
    expect(pos.taxTable.basis).toMatch(/flat 15%/i);
    expect(pos.disclaimer).toBe(TAX_ADVISORY_COPY);
  });
});
