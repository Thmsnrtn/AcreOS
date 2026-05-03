/**
 * 1099-INT correctness regression tests.
 *
 * These tests guard against two P0 tax-compliance bugs that previously
 * shipped from server/services/bookkeeping.ts:
 *
 *   1. Hardcoded placeholder identifiers (`payerEin: "00-0000000"`,
 *      `recipientTin: "000-00-0000"`) being emitted on every 1099-INT.
 *   2. The 1099-INT emitter actually using a 1098-shaped record instead of
 *      the IRS Form 1099-INT box layout.
 *
 * If either regresses, CI fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../server/db", () => {
  // We rebuild a tiny query-builder mock per test via `setDbRows`.
  let nextRows: any[][] = [];
  const dbState = {
    setNextRows(rows: any[][]) {
      nextRows = rows;
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(nextRows.shift() ?? [])),
        innerJoin: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            leftJoin: vi.fn(() => ({
              where: vi.fn(() => Promise.resolve(nextRows.shift() ?? [])),
            })),
            where: vi.fn(() => Promise.resolve(nextRows.shift() ?? [])),
          })),
        })),
      })),
    })),
  };
  return { db: dbState, __dbState: dbState };
});

// configManager.decryptValue is exercised — feed a no-op stub so we don't
// need real AES keys in CI. We treat ciphertext as plaintext.
vi.mock("../../server/services/configManager", () => ({
  decryptValue: (s: string) => s,
}));

// ── Imports under test (after mocks) ─────────────────────────────────────────

import {
  generate1099IntForms,
  TaxIdentityError,
  type Form1099Int,
} from "../../server/services/bookkeeping";
import { db as dbMock } from "../../server/db";

const dbState = dbMock as unknown as {
  setNextRows(rows: any[][]): void;
};

// ── Fixture builders ─────────────────────────────────────────────────────────

function org(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "AcreOS Test Org",
    legalEntityName: "AcreOS Test LLC",
    ein: "12-3456789",
    taxIdType: "EIN",
    taxAddress: {
      line1: "100 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
      phone: "555-555-5555",
    },
    ...overrides,
  };
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    payment: {
      id: 1,
      organizationId: 1,
      noteId: 10,
      principalAmount: "100",
      interestAmount: "1500",
      lateFeeAmount: "0",
      paymentDate: new Date("2024-06-01"),
      status: "completed",
    },
    note: {
      id: 10,
      borrowerId: 99,
      originalPrincipal: "50000",
      currentBalance: "45000",
    },
    lead: {
      id: 99,
      firstName: "Jane",
      lastName: "Borrower",
      email: "jane@example.com",
      address: "200 Oak Ln",
      city: "Houston",
      state: "TX",
      zip: "77001",
      taxId: "987-65-4321",
      taxIdType: "SSN",
    },
    property: { address: "5 Pasture Way" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("generate1099IntForms — payer / recipient identity", () => {
  it("rejects orgs missing an EIN with TaxIdentityError", async () => {
    dbState.setNextRows([[org({ ein: null })]]);
    await expect(generate1099IntForms(1, 2024)).rejects.toBeInstanceOf(TaxIdentityError);
  });

  it("rejects placeholder payer EIN even if stored on the org", async () => {
    dbState.setNextRows([
      [org({ ein: "00-0000000" })],
      [paymentRow()],
    ]);
    await expect(generate1099IntForms(1, 2024)).rejects.toThrow(/payer EIN/i);
  });

  it("rejects when borrower lead has no TIN on file", async () => {
    dbState.setNextRows([
      [org()],
      [paymentRow({ lead: { ...paymentRow().lead, taxId: null } })],
    ]);
    await expect(generate1099IntForms(1, 2024)).rejects.toThrow(/W-9|TIN/);
  });

  it("rejects placeholder recipient TIN ('000-00-0000')", async () => {
    dbState.setNextRows([
      [org()],
      [paymentRow({ lead: { ...paymentRow().lead, taxId: "000-00-0000" } })],
    ]);
    await expect(generate1099IntForms(1, 2024)).rejects.toThrow(/TIN/);
  });

  it("never emits the hardcoded placeholders on a successful run", async () => {
    dbState.setNextRows([
      [org()],
      [paymentRow()],
    ]);
    const forms = await generate1099IntForms(1, 2024);
    expect(forms).toHaveLength(1);
    for (const f of forms) {
      expect(f.payerTin).not.toBe("00-0000000");
      expect(f.recipientTin).not.toBe("000-00-0000");
      expect(f.payerTin).not.toMatch(/^0{2}-0{7}$/);
      expect(f.recipientTin).not.toMatch(/^0{3}-0{2}-0{4}$/);
    }
  });
});

describe("generate1099IntForms — IRS Form 1099-INT box shape", () => {
  it("emits the 1099-INT box layout (not 1098)", async () => {
    dbState.setNextRows([
      [org()],
      [paymentRow()],
    ]);
    const [form] = await generate1099IntForms(1, 2024);

    // Must NOT carry the legacy 1098-shaped fields.
    expect((form as any).box1InterestIncome).toBeUndefined();
    expect((form as any).box4FederalWithholding).toBeUndefined();
    expect((form as any).payerEin).toBeUndefined();

    // Must carry the IRS-spec 1099-INT field set.
    const required: (keyof Form1099Int)[] = [
      "box1_interestIncome",
      "box2_earlyWithdrawalPenalty",
      "box3_usSavingsBondInterest",
      "box4_federalIncomeTaxWithheld",
      "box5_investmentExpenses",
      "box6_foreignTaxPaid",
      "box7_foreignCountry",
      "box8_taxExemptInterest",
      "box9_privateActivityBondInterest",
      "box10_marketDiscount",
      "box11_bondPremium",
      "box12_bondPremiumOnTreasury",
      "box13_bondPremiumOnTaxExempt",
      "box14_taxExemptBondCusip",
      "box15_state",
      "box16_statePayerStateNumber",
      "box17_stateTaxWithheld",
      "fatcaFilingRequirement",
      "secondTinNotice",
      "payerTin",
      "payerTinType",
      "recipientTin",
      "recipientTinType",
    ];
    for (const k of required) {
      expect(form, `missing ${k}`).toHaveProperty(k as string);
    }
  });

  it("populates Box 1 with the year's interest income for the qualifying note", async () => {
    dbState.setNextRows([
      [org()],
      [paymentRow()],
    ]);
    const [form] = await generate1099IntForms(1, 2024);
    expect(form.box1_interestIncome).toBe(1500);
    expect(form.taxYear).toBe(2024);
    expect(form.accountNumber).toBe("NOTE-10");
  });

  it("only emits forms for notes with >= $600 of interest", async () => {
    dbState.setNextRows([
      [org()],
      [
        paymentRow(), // 1500
        paymentRow({
          payment: { ...paymentRow().payment, id: 2, noteId: 11, interestAmount: "200" },
          note: { ...paymentRow().note, id: 11 },
          lead: { ...paymentRow().lead, id: 100 },
        }),
      ],
    ]);
    const forms = await generate1099IntForms(1, 2024);
    expect(forms).toHaveLength(1);
    expect(forms[0].box1_interestIncome).toBe(1500);
  });
});
