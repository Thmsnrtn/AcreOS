/**
 * 1099-NEC is withheld until its reporting threshold is confirmed
 * (founder decision 2026-11-05).
 *
 * POST /api/contractors/1099-nec-batch applies a hard-coded threshold
 * (NEC_THRESHOLD_CENTS) that a qualified tax reviewer (K13) has not confirmed
 * for payments made after 2025. Until that determination is recorded, the
 * route refuses exactly like the 1099-INT entry points do (DEFECT-0101): the
 * SAME gate, `requireQualified1099Output`, with the same founder bypass and the
 * same fail-closed 422 `not_qualified_filing_output` — but reading the NEC
 * determination's OWN flag. An INT determination never opens NEC; an NEC
 * determination never opens INT.
 *
 * This file drives the real route and the real gate. Only the flag store, the
 * founder check, the db and the PDF renderer are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

// Walks the server tree (the flag-naming population check below).
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const INT_FLAG = "tax.1099int.direction_reviewed";
const NEC_FLAG = "tax.1099nec.threshold_confirmed";

const h = vi.hoisted(() => {
  process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64);
  return {
    flagsOn: new Set<string>(),
    flagThrows: false,
    flagKeysRead: [] as string[],
    founderEmails: new Set<string>(),
    user: { id: "u1", email: "owner@flipper.test" } as { id: string; email: string },
    org: {} as Record<string, unknown>,
    select: vi.fn(),
    execute: vi.fn(),
    generate: vi.fn(() => Buffer.from("%PDF")),
    logInfo: vi.fn(),
  };
});

vi.mock("../../server/services/featureFlags", () => ({
  featureFlagService: {
    isEnabled: vi.fn(async (key: string) => {
      h.flagKeysRead.push(key);
      if (h.flagThrows) throw new Error("flag store down");
      return h.flagsOn.has(key);
    }),
  },
  buildFlagContext: (req: any) => ({ userId: req.user?.id, isFounder: false, email: req.user?.email }),
}));
vi.mock("../../server/services/founder", () => ({
  isFounderEmail: (email: string | null | undefined) => !!email && h.founderEmails.has(email),
}));
vi.mock("../../server/db", () => ({
  db: {
    select: (...a: unknown[]) => {
      h.select(...a);
      return { from: () => ({ where: async () => [h.org] }) };
    },
    execute: h.execute,
  },
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization: unknown; user: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7, ...h.org };
    req.user = h.user;
    n();
  },
}));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/services/form1099NecPdf", () => ({ generate1099NecPdf: h.generate }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: h.logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerContractorRoutes } from "../../server/routes-contractors";
import { NEC_THRESHOLD_CENTS, NEC_THRESHOLD_REVIEW_NOTE } from "../../server/services/form1099NecPayer";
import { requireQualified1099Output } from "../../server/services/form1099Refusal";
import { encrypt } from "../../server/services/fieldEncryption";

const ADDRESS = { line1: "1 Main", city: "Austin", state: "TX", zip: "78701" };
const QUALIFIED_PAYER_ORG = {
  name: "Acre Holdings",
  legalEntityName: "Acre Holdings LLC",
  ein: encrypt("12-3456789"),
  taxIdType: "EIN",
  taxAddress: ADDRESS,
};
const CONTRACTOR_ROW = {
  id: "c1",
  name: "Marcus",
  legal_entity_name: "Marcus Construction LLC",
  business_name: null,
  email: null,
  address: { line1: "9 Oak St", city: "Austin", state: "TX", zip: "78701" },
  tax_id_encrypted: "123456789",
  tax_id_type: "ein",
  total_cents: 150000,
};

function app() {
  const a = express();
  a.use(express.json());
  registerContractorRoutes(a);
  return a;
}
const postBatch = () => request(app()).post("/api/contractors/1099-nec-batch?taxYear=2026").send({});

beforeEach(() => {
  h.flagsOn = new Set();
  h.flagThrows = false;
  h.flagKeysRead = [];
  h.founderEmails = new Set(["founder@acreos.test"]);
  h.user = { id: "u1", email: "owner@flipper.test" };
  h.org = { ...QUALIFIED_PAYER_ORG };
  h.select.mockClear();
  h.execute.mockReset();
  h.execute.mockResolvedValue({ rows: [CONTRACTOR_ROW] });
  h.generate.mockClear();
  h.logInfo.mockClear();
});

function expectNothingGenerated() {
  expect(h.select, "the payer org must not even be read").not.toHaveBeenCalled();
  expect(h.execute, "no batch query may run").not.toHaveBeenCalled();
  expect(h.generate, "no 1099-NEC PDF may be rendered").not.toHaveBeenCalled();
  expect(
    h.logInfo.mock.calls.some((c) => /1099-NEC batch generated/.test(String(c[0]))),
    "nothing may be logged as if a batch was generated",
  ).toBe(false);
}

describe("POST /api/contractors/1099-nec-batch refuses until the NEC threshold is confirmed", () => {
  it("refuses with the structured 422 and generates nothing (no determination recorded)", async () => {
    const res = await postBatch();
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "not_qualified_filing_output",
      statusCode: 422,
      details: { reason: "nec_threshold_unconfirmed", flagKey: NEC_FLAG, thresholdCents: NEC_THRESHOLD_CENTS },
    });
    expect(res.body.forms).toBeUndefined();
    expect(res.body.formCount).toBeUndefined();
    expectNothingGenerated();
  });

  it("the refusal states the NEC reason and carries no 1099-INT wording", async () => {
    const res = await postBatch();
    const body = JSON.stringify(res.body);
    expect(res.body.message).toMatch(/1099-NEC/);
    expect(res.body.message).toMatch(/threshold/);
    expect(res.body.message).toMatch(/\$600/);
    expect(body).not.toMatch(/1099-INT/);
    expect(body).not.toMatch(/DEFECT-0101/);
    expect(body).not.toMatch(/RECEIVED|interest|direction/i);
  });

  it("an INT determination does NOT open NEC", async () => {
    h.flagsOn.add(INT_FLAG);
    const res = await postBatch();
    expect(res.status).toBe(422);
    expectNothingGenerated();
  });

  it("fails CLOSED when the flag store throws", async () => {
    h.flagThrows = true;
    const res = await postBatch();
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("not_qualified_filing_output");
    expectNothingGenerated();
  });

  it("generates once the NEC determination is recorded for the org — threshold value unchanged", async () => {
    h.flagsOn.add(NEC_FLAG);
    const res = await postBatch();
    expect(res.status).toBe(200);
    expect(res.body.formCount).toBe(1);
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.flagKeysRead).toEqual([NEC_FLAG]);
    // The figure is the reviewer's to set, not this change's.
    expect(NEC_THRESHOLD_CENTS).toBe(60000);
    expect(NEC_THRESHOLD_REVIEW_NOTE).toMatch(/not been confirmed/);
    expect(res.body.thresholdNote).toBe(NEC_THRESHOLD_REVIEW_NOTE);
  });

  it("the founder passes (that is how the review is exercised against real data)", async () => {
    h.user = { id: "f", email: "founder@acreos.test" };
    const res = await postBatch();
    expect(res.status).toBe(200);
    expect(h.generate).toHaveBeenCalledTimes(1);
  });

  it("the GET preview is outside this change's scope and still answers", async () => {
    const res = await request(app()).get("/api/contractors/1099-nec-batch?taxYear=2026");
    expect(res.status).toBe(200);
    expect(h.generate).not.toHaveBeenCalled();
  });
});

// ── The shared mechanism, one determination per form ─────────────────────────

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined as unknown };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}
async function runGate(form: "1099-INT" | "1099-NEC" | undefined) {
  const res = fakeRes();
  const next = vi.fn();
  const mw = form ? requireQualified1099Output(form) : requireQualified1099Output();
  await mw({ user: { id: "u1", email: "owner@x.test" }, organization: { id: 7 } } as any, res, next);
  return { res, next };
}

describe("requireQualified1099Output — one gate, each form behind its own determination", () => {
  it("each form reads its own flag key, and only that key", async () => {
    const nec = await runGate("1099-NEC");
    expect(h.flagKeysRead).toEqual([NEC_FLAG]);
    expect(nec.res.body.details.flagKey).toBe(NEC_FLAG);
    h.flagKeysRead = [];
    const int = await runGate("1099-INT");
    expect(h.flagKeysRead).toEqual([INT_FLAG]);
    expect(int.res.body.details.flagKey).toBe(INT_FLAG);
    expect(NEC_FLAG).not.toBe(INT_FLAG);
  });

  it("an NEC determination does NOT open INT", async () => {
    h.flagsOn.add(NEC_FLAG);
    const { res, next } = await runGate("1099-INT");
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    expect(res.body.details).toMatchObject({ defect: "DEFECT-0101", flagKey: INT_FLAG });
  });

  it("INT behaviour is unchanged: default form is INT, same body, opened only by its own flag", async () => {
    const dflt = await runGate(undefined);
    expect(dflt.res.statusCode).toBe(422);
    expect(dflt.res.body).toMatchObject({
      error: "not_qualified_filing_output",
      details: { defect: "DEFECT-0101", flagKey: INT_FLAG },
    });
    expect(String(dflt.res.body.message)).toMatch(/RECEIVED/);
    expect(dflt.res.body.details.reason).toBeUndefined();

    h.flagsOn.add(INT_FLAG);
    const open = await runGate(undefined);
    expect(open.next).toHaveBeenCalledTimes(1);
  });
});

describe("the NEC route consults the shared gate — no second mechanism (source, comments stripped)", () => {
  const root = resolve(__dirname, "../..");
  const read = (p: string) => stripComments(readFileSync(resolve(root, p), "utf8"));

  it("the POST registration mounts requireQualified1099Output(\"1099-NEC\") before the handler", () => {
    const src = read("server/routes-contractors.ts");
    // Vacuity: the file must still reach the generator.
    expect(src).toMatch(/generate1099NecPdf\(/);
    expect(src).toMatch(
      /app\.post\(\s*"\/api\/contractors\/1099-nec-batch"\s*,[^]*?requireQualified1099Output\(\s*"1099-NEC"\s*\)[^]*?async\s*\(/,
    );
  });

  it("the route reads no flag of its own", () => {
    const src = read("server/routes-contractors.ts");
    expect(src).not.toMatch(/featureFlagService|isEnabled\(|requireLadderFlag|tax\.1099/);
  });

  it("form1099Refusal.ts is the only server file that names a 1099 determination flag", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts)$/.test(name)) files.push(p);
      }
    };
    walk(resolve(root, "server"));
    // Population floor: the walk actually read the server tree.
    expect(files.length).toBeGreaterThan(200);
    const naming = files
      .filter((f) => /["'`]tax\.1099/.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => relative(root, f));
    expect(naming).toEqual(["server/services/form1099Refusal.ts"]);
  });
});
