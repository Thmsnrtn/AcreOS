/**
 * L1 — liability-shield disclaimer legends (server/services/legalDisclaimers.ts).
 *
 * Proves:
 *  1. Every legend constant is non-empty and carries its load-bearing
 *     phrases ("not a consumer credit score", "not legal advice",
 *     "attorney") drawn from the ToS vocabulary.
 *  2. Pure generators embed the legend in their output:
 *     - checkDoddFrankCompliance (both return paths) carries `disclaimer`
 *     - rmloAdvisor.advise carries its always-rendered `disclaimer`
 *     - computePartialLcs carries the informational-score legend
 *
 * These legends only ADD text — none of the assertions here exercise any
 * gating/blocking behavior, because there is none.
 */
import { describe, it, expect, vi } from "vitest";

// computePartialLcs lives in publicParcelReport.ts, which imports db /
// resolveParcel / alertSpine at module scope. Mock those side-effectful
// imports the same way tests/unit/publicParcelReport.test.ts does — the
// pure function under test never touches them.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/parcel/resolveParcel", () => ({
  resolveParcel: vi.fn(),
}));
vi.mock("../../server/services/alertSpine", () => ({
  raiseAlert: vi.fn(async () => undefined),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  DISCLAIMER_INFORMATIONAL_SCORE,
  DISCLAIMER_WORKSHEET,
  DISCLAIMER_DOCUMENT_TEMPLATE,
  DISCLAIMER_AI,
} from "../../server/services/legalDisclaimers";
import { checkDoddFrankCompliance } from "../../server/services/doddFrankChecker";
import { advise } from "../../shared/regulatory/rmloAdvisor";
import { computePartialLcs } from "../../server/services/publicParcelReport";

describe("legalDisclaimers constants", () => {
  const all = {
    DISCLAIMER_INFORMATIONAL_SCORE,
    DISCLAIMER_WORKSHEET,
    DISCLAIMER_DOCUMENT_TEMPLATE,
    DISCLAIMER_AI,
  };

  it("every legend is a non-empty string", () => {
    for (const [name, value] of Object.entries(all)) {
      expect(typeof value, name).toBe("string");
      expect(value.length, name).toBeGreaterThan(40);
    }
  });

  it("score legend carries the not-a-consumer-credit-score framing", () => {
    expect(DISCLAIMER_INFORMATIONAL_SCORE).toContain("not a consumer credit score");
    expect(DISCLAIMER_INFORMATIONAL_SCORE).toContain("FCRA");
    // ToS vocabulary — never a novel legal claim.
    expect(DISCLAIMER_INFORMATIONAL_SCORE).toContain(
      "not a broker, lender, servicer, real estate agent, investment adviser, or fiduciary",
    );
  });

  it("document-template legend carries the not-legal-advice + attorney framing", () => {
    expect(DISCLAIMER_DOCUMENT_TEMPLATE).toContain("not legal advice");
    expect(DISCLAIMER_DOCUMENT_TEMPLATE).toContain("attorney");
    expect(DISCLAIMER_DOCUMENT_TEMPLATE).toContain("does not practice law");
  });

  it("worksheet legend carries the verify-with-attorney/CPA framing", () => {
    expect(DISCLAIMER_WORKSHEET).toContain("attorney");
    expect(DISCLAIMER_WORKSHEET).toContain("CPA");
    expect(DISCLAIMER_WORKSHEET).toContain("informational worksheet");
    // ToS vocabulary.
    expect(DISCLAIMER_WORKSHEET).toContain(
      "does not provide legal, financial, investment, or tax advice",
    );
  });

  it("AI legend carries the may-contain-errors framing", () => {
    expect(DISCLAIMER_AI).toContain("may contain errors");
    expect(DISCLAIMER_AI).toContain("informational purposes");
  });
});

describe("generators embed the legend in their output", () => {
  it("checkDoddFrankCompliance carries the disclaimer on the land-only path", () => {
    const result = checkDoddFrankCompliance({
      sellerFinancedDealsLast12Months: 1,
      sellerType: "natural_person",
      hasDwelling: false,
      sellerConstructedDwelling: false,
      isSellerResidence: false,
      loanTermMonths: 60,
      rateType: "fixed",
      interestRate: 9,
    });
    expect(result.risk).toBe("compliant");
    expect(result.disclaimer).toBe(DISCLAIMER_WORKSHEET);
  });

  it("checkDoddFrankCompliance carries the disclaimer on the dwelling path", () => {
    const result = checkDoddFrankCompliance({
      sellerFinancedDealsLast12Months: 2,
      sellerType: "natural_person",
      hasDwelling: true,
      sellerConstructedDwelling: false,
      isSellerResidence: false,
      loanTermMonths: 120,
      rateType: "fixed",
      interestRate: 8,
    });
    expect(result.disclaimer).toBe(DISCLAIMER_WORKSHEET);
  });

  it("rmloAdvisor.advise always carries its not-legal-advice disclaimer", () => {
    const result = advise({
      state: "TX",
      collateralType: "vacant_land",
      loanAmountCents: 5_000_000,
      annualRateBps: 900,
      isOriginating: true,
    });
    expect(typeof result.disclaimer).toBe("string");
    expect(result.disclaimer).toContain("Not legal advice");
    expect(result.disclaimer).toContain("attorney");
  });

  it("computePartialLcs carries the informational-score legend", () => {
    const lcs = computePartialLcs([]);
    expect(lcs.disclaimer).toBe(DISCLAIMER_INFORMATIONAL_SCORE);
  });
});
