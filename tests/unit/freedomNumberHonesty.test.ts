/**
 * GET /api/data-intel/freedom-number — no-fabrication pins.
 *
 * The handler previously violated the fabrication hard-stop three ways:
 *   1. monthlyExpenses defaulted to an invented $5,000 when the query param
 *      was absent (there is no stored expense column to fall back on);
 *   2. avgNotePayment fell back to an invented $200 when no real data existed;
 *   3. noteCount was computed as sum(notes.id) — a SUM OF PRIMARY KEYS — and
 *      monthlyIncome divided the ALL-TIME payment total by 12 as if it were
 *      one year's income.
 *
 * This suite pins the honest replacements:
 *   - absent/invalid monthlyExpenses → 422 refusal naming the field, before
 *     any db read — never a defaulted denominator;
 *   - noteCount uses drizzle count(), asserted against the live query shape;
 *   - monthlyIncome is scoped to payments with paymentDate in the trailing
 *     12 months (gte bound pinned at runtime);
 *   - an empty portfolio answers with nulls + avgNotePaymentKnown:false,
 *     never a $200 average or projections derived from one;
 *   - source scan (comments stripped) proves the 5000/200 literals are gone.
 *
 * idempotent: true — db and logger are fully mocked; the route handler and
 * calculateFreedomNumber run REAL.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

const ORG_ID = 7;

const H = vi.hoisted(() => {
  const state = {
    /** Every select captured in order: table, projection, where expression. */
    queries: [] as Array<{ table: string; projection: any; where: any }>,
    /** Rows returned per table name. */
    rows: {} as Record<string, any[]>,
  };

  const tableName = (t: any) => t?.[Symbol.for("drizzle:Name")] ?? "";

  const dbMock: any = {
    select: (projection?: any) => ({
      from: (table: any) => {
        const entry = { table: tableName(table), projection, where: undefined as any };
        state.queries.push(entry);
        const make = (): any => ({
          where: (w: any) => {
            entry.where = w;
            return make();
          },
          then: (onF: any, onR: any) =>
            Promise.resolve((state.rows[entry.table] ?? []).map((r) => ({ ...r }))).then(onF, onR),
        });
        return make();
      },
    }),
  };

  return { state, dbMock };
});

vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import dataIntelRouter from "../../server/routes-data-intelligence";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

function makeApp() {
  const app = express();
  app.use((req: any, _res, next) => {
    req.organization = { id: ORG_ID, name: "Test Org" };
    req.organizationId = ORG_ID;
    next();
  });
  app.use("/api/data-intel", dataIntelRouter);
  return app;
}
const app = makeApp();

/** Collect the literal SQL string chunks of a drizzle SQL expression. */
function sqlStrings(root: any): string[] {
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.value) && node.value.every((v: any) => typeof v === "string")) {
      out.push(node.value.join(""));
    }
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach(walk);
  };
  walk(root);
  return out;
}

/** Collect column names referenced by a drizzle SQL expression. */
function sqlColumns(root: any): string[] {
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.name === "string" && node.table !== undefined) out.push(node.name);
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach(walk);
  };
  walk(root);
  return out;
}

/** Collect bound parameter values of a drizzle SQL expression. */
function sqlParams(root: any): unknown[] {
  const out: unknown[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if ("encoder" in node && "value" in node) out.push(node.value);
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach(walk);
  };
  walk(root);
  return out;
}

beforeEach(() => {
  H.state.queries.length = 0;
  H.state.rows = {};
});

