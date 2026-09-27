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

// ── DEFECT-0101 — the refusal posture ────────────────────────────────────────
//
// Everything above pins the generator's SHAPE. This block pins that no customer
// path can reach it: the org is cast as PAYER of interest it RECEIVED, which
// is the wrong direction for Form 1099-INT, so every entry point refuses with
// one structured 422 until a qualified tax reviewer settles the direction. The
// founder passes (that is how the review is exercised); a ladder flag can open
// it per org; a flag-store error is a refusal, not a filing.
//
// The generator tests above are deliberately KEPT (retitled in spirit as
// "direction unreviewed"): they still guard the placeholder-TIN and box-layout
// regressions on the code the founder can still run.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const flagState = vi.hoisted(() => ({ enabled: false, throws: false, founderEmails: new Set<string>() }));

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
  isFounderEmail: (email: string | null | undefined) => !!email && flagState.founderEmails.has(email),
}));

import {
  requireQualified1099Output,
  assertQualified1099JobPayload,
  QUALIFIED_1099_PAYLOAD_MARK,
} from "../../server/services/form1099Refusal";
import { generateAnnualInterestReport } from "../../server/services/bookkeeping";

const NOT_QUALIFIED_1099_ERROR = "not_qualified_filing_output";

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined as unknown };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

async function runMiddleware(req: any) {
  const res = fakeRes();
  const next = vi.fn();
  await requireQualified1099Output()(req, res, next);
  return { res, next };
}

describe("DEFECT-0101 — requireQualified1099Output refuses unqualified 1099-INT output", () => {
  beforeEach(() => {
    flagState.enabled = false;
    flagState.throws = false;
    flagState.founderEmails = new Set(["founder@acreos.test"]);
  });

  it("refuses a customer with a structured 422 naming the defect (flag off)", async () => {
    const { res, next } = await runMiddleware({ user: { id: "u1", email: "owner@lender.test" }, organization: { id: 7 } });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({
      error: NOT_QUALIFIED_1099_ERROR,
      statusCode: 422,
      details: { defect: "DEFECT-0101" },
    });
    expect(String((res.body as any).message)).toMatch(/RECEIVED/);
  });

  it("lets the founder through", async () => {
    const { res, next } = await runMiddleware({ user: { id: "f", email: "founder@acreos.test" } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("lets an org through once the direction-reviewed flag is enabled for it", async () => {
    flagState.enabled = true;
    const { next } = await runMiddleware({ user: { id: "u1", email: "owner@lender.test" }, organization: { id: 7 } });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("fails CLOSED when the flag store throws — a broken gate is a refusal, not a filing", async () => {
    flagState.throws = true;
    const { res, next } = await runMiddleware({ user: { id: "u1", email: "owner@lender.test" }, organization: { id: 7 } });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    expect((res.body as any).error).toBe(NOT_QUALIFIED_1099_ERROR);
  });
});

describe("DEFECT-0101 — the worker refuses an unstamped batch payload", () => {
  it("refuses a payload the route did not qualify (e.g. queued before the refusal existed)", () => {
    const v = assertQualified1099JobPayload({ organizationId: 1, taxYear: 2025 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.defect).toBe("DEFECT-0101");
  });
  it("accepts a payload the route stamped after its own middleware passed", () => {
    expect(assertQualified1099JobPayload({ organizationId: 1, taxYear: 2025, qualifiedBy: QUALIFIED_1099_PAYLOAD_MARK }).ok).toBe(true);
  });
});

describe("DEFECT-0101 — every entry point is behind the refusal (source, comments stripped)", () => {
  const root = resolve(__dirname, "../..");
  const read = (p: string) => stripComments(readFileSync(resolve(root, p), "utf8"));

  const ROUTES: Array<{ file: string; registration: RegExp; generator: RegExp }> = [
    {
      file: "server/routes-bookkeeping.ts",
      registration: /router\.get\(\s*"\/1099"\s*,\s*requireQualified1099Output\(\)/,
      generator: /generate1099IntForms\(/,
    },
    {
      file: "server/routes-elite-features.ts",
      registration: /app\.get\(\s*"\/api\/bookkeeping\/1099-int"\s*,\s*\.\.\.auth\s*,\s*requireQualified1099Output\(\)/,
      generator: /generate1099IntForms\(/,
    },
    {
      file: "server/routes-accounting.ts",
      registration: /router\.post\(\s*"\/1099-batch"\s*,\s*requireQualified1099Output\(\)/,
      generator: /generate1099Batch\(/,
    },
    {
      // DEFECT-0125 — the stored FIRE file of an earlier batch is served here.
      file: "server/routes-accounting.ts",
      registration: /router\.get\(\s*"\/1099-batch\/:jobId"\s*,\s*requireQualified1099Output\(\)/,
      generator: /getForm1099BatchStatus\(/,
    },
  ];

  for (const r of ROUTES) {
    it(`${r.file} registers the refusal on the 1099 route it serves`, () => {
      const src = read(r.file);
      // Vacuity: the file must still reach the generator, or this pin is
      // scanning the wrong population.
      expect(src, `${r.file} no longer references the generator — update this pin`).toMatch(r.generator);
      expect(src).toMatch(r.registration);
    });
  }

  it("the async batch payload is stamped only after the middleware, and the worker demands the stamp before generating", () => {
    const route = read("server/routes-accounting.ts");
    expect(route).toMatch(/qualifiedBy:\s*QUALIFIED_1099_PAYLOAD_MARK/);
    const worker = read("server/worker.ts");
    const body = worker.slice(worker.indexOf("async function handle1099BatchGenerate"));
    const assertAt = body.indexOf("assertQualified1099JobPayload(payload)");
    const generateAt = body.indexOf("generate1099Batch(");
    expect(assertAt).toBeGreaterThan(-1);
    expect(generateAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(generateAt);
  });
});

describe("DEFECT-0101 — the annual report says what `requires1099` measures", () => {
  it("carries the note that the flag is interest RECEIVED, not a filing determination", async () => {
    dbState.setNextRows([[]]);
    const report = await generateAnnualInterestReport(1, 2025);
    expect(report.requires1099Note).toMatch(/RECEIVED/);
    expect(report.requires1099Note).toMatch(/\$600/);
    expect(report.requires1099Note).toMatch(/DEFECT-0101/);
  });
});
