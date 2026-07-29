import { describe, it, expect } from "vitest";
import {
  buildRouterShipment,
  responseBlockHtml,
  type FlushShipment,
  type FlushPiece,
} from "../../server/services/mail/mailFlusher";

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

/**
 * Wave B completeness audit (2026-07-29). The per-piece attribution code was
 * minted at queue time and stored on the row, but the flusher never read the
 * column — so nothing about it reached the printed piece and `/r/:code` could
 * only ever be hit by someone who already knew the URL. These pin the fix:
 * an instrumented piece PRINTS its response link; an uninstrumented one
 * prints nothing at all (never a placeholder, never a dead link).
 */
describe("printed attribution block", () => {
  it("prints nothing for an uninstrumented piece", () => {
    expect(responseBlockHtml(null)).toBe("");
    expect(responseBlockHtml(undefined)).toBe("");
    expect(responseBlockHtml("")).toBe("");
    const s = buildRouterShipment(ship({ copySnapshot: "BODY" }), [piece()]);
    expect(s.pieces[0].vars?.htmlContent).toBe("BODY");
    expect(s.pieces[0].vars?.backHtml).toBe("");
  });

  it("prints the piece's own short link when the piece is instrumented", () => {
    const s = buildRouterShipment(ship({ copySnapshot: "BODY" }), [
      piece({ qrCode: "a-1b2c3d4e" }),
    ]);
    // The back of a postcard carries the response block; the front stays the
    // operator's artwork.
    expect(s.pieces[0].vars?.backHtml).toContain("/r/a-1b2c3d4e");
    expect(s.pieces[0].vars?.frontHtml).toBe("BODY");
    // Letters have one canvas — the block is appended to the body.
    expect(s.pieces[0].vars?.htmlContent).toContain("BODY");
    expect(s.pieces[0].vars?.htmlContent).toContain("/r/a-1b2c3d4e");
  });

  it("gives each piece ITS OWN code (attribution is per piece, not per shipment)", () => {
    const s = buildRouterShipment(ship(), [
      piece({ id: 10, qrCode: "a-11111111" }),
      piece({ id: 11, qrCode: "b-22222222" }),
      piece({ id: 12, qrCode: null }),
    ]);
    expect(s.pieces[0].vars?.backHtml).toContain("/r/a-11111111");
    expect(s.pieces[1].vars?.backHtml).toContain("/r/b-22222222");
    expect(s.pieces[2].vars?.backHtml).toBe("");
  });
});
