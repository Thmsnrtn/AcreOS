/**
 * GET /api/borrower/payoff-quote — on the engine, behind the session, recorded
 * (DEFECT-0097).
 *
 * Before 2026-09-27 the route authenticated with the note's long-lived access
 * token and the borrower's email IN THE QUERY STRING, computed the payoff in
 * floating-point dollars with the accrual start GUESSED as
 * `nextPaymentDate − 30 days`, persisted nothing, and told the borrower the
 * figure was "valid for 30 days" while accruing interest only through today.
 *
 * `payoffEngineUnification.test.ts` names this route as one of the four paths
 * it unified and proves the helper `payoffInputsFromServicedNote` — which had
 * zero production callers. This file proves the ROUTE:
 *
 *   (5) query-string credentials are refused; the session cookie is required;
 *   (6) the numbers equal `computePayoffQuote(payoffInputsFromServicedNote(…))`
 *       from the note's OWN ledger, and one `note_payoff_quotes` row is written
 *       with `goodThroughDate === payoffDate`;
 *   (7) "30 days" appears nowhere — not in the JSON, not in the PDF;
 *   (8) the recorded-quote read is tenant-scoped (source-level, since the mock
 *       cannot evaluate a drizzle `where`).
 *
 * At HEAD before the fix: (5) returned 200 with a quote; (6) wrote no row and
 * accrued 13 guessed days rather than 12 ledger days; (7) returned
 * `daysValid: 30` and printed the literal string.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Session = {
  id: number;
  noteId: number;
  organizationId: number;
  email: string;
  expiresAt: Date;
  createdAt: Date;
};
const SESSIONS = new Map<string, Session>();

const NOTE_ROW = {
  id: 42,
  organizationId: 7,
  borrowerId: 9,
  currentBalance: "48250.00",
  interestRate: "9.875",
  monthlyPayment: "500",
  lateFee: "0",
  gracePeriodDays: null,
  startDate: new Date("2026-01-03T00:00:00Z"),
  nextPaymentDate: new Date("2026-09-03T00:00:00Z"),
  amortizationSchedule: [],
  version: 1,
  status: "active",
};

// The note's OWN ledger. The accrual start is the payment_date of the most
// recent COMPLETED row carrying interest. The pending row and the
// zero-interest row must not move the clock.
//
// `payments.payment_date` is a TIMESTAMP. Row 2 posted at 03:00 UTC on
// Aug 4 — which is 22:00 on Aug 3 in the lender's zone (America/Chicago). The
// accrual start is the lender's calendar day, 2026-08-03: reading the instant
// in UTC would say Aug 4, and handing the engine the raw instant would floor
// Aug 4 03:00 → Aug 15 00:00 to ten days. Twelve is the answer the ledger
// defends.
const LENDER_TZ = vi.hoisted(() => "America/Chicago");
const LEDGER = [
  { id: 1, paymentDate: new Date("2026-07-03T14:00:00Z"), interestAmount: "397.06", status: "completed" },
  { id: 2, paymentDate: new Date("2026-08-04T03:00:00Z"), interestAmount: "398.06", status: "completed" },
  { id: 3, paymentDate: new Date("2026-08-20T09:30:00Z"), interestAmount: "500.00", status: "pending" },
  { id: 4, paymentDate: new Date("2026-08-25T09:30:00Z"), interestAmount: "0", status: "completed" },
];

/** Every note_payoff_quotes row the route inserted, in order. */
const QUOTES = vi.hoisted(() => ({ rows: [] as Array<Record<string, any>>, nextId: 1 }));
const TABLES = vi.hoisted(() => ({ notePayoffQuotes: null as any }));

