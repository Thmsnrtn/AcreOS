import { describe, it, expect } from "vitest";
import {
  situationVector,
  situationDistance,
  recallSimilar,
  summarizeRecall,
  type Episode,
  type EpisodeSenses,
} from "../../server/services/autopilot/memory";

const senses = (over: Partial<EpisodeSenses> = {}): EpisodeSenses => ({
  mrr: 0,
  trials: 0,
  supportBacklog: 0,
  envelopeStatus: "green",
  dispatchBacklog: 0,
  openIncidents: 0,
  complianceOpenCount: 0,
  ...over,
});

const ep = (moveKind: string, vote: Episode["vote"], s: Partial<EpisodeSenses>): Episode => ({ moveKind, vote, senses: senses(s) });

describe("autopilot living memory — case-based recall", () => {
  it("the situation vector is bounded [0,1] and orders envelope health", () => {
    const v = situationVector(senses({ mrr: 100000, supportBacklog: 50, envelopeStatus: "red" }));
    for (const x of v) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
    expect(situationVector(senses({ envelopeStatus: "green" }))[3]).toBe(0);
    expect(situationVector(senses({ envelopeStatus: "red" }))[3]).toBe(1);
  });

  it("identical situations have zero distance; different ones have positive distance", () => {
    const a = situationVector(senses({ supportBacklog: 3 }));
    expect(situationDistance(a, a)).toBe(0);
    expect(situationDistance(a, situationVector(senses({ supportBacklog: 0 })))).toBeGreaterThan(0);
  });

  it("recalls the NEAREST past episodes and excludes unresolved (pending) ones", () => {
    const current = senses({ supportBacklog: 4, trials: 1 });
    const episodes: Episode[] = [
      ep("clear_support_backlog", "success", { supportBacklog: 5, trials: 1 }), // very near
      ep("grow_owned_channels", "failure", { mrr: 5000, trials: 50 }), // far
      ep("optimize", "pending", { supportBacklog: 4 }), // pending — excluded
    ];
    const recalled = recallSimilar(current, episodes, 5);
    expect(recalled.map((r) => r.moveKind)).toEqual(["clear_support_backlog", "grow_owned_channels"]);
    expect(recalled.find((r) => r.vote === "pending")).toBeUndefined();
    // nearest first
    expect(recalled[0].moveKind).toBe("clear_support_backlog");
  });

  it("summarizes the move that worked best in similar situations", () => {
    const recalled = recallSimilar(senses({ supportBacklog: 4 }), [
      ep("clear_support_backlog", "success", { supportBacklog: 4 }),
      ep("clear_support_backlog", "success", { supportBacklog: 5 }),
      ep("clear_support_backlog", "failure", { supportBacklog: 3 }),
      ep("grow_owned_channels", "failure", { supportBacklog: 4 }),
    ]);
    const summary = summarizeRecall(recalled);
    expect(summary.bestKind).toBe("clear_support_backlog");
    expect(summary.note).toMatch(/worked best \(2\/3\)/);
  });

  it("HONESTY: no history ⇒ empty recall + an honest 'nothing on record' note", () => {
    expect(recallSimilar(senses(), [], 5)).toEqual([]);
    const summary = summarizeRecall([]);
    expect(summary.bestKind).toBeNull();
    expect(summary.note).toMatch(/No similar past situations on record/i);
  });

  it("when neighbours exist but none succeeded, it says so rather than recommending a loser", () => {
    const recalled = recallSimilar(senses({ supportBacklog: 4 }), [
      ep("clear_support_backlog", "failure", { supportBacklog: 4 }),
      ep("grow_owned_channels", "failure", { supportBacklog: 5 }),
    ]);
    const summary = summarizeRecall(recalled);
    expect(summary.bestKind).toBeNull();
    expect(summary.note).toMatch(/nothing has clearly worked yet/i);
  });
});
