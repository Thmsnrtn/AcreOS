/**
 * DEFECT-0105 — mail the provider accepted is never marked failed or refunded.
 *
 * `flushOne` wrapped the provider call AND the post-accept write-back in one
 * catch that marked every piece and the shipment `failed` and refunded the
 * full debit. So:
 *   - a provider that accepted pieces 1..k and then failed on k+1 had its k
 *     printed pieces marked failed and refunded (and the router, failing over,
 *     would print them again through the next provider);
 *   - a database hiccup AFTER the provider accepted everything refunded mail
 *     that was in the post.
 * Only a failure with NOTHING accepted is now a failed, fully-refunded
 * shipment. Drives the real `flushDueMailShipments` over a database double.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ op: "and", a }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  asc: (c: unknown) => c,
  sql: Object.assign(() => ({ op: "sql" }), { raw: () => ({ op: "sql" }) }),
}));
const T = vi.hoisted(() => ({
  mailShipments: { __t: "ships", id: "s.id", organizationId: "s.org", totalCents: "s.total" },
  mailShipmentPieces: { __t: "pieces", id: "p.id", shipmentId: "p.ship", organizationId: "p.org", status: "p.status", recipientName: "p.rn", addressLine1: "p.a1", city: "p.city", state: "p.state", zip: "p.zip", qrCode: "p.qr" },
  marketingSpend: { __t: "spend", id: "m.id" },
  organizations: { __t: "orgs", id: "o.id", subscriptionTier: "o.tier" },
}));
vi.mock("@shared/schema", () => T);

const S = vi.hoisted(() => ({
  pieces: [] as Array<{ id: number; status: string; providerPieceId?: string | null }>,
  ship: { status: "sending" } as Record<string, unknown>,
  refunds: [] as Array<{ amountCents: number }>,
  failWriteBack: false,
  route: null as null | (() => Promise<unknown>),
}));

function eqVal(cond: unknown, col: string): unknown {
  const c = cond as { op?: string; col?: unknown; val?: unknown; a?: unknown[] };
  if (c?.op === "eq" && c.col === col) return c.val;
  for (const x of c?.a ?? []) {
    const v = eqVal(x, col);
    if (v !== undefined) return v;
  }
  return undefined;
}

vi.mock("../../server/db", () => ({
  db: {
    execute: async () => [
      { id: 1, organization_id: 5, piece_type: "letter_10", speed: "standard", copy_snapshot: "<p>Offer</p>", debit_event_key: "mail:1", debited_cents: 300 },
    ],
    select: () => ({
      from: (t: { __t: string }) => ({
        where: () => {
          const rows = t.__t === "pieces" ? S.pieces.filter((p) => p.status === "pending").map((p) => ({ id: p.id, recipientName: "Bea Rowe", addressLine1: "1 Main", city: "Austin", state: "TX", zip: "78701", qrCode: null })) : t.__t === "orgs" ? [{ tier: "pro" }] : [];
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
            if (S.failWriteBack && v.status === "sent") throw new Error("connection reset during write-back");
            const id = eqVal(cond, T.mailShipmentPieces.id);
            for (const p of S.pieces) if (id === undefined || p.id === id) Object.assign(p, v);
          } else if (t.__t === "ships") {
            Object.assign(S.ship, v);
          }
        },
      }),
    }),
  },
}));
vi.mock("../../server/services/creditPool", () => ({
  refundPoolDebit: vi.fn(async (a: { amountCents: number }) => {
    S.refunds.push({ amountCents: a.amountCents });
  }),
}));
vi.mock("../../server/services/outreachStopLoss", () => ({
  getOutreachStopLossStatus: async () => ({ paused: false }),
  notifyOutreachPausedOnce: vi.fn(),
}));
vi.mock("../../server/services/solene/verifyQueue", () => ({ enqueueMailShipmentVerify: vi.fn(async () => undefined) }));
vi.mock("../../server/services/founderSettings", () => ({ getSetting: async () => JSON.stringify(["lob", "postgrid"]) }));
vi.mock("../../server/services/mail/qrCodes", () => ({ qrRedirectUrl: () => "https://example.test/r/x" }));
vi.mock("../../server/services/mail/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/mail/router")>();
  return {
    ...actual,
    MailRouter: class {
      async route() {
        return S.route!();
      }
    },
  };
});

const { PartialMailSendError } = await import("../../server/services/mail/router");
const { flushDueMailShipments } = await import("../../server/services/mail/mailFlusher");

beforeEach(() => {
  S.pieces = [1, 2, 3].map((id) => ({ id, status: "pending" }));
  S.ship = { status: "sending" };
  S.refunds.length = 0;
  S.failWriteBack = false;
});

describe("mail the provider accepted is never failed or refunded (DEFECT-0105)", () => {
  it("provider accepts 2 of 3 then fails: 2 sent with ids, 1 failed, only 1/3 of the debit refunded", async () => {
    S.route = async () => {
      throw new PartialMailSendError("lob", [{ providerPieceId: "ltr_1", recipientRef: "5" }, { providerPieceId: "ltr_2", recipientRef: "5" }], 3, "rate limited");
    };
    const summary = await flushDueMailShipments();
    expect(S.pieces.map((p) => p.status)).toEqual(["sent", "sent", "failed"]);
    expect(S.pieces[0].providerPieceId).toBe("ltr_1");
    expect(S.refunds).toEqual([{ amountCents: 100 }]);
    expect(S.ship.status).toBe("sent");
    expect(String(S.ship.cancellationReason)).toMatch(/2 of 3/);
    expect(summary.sent).toBe(1);
  });

  it("provider accepts everything, then the write-back fails: NOT marked failed, NOT refunded", async () => {
    S.failWriteBack = true;
    S.route = async () => ({ chosenProvider: "lob", alternatives: [], savedVsLobCents: 0, result: { provider: "lob", providerEventId: "ltr_1", pieces: [1, 2, 3].map((i) => ({ providerPieceId: `ltr_${i}`, recipientRef: "5" })), totalCostCents: 300 } });
    const summary = await flushDueMailShipments();
    expect(S.refunds).toEqual([]);
    expect(S.pieces.some((p) => p.status === "failed")).toBe(false);
    expect(S.ship.status).not.toBe("failed");
    expect(summary.failed).toBe(0);
  });

  it("nothing accepted: every piece failed and the full debit refunded (unchanged)", async () => {
    S.route = async () => {
      throw new Error("every viable provider failed");
    };
    await flushDueMailShipments();
    expect(S.pieces.map((p) => p.status)).toEqual(["failed", "failed", "failed"]);
    expect(S.refunds).toEqual([{ amountCents: 300 }]);
    expect(S.ship.status).toBe("failed");
  });

  it("each routed piece carries a durable identity for provider-side idempotency", async () => {
    const { buildRouterShipment } = await import("../../server/services/mail/mailFlusher");
    const s = buildRouterShipment(
      { id: 1, organizationId: 5, pieceType: "letter_10", speed: "standard", copySnapshot: "x", debitEventKey: null, debitedCents: null },
      [{ id: 44, recipientName: "A B", addressLine1: "1", city: "c", state: "TX", zip: "1", qrCode: null }],
    );
    expect(s.pieces[0].pieceRef).toBe("mail_piece:44");
  });
});

describe("the router never fails over a partially accepted shipment (DEFECT-0105)", () => {
  it("a PartialMailSendError propagates instead of trying the next provider", async () => {
    const { MailRouter: RealRouter, __setMailRouterRegistry } = await vi.importActual<typeof import("../../server/services/mail/router")>("../../server/services/mail/router");
    const secondSend = vi.fn();
    __setMailRouterRegistry([
      { name: "lob", isConfigured: () => true, quote: async () => ({ provider: "lob", costPerPieceCents: 100, deliveryEtaDays: 5, minVolume: 1, meetsConstraints: true }), send: async () => { throw new PartialMailSendError("lob", [{ providerPieceId: "ltr_1", recipientRef: "5" }], 3, "boom"); } },
      { name: "postgrid", isConfigured: () => true, quote: async () => ({ provider: "postgrid", costPerPieceCents: 120, deliveryEtaDays: 5, minVolume: 1, meetsConstraints: true }), send: secondSend },
    ] as never);
    const router = new RealRouter();
    await expect(
      router.route({ customerId: 5, organizationId: 5, speed: "standard", personalizationRequired: false, pieces: [1, 2, 3].map(() => ({ recipient: { address1: "1", city: "c", state: "TX", zip: "1" }, pieceType: "letter_10" as const })) }),
    ).rejects.toBeInstanceOf(PartialMailSendError);
    expect(secondSend).not.toHaveBeenCalled();
  });
});
