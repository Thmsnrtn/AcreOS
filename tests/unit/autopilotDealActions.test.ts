import { describe, it, expect } from "vitest";
import {
  scoreDealAction,
  recommendNextActions,
  STALE_NEGOTIATION_DAYS,
  HOT_DECAY_DAYS,
  COLD_REQUALIFY_DAYS,
  type DealSignal,
} from "../../server/services/autopilot/dealActions";

const NOW = 1_750_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ago = (d: number) => NOW - d * DAY;
const deal = (over: Partial<DealSignal> = {}): DealSignal => ({ id: "d1", status: "new", createdAt: ago(5), ...over });

describe("autopilot deal-coach — land-native next best action", () => {
  it("MONEY ON THE TABLE: under-contract/accepted is the top priority (drive to close)", () => {
    expect(scoreDealAction(deal({ status: "under_contract" }), NOW)).toMatchObject({ kind: "advance_to_close", priority: 0, urgency: "high" });
    expect(scoreDealAction(deal({ status: "accepted" }), NOW)?.kind).toBe("advance_to_close");
  });

  it("a warm negotiation gone quiet ⇒ follow up (the #1 deal-killer)", () => {
    const stale = scoreDealAction(deal({ status: "negotiating", lastContactedAt: ago(STALE_NEGOTIATION_DAYS + 1) }), NOW);
    expect(stale?.kind).toBe("follow_up");
    // recently touched negotiation ⇒ leave it alone
    expect(scoreDealAction(deal({ status: "negotiating", lastContactedAt: ago(1) }), NOW)).toBeNull();
  });

  it("high-value or hot stalled negotiations are MORE urgent", () => {
    const base = scoreDealAction(deal({ status: "responded", lastContactedAt: ago(10) }), NOW);
    const hv = scoreDealAction(deal({ status: "responded", lastContactedAt: ago(10), estimatedValueUsd: 60000 }), NOW);
    expect(base?.urgency).toBe("medium");
    expect(hv?.urgency).toBe("high");
    expect(hv!.priority).toBeLessThan(base!.priority);
  });

  it("a hot lead with no recent contact ⇒ contact now (hot leads decay fast)", () => {
    // a hot lead NOT in a negotiation status, gone quiet ⇒ contact_now
    expect(scoreDealAction(deal({ status: "new", nurturingStage: "hot", lastContactedAt: ago(3) }), NOW)?.kind).toBe("contact_now");
    expect(scoreDealAction(deal({ status: "mailed", score: 90, lastContactedAt: ago(3) }), NOW)?.kind).toBe("contact_now");
    // but a recently-contacted hot lead is fine
    expect(scoreDealAction(deal({ status: "new", nurturingStage: "hot", lastContactedAt: ago(1) }), NOW)).toBeNull();
  });

  it("negotiation status routes to follow_up even for a hot lead (status precedence)", () => {
    expect(scoreDealAction(deal({ status: "interested", nurturingStage: "hot", lastContactedAt: ago(STALE_NEGOTIATION_DAYS + 1) }), NOW)?.kind).toBe("follow_up");
  });

  it("a new, unworked lead ⇒ first contact", () => {
    expect(scoreDealAction(deal({ status: "new", createdAt: ago(3) }), NOW)?.kind).toBe("first_contact");
    // brand new (today) ⇒ no nag yet
    expect(scoreDealAction(deal({ status: "new", createdAt: ago(0) }), NOW)).toBeNull();
  });

  it("a cold lead clogging the pipeline ⇒ requalify or drop", () => {
    expect(scoreDealAction(deal({ status: "responded", nurturingStage: "cold", lastContactedAt: ago(COLD_REQUALIFY_DAYS + 5) }), NOW)?.kind).toBe("follow_up"); // negotiation status still wins
    expect(scoreDealAction(deal({ status: "warmish", nurturingStage: "cold", lastContactedAt: ago(COLD_REQUALIFY_DAYS + 5) }), NOW)?.kind).toBe("requalify_or_drop");
  });

  it("terminal deals (closed/dead/won) get no action", () => {
    for (const s of ["closed", "dead", "won", "lost", "archived"]) {
      expect(scoreDealAction(deal({ status: s }), NOW)).toBeNull();
    }
  });

  it("recommendNextActions ranks the whole pipeline by leverage and trims", () => {
    const pipeline: DealSignal[] = [
      deal({ id: "won", status: "closed" }),
      deal({ id: "newish", status: "new", createdAt: ago(3) }),
      deal({ id: "committed", status: "under_contract" }),
      deal({ id: "stale-hv", status: "negotiating", lastContactedAt: ago(20), estimatedValueUsd: 80000 }),
    ];
    const actions = recommendNextActions(pipeline, NOW, 10);
    expect(actions.map((a) => a.dealId)).toEqual(["committed", "stale-hv", "newish"]); // won dropped, ordered by leverage
    expect(actions[0].kind).toBe("advance_to_close");
  });

  it("limit trims to the top actions so nobody drowns", () => {
    const many = Array.from({ length: 20 }, (_, i) => deal({ id: `d${i}`, status: "new", createdAt: ago(5) }));
    expect(recommendNextActions(many, NOW, 3)).toHaveLength(3);
  });
});
