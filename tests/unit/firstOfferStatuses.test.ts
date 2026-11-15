import { describe, expect, it } from "vitest";
import { ALL_FUNNEL_DEAL_STATUSES } from "../../shared/lifecycle/pipeline-status";
import { OFFER_MADE_DEAL_STATUSES, OFFER_MADE_OFFER_STATUSES, OFFER_MADE_PROPERTY_STATUSES } from "../../shared/growth/firstOffer";

describe("what counts as an offer made", () => {
  it("classifies every funnel deal status (a new stage must be decided here)", () => {
    const before = ["negotiating", "cancelled"];
    const made = ["offer_sent", "countered", "accepted", "in_escrow", "closed", "closing"];
    expect([...before, ...made].sort()).toEqual([...ALL_FUNNEL_DEAL_STATUSES].sort());
    expect([...OFFER_MADE_DEAL_STATUSES].sort()).toEqual([...made].sort());
  });
  it("does not count drafts or approved-but-unsent offers", () => {
    expect(OFFER_MADE_OFFER_STATUSES).not.toContain("draft");
    expect(OFFER_MADE_OFFER_STATUSES).not.toContain("approved");
    expect(OFFER_MADE_OFFER_STATUSES).toContain("sent");
  });
  it("counts only parcels marked offer sent / under contract", () => {
    expect([...OFFER_MADE_PROPERTY_STATUSES]).toEqual(["offer_sent", "under_contract"]);
  });
});
