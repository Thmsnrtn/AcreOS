/**
 * Quality directive 2026-09-29 (first-mail wedge) — the Outreach composer's
 * physical-mail queue mails exactly the audience the investor chose, once.
 *
 * What each case replaced (all at POST /api/outreach/mail/queue unless named):
 *  1. A selected marketing list contributed only its `filters.states` — a
 *     "Hidalgo County" list mailed every eligible Texas lead, a list with no
 *     states (or an unknown id) mailed the whole CRM. A list now chooses
 *     EXACTLY its recorded members (marketing_list_members, W10.3), through
 *     the composer's unchanged audience rules, and says how many members
 *     those rules excluded and why; a list that records no members, or is
 *     not this org's, is still REFUSED, never approximated.
 *  2. Counties were ignored. They now narrow the set — and need their state.
 *  3. 50,000+ matches were silently cut to 50,000. Now refused.
 *  4. The audience was read twice (queue, then quote), so the count charged and
 *     the pieces written could differ. One read; the quote's digest must match
 *     what the investor confirmed, else 409 and nothing charged.
 *  5. The Idempotency-Key the composer sent was ignored and the debit keyed on
 *     Date.now(): a lost response + another click queued and charged twice.
 *     The same key now returns the shipment already queued.
 *  6. Queueing recorded first_mailer_sent (the email/SMS event).
 *  7. "Preview all" called a route that did not exist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const S = vi.hoisted(() => ({
  debitInTx: [] as boolean[],
  leads: [] as Array<Record<string, unknown>>,
  leadReads: 0,
  leadWhere: { sql: "", params: [] as unknown[] },
  /** Rows returned for the leads read, per call (to simulate a set changing). */
  leadsByRead: null as null | Array<Array<Record<string, unknown>>>,
  shipments: [] as Array<Record<string, unknown>>,
  pieces: 0,
  debitKeys: [] as string[],
  refunds: [] as string[],
  events: [] as string[],
  locks: 0,
  orgTier: "starter",
  /** Real ledger semantics: a debit key already written replays at 0 cents. */
  ledgerKeys: new Set<string>(),
  /** Make the next shipment insert throw (a DB failure after the debit). */
  failNextInsert: false,
  /** Hold each debit open this long, so concurrent requests really interleave. */
  debitDelayMs: 0,
  /** The debit was funded from purchased credits (pool exhausted). */
  fundedByPurchased: false,
  /** Post-commit auto top-ups fired (audit of 1694a0b). */
  topUps: 0,
  /** marketing_lists rows the org owns (the ownership read). */
  lists: [] as Array<Record<string, unknown>>,
  /** marketing_list_members rows (the "does it record members" read). */
  memberRows: [] as Array<Record<string, unknown>>,
  /** The list-member accounting aggregate over leads. */
  listAgg: null as null | Record<string, number>,
  listAggWhere: { sql: "", params: [] as unknown[] },
  listAggFields: "",
  tableReads: [] as string[],
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", claims: { sub: "user-1" } };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 42, name: "Mesa Land", subscriptionTier: S.orgTier };
    req.organizationId = 42;
    req.isFounder = false;
    next();
  },
}));
vi.mock("../../server/db", () => {
  const dialect = new PgDialect();
  const select = (fields?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      const name = getTableName(table as never);
      let where: { sql: string; params: unknown[] } = { sql: "", params: [] };
      const rows = () => {
        S.tableReads.push(name);
        if (name === "leads" && fields && "members" in fields) {
          S.listAggWhere = where;
          S.listAggFields = dialect.sqlToQuery((fields as Record<string, SQL>).noMailingAddress).sql;
          return S.listAgg ? [S.listAgg] : [];
        }
        if (name === "marketing_lists") return S.lists;
        if (name === "marketing_list_members") return S.memberRows;
        if (name === "leads") {
          S.leadReads++;
          S.leadWhere = where;
          if (S.leadsByRead) return S.leadsByRead[Math.min(S.leadReads - 1, S.leadsByRead.length - 1)];
          return S.leads;
        }
        if (name === "mail_shipments") {
          if (fields && "used" in fields) return [{ used: 0 }];
          return S.shipments.filter((sh) => where.params.includes(sh.operationKey));
        }
        return [];
      };
      const chain: any = {
        where: (w: unknown) => {
          where = dialect.sqlToQuery(w as SQL);
          return chain;
        },
        orderBy: () => chain,
        groupBy: () => chain,
        limit: async () => rows(),
        then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
      };
      return chain;
    },
  });
  // The per-org advisory lock, for real: transactions run one at a time.
  let lockChain: Promise<unknown> = Promise.resolve();
  const tx = {
    execute: async () => {
      S.locks++;
      return [];
    },
    select,
    insert: (table: unknown) => ({
      values: (v: any) => ({
        returning: async () => {
          if (getTableName(table as never) === "mail_shipments") {
            if (S.failNextInsert) {
              S.failNextInsert = false;
              throw new Error("connection reset during insert");
            }
            const row = { id: 700 + S.shipments.length, status: "queued", queuedAt: new Date(), sentAt: null, cancelledAt: null, ...v };
            S.shipments.push(row);
            return [{ id: row.id }];
          }
          const list = Array.isArray(v) ? v : [v];
          S.pieces += list.length;
          return list.map((_: unknown, i: number) => ({ id: i + 1 }));
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  const transaction = (cb: any) => {
    const run = lockChain.then(() => cb(tx));
    lockChain = run.catch(() => undefined);
    return run;
  };
  return { db: { select, transaction } };
});
vi.mock("../../server/services/mail/router", () => ({ mailRouter: { quote: async () => [] } }));
vi.mock("../../server/services/creditPool", () => ({
  poolDebit: async (a: { externalEventId: string; tx?: unknown }) => {
    S.debitKeys.push(a.externalEventId);
    S.debitInTx.push(a.tx !== undefined && a.tx !== null);
    if (S.debitDelayMs) await new Promise((r) => setTimeout(r, S.debitDelayMs));
    // As creditPool does: ON CONFLICT on the key — a replay debits nothing.
    const replay = S.ledgerKeys.has(a.externalEventId);
    S.ledgerKeys.add(a.externalEventId);
    return {
      allowed: true, debitedCents: replay ? 0 : 300, remaining: 1000, poolMonthly: 2500, ledgerRowId: 1, overPool: false,
      ...(S.fundedByPurchased ? { fundedBy: "purchased_credits" as const } : {}),
    };
  },
  refundPoolDebit: async (a: { originalEventId: string }) => {
    S.refunds.push(a.originalEventId);
  },
  poolRefusalDetails: () => ({ reason: "pool_exhausted" }),
}));
vi.mock("../../server/services/credits", () => ({
  creditService: { afterDebitCommitted: () => void S.topUps++ },
}));
vi.mock("../../server/services/activation", () => ({
  recordActivationEventAsync: (e: { eventName: string }) => {
    S.events.push(e.eventName);
  },
}));
vi.mock("../../server/services/comms/tracking-pool", () => ({ assignTrackingNumberForMailShipment: async () => null }));
vi.mock("../../server/services/mail/qrCodes", () => ({
  mintQrCode: () => null,
  qrRedirectUrl: () => "https://example.test/r/x",
  qrSigningConfigured: () => false,
}));
vi.mock("../../server/routes/public-qr-redirect", () => ({ registerQrRedirectRoutes: () => undefined }));
vi.mock("../../server/routes/lob-webhooks", () => ({ registerLobWebhookRoutes: () => undefined }));

import { registerOutreachMailRoutes } from "../../server/routes-outreach-mail";

const lead = (id: number, o: Record<string, unknown> = {}) => ({
  id,
  firstName: "Ana",
  lastName: `Owner${id}`,
  address: `${id} Ranch Rd`,
  city: "Edinburg",
  state: "TX",
  zip: "78539",
  lastContactedAt: null,
  ...o,
});

function app() {
  const a = express();
  a.use(express.json());
  registerOutreachMailRoutes(a);
  return a;
}

const BASE = { pieceType: "letter_10", speed: "standard" };
const TX = { audienceFilter: { states: ["TX"], counties: ["Hidalgo"] }, ...BASE };

async function quoted(body: Record<string, unknown> = TX) {
  const r = await request(app()).post("/api/outreach/mail/quote").send(body);
  expect(r.status).toBe(200);
  return r.body as { audienceDigest: string; pieceCount: number };
}

beforeEach(() => {
  S.leads = [lead(1), lead(2), lead(3)];
  S.leadReads = 0;
  S.leadWhere = { sql: "", params: [] };
  S.leadsByRead = null;
  S.shipments = [];
  S.pieces = 0;
  S.debitKeys = [];
  S.debitInTx = [];
  S.refunds = [];
  S.events = [];
  S.locks = 0;
  S.orgTier = "starter";
  S.ledgerKeys = new Set();
  S.failNextInsert = false;
  S.debitDelayMs = 0;
  S.fundedByPurchased = false;
  S.topUps = 0;
  S.lists = [];
  S.memberRows = [];
  S.listAgg = null;
  S.listAggWhere = { sql: "", params: [] };
  S.listAggFields = "";
  S.tableReads = [];
});

describe("the audience is exactly what the investor chose — or refused", () => {
  it("a list that is not this org's is refused — nothing about anyone's leads is read", async () => {
    for (const path of ["/api/outreach/mail/quote", "/api/outreach/mail/queue"]) {
      const r = await request(app())
        .post(path)
        .set("Idempotency-Key", "op-list")
        .send({ audienceFilter: { leadListIds: [9] }, ...BASE, expectedAudienceDigest: "x" });
      expect(r.status, path).toBe(422);
      expect(r.body.error).toBe("list_not_found");
    }
    expect(S.tableReads).not.toContain("leads");
    expect(S.debitKeys).toEqual([]);
    expect(S.pieces).toBe(0);
  });

  it("a list that records no members (an import from before lists kept them) is refused, never approximated", async () => {
    S.lists = [{ id: 9, source: "propstream" }];
    S.memberRows = [];
    for (const path of ["/api/outreach/mail/quote", "/api/outreach/mail/queue"]) {
      const r = await request(app())
        .post(path)
        .set("Idempotency-Key", "op-list-2")
        .send({ audienceFilter: { leadListIds: [9] }, ...BASE, expectedAudienceDigest: "x" });
      expect(r.status, path).toBe(422);
      expect(r.body.error).toBe("list_membership_unavailable");
      expect(r.body.message).toMatch(/doesn't record which leads/);
    }
    expect(S.tableReads).not.toContain("leads");
    expect(S.pieces).toBe(0);
  });

  it("EVERY chosen list must record its members: a county list beside a legacy list with none is refused, not mailed as the county list alone", async () => {
    // W10.3 second audit, finding 6: the check read "does ANY chosen list
    // record a member" — the county list's rows answered for the legacy list
    // too, and the legacy list silently contributed nobody.
    S.lists = [{ id: 9, source: "county_records" }, { id: 10, source: "propstream" }];
    S.memberRows = [{ listId: 9 }];
    for (const path of ["/api/outreach/mail/quote", "/api/outreach/mail/queue"]) {
      const r = await request(app())
        .post(path)
        .set("Idempotency-Key", "op-list-3")
        .send({ audienceFilter: { leadListIds: [9, 10] }, ...BASE, expectedAudienceDigest: "x" });
      expect(r.status, path).toBe(422);
      expect(r.body.error).toBe("list_membership_unavailable");
    }
    expect(S.tableReads).not.toContain("leads");
    expect(S.pieces).toBe(0);
  });

  it("two lists that each record members are an audience", async () => {
    S.lists = [{ id: 9, source: "county_records" }, { id: 10, source: "propstream" }];
    S.memberRows = [{ listId: 9 }, { listId: 10 }];
    S.listAgg = { members: 10, optedOut: 1, noMailingAddress: 6, included: 3 };
    const q = await quoted({ audienceFilter: { leadListIds: [9, 10] }, ...BASE });
    expect(q.pieceCount).toBe(3);
  });

  it("a list with members chooses EXACTLY its members, through the composer's unchanged rules", async () => {
    S.lists = [{ id: 9, source: "county_records" }];
    S.memberRows = [{ listId: 9 }];
    S.listAgg = { members: 10, optedOut: 1, noMailingAddress: 6, included: 3 };
    const q = await quoted({ audienceFilter: { leadListIds: [9] }, ...BASE });
    expect(q.pieceCount).toBe(3);

    // The recipients read: org-bound membership, AND every existing rule.
    expect(S.leadWhere.sql).toMatch(/"marketing_list_members"\."organization_id" = \$\d+/);
    expect(S.leadWhere.sql).toMatch(/"marketing_list_members"\."list_id" in \(\$\d+\)/);
    for (const rule of ['"leads"."do_not_contact" is not true', '"leads"."opt_out_date" is null', '"leads"."address" is not null', '"leads"."zip" is not null', '"leads"."deleted_at" is null']) {
      expect(S.leadWhere.sql.toLowerCase(), rule).toContain(rule);
    }
    const orgParams = [...S.leadWhere.sql.matchAll(/"organization_id" = \$(\d+)/g)].map((m) => S.leadWhere.params[Number(m[1]) - 1]);
    expect(orgParams.length).toBeGreaterThanOrEqual(2);
    expect(orgParams.every((p) => p === 42)).toBe(true);
    expect(S.leadWhere.params).toContain(9);

    // The accounting read is over the same members, live, in this org.
    expect(S.listAggWhere.sql).toMatch(/"marketing_list_members"\."list_id" in/);
    expect(S.listAggWhere.sql).toMatch(/"leads"\."deleted_at" is null/);
    expect(S.listAggFields).toMatch(/"leads"\."address" is null/i);
  });

  it("says how many list members were excluded and why — never a silent drop", async () => {
    S.lists = [{ id: 9, source: "county_records" }];
    S.memberRows = [{ id: 1 }];
    S.listAgg = { members: 10, optedOut: 1, noMailingAddress: 6, included: 3 };
    for (const path of ["/api/outreach/mail/quote", "/api/outreach/mail/preview"]) {
      const r = await request(app()).post(path).send({ audienceFilter: { leadListIds: [9], states: ["TX"] }, ...BASE });
      expect(r.status, path).toBe(200);
      expect(r.body.listMembers, path).toEqual({
        lists: 1,
        members: 10,
        included: 3,
        excluded: { optedOut: 1, noMailingAddress: 6, outsideFilters: 0 },
        message: expect.stringMatching(/7 of 10 list members can't be mailed: 6 have no mailing address yet \(skip-trace them first\), 1 opted out/),
      });
    }
  });

  it("without a list, nothing changes: no list reads and no list accounting", async () => {
    const r = await request(app()).post("/api/outreach/mail/quote").send(TX);
    expect(r.status).toBe(200);
    expect(r.body.listMembers).toBeNull();
    expect(S.tableReads).not.toContain("marketing_lists");
    expect(S.tableReads).not.toContain("marketing_list_members");
  });

  it("a county narrows the set, case- and suffix-insensitively, within its state", async () => {
    await quoted({ audienceFilter: { states: ["tx"], counties: ["Hidalgo County", " hidalgo "] }, ...BASE });
    expect(S.leadWhere.sql).toMatch(/lower\(regexp_replace\(trim\("leads"\."county"\)/);
    // The regex Postgres receives is \s+county$ — a template literal cooks a
    // bare "\s" to "s", which left every "Hidalgo County" row out.
    expect(S.leadWhere.sql).toContain("'\\s+county$'");
    expect(S.leadWhere.params).toContain("hidalgo");
    expect(S.leadWhere.params).toContain("TX");
  });

  it("a county without its state is refused (the same name exists in many states)", async () => {
    const r = await request(app()).post("/api/outreach/mail/quote").send({ audienceFilter: { counties: ["Washington"] }, ...BASE });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("county_needs_state");
  });

  it("counties across two states are refused (each county name was matched in both)", async () => {
    const r = await request(app()).post("/api/outreach/mail/quote").send({ audienceFilter: { states: ["AR", "MO"], counties: ["Washington"] }, ...BASE });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("county_needs_state");
  });

  it("acreage bounds narrow the set", async () => {
    await quoted({ audienceFilter: { states: ["TX"], acreageMin: 5, acreageMax: 40 }, ...BASE });
    expect(S.leadWhere.sql).toMatch(/"leads"\."acreage" >= \$\d/);
    expect(S.leadWhere.sql).toMatch(/"leads"\."acreage" <= \$\d/);
  });

  it("more than 50,000 matches is refused, never cut off", async () => {
    S.leads = Array.from({ length: 50_001 }, (_, i) => lead(i + 1));
    const r = await request(app()).post("/api/outreach/mail/quote").send(TX);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("audience_too_large");
  });
});

describe("one confirmed set, one operation", () => {
  it("the audience is read ONCE per queue, and the pieces written are the set that was charged", async () => {
    const q = await quoted();
    S.leadReads = 0;
    const r = await request(app())
      .post("/api/outreach/mail/queue")
      .set("Idempotency-Key", "op-1")
      .send({ ...TX, expectedAudienceDigest: q.audienceDigest });
    expect(r.status).toBe(201);
    expect(S.leadReads).toBe(1);
    expect(S.pieces).toBe(3);
    expect(S.shipments[0].pieceCount).toBe(3);
  });

  it("recipients changed since the quote: 409 with the new quote, nothing charged or queued", async () => {
    const q = await quoted();
    S.leads = [lead(1), lead(2), lead(3), lead(4)];
    const r = await request(app())
      .post("/api/outreach/mail/queue")
      .set("Idempotency-Key", "op-2")
      .send({ ...TX, expectedAudienceDigest: q.audienceDigest });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("audience_changed");
    expect(r.body.details.quote.pieceCount).toBe(4);
    expect(S.debitKeys).toEqual([]);
    expect(S.pieces).toBe(0);
  });

  it("a readdressed lead also changes the digest (the address is what gets mailed)", async () => {
    const q = await quoted();
    S.leads = [lead(1), lead(2, { address: "9 New St" }), lead(3)];
    const r = await request(app())
      .post("/api/outreach/mail/queue")
      .set("Idempotency-Key", "op-3")
      .send({ ...TX, expectedAudienceDigest: q.audienceDigest });
    expect(r.status).toBe(409);
  });

  it("no operation key, no send", async () => {
    const q = await quoted();
    const r = await request(app()).post("/api/outreach/mail/queue").send({ ...TX, expectedAudienceDigest: q.audienceDigest });
    expect(r.status).toBe(400);
    expect(S.debitKeys).toEqual([]);
  });

  it("the same operation retried (lost response, double click) returns the one shipment — no second debit, no second queue", async () => {
    const q = await quoted();
    const send = () =>
      request(app())
        .post("/api/outreach/mail/queue")
        .set("Idempotency-Key", "op-retry")
        .send({ ...TX, expectedAudienceDigest: q.audienceDigest });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.shipmentId).toBe(first.body.shipmentId);
    expect(second.body.quote.pieceCount).toBe(3);
    expect(S.shipments).toHaveLength(1);
    expect(S.debitKeys).toHaveLength(1);
  });

  it("the debit is keyed on the operation — not on the clock", async () => {
    const q = await quoted();
    await request(app())
      .post("/api/outreach/mail/queue")
      .set("Idempotency-Key", "op-key")
      .send({ ...TX, expectedAudienceDigest: q.audienceDigest });
    expect(S.debitKeys).toHaveLength(1);
    expect(S.debitKeys[0]).toMatch(/^mail:queue:42:op:op-key:[0-9a-f-]{36}$/);
    expect(S.shipments[0].operationKey).toBe("op-key");
    expect(S.locks).toBe(1); // the per-org lock that serialises concurrent sends
  });

  it("a retry after a failed save (same key) is charged — not replayed free", async () => {
    const q = await quoted();
    const send = () =>
      request(app())
        .post("/api/outreach/mail/queue")
        .set("Idempotency-Key", "op-fail")
        .send({ ...TX, expectedAudienceDigest: q.audienceDigest });
    S.failNextInsert = true;
    const first = await send();
    expect(first.status).toBe(500);
    // The debit is taken INSIDE the shipment transaction (DEFECT-0213), so
    // the failed save rolled it back with it — there is nothing to refund,
    // and no crash between two commits can strand it.
    expect(S.debitInTx).toEqual([true]);
    expect(S.refunds).toHaveLength(0);
    const second = await send();
    expect(second.status).toBe(201);
    // A fresh debit for the attempt that saved — the refunded one is not reused.
    expect(S.debitKeys).toHaveLength(2);
    expect(S.debitKeys[0]).not.toBe(S.debitKeys[1]);
    expect(S.shipments[0].debitedCents).toBe(300);
  });

  it("a debit paid from purchased credits fires its auto top-up once the shipment commits — never for one that rolled back (audit of 1694a0b)", async () => {
    const q = await quoted();
    S.fundedByPurchased = true;
    const send = (key: string) =>
      request(app())
        .post("/api/outreach/mail/queue")
        .set("Idempotency-Key", key)
        .send({ ...TX, expectedAudienceDigest: q.audienceDigest });
    S.failNextInsert = true;
    expect((await send("op-topup-fail")).status).toBe(500);
    expect(S.topUps).toBe(0);
    expect((await send("op-topup")).status).toBe(201);
    expect(S.topUps).toBe(1);
  });

  it("two concurrent requests with the same key: one shipment, one debit, and it carries the real charge", async () => {
    const q = await quoted();
    const send = () =>
      request(app())
        .post("/api/outreach/mail/queue")
        .set("Idempotency-Key", "op-race")
        .send({ ...TX, expectedAudienceDigest: q.audienceDigest });
    S.debitDelayMs = 30; // the first request is mid-debit when the second arrives
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(S.shipments).toHaveLength(1);
    expect(S.debitKeys).toHaveLength(1);
    expect(S.shipments[0].debitedCents).toBe(300);
  });

  it("a deliberate second send (new key) is a second shipment", async () => {
    const q = await quoted();
    for (const k of ["op-a", "op-b"]) {
      const r = await request(app())
        .post("/api/outreach/mail/queue")
        .set("Idempotency-Key", k)
        .send({ ...TX, expectedAudienceDigest: q.audienceDigest });
      expect(r.status).toBe(201);
    }
    expect(S.shipments).toHaveLength(2);
  });
});

describe("what gets measured", () => {
  it("queueing records first_mail_queued — not first_mailer_sent (the email/SMS event)", async () => {
    const q = await quoted();
    await request(app())
      .post("/api/outreach/mail/queue")
      .set("Idempotency-Key", "op-evt")
      .send({ ...TX, expectedAudienceDigest: q.audienceDigest });
    expect(S.events).toEqual(["first_mail_queued"]);
  });
});

describe("preview shows the set that will be mailed", () => {
  it("pages through the same resolved recipients, with the same digest as the quote", async () => {
    const q = await quoted();
    const r = await request(app())
      .post("/api/outreach/mail/preview")
      .send({ ...TX, offset: 1, limit: 1 });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3);
    expect(r.body.recipients).toEqual([
      expect.objectContaining({ leadId: 2, name: "Ana Owner2", addressLine1: "2 Ranch Rd", zip: "78539" }),
    ]);
    expect(r.body.audienceDigest).toBe(q.audienceDigest);
  });
});

describe("the results measure accepted pieces and responding pieces", () => {
  const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-outreach-mail.ts"), "utf8"));
  const handler = (path: string) => {
    const at = src.indexOf(`"${path}"`);
    expect(at, path).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf("app.", at + path.length + 2));
  };

  it("no results query sums a shipment's pieceCount over its joined pieces (a 3-piece shipment read as 9 sends)", () => {
    for (const path of ["/api/outreach/mail/templates", "/api/outreach/mail/results/compare-templates", "/api/outreach/mail/results/cohort-by-month"]) {
      const h = handler(path);
      expect(h, path).toContain("leftJoin(mailShipmentPieces");
      expect(h, path).not.toMatch(/sum\(\$\{mailShipments\.pieceCount\}\)/);
      expect(h, path).toMatch(/filter \(where \$\{acceptedPiece\}/);
    }
  });

  it("the funnel's sent is accepted pieces — failed and suppressed are counted apart", () => {
    const h = handler("/api/outreach/mail/results/funnel/:shipmentId");
    expect(h).not.toMatch(/status\} != 'pending'/);
    expect(h).toMatch(/sent: sql<number>`count\(\*\) filter \(where \$\{acceptedPiece\}\)/);
    expect(h).toContain("failed:");
    expect(h).toContain("suppressed:");
  });

  it("accepted means a provider took it: pending, failed and suppressed are not in the set", () => {
    const def = src.slice(src.indexOf("const acceptedPiece"), src.indexOf("const respondedPiece"));
    expect(def).toContain("'sent','printed','in_transit','delivered','returned'");
    for (const s of ["'pending'", "'failed'", "'suppressed'"]) expect(def).not.toContain(s);
  });
});

describe("the legacy campaign mail route measures physical mail only when it was live", () => {
  it("first_letter_sent is recorded under the OBSERVED send mode — a test send never fixes the first-mail date", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-campaigns.ts"), "utf8"));
    const at = src.indexOf('eventName: "first_letter_sent"');
    expect(at).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, at - 600), at);
    expect(before).toContain("const sentLive = !(result.isTestMode ?? isTestMode);");
    expect(before).toContain("if (sentLive) {");
  });
});
