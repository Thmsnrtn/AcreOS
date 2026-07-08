import { describe, it, expect } from "vitest";
import {
  evaluateMarketingChannels,
  eligibleMarketingChannels,
  marketingPostureLine,
  MARKETING_CHANNELS,
  FUNNEL_PROVEN_MIN_SIGNUPS,
  type MarketingState,
} from "../../server/services/autopilot/marketingChannels";

const off: MarketingState = {
  publishEnabled: false,
  attributedSignups: 0,
  growthAutonomyEarned: false,
  paidProviderAvailable: false,
  cacProven: false,
};

function decisionFor(state: MarketingState, id: string) {
  return evaluateMarketingChannels(state).find((d) => d.channel.id === id)!;
}

describe("marketingChannels — free-first self-marketing", () => {
  it("with everything off, NOTHING is eligible (publish gates the free snowball)", () => {
    expect(eligibleMarketingChannels(off)).toHaveLength(0);
    expect(marketingPostureLine(off)).toContain("idle");
  });

  it("flipping publish on lights every FREE owned/SEO/distribution channel", () => {
    const s = { ...off, publishEnabled: true };
    const free = eligibleMarketingChannels(s);
    expect(free.map((c) => c.id)).toEqual(
      expect.arrayContaining(["owned_county_guides", "owned_field_notes", "parcel_report_seo", "embeddable_tools"]),
    );
    // outbound + paid still gated.
    expect(free.find((c) => c.id === "witnessed_outbound")).toBeUndefined();
    expect(free.find((c) => c.costClass === "paid")).toBeUndefined();
  });

  it("witnessed outbound unlocks only once growth autonomy is earned", () => {
    expect(decisionFor({ ...off, publishEnabled: true }, "witnessed_outbound").eligible).toBe(false);
    expect(decisionFor({ ...off, publishEnabled: true, growthAutonomyEarned: true }, "witnessed_outbound").eligible).toBe(true);
  });
});

describe("marketingChannels — paid 'when the time is right'", () => {
  const proven: MarketingState = {
    publishEnabled: true,
    attributedSignups: FUNNEL_PROVEN_MIN_SIGNUPS,
    growthAutonomyEarned: true,
    paidProviderAvailable: true,
    cacProven: true,
  };

  it("paid is eligible ONLY when provider + autonomy + proven funnel + healthy CAC all hold", () => {
    expect(decisionFor(proven, "paid_ads").eligible).toBe(true);
  });

  it("paid stays LOCKED if the free funnel isn't proven yet (don't pay to fill an unproven funnel)", () => {
    const r = decisionFor({ ...proven, attributedSignups: 1 }, "paid_ads");
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("not yet proven");
  });

  it("paid stays LOCKED without a wired provider (dormant by absence)", () => {
    expect(decisionFor({ ...proven, paidProviderAvailable: false }, "paid_ads").eligible).toBe(false);
  });

  it("paid stays LOCKED without earned autonomy, and without healthy CAC", () => {
    expect(decisionFor({ ...proven, growthAutonomyEarned: false }, "paid_ads").eligible).toBe(false);
    expect(decisionFor({ ...proven, cacProven: false }, "paid_ads").eligible).toBe(false);
  });

  it("the posture line reports paid unlocked once proven", () => {
    expect(marketingPostureLine(proven)).toContain("paid amplification UNLOCKED");
  });
});

describe("marketingChannels — catalog integrity", () => {
  it("free channels are listed before paid (snowball-first ordering)", () => {
    const lastFree = MARKETING_CHANNELS.map((c) => c.costClass).lastIndexOf("free");
    const firstPaid = MARKETING_CHANNELS.findIndex((c) => c.costClass === "paid");
    expect(firstPaid).toBeGreaterThan(lastFree);
  });
});
