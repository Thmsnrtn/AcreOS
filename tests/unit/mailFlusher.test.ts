import { describe, it, expect } from "vitest";
import { buildRouterShipment, type FlushShipment, type FlushPiece } from "../../server/services/mail/mailFlusher";

/**
 * Gap 2 (product-truth audit) — the mail flusher's pure mapper. The DB
 * orchestration (claim/send/refund) is integration-tested by the live worker;
 * this pins the shipment→router mapping that feeds the real Lob send.
 */
const ship = (over: Partial<FlushShipment> = {}): FlushShipment => ({
  id: 1,
  organizationId: 42,
  pieceType: "postcard_4x6",
  speed: "standard",
  copySnapshot: "<h1>Cash offer for your land</h1>",
  debitEventKey: "mail:queue:42:123:2",
  debitedCents: 184,
  ...over,
});

const piece = (over: Partial<FlushPiece> = {}): FlushPiece => ({
  id: 10,
  recipientName: "Jane Q Public",
  addressLine1: "100 Ranch Rd",
  city: "Austin",
  state: "TX",
  zip: "78701",
  ...over,
});

describe("buildRouterShipment", () => {
  it("maps shipment + pieces into a router MailShipment (org scope, speed, feature)", () => {
    const s = buildRouterShipment(ship(), [piece()]);
    expect(s.organizationId).toBe(42);
    expect(s.customerId).toBe(42);
    expect(s.speed).toBe("standard");
    expect(s.feature).toBe("outreach_mail_queue");
    expect(s.pieces).toHaveLength(1);
    expect(s.pieces[0].pieceType).toBe("postcard_4x6");
  });

  it("splits the recipient name into first + last", () => {
    const s = buildRouterShipment(ship(), [piece({ recipientName: "Jane Q Public" })]);
    expect(s.pieces[0].recipient.firstName).toBe("Jane");
    expect(s.pieces[0].recipient.lastName).toBe("Q Public");
    expect(s.pieces[0].recipient.address1).toBe("100 Ranch Rd");
    expect(s.pieces[0].recipient.city).toBe("Austin");
  });

  it("fans the copy snapshot into both letter + postcard content vars", () => {
    const s = buildRouterShipment(ship({ copySnapshot: "BODY" }), [piece()]);
    expect(s.pieces[0].vars?.htmlContent).toBe("BODY");
    expect(s.pieces[0].vars?.frontHtml).toBe("BODY");
  });

  it("preserves piece ORDER (so the index-aligned writeback maps correctly)", () => {
    const s = buildRouterShipment(ship(), [
      piece({ id: 10, recipientName: "A", addressLine1: "1 St" }),
      piece({ id: 11, recipientName: "B", addressLine1: "2 St" }),
      piece({ id: 12, recipientName: "C", addressLine1: "3 St" }),
    ]);
    expect(s.pieces.map((p) => p.recipient.address1)).toEqual(["1 St", "2 St", "3 St"]);
  });

  it("is total on a blank/missing recipient name", () => {
    const s = buildRouterShipment(ship(), [piece({ recipientName: null })]);
    expect(s.pieces[0].recipient.firstName).toBeUndefined();
    expect(s.pieces[0].recipient.lastName).toBeUndefined();
    expect(s.pieces[0].recipient.address1).toBe("100 Ranch Rd");
  });

  it("handles an empty copy snapshot without throwing", () => {
    const s = buildRouterShipment(ship({ copySnapshot: null }), [piece()]);
    expect(s.pieces[0].vars?.htmlContent).toBe("");
  });
});