// ═══════════════════════════════════════════════════════════════════════════
describe("missing denominator is refused, never defaulted", () => {
  it("no monthlyExpenses → 422 VALIDATION_FAILED naming the field; the db is never queried", async () => {
    const res = await request(app).get("/api/data-intel/freedom-number");

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(res.body.details)).toContain("monthlyExpenses");
    // The refusal explains itself — no stored figure exists to fall back on.
    expect(JSON.stringify(res.body.details)).toContain("no stored expense figure");
    expect(H.state.queries).toHaveLength(0);
  });

  it("non-numeric and non-positive values are refused the same way", async () => {
    for (const bad of ["abc", "0", "-100", "NaN"]) {
      const res = await request(app).get(`/api/data-intel/freedom-number?monthlyExpenses=${bad}`);
      expect(res.status, `monthlyExpenses=${bad}`).toBe(422);
      expect(res.body.error).toBe("VALIDATION_FAILED");
    }
    expect(H.state.queries).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the live query shape: count() not sum(id), trailing-12-month income", () => {
  beforeEach(() => {
    H.state.rows = {
      payments: [{ total: "24000" }],
      notes: [{ noteCount: 4 }],
    };
  });

  it("noteCount is a COUNT of active notes — never a sum of primary keys", async () => {
    const res = await request(app).get("/api/data-intel/freedom-number?monthlyExpenses=5000");
    expect(res.status).toBe(200);

    const notesQuery = H.state.queries.find((q) => q.table === "notes");
    expect(notesQuery).toBeDefined();
    const agg = sqlStrings(notesQuery!.projection?.noteCount).join("");
    expect(agg).toContain("count(");
    expect(agg).not.toContain("sum(");
    // Still scoped to this org's ACTIVE notes.
    expect(sqlColumns(notesQuery!.where)).toEqual(
      expect.arrayContaining(["organization_id", "status"]),
    );
    expect(sqlParams(notesQuery!.where)).toEqual(expect.arrayContaining([ORG_ID, "active"]));
  });

  it("monthlyIncome sums payments bounded by paymentDate >= now-12mo, not all-time", async () => {
    const before = Date.now();
    const res = await request(app).get("/api/data-intel/freedom-number?monthlyExpenses=5000");
    expect(res.status).toBe(200);

    const paymentsQuery = H.state.queries.find((q) => q.table === "payments");
    expect(paymentsQuery).toBeDefined();
    expect(sqlStrings(paymentsQuery!.where).join("")).toContain(">=");
    expect(sqlColumns(paymentsQuery!.where)).toEqual(
      expect.arrayContaining(["organization_id", "payment_date"]),
    );

    const dateBound = sqlParams(paymentsQuery!.where).find((v) => v instanceof Date) as Date;
    expect(dateBound).toBeInstanceOf(Date);
    const expected = new Date(before);
    expected.setMonth(expected.getMonth() - 12);
    // Within a day of exactly 12 months back — a bound of epoch/all-time fails.
    expect(Math.abs(dateBound.getTime() - expected.getTime())).toBeLessThan(24 * 60 * 60 * 1000);

    // $24,000 across the trailing 12 months → $2,000/mo, honestly derived.
    expect(res.body.currentPassiveIncome).toBe(2000);
  });

  it("with real data the analysis is real arithmetic end to end", async () => {
    const res = await request(app).get("/api/data-intel/freedom-number?monthlyExpenses=5000");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      monthlyExpenses: 5000,
      currentPassiveIncome: 2000, // 24000 / 12
      freedomGap: 3000,
      freedomPercent: 40,
      avgNotePayment: 500, // 2000/mo over 4 active notes
      avgNotePaymentKnown: true,
      notesNeeded: 6, // ceil(3000 / 500)
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("an empty portfolio answers honestly — no invented $200 average", () => {
  it("zero notes/payments → nulls with avgNotePaymentKnown:false, real zeros elsewhere", async () => {
    H.state.rows = {
      payments: [{ total: null }],
      notes: [{ noteCount: 0 }],
    };

    const res = await request(app).get("/api/data-intel/freedom-number?monthlyExpenses=4750");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      monthlyExpenses: 4750,
      currentPassiveIncome: 0,
      freedomGap: 4750,
      freedomPercent: 0,
      avgNotePayment: null,
      avgNotePaymentKnown: false,
      notesNeeded: null,
      dealsNeededToGenNotes: null,
      estimatedTimeToFreedom: null,
      weeklyMailersNeeded: null,
    });
    // The statement labels the absence instead of projecting from a made-up
    // number — and nothing in the payload smuggles the old $200 back in.
    expect(res.body.freedomStatement).toContain("unavailable");
    expect(JSON.stringify(res.body)).not.toContain("200");
  });

  it("active notes but no payment history in the window → projections still refused", async () => {
    H.state.rows = {
      payments: [{ total: null }],
      notes: [{ noteCount: 3 }],
    };

    const res = await request(app).get("/api/data-intel/freedom-number?monthlyExpenses=3999");
    expect(res.status).toBe(200);
    expect(res.body.avgNotePayment).toBeNull();
    expect(res.body.avgNotePaymentKnown).toBe(false);
    expect(res.body.notesNeeded).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Source-level pin — the fabricated literals must not reappear. Comments are
// stripped first so a mention in prose can't mask (or trip) the scan.
// ═══════════════════════════════════════════════════════════════════════════

describe("source scan: the freedom-number handler carries no fabricated literals", () => {
  const handlerSlice = (): string => {
    const routeFile = path.resolve(__dirname, "../../server/routes-data-intelligence.ts");
    const src = stripComments(fs.readFileSync(routeFile, "utf8"));
    const start = src.indexOf('router.get("/freedom-number"');
    const end = src.indexOf("router.get(", start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };
  const handler = handlerSlice;

  it("no literal 5000 or 200 fallback remains", () => {
    expect(handler()).not.toMatch(/\b5000\b/);
    expect(handler()).not.toMatch(/\b200\b/);
  });

  it("counts notes with count(), never sum(notes.id)", () => {
    expect(handler()).toContain("count()");
    expect(handler()).not.toContain("sum(notes.id)");
  });

  it("bounds income to the trailing 12 months of paymentDate", () => {
    expect(handler()).toContain("gte(payments.paymentDate");
  });

  it("refuses a missing denominator through the standard 422 helper", () => {
    expect(handler()).toContain("Errors.validationFailed");
  });
});
