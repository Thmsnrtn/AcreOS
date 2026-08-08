// Pins the buyer-match lifecycle emitter (audit Wave 1, beta→core):
// tpl_buyer_match_found was dead until this emitter shipped, so this test fixes
// the new truth — buyer.match_created fires for a genuinely NEW match, carries
// only real fields (the match row's columns + the resolved buyer contact), and
// passes null (never a fabricated recipient/name/address) when the buyer profile
// has no linked lead. Fire-and-forget: a throwing engine never propagates.
//
// The caller (buyerMatchingAI) fires this ONLY on its fresh-insert branch — that
// no-re-fire discipline lives in buyerMatchingAI, so this pure test pins the
// emitter's payload/contract, not the call-site gating (mock the engine helper).
import { afterEach, describe, expect, it, vi } from "vitest";

const { emitBuyerEvent } = vi.hoisted(() => ({ emitBuyerEvent: vi.fn() }));
vi.mock("../../server/services/workflow-engine", () => ({ emitBuyerEvent }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { emitBuyerMatchCreated } from "../../server/services/buyerEvents";

const match = {
  id: 900,
  organizationId: 7,
  buyerProfileId: 55,
  propertyId: 42,
};

const contact = {
  propertyAddress: "1247 Cherokee Pl",
  buyerEmail: "buyer@example.com",
  buyerName: "Ari Buyer",
  buyerFirstName: "Ari",
};

afterEach(() => emitBuyerEvent.mockReset());

describe("emitBuyerMatchCreated", () => {
  it("fires buyer.match_created with the real match + contact fields", () => {
    emitBuyerMatchCreated(match, contact);
    expect(emitBuyerEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitBuyerEvent.mock.calls[0];
    expect(event).toBe("buyer.match_created");
    expect(orgId).toBe(7);
    // entityId is the buyer_profiles.id the match is for, never the match id.
    expect(entityId).toBe(55);
    expect(data.matchId).toBe(900);
    expect(data.buyerProfileId).toBe(55);
    expect(data.propertyId).toBe(42);
    expect(data.propertyAddress).toBe("1247 Cherokee Pl");
    expect(data.buyerEmail).toBe("buyer@example.com");
    expect(data.buyerName).toBe("Ari Buyer");
    expect(data.buyerFirstName).toBe("Ari");
  });

  it("passes null (never a fabricated recipient/name/address) when the profile has no linked lead", () => {
    emitBuyerMatchCreated(match, {
      propertyAddress: null,
      buyerEmail: null,
      buyerName: null,
      buyerFirstName: null,
    });
    expect(emitBuyerEvent).toHaveBeenCalledTimes(1);
    const [, , entityId, data] = emitBuyerEvent.mock.calls[0];
    expect(entityId).toBe(55);
    // The tpl_buyer_match_found send_email targets {{buyerEmail}}: a null email
    // renders blank, so the counterparty rail refuses rather than inventing one.
    expect(data.buyerEmail).toBeNull();
    expect(data.buyerName).toBeNull();
    expect(data.buyerFirstName).toBeNull();
    expect(data.propertyAddress).toBeNull();
  });

  it("does not propagate a throwing engine (fire-and-forget)", () => {
    emitBuyerEvent.mockImplementationOnce(() => {
      throw new Error("engine down");
    });
    expect(() => emitBuyerMatchCreated(match, contact)).not.toThrow();
  });
});
