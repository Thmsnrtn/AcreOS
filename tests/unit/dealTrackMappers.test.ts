/**
 * W6.2b — the deal track's query-time mappers. The /track endpoint's
 * "single track" promise depends on these translating the real source
 * tables (offers, seller_communications, campaign_responses,
 * mail_shipment_pieces) into timeline events faithfully:
 *
 *   - only things that HAPPENED appear (draft offers, pending mail,
 *     outbound comms contribute nothing);
 *   - ids are string-prefixed so they can never collide with the serial
 *     ids of real activity_events rows in the endpoint's dedup set;
 *   - money renders from the real columns (cashOffer, counterOffer) —
 *     no fabrication when a column is null.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  offerToTrackEvents,
  inboundCommToTrackEvent,
  campaignResponseToTrackEvent,
  mailPieceToTrackEvents,
} from "../../server/services/dealTrack";

const T1 = new Date("2026-07-01T10:00:00Z");
const T2 = new Date("2026-07-02T10:00:00Z");
const T3 = new Date("2026-07-03T10:00:00Z");

describe("offerToTrackEvents", () => {
  const baseOffer = {
    id: 12,
    organizationId: 7,
    leadId: 55,
    propertyId: 9,
    status: "sent",
    cashOffer: "45000",
    counterOffer: null,
    sellerNotes: null,
    sentAt: T1,
    viewedAt: null,
    respondedAt: null,
  } as any;

  it("a sent offer becomes one offer_sent event with the REAL cash amount", () => {
    const events = offerToTrackEvents(baseOffer);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "offer-12-sent",
      eventType: "offer_sent",
      entityType: "lead",
      entityId: 55,
      description: "Offer sent — $45,000 cash",
    });
    expect(events[0].eventDate).toEqual(T1);
  });

  it("sent + viewed + countered becomes the full three-beat story", () => {
    const events = offerToTrackEvents({
      ...baseOffer,
      status: "countered",
      counterOffer: "52000",
      viewedAt: T2,
      respondedAt: T3,
    });
    expect(events.map((e) => e.eventType)).toEqual(["offer_sent", "offer_viewed", "offer_response"]);
    expect(events[2].description).toBe("Seller countered at $52,000");
    expect(events[2].id).toBe("offer-12-response");
  });

  it("accepted and rejected responses read as outcomes, not raw statuses", () => {
    const accepted = offerToTrackEvents({ ...baseOffer, status: "accepted", respondedAt: T3 });
    expect(accepted[1].description).toBe("Offer accepted");
    const rejected = offerToTrackEvents({ ...baseOffer, status: "rejected", respondedAt: T3 });
    expect(rejected[1].description).toBe("Offer declined");
  });

  it("a DRAFT offer (no sentAt) contributes nothing — the track shows what happened", () => {
    expect(offerToTrackEvents({ ...baseOffer, status: "draft", sentAt: null })).toEqual([]);
  });

  it("a null cashOffer never fabricates an amount", () => {
    const events = offerToTrackEvents({ ...baseOffer, cashOffer: null });
    expect(events[0].description).toBe("Offer sent");
  });

  it("falls back to the property entity when the offer has no lead", () => {
    const events = offerToTrackEvents({ ...baseOffer, leadId: null });
    expect(events[0]).toMatchObject({ entityType: "property", entityId: 9 });
  });
});

describe("inboundCommToTrackEvent", () => {
  const comm = {
    id: 3,
    organizationId: 7,
    leadId: 55,
    direction: "inbound",
    channel: "call",
    subject: null,
    content: "Seller called back, interested in terms",
    sentiment: "positive",
    callOutcome: "interested",
    callDuration: 240,
    createdAt: T2,
  } as any;

  it("an inbound call becomes response_received with the call details", () => {
    const event = inboundCommToTrackEvent(comm);
    expect(event).toMatchObject({
      id: "comm-3",
      eventType: "response_received",
      entityType: "lead",
      entityId: 55,
      description: "Inbound call: Seller called back, interested in terms",
      metadata: { channel: "call", sentiment: "positive", callOutcome: "interested", callDuration: 240 },
    });
  });

  it("OUTBOUND comms are excluded — sends are already on the track from their own sources", () => {
    expect(inboundCommToTrackEvent({ ...comm, direction: "outbound" })).toBeNull();
  });
});

describe("campaignResponseToTrackEvent", () => {
  it("maps a campaign response with attribution", () => {
    const event = campaignResponseToTrackEvent({
      id: 8,
      organizationId: 7,
      leadId: 55,
      campaignId: 4,
      channel: "text",
      responseDate: T1,
      content: "Yes, still own the parcel",
      createdAt: T1,
    } as any);
    expect(event).toMatchObject({
      id: "campresp-8",
      eventType: "response_received",
      entityId: 55,
      campaignId: 4,
      description: "Campaign response via text",
      metadata: { channel: "text", notes: "Yes, still own the parcel" },
    });
  });

  it("a response with no lead attribution is skipped (nothing to stitch it to)", () => {
    expect(campaignResponseToTrackEvent({ id: 9, organizationId: 7, leadId: null } as any)).toBeNull();
  });
});

describe("mailPieceToTrackEvents", () => {
  const piece = {
    id: 21,
    organizationId: 7,
    leadId: 55,
    recipientName: "Pat Seller",
    city: "Alpine",
    state: "TX",
    status: "delivered",
    printedAt: T1,
    deliveredAt: T2,
    createdAt: T1,
  } as any;

  it("a delivered piece becomes mail_sent + mail_delivered (existing registry types)", () => {
    const events = mailPieceToTrackEvents(piece);
    expect(events.map((e) => e.eventType)).toEqual(["mail_sent", "mail_delivered"]);
    expect(events[0]).toMatchObject({
      id: "mailpiece-21-sent",
      description: "Direct mail sent to Pat Seller",
    });
    expect(events[1].eventDate).toEqual(T2);
  });

  it("an in-transit piece has only the sent beat", () => {
    const events = mailPieceToTrackEvents({ ...piece, status: "in_transit", deliveredAt: null });
    expect(events.map((e) => e.eventType)).toEqual(["mail_sent"]);
  });

  it("pending and failed pieces contribute nothing — nothing was sent", () => {
    expect(mailPieceToTrackEvents({ ...piece, status: "pending", deliveredAt: null })).toEqual([]);
    expect(mailPieceToTrackEvents({ ...piece, status: "failed", deliveredAt: null })).toEqual([]);
  });

  it("a piece with no lead is skipped", () => {
    expect(mailPieceToTrackEvents({ ...piece, leadId: null })).toEqual([]);
  });
});
