/**
 * Quality directive 2026-09-29 (first-mail wedge) — the 30-minute hold exists
 * so a send can be stopped, and a seller's STOP during it stops their piece.
 *
 * The queue excluded opted-out leads when it resolved the audience, but the
 * flusher read the stored piece addresses and handed them to the provider
 * without looking at the lead again: a seller who texted STOP after the queue
 * and before the handoff was still printed and mailed. Now the flusher
 * re-reads each piece's lead; a suppressed piece is marked `suppressed`,
 * never sent, and only its share of the debit is refunded — under its own
 * refund key, so a later partial-send refund is not swallowed and a later
 * total failure does not refund it twice.
 *
 * Also here: the org's first PHYSICAL mail (first_letter_sent) is recorded
 * when a provider accepts a LIVE piece — not at queue time, not on a test key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ op: "and", a }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  inArray: (col: unknown, vals: unknown[]) => ({ op: "in", col, vals }),
  asc: (c: unknown) => c,
  sql: Object.assign(() => ({ op: "sql" }), { raw: () => ({ op: "sql" }) }),
}));
const T = vi.hoisted(() => ({
  mailShipments: { __t: "ships", id: "s.id", organizationId: "s.org", totalCents: "s.total" },
  mailShipmentPieces: { __t: "pieces", id: "p.id", shipmentId: "p.ship", organizationId: "p.org", status: "p.status", recipientName: "p.rn", addressLine1: "p.a1", city: "p.city", state: "p.state", zip: "p.zip", qrCode: "p.qr", leadId: "p.lead" },
  leads: { __t: "leads", id: "l.id", organizationId: "l.org", deletedAt: "l.del", doNotContact: "l.dnc", optOutDate: "l.opt" },
  marketingSpend: { __t: "spend", id: "m.id" },
  organizations: { __t: "orgs", id: "o.id", subscriptionTier: "o.tier" },
}));
vi.mock("@shared/schema", () => T);

const S = vi.hoisted(() => ({
  pieces: [] as Array<{ id: number; leadId: number; status: string }>,
  optedOut: new Set<number>(),
  leadQueryOrg: undefined as unknown,
  ship: { status: "sending" } as Record<string, unknown>,
  refunds: [] as Array<{ originalEventId: string; amountCents: number }>,
  routed: [] as number[],
  route: null as null | ((n: number) => Promise<unknown>),
  events: [] as Array<{ eventName: string }>,
}));

function findEq(cond: unknown, col: string): unknown {
  const c = cond as { op?: string; col?: unknown; val?: unknown; a?: unknown[] };
  if (c?.op === "eq" && c.col === col) return c.val;
  for (const x of c?.a ?? []) {
    const v = findEq(x, col);
    if (v !== undefined) return v;
  }
  return undefined;
}
function findIn(cond: unknown, col: string): unknown[] | undefined {
  const c = cond as { op?: string; col?: unknown; vals?: unknown[]; a?: unknown[] };
  if (c?.op === "in" && c.col === col) return c.vals;
  for (const x of c?.a ?? []) {
    const v = findIn(x, col);
    if (v) return v;
  }
  return undefined;
}

vi.mock("../../server/db", () => ({
  db: {
    execute: async () => [
      { id: 1, organization_id: 5, piece_type: "letter_10", speed: "standard", copy_snapshot: "<p>Offer</p>", debit_event_key: "mail:1", debited_cents: 300, piece_count: 3 },
    ],
    select: () => ({
      from: (t: { __t: string }) => ({
        where: (cond: unknown) => {
          let rows: unknown[] = [];
          if (t.__t === "pieces") {
            rows = S.pieces
              .filter((p) => p.status === "pending")
              .map((p) => ({ id: p.id, leadId: p.leadId, recipientName: "Bea Rowe", addressLine1: "1 Main", city: "Austin", state: "TX", zip: "78701", qrCode: null }));
          } else if (t.__t === "leads") {
            S.leadQueryOrg = findEq(cond, T.leads.organizationId);
            const ids = (findIn(cond, T.leads.id) ?? []) as number[];
            rows = ids.filter((id) => !S.optedOut.has(id)).map((id) => ({ id }));
          } else if (t.__t === "orgs") {
            rows = [{ tier: "pro" }];
          }
          const chain = Promise.resolve(rows) as Promise<unknown[]> & { orderBy: () => Promise<unknown[]> };
          chain.orderBy = async () => rows;
          return chain;
        },
      }),
    }),
    update: (t: { __t: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          if (t.__t === "pieces") {
            const id = findEq(cond, T.mailShipmentPieces.id);
            const ids = findIn(cond, T.mailShipmentPieces.id);
            for (const p of S.pieces) {
              if (ids ? ids.includes(p.id) : id === undefined || p.id === id) Object.assign(p, v);
            }
          } else if (t.__t === "ships") {
            Object.assign(S.ship, v);
          }
        },
      }),
    }),
  },
}));
vi.mock("../../server/services/creditPool", () => ({
  refundPoolDebit: vi.fn(async (a: { originalEventId: string; amountCents: number }) => {
    S.refunds.push({ originalEventId: a.originalEventId, amountCents: a.amountCents });
  }),
}));
vi.mock("../../server/services/activation", () => ({
  recordActivationEventAsync: (e: { eventName: string }) => {
    S.events.push(e);
  },
}));
vi.mock("../../server/services/outreachStopLoss", () => ({
  getOutreachStopLossStatus: async () => ({ paused: false }),
  notifyOutreachPausedOnce: vi.fn(),
}));
vi.mock("../../server/services/solene/verifyQueue", () => ({ enqueueMailShipmentVerify: vi.fn(async () => undefined) }));
vi.mock("../../server/services/founderSettings", () => ({ getSetting: async () => JSON.stringify(["lob"]) }));
vi.mock("../../server/services/mail/qrCodes", () => ({ qrRedirectUrl: () => "https://example.test/r/x" }));
vi.mock("../../server/services/mail/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/mail/router")>();
  return {
    ...actual,
    MailRouter: class {
      async route(shipment: { pieces: unknown[] }) {
        S.routed.push(shipment.pieces.length);
        return S.route!(shipment.pieces.length);
      }
    },
  };
});

const { flushDueMailShipments } = await import("../../server/services/mail/mailFlusher");

const accepted = (n: number) => ({
  chosenProvider: "lob",
  alternatives: [],
  savedVsLobCents: 0,
  result: { provider: "lob", providerEventId: "ltr_x", pieces: Array.from({ length: n }, (_, i) => ({ providerPieceId: `ltr_${i}`, recipientRef: "5" })), totalCostCents: 100 * n },
});

const env = { ...process.env };
beforeEach(() => {
  S.pieces = [1, 2, 3].map((id) => ({ id, leadId: 10 + id, status: "pending" }));
  S.optedOut = new Set();
  S.leadQueryOrg = undefined;
  S.ship = { status: "sending" };
  S.refunds.length = 0;
  S.routed.length = 0;
  S.events.length = 0;
  S.route = async (n) => accepted(n);
  delete process.env.LOB_TEST_API_KEY;
  process.env.LOB_LIVE_API_KEY = "live_abc";
});
afterEach(() => {
  process.env = { ...env };
});

describe("a STOP during the hold stops the piece", () => {
  it("the opted-out lead's piece is suppressed, the rest are sent, and only its share is refunded", async () => {
    S.optedOut.add(12);
    await flushDueMailShipments();
    expect(S.routed).toEqual([2]);
    expect(S.pieces.map((p) => p.status)).toEqual(["sent", "suppressed", "sent"]);
    expect(S.refunds).toEqual([{ originalEventId: "mail:1:suppressed", amountCents: 100 }]);
    expect(S.leadQueryOrg).toBe(5); // the recheck reads THIS org's leads
  });

  it("everyone opted out: nothing is sent, the shipment is cancelled, the whole debit refunded", async () => {
    S.optedOut = new Set([11, 12, 13]);
    await flushDueMailShipments();
    expect(S.routed).toEqual([]);
    expect(S.ship.status).toBe("cancelled");
    expect(S.refunds).toEqual([{ originalEventId: "mail:1:suppressed", amountCents: 300 }]);
  });

  it("one suppressed, then the provider refuses everything: the two refunds add up to the debit — not more", async () => {
    S.optedOut.add(11);
    S.route = async () => {
      throw new Error("every viable provider failed");
    };
    await flushDueMailShipments();
    const total = S.refunds.reduce((s, r) => s + r.amountCents, 0);
    expect(total).toBe(300);
    expect(S.refunds).toContainEqual({ originalEventId: "mail:1:suppressed", amountCents: 100 });
    expect(S.refunds).toContainEqual({ originalEventId: "mail:1", amountCents: 200 });
  });

  it("no STOP: all three go out, nothing refunded", async () => {
    await flushDueMailShipments();
    expect(S.routed).toEqual([3]);
    expect(S.refunds).toEqual([]);
  });
});

describe("the first physical mail is measured when a provider accepts a live piece", () => {
  it("live key + accepted: first_letter_sent", async () => {
    await flushDueMailShipments();
    expect(S.events.map((e) => e.eventName)).toEqual(["first_letter_sent"]);
  });

  it("a test key is not physical mail", async () => {
    process.env.LOB_TEST_API_KEY = "test_abc";
    await flushDueMailShipments();
    expect(S.events).toEqual([]);
  });

  it("nothing accepted: nothing recorded", async () => {
    S.route = async () => {
      throw new Error("provider down");
    };
    await flushDueMailShipments();
    expect(S.events).toEqual([]);
  });
});

describe("what is printed is what the preview showed", () => {
  it("merge fields are filled per piece, escaped, and an entity is greeted by its whole name", async () => {
    const { buildRouterShipment } = await import("../../server/services/mail/mailFlusher");
    const ship = { id: 1, organizationId: 5, pieceType: "letter_10", speed: "standard", copySnapshot: "<p>Hi {firstName}, land in {city}, {state}?</p>", debitEventKey: null, debitedCents: null };
    const out = buildRouterShipment(ship, [
      { id: 1, recipientName: "Ana Owner", addressLine1: "1", city: "Edinburg", state: "TX", zip: "1", qrCode: null },
      { id: 2, recipientName: "SMITH FAMILY TRUST", addressLine1: "1", city: "Llano", state: "TX", zip: "1", qrCode: null },
      { id: 3, recipientName: "Bo <script>", addressLine1: "1", city: "A&B", state: "TX", zip: "1", qrCode: null },
    ] as never);
    expect(out.pieces[0].vars?.htmlContent).toBe("<p>Hi Ana, land in Edinburg, TX?</p>");
    expect(out.pieces[1].vars?.htmlContent).toBe("<p>Hi SMITH FAMILY TRUST, land in Llano, TX?</p>");
    expect(out.pieces[2].vars?.htmlContent).toBe("<p>Hi Bo, land in A&amp;B, TX?</p>");
    expect(out.pieces.every((p) => !String(p.vars?.htmlContent).includes("{firstName}"))).toBe(true);
  });
});
