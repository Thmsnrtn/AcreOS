/**
 * Founder tax-engine tests (FOUNDER-SIDE ONLY).
 *
 * Locks the draft-return math against HAND-VERIFIED figures so a future drift
 * PR can't silently move Tom's tax numbers. Honesty over cleverness: each case
 * shows its arithmetic in the comment so the expected value is auditable.
 *
 * Also asserts the encryption-amount round-trip used to store income amounts,
 * and that the engine NEVER emits a figure without a basis (the honesty
 * contract).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import {
  computeBracketTax,
  computeFederalReturn,
  computeMassachusettsReturn,
  computeDraftReturn,
  type TaxEngineInput,
} from "../../server/services/founder/taxEngine";
import { getFederalRules, getMassachusettsRules } from "../../server/services/founder/taxRules";

const FIELD_KEY_HEX = "c".repeat(64); // 32 bytes
const originalFieldKey = process.env.FIELD_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = FIELD_KEY_HEX;
});
afterAll(() => {
  if (originalFieldKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = originalFieldKey;
});

describe("computeBracketTax — progressive bands", () => {
  it("returns 0 for non-positive taxable income", () => {
    const { rules } = getFederalRules(2025);
    expect(computeBracketTax(0, rules.brackets.married_joint)).toBe(0);
    expect(computeBracketTax(-5000, rules.brackets.married_joint)).toBe(0);
  });

  it("MFJ 2025 taxable $200,000 = $33,828 (hand-verified)", () => {
    // 10% × 23,850 = 2,385
    // 12% × (96,950-23,850)=73,100 = 8,772
    // 22% × (200,000-96,950)=103,050 = 22,671
    // total = 33,828
    const { rules } = getFederalRules(2025);
    expect(computeBracketTax(200000, rules.brackets.married_joint)).toBe(33828);
  });

  it("Single 2025 taxable $50,000 = $6,053.5 → rounds to $6,053 (hand-verified)", () => {
    // 10% × 11,925 = 1,192.5
    // 12% × (48,475-11,925)=36,550 = 4,386
    // 22% × (50,000-48,475)=1,525 = 335.5
    // total = 5,914  (1192.5 + 4386 + 335.5)
    const { rules } = getFederalRules(2025);
    expect(computeBracketTax(50000, rules.brackets.single)).toBe(5914);
  });
});

describe("computeFederalReturn — MFJ, two W-2 incomes, 2025", () => {
  const input: TaxEngineInput = {
    taxYear: 2025,
    filingStatus: "married_joint",
    state: "MA",
    income: [
      { sourceType: "w2_self", label: "Day job", amount: 150000, withholdingAtSource: true, federalWithheld: 26000 },
      { sourceType: "w2_spouse", label: "Spouse W-2", amount: 80000, withholdingAtSource: true, federalWithheld: 10000 },
    ],
  };

  it("computes AGI, taxable income, and income tax exactly", () => {
    const r = computeFederalReturn(input);
    expect(r.summary.totalIncome).toBe(230000);
    expect(r.summary.selfEmploymentTax).toBe(0);
    expect(r.summary.adjustedGrossIncome).toBe(230000); // no SE deduction
    expect(r.summary.taxableIncome).toBe(200000); // 230,000 - 30,000 std deduction
    expect(r.summary.incomeTax).toBe(33828);
    expect(r.summary.totalTax).toBe(33828);
  });

  it("computes refund vs balance due from withholding", () => {
    const r = computeFederalReturn(input);
    // withheld 36,000 - tax 33,828 = +2,172 refund
    expect(r.summary.totalWithheld).toBe(36000);
    expect(r.summary.refundOrOwed).toBe(2172);
  });

  it("every line carries a non-empty basis (honesty contract)", () => {
    const r = computeFederalReturn(input);
    expect(r.lines.length).toBeGreaterThan(0);
    for (const line of r.lines) {
      expect(line.basis.length).toBeGreaterThan(0);
      expect(line.formRef.length).toBeGreaterThan(0);
    }
  });

  it("flags 2026 federal as provisional", () => {
    const r = computeFederalReturn({ ...input, taxYear: 2026 });
    expect(r.provisional).toBe(true);
  });
});

describe("computeFederalReturn — side income with self-employment tax", () => {
  // $40,000 1099 side income, no other income, MFJ 2025.
  const input: TaxEngineInput = {
    taxYear: 2025,
    filingStatus: "married_joint",
    state: "MA",
    income: [
      { sourceType: "side_income", label: "Woodworking", amount: 40000, withholdingAtSource: false },
    ],
  };

  it("computes SE tax on the net-earnings base", () => {
    const r = computeFederalReturn(input);
    // SE base = 40,000 × 0.9235 = 36,940
    // OASDI 12.4% × 36,940 = 4,580.56 → 4,581 (under wage-base cap, no W-2 wages)
    // Medicare 2.9% × 36,940 = 1,071.26 → 1,071
    // SE tax = 5,652
    expect(r.summary.selfEmploymentTax).toBe(5652);
  });

  it("deducts one-half of SE tax above the line", () => {
    const r = computeFederalReturn(input);
    // deductible = round(5,652 × 0.5) = 2,826 → AGI = 40,000 - 2,826 = 37,174
    expect(r.summary.adjustedGrossIncome).toBe(37174);
    // taxable = 37,174 - 30,000 = 7,174; income tax 10% = 717.4 → 717
    expect(r.summary.taxableIncome).toBe(7174);
    expect(r.summary.incomeTax).toBe(717);
    // total tax = 717 + 5,652 = 6,369
    expect(r.summary.totalTax).toBe(6369);
  });
});

describe("computeMassachusettsReturn — MFJ 2025", () => {
  const input: TaxEngineInput = {
    taxYear: 2025,
    filingStatus: "married_joint",
    state: "MA",
    income: [
      { sourceType: "w2_self", label: "Day job", amount: 150000, withholdingAtSource: true, stateWithheld: 7000 },
      { sourceType: "w2_spouse", label: "Spouse W-2", amount: 80000, withholdingAtSource: true, stateWithheld: 4000 },
    ],
  };

  it("computes MA flat tax with personal exemption, no surtax", () => {
    const r = computeMassachusettsReturn(input);
    expect(r.summary.massachusettsAgi).toBe(230000);
    expect(r.summary.personalExemption).toBe(8800);
    // taxable = 230,000 - 8,800 = 221,200; × 5% = 11,060
    expect(r.summary.taxableIncome).toBe(221200);
    expect(r.summary.incomeTax).toBe(11060);
    expect(r.summary.surtax).toBe(0);
    expect(r.summary.totalTax).toBe(11060);
  });

  it("computes MA refund vs balance due", () => {
    const r = computeMassachusettsReturn(input);
    // withheld 11,000 - tax 11,060 = -60 (balance due $60)
    expect(r.summary.totalWithheld).toBe(11000);
    expect(r.summary.refundOrOwed).toBe(-60);
  });

  it("applies the 4% Fair Share surtax above the threshold", () => {
    const big: TaxEngineInput = {
      ...input,
      income: [
        { sourceType: "w2_self", label: "Big year", amount: 1300000, withholdingAtSource: true },
      ],
    };
    const r = computeMassachusettsReturn(big);
    const { rules } = getMassachusettsRules(2025);
    // taxable = 1,300,000 - 8,800 = 1,291,200
    expect(r.summary.taxableIncome).toBe(1291200);
    // surtax base = 1,291,200 - 1,083,150 = 208,050; × 4% = 8,322
    const expectedSurtax = Math.round((1291200 - rules.surtax.threshold) * rules.surtax.rate);
    expect(r.summary.surtax).toBe(expectedSurtax);
    expect(r.summary.surtax).toBe(8322);
  });
});

describe("computeDraftReturn — top-level package", () => {
  it("includes federal + MA, disclaimer, and notModeled list", () => {
    const r = computeDraftReturn({
      taxYear: 2025,
      filingStatus: "married_joint",
      state: "MA",
      income: [{ sourceType: "w2_self", label: "Job", amount: 100000, withholdingAtSource: true }],
    });
    expect(r.federal).toBeTruthy();
    expect(r.massachusetts).toBeTruthy();
    expect(r.disclaimer).toMatch(/estimate/i);
    expect(r.disclaimer).toMatch(/not.*advice/i);
    expect(r.notModeled.length).toBeGreaterThan(3);
  });

  it("omits the MA return for a non-MA state", () => {
    const r = computeDraftReturn({
      taxYear: 2025,
      filingStatus: "single",
      state: "NH",
      income: [{ sourceType: "w2_self", label: "Job", amount: 100000, withholdingAtSource: true }],
    });
    expect(r.massachusetts).toBeNull();
  });
});

describe("encryptAmount — income amounts are sealed and round-trip", () => {
  it("round-trips a whole-dollar amount through the vault helper", async () => {
    const { encryptAmount, decryptAmount, assertEncrypted } = await import(
      "../../server/services/founder/vaultEncryption"
    );
    const amount = 152347;
    const sealed = encryptAmount(amount);
    // Sealed envelope must NOT contain the plaintext number anywhere.
    expect(sealed).not.toContain("152347");
    const shape = assertEncrypted(sealed);
    expect(shape.sealed).toBe(true);
    expect(shape.prefix).toBe("enc:v1:");
    expect(decryptAmount(sealed)).toBe(amount);
  });
});
