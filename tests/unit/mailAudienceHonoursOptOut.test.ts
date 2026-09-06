/**
 * A seller who opted out must not receive a physical letter.
 *
 * `handleInboundOptKeyword` sets `leads.doNotContact` and `leads.opt_out_date`
 * when a seller texts STOP, and the consent-revocation record written beside it
 * names `direct_mail` among the revoked channels (smsService.ts:472,
 * tcpaCompliance.ts:353). `preMailDedupe.ts:105` honours that on its lane.
 *
 * `resolveAudience` in routes-outreach-mail.ts — the compose tab's lane, which
 * quotes, debits the pool and writes `mail_shipment_pieces` that `mail_flusher`
 * hands to Lob half an hour later — read neither column. It filtered on org,
 * not-deleted, and a complete address. So the org's own audit trail said the
 * seller had revoked physical mail while a second door in the same product
 * printed and delivered one.
 *
 * ── WHY THIS READS SQL AND NOT SOURCE ─────────────────────────────────────
 * The assertion below renders the predicate the handler actually builds through
 * drizzle's own dialect and inspects the SQL Postgres will run. A gate that
 * asserted the file MENTIONS `doNotContact` would pass on a mention in a
 * comment, on a variable that is built and never used, and on a condition
 * pushed to the wrong array — and this is a gate over consequential action, so
 * it is worth the extra twenty lines to check the query instead of the text.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Every predicate handed to `.where()` during a request, in order. */
const capturedPredicates: unknown[] = [];

function chain(rows: unknown[]): any {
  const step: any = {
    select: () => chain(rows),
    from: () => chain(rows),
    where: (predicate: unknown) => {
      capturedPredicates.push(predicate);
      return chain(rows);
    },
    orderBy: () => chain(rows),
    limit: () => chain(rows),
    groupBy: () => chain(rows),
    innerJoin: () => chain(rows),
    leftJoin: () => chain(rows),
    then: (ok: any, no: any) => Promise.resolve(rows).then(ok, no),
  };
  return step;
}

vi.mock("../../server/db", () => ({
  db: {
    select: () => chain([]),
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  },
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(chain([])),
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _s: unknown, next: () => void) => {
    req.organization = { id: 7, name: "Acme" };
    req.organizationId = 7;
    next();
  },
}));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));

import { registerOutreachMailRoutes } from "../../server/routes-outreach-mail";

const dialect = new PgDialect();

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.organization = { id: 7, name: "Acme" };
    req.organizationId = 7;
    req.user = { id: "u1" };
    next();
  });
  registerOutreachMailRoutes(app);
  return app;
}

/** The SQL text of every predicate captured, lowercased. */
function capturedSql(): string[] {
  return capturedPredicates.map((p) => {
    try {
      return dialect.sqlToQuery(p as never).sql.toLowerCase();
    } catch {
      return "";
    }
  });
}

describe("the mail audience excludes anyone who opted out", () => {
  beforeEach(() => {
    capturedPredicates.length = 0;
  });

  it("the quote's lead query constrains both opt-out columns", async () => {
    const app = makeApp();
    await request(app)
      .post("/api/outreach/mail/quote")
      .send({
        audienceFilter: { states: ["TX"] },
        pieceType: "postcard_4x6",
        speed: "standard",
      });

    const sqls = capturedSql();
    expect(sqls.length, "no predicate was captured — the mock never saw the query").toBeGreaterThan(0);

    const leadQuery = sqls.find((s) => s.includes('"leads"') || s.includes("do_not_contact") || s.includes("deleted_at"));
    expect(leadQuery, `no leads predicate among ${sqls.length} captured`).toBeTruthy();

    expect(
      leadQuery,
      "the audience query must exclude do_not_contact — otherwise a seller who " +
        "texted STOP is quoted, debited for, and mailed",
    ).toContain("do_not_contact");
    expect(
      leadQuery,
      "…and opt_out_date, which is the column preMailDedupe.ts reads on the other lane",
    ).toContain("opt_out_date");
  });

  it("is not true / is null, not equality — the columns are nullable", async () => {
    const app = makeApp();
    await request(app)
      .post("/api/outreach/mail/quote")
      .send({
        audienceFilter: { states: ["TX"] },
        pieceType: "postcard_4x6",
        speed: "standard",
      });

    const leadQuery = capturedSql().find((s) => s.includes("do_not_contact"));
    expect(leadQuery).toBeTruthy();
    // `do_not_contact = false` would drop every lead whose column is NULL —
    // i.e. almost all of them — turning a suppression fix into an empty audience.
    expect(
      leadQuery,
      "a nullable boolean needs IS NOT TRUE; `= false` silently empties the audience",
    ).toMatch(/do_not_contact"?\s+is not true/);
    expect(leadQuery).toMatch(/opt_out_date"?\s+is null/);
  });
});