vi.mock("../../server/storage", () => {
  const storage = {
    getBorrowerSession: async (token: string) => SESSIONS.get(token) ?? null,
    deleteBorrowerSession: async (token: string) => void SESSIONS.delete(token),
    updateBorrowerSessionAccess: async () => {},
    getOrganization: async (id: number) => ({ id, name: "Acme Lender", settings: {} }),
    getLead: async () => ({ id: 9, firstName: "Bea", lastName: "Rowe", email: "borrower@example.com" }),
    getPayments: vi.fn(async () => LEDGER),
    updateNote: vi.fn(async () => NOTE_ROW),
  };
  const makeStep = (table: any): any => ({
    from: (t: any) => makeStep(t),
    where: () => makeStep(table),
    orderBy: () => makeStep(table),
    limit: () => makeStep(table),
    for: () => makeStep(table),
    then: (ok: any, no: any) => {
      const rows = table === TABLES.notePayoffQuotes ? QUOTES.rows.slice(-1) : [NOTE_ROW];
      return Promise.resolve(rows).then(ok, no);
    },
  });
  const db = {
    select: () => makeStep(null),
    insert: (table: any) => ({
      values: (vals: Record<string, any>) => ({
        returning: async () => {
          if (table !== TABLES.notePayoffQuotes) throw new Error("unexpected insert target");
          const row = { id: `q-${QUOTES.nextId++}`, quotedAt: new Date("2026-08-14T12:00:00Z"), createdAt: new Date(), ...vals };
          QUOTES.rows.push(row);
          return [row];
        },
      }),
    }),
  };
  return { storage, db };
});

vi.mock("../../server/db", () => {
  // `resolveOrgTimeZone` (form1098Batch.ts) reads organizations.timezone
  // through this module's `db`.
  const step: any = {
    from: () => step,
    where: () => step,
    limit: () => step,
    then: (ok: any, no: any) => Promise.resolve([{ timezone: LENDER_TZ }]).then(ok, no),
  };
  return {
    db: { select: () => step },
    withTransaction: async () => {
      throw new Error("payoff quote must not open a money transaction");
    },
  };
});
// The late-fee ledger (ruling 2026-09-29 #6): what the note owes is read
// from it; this note owes $25 in assessed, unpaid fees.
const FEES = vi.hoisted(() => ({ owedCents: 2500, dueByCents: 0, assessCalls: 0 }));
vi.mock("../../server/services/notes/servicedLateFees", () => ({
  // Read at module load by achAutopay and the borrower routes.
  ACH_IN_FLIGHT_STATUSES: ["created", "submitted", "processing"],
  assessServicedNoteLateFee: async () => {
    FEES.assessCalls++;
    return { assessed: false, alreadyExisted: false, feeCents: 0, reason: "test" };
  },
  outstandingServicedLateFeesCents: async () => FEES.owedCents,
  lateFeeDueByCents: async () => FEES.dueByCents,
  feeFromExcessCents: () => 0,
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));

/** pdfkit stand-in that records every line of text it was asked to print. */
const PDF_TEXT = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock("pdfkit", () => {
  class FakePdf {
    private res: any;
    fontSize() { return this; }
    fillColor() { return this; }
    moveDown() { return this; }
    text(s: string) { PDF_TEXT.lines.push(s); return this; }
    pipe(res: any) { this.res = res; return res; }
    end() { this.res?.end(); }
  }
  return { default: FakePdf };
});

import { notePayoffQuotes } from "@shared/schema";
import {
  computePayoffQuote,
  payoffInputsFromServicedNote,
  parseIsoDateUtc,
} from "../../server/services/notePaymentMath";
import { registerBorrowerRoutes } from "../../server/routes-borrower";

TABLES.notePayoffQuotes = notePayoffQuotes;

const TOKEN = "borrower-session-token";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.cookies = {};
    const header = req.headers.cookie as string | undefined;
    if (header) {
      for (const part of header.split(";")) {
        const [k, v] = part.trim().split("=");
        if (k) req.cookies[k] = decodeURIComponent(v ?? "");
      }
    }
    next();
  });
  registerBorrowerRoutes(app);
  return app;
}

