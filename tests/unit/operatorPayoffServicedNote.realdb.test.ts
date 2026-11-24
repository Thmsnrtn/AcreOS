/**
 * Operator payoff surfaces for SERVICED notes (L9-DEF-1) — real database.
 *
 * Before the fix, GET /api/notes/:id/payoff and POST
 * /api/notes/:id/payoff/quotes passed the route id straight into
 * `computeAcquiredNotePayoff`, whose lookup is `acquired_notes.id` (UUID).
 * A numeric serviced-note id threw Postgres invalid-uuid and the handler's
 * catch returned 500 — for the entire serviced book (walk evidence:
 * POST /api/notes/58/payoff/quotes → 500, requestIds 30cba217… / a4348413…;
 * GET /api/notes/58/payoff → 500, d9022d24…). The borrower portal quoted
 * the same note exactly, so the engine was never the problem — the route
 * was asking the wrong book.
 *
 * This file proves the ROUTES, against a database built from this repo:
 *
 *   (1) GET with a numeric id → 200, numbers equal
 *       `computePayoffQuote(payoffInputsFromServicedNote(…))` from the
 *       note's OWN completed ledger, and NO quote row is recorded;
 *   (2) POST with a numeric id → 201, exactly one `note_payoff_quotes` row
 *       with `noteSystem: serviced_note`, listable through the list route;
 *   (3) the UUID shape still routes to the acquired engine (no regression);
 *   (4) MUTATION: an id of neither shape (and a serviced id under a
 *       foreign org) → 404, never 500 — on the pre-fix code (1), (2) and
 *       (4) all returned 500, so these tests fail if the dispatch regresses.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("operatorPayoffServicedNote.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The operator surfaces are ownerOrAdmin-gated; this file pins the route
// behavior, not Clerk. The org id arrives on a header so each test org —
// and the foreign-org probe — is explicit. Other exports of these modules
// are the real ones, so nothing else in the import graph changes shape.
vi.mock("../../server/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../server/auth")>();
  return {
    ...original,
    isAuthenticated: (req: any, _res: any, next: any) => {
      req.user = { id: "test-operator" };
      next();
    },
  };
});
vi.mock("../../server/middleware/getOrCreateOrg", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../server/middleware/getOrCreateOrg")>();
  return {
    ...original,
    getOrCreateOrg: (req: any, _res: any, next: any) => {
      req.organization = { id: Number(req.header("x-test-org-id")) };
      next();
    },
  };
});
vi.mock("../../server/middleware/roleGuard", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../server/middleware/roleGuard")>();
  return {
    ...original,
    requireRole: () => (_req: any, _res: any, next: any) => next(),
  };
});

import express from "express";
import request from "supertest";
import {
  computePayoffQuote,
  payoffInputsFromServicedNote,
} from "../../server/services/notePaymentMath";

const tag = `l9def1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Fixed payoff date, so the accrual math is pinned, not "today".
const PAYOFF_DATE = "2026-11-19";
const PAYOFF_DAY = new Date("2026-11-19T00:00:00Z");

// Serviced note (the `notes` book), mirroring the walk's note 58 economics:
// $53,100 balance at 9.9%, one interest-carrying posting on 2026-08-03.
// The next installment is due 2027-06-19 — no late-fee grace can pass
// before any re-run of this file, so outstanding late fees stay 0.
const SERVICED = {
  balance: "53100.00",
  rate: "9.9",
  start: new Date("2026-01-03T12:00:00Z"),
};
let orgId = 0;
let servicedId = 0;
let acquiredId = "";

// Independent expectation for the serviced quote, from the fixture's OWN
// completed ledger (the pending row and the zero-interest row are NOT
// inputs: pending settles nothing, zero interest moves no clock).
//
// The ledger dates below are the CALENDAR days the route derives, not the
// raw instants: the route maps each `payment_date` through `dayInZone`
// (lender zone — America/New_York, set explicitly on the fixture org), so
// a posting at noon UTC counts as its UTC calendar day. Passing the raw
// noon instants here would undercount by a day (107, not 108): the engine
// floors whole days between instants, and `parseIsoDateUtc` returns a Date
// as-is. The 108-day assertion below is the pin that the route derived
// the calendar day, as the borrower portal does.
const expectedServiced = computePayoffQuote(
  payoffInputsFromServicedNote({
    note: { currentBalance: SERVICED.balance, interestRate: SERVICED.rate, startDate: "2026-01-03" },
    ledgerRows: [
      { paymentDate: "2026-08-03", interestAmount: "420.38" },
      { paymentDate: "2026-08-25", interestAmount: "0" },
    ],
    payoffDate: PAYOFF_DAY,
    unappliedCreditCents: 0,
    lateFeesOutstandingCents: 0,
    payoffFeeCents: 0,
  }),
);

// Independent expectation for the acquired control: no payments, so the
// accrual start is the origination date 2024-01-01 → 1,053 days to 2026-11-19.
const expectedAcquired = computePayoffQuote({
  principalBalanceCents: 900000,
  annualRateBps: 900,
  accrualStartDate: new Date("2024-01-01T00:00:00Z"),
  payoffDate: PAYOFF_DAY,
  unappliedCreditCents: 0,
  lateFeesOutstandingCents: 0,
  payoffFeeCents: 0,
});

let app: express.Express;
const orgHeader = () => ({ "x-test-org-id": String(orgId) });

const quoteCount = async (noteRef: string, system: string) => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM note_payoff_quotes
    WHERE organization_id = ${orgId} AND note_system = ${system} AND note_ref = ${noteRef}`);
  return Number((res as unknown as { rows: Array<{ n: number }> }).rows[0].n);
};

describe.runIf(realDbAvailable)("operator payoff surfaces route serviced notes — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { organizations } = await import("@shared/schema");
    const [org] = await db
      .insert(organizations)
      .values({ name: tag, slug: tag, ownerId: `${tag}-o`, timezone: "America/New_York" } as never)
      .returning();
    orgId = org.id;
    // The lender zone is pinned, not assumed from the column default: the
    // expected quote below derives calendar days in this zone.
    expect(org.timezone).toBe("America/New_York");

    const lead = await db.execute(sql`
      INSERT INTO leads (organization_id, first_name, last_name, type, status, source)
      VALUES (${orgId}, 'Bea', ${tag}, 'borrower', 'active', 'import') RETURNING id
    `);
    const borrowerId = (lead as unknown as { rows: Array<{ id: number }> }).rows[0].id;

    // The ATR origination gate (0099): an 'active' note needs a completed
    // ATR determination or an exemption. This is a raw-land seller-financed
    // note — 'raw_land' is its statutory exemption, not a test shortcut.
    const note = await db.execute(sql`
      INSERT INTO notes (
        organization_id, borrower_id, original_principal, current_balance,
        interest_rate, term_months, monthly_payment,
        start_date, first_payment_date, next_payment_date, status, atr_exemption_code
      ) VALUES (
        ${orgId}, ${borrowerId}, '60000.00', ${SERVICED.balance},
        ${SERVICED.rate}, 360, '687.10',
        ${SERVICED.start.toISOString()}, '2026-02-03T12:00:00Z', '2027-06-19T12:00:00Z', 'active', 'raw_land'
      ) RETURNING id
    `);
    servicedId = (note as unknown as { rows: Array<{ id: number }> }).rows[0].id;

    // The note's OWN ledger: one interest-carrying posting (moves the
    // clock to 2026-08-03), one zero-interest completed posting (does not),
    // one pending posting (settles nothing). All at noon UTC, so the
    // lender-zone calendar day is the same in any US zone.
    await db.execute(sql`
      INSERT INTO payments (
        organization_id, note_id, amount, principal_amount, interest_amount,
        fee_amount, late_fee_amount, payment_date, due_date, status, transaction_id
      ) VALUES
        (${orgId}, ${servicedId}, '687.10', '266.72', '420.38', '0', '25.00',
         '2026-08-03T12:00:00Z', '2026-08-03T12:00:00Z', 'completed', ${`${tag}-p1`}),
        (${orgId}, ${servicedId}, '687.10', '687.10', '0', '0', '0',
         '2026-08-25T12:00:00Z', '2026-08-25T12:00:00Z', 'completed', ${`${tag}-p2`}),
        (${orgId}, ${servicedId}, '687.10', '187.10', '500.00', '0', '0',
         '2026-09-03T12:00:00Z', '2026-09-03T12:00:00Z', 'pending', ${`${tag}-p3`})
    `);

    // Acquired-note control, same org: $9,000 balance at 9.00%, originated
    // 2024-01-01, no payments — the accrual start is the origination date.
    const prop = await db.execute(sql`
      INSERT INTO properties (organization_id, apn, county, state, size_acres, status)
      VALUES (${orgId}, ${`${tag}-apn`}, 'Test', 'TX', '1', 'owned') RETURNING id
    `);
    const propertyId = (prop as unknown as { rows: Array<{ id: number }> }).rows[0].id;
    const acquired = await db.execute(sql`
      INSERT INTO acquired_notes (
        organization_id, property_id, borrower_id, note_number,
        original_principal_cents, current_balance_cents, interest_rate_bps, term_months,
        payment_amount_cents, payment_due_day, origination_date, maturity_date,
        acquisition_date, acquisition_price_cents, payer_name
      ) VALUES (
        ${orgId}, ${propertyId}, ${borrowerId}, ${`${tag}-n1`},
        1000000, 900000, 900, 120,
        12000, 1, '2024-01-01', '2034-01-01',
        '2025-01-01', 800000, 'Test Payer'
      ) RETURNING id
    `);
    acquiredId = (acquired as unknown as { rows: Array<{ id: string }> }).rows[0].id;

    const { registerNoteRoutes } = await import("../../server/routes-notes");
    app = express();
    app.use(express.json());
    registerNoteRoutes(app);
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    if (orgId) {
      // `payments.organization_id` is NO ACTION (every other fixture
      // table cascades), so a bare org delete is FK-blocked once the
      // fixture's ledger exists — delete the payments first.
      await db.execute(sql`DELETE FROM payments WHERE organization_id = ${orgId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => undefined);
    }
    await pool.end();
  });

  it("GET /api/notes/:numeric-id/payoff quotes the serviced note from its own ledger and records nothing", async () => {
    expect(await quoteCount(String(servicedId), "serviced_note")).toBe(0);
    const res = await request(app)
      .get(`/api/notes/${servicedId}/payoff?date=${PAYOFF_DATE}`)
      .set(orgHeader());
    // The defect: this was 500 (invalid-uuid) for every serviced note.
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(false);
    expect(res.body.principalCents).toBe(5310000);
    // Accrual start 2026-08-03 → 108 days to 2026-11-19. The pending row
    // and the zero-interest row must not move it.
    expect(res.body.daysAccrued).toBe(108);
    expect(res.body.accrualStart).toBe("2026-08-03");
    expect(res.body.totalPayoffCents).toBe(expectedServiced.totalPayoffCents);
    expect(res.body.accruedInterestCents).toBe(expectedServiced.accruedInterestCents);
    expect(res.body.perDiemInterestCents).toBe(expectedServiced.perDiemInterestCents);
    // $25.00 of late fees already collected through the ledger.
    expect(res.body.lateFeesAppliedToDateCents).toBe(2500);
    // No fee grace has passed: nothing outstanding.
    expect(res.body.lateFeesOutstandingCents).toBe(0);
    // The calculator records no quote row.
    expect(await quoteCount(String(servicedId), "serviced_note")).toBe(0);
  });

  it("POST /api/notes/:numeric-id/payoff/quotes records exactly one serviced-note quote", async () => {
    const res = await request(app)
      .post(`/api/notes/${servicedId}/payoff/quotes`)
      .set(orgHeader())
      .send({ payoffDate: PAYOFF_DATE });
    // The defect: this was 500 (invalid-uuid) for every serviced note.
    expect(res.status).toBe(201);
    expect(res.body.recorded).toBe(true);
    expect(res.body.totalPayoffCents).toBe(expectedServiced.totalPayoffCents);
    expect(res.body.quote.noteSystem).toBe("serviced_note");
    expect(res.body.quote.noteRef).toBe(String(servicedId));
    expect(res.body.quote.channel).toBe("operator_api");
    expect(res.body.quote.goodThroughDate).toBe(PAYOFF_DATE);
    expect(res.body.quote.notes).toBe("operator_api:test-operator");
    expect(await quoteCount(String(servicedId), "serviced_note")).toBe(1);

    // …and the recorded quote is listable through the list route, which
    // used to hard-code the acquired book.
    const list = await request(app)
      .get(`/api/notes/${servicedId}/payoff/quotes`)
      .set(orgHeader());
    expect(list.status).toBe(200);
    expect(list.body.quotes).toHaveLength(1);
    expect(list.body.quotes[0].id).toBe(res.body.quote.id);
  });

  it("POST refuses a payoff fee on a serviced note instead of silently dropping it", async () => {
    const res = await request(app)
      .post(`/api/notes/${servicedId}/payoff/quotes`)
      .set(orgHeader())
      .send({ payoffDate: PAYOFF_DATE, payoffFeeCents: 100 });
    expect(res.status).toBe(400);
    // The refused quote was not recorded.
    expect(await quoteCount(String(servicedId), "serviced_note")).toBe(1);
  });

  it("the UUID shape still routes to the acquired engine", async () => {
    const calc = await request(app)
      .get(`/api/notes/${acquiredId}/payoff?date=${PAYOFF_DATE}`)
      .set(orgHeader());
    expect(calc.status).toBe(200);
    expect(calc.body.principalCents).toBe(900000);
    expect(calc.body.daysAccrued).toBe(1053);
    expect(calc.body.totalPayoffCents).toBe(expectedAcquired.totalPayoffCents);
    expect(calc.body.accruedInterestCents).toBe(expectedAcquired.accruedInterestCents);
    expect(calc.body.lateFeesOutstandingCents).toBeNull();

    const quote = await request(app)
      .post(`/api/notes/${acquiredId}/payoff/quotes`)
      .set(orgHeader())
      .send({ payoffDate: PAYOFF_DATE });
    expect(quote.status).toBe(201);
    expect(quote.body.quote.noteSystem).toBe("acquired_note");
    expect(quote.body.quote.noteRef).toBe(acquiredId);
    expect(await quoteCount(acquiredId, "acquired_note")).toBe(1);
  });

  it("an id of neither shape 404s on both routes — never 500", async () => {
    const calc = await request(app)
      .get(`/api/notes/abc/payoff?date=${PAYOFF_DATE}`)
      .set(orgHeader());
    expect(calc.status).toBe(404);
    const quote = await request(app)
      .post(`/api/notes/abc/payoff/quotes`)
      .set(orgHeader())
      .send({ payoffDate: PAYOFF_DATE });
    expect(quote.status).toBe(404);
    // Control: a well-formed UUID for a note that does not exist was
    // already a 404 before the fix — the shape, not the existence, is
    // what used to 500.
    const missing = await request(app)
      .get(`/api/notes/00000000-0000-4000-8000-000000000000/payoff?date=${PAYOFF_DATE}`)
      .set(orgHeader());
    expect(missing.status).toBe(404);
  });

  it("a serviced id under a foreign org 404s (the lookup is org-scoped)", async () => {
    const res = await request(app)
      .get(`/api/notes/${servicedId}/payoff?date=${PAYOFF_DATE}`)
      .set({ "x-test-org-id": String(orgId + 99991) });
    expect(res.status).toBe(404);
  });
});