describe("GET /api/borrower/payoff-quote — engine, session, recorded", () => {
  let app: express.Express;

  beforeEach(() => {
    // "Today" is 2026-08-14 so a 2026-08-15 payoff date is in the future and
    // the 2026-08-03 ledger posting is the accrual start.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-14T12:00:00Z") });
    FEES.owedCents = 2500;
    FEES.dueByCents = 0;
    SESSIONS.clear();
    SESSIONS.set(TOKEN, {
      id: 1,
      noteId: 42,
      organizationId: 7,
      email: "borrower@example.com",
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
    });
    QUOTES.rows.length = 0;
    QUOTES.nextId = 1;
    PDF_TEXT.lines.length = 0;
    app = makeApp();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("(5) refuses the old query-string credentials — the session cookie is the only key", async () => {
    const res = await request(app).get(
      "/api/borrower/payoff-quote?accessToken=note-token&email=borrower%40example.com",
    );
    expect(res.status).toBe(401);
    expect(QUOTES.rows, "an unauthenticated request must record nothing").toHaveLength(0);
  });

  it("(6) quotes from the note's own ledger through the one payoff engine, and records the quote", async () => {
    const res = await request(app)
      .get("/api/borrower/payoff-quote?payoffDate=2026-08-15")
      .set("Cookie", `borrower_session=${TOKEN}`);
    expect(res.status).toBe(200);

    // Expected from the engine over CALENDAR DAYS — the lender-zone day each
    // posting fell on — never the raw instants.
    const expected = computePayoffQuote(
      payoffInputsFromServicedNote({
        note: { currentBalance: NOTE_ROW.currentBalance, interestRate: NOTE_ROW.interestRate, startDate: "2026-01-02" },
        ledgerRows: [
          { paymentDate: "2026-07-03", interestAmount: "397.06" },
          { paymentDate: "2026-08-03", interestAmount: "398.06" },
          { paymentDate: "2026-08-24", interestAmount: "0" },
        ],
        payoffDate: parseIsoDateUtc("2026-08-15"),
        lateFeesOutstandingCents: 2500,
      }),
    );

    expect(res.body.totalPayoffCents).toBe(expected.totalPayoffCents);
    expect(res.body.accruedInterestCents).toBe(expected.accruedInterestCents);
    expect(res.body.perDiemInterestCents).toBe(expected.perDiemInterestCents);
    expect(res.body.principalBalanceCents).toBe(4_825_000);
    // 2026-08-03 → 2026-08-15: twelve ledger days, not thirteen guessed ones.
    expect(res.body.daysAccrued).toBe(12);
    expect(res.body.accrualStartDate).toBe("2026-08-03");
    expect(res.body.payoffDate).toBe("2026-08-15");
    expect(res.body.goodThroughDate).toBe(res.body.payoffDate);
    // Owed late fees come from the assessed ledger and are IN the total
    // (ruling 2026-09-29 #6) — they used to be "not tracked" and left out.
    expect(res.body.lateFeesOutstandingCents).toBe(2500);
    expect(res.body.lateFeesOutstandingNote).toMatch(/assessed under your note that are unpaid as of today/);
    expect(FEES.assessCalls).toBe(1); // the current installment is assessed before quoting
    expect(res.body.quoteId).toBe("q-1");
    expect(res.body.pdfUrl).toBe("/api/borrower/payoff-quote?quoteId=q-1");

    expect(QUOTES.rows).toHaveLength(1);
    const row = QUOTES.rows[0];
    expect(row.organizationId).toBe(7);
    expect(row.noteSystem).toBe("serviced_note");
    expect(row.noteRef).toBe("42");
    expect(row.channel).toBe("borrower_portal");
    expect(row.quotedByUserId).toBeNull();
    expect(row.goodThroughDate).toBe("2026-08-15");
    expect(row.payoffDate).toBe("2026-08-15");
    expect(row.totalPayoffCents).toBe(expected.totalPayoffCents);
    expect(row.lateFeesOutstandingCents).toBe(2500);
    expect(row.engineVersion).toBe(expected.engineVersion);
    expect(row.engineInputJson.accrualStartDate).toBe("2026-08-03");
    expect(row.notes).toBe("borrower_session:1");
  });

  it("(6a) a fee grace will pass on before the good-through date is in the total", async () => {
    // Paying the quoted total on that date must pay the note off; posting
    // would assess the fee first and take it out of the money.
    FEES.dueByCents = 2500;
    const res = await request(app)
      .get("/api/borrower/payoff-quote?payoffDate=2026-08-15")
      .set("Cookie", `borrower_session=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.lateFeesOutstandingCents).toBe(5000);
    expect(res.body.lateFeesOutstandingNote).toMatch(/before the good-through date/);
  });

  it("(6b) refuses a past payoff date rather than flooring it to zero days of interest", async () => {
    const res = await request(app)
      .get("/api/borrower/payoff-quote?payoffDate=2026-08-01")
      .set("Cookie", `borrower_session=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(QUOTES.rows).toHaveLength(0);
  });

  it("(6c) refuses a date that is not a day", async () => {
    const res = await request(app)
      .get("/api/borrower/payoff-quote?payoffDate=2026-02-30")
      .set("Cookie", `borrower_session=${TOKEN}`);
    expect(res.status).toBe(400);
  });

  it('(7) promises no "30 days" — JSON and PDF are good through the payoff date and publish the per-diem', async () => {
    const json = await request(app)
      .get("/api/borrower/payoff-quote")
      .set("Cookie", `borrower_session=${TOKEN}`);
    expect(json.status).toBe(200);
    expect(JSON.stringify(json.body)).not.toMatch(/30 days|daysValid/);
    expect(json.body.goodThroughDate).toBe(json.body.payoffDate);
    expect(json.body.payoffDate).toBe("2026-08-14");

    const pdf = await request(app)
      .get(`/api/borrower/payoff-quote?quoteId=${json.body.quoteId}`)
      .set("Cookie", `borrower_session=${TOKEN}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
    const printed = PDF_TEXT.lines.join("\n");
    expect(printed).not.toMatch(/valid for 30 days/i);
    expect(printed).toMatch(/good through 2026-08-14/i);
    expect(printed).toMatch(/per day after that date/i);
    // The PDF renders the RECORDED row — no second quote is written.
    expect(QUOTES.rows).toHaveLength(1);
  });

  it("(7b) a quoteId that resolves to no recorded quote is a 404, not a recompute", async () => {
    const res = await request(app)
      .get("/api/borrower/payoff-quote?quoteId=q-missing")
      .set("Cookie", `borrower_session=${TOKEN}`);
    expect(res.status).toBe(404);
    expect(QUOTES.rows).toHaveLength(0);
  });

  it("(9) the portal session carries what is owed, and the Pay button charges installment + owed", async () => {
    const res = await request(app).get("/api/borrower/session").set("Cookie", `borrower_session=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.lateFeesOwedCents).toBe(2500);
    // Before, the portal always charged the bare installment, so an assessed
    // fee could never be paid here — while the statement's amount due said
    // installment + fees.
    const portal = stripComments(readFileSync(resolve(__dirname, "../../client/src/pages/borrower-portal.tsx"), "utf8"));
    expect(portal).toMatch(/const amountDueDollars = \(Math\.round\(Number\(note\.monthlyPayment \|\| 0\) \* 100\) \+ lateFeesOwedCents\) \/ 100;/);
    expect(portal).toContain("JSON.stringify({ amount: amountDueDollars })");
    expect(portal).not.toContain("JSON.stringify({ amount: Number(note.monthlyPayment) })");
  });

  it("(8) the recorded-quote read is pinned to the session's organization and note (source)", () => {
    const src = readFileSync(resolve(__dirname, "../../server/routes-borrower.ts"), "utf8");
    const start = src.indexOf('api.get("/api/borrower/payoff-quote"');
    expect(start).toBeGreaterThan(-1);
    const handler = src.slice(start, src.indexOf("api.get(", start + 10));
    expect(handler).toContain("validateBorrowerSession");
    expect(handler).toContain("eq(notePayoffQuotes.organizationId, note.organizationId)");
    expect(handler).toContain("eq(notePayoffQuotes.noteRef, String(note.id))");
    expect(handler).not.toMatch(/req\.query\.(accessToken|email)/);
    expect(handler).not.toMatch(/\b30 days\b|daysValid/);
  });
});
