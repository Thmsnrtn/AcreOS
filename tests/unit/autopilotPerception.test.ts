import { describe, it, expect } from "vitest";
import {
  aggregateSenses,
  outwardSignalFrom,
  type AggregatedSense,
} from "../../server/services/autopilot/perception";

// rows are newest-first, matching the DB read order.
function row(kind: string, value: number, iso: string) {
  return { kind, value, observedAt: new Date(iso) };
}

describe("autopilot perception bus — aggregateSenses (pure)", () => {
  it("groups by kind, summing and counting, keeping the newest as latest", () => {
    const agg = aggregateSenses([
      row("revenue_delta", 5000, "2026-06-17T10:00:00Z"), // newest
      row("revenue_delta", 2000, "2026-06-17T09:00:00Z"),
      row("dunning_pressure", 1, "2026-06-17T08:00:00Z"),
    ]);
    const rev = agg.get("revenue_delta") as AggregatedSense;
    expect(rev.count).toBe(2);
    expect(rev.sum).toBe(7000);
    expect(rev.latest).toBe(5000); // first row seen = newest
    expect(agg.get("dunning_pressure")?.count).toBe(1);
  });

  it("returns an empty map for no rows (honest none-known)", () => {
    expect(aggregateSenses([]).size).toBe(0);
  });

  it("coerces non-finite values to zero defensively", () => {
    const agg = aggregateSenses([row("revenue_delta", NaN as number, "2026-06-17T10:00:00Z")]);
    expect(agg.get("revenue_delta")?.sum).toBe(0);
  });
});

describe("autopilot perception bus — outwardSignalFrom (pure)", () => {
  it("maps aggregated senses to the brain-facing signal shape", () => {
    const agg = aggregateSenses([
      row("revenue_delta", 4900, "2026-06-17T10:00:00Z"),
      row("dunning_pressure", 1, "2026-06-17T10:00:00Z"),
      row("dunning_pressure", 1, "2026-06-17T09:00:00Z"),
      row("churn_signal", 1, "2026-06-17T08:00:00Z"),
      row("email_complaint", 1, "2026-06-17T07:00:00Z"),
      row("sms_opt_out", 2, "2026-06-17T06:00:00Z"),
      row("trial_ending", 1, "2026-06-17T05:00:00Z"),
    ]);
    const sig = outwardSignalFrom(agg);
    expect(sig.revenueDeltaCents).toBe(4900);
    expect(sig.dunningPressure).toBe(2); // count, not sum
    expect(sig.churnSignals).toBe(1);
    expect(sig.emailComplaints).toBe(1);
    expect(sig.smsOptOuts).toBe(1); // count of observations
    expect(sig.trialsEnding).toBe(1);
  });

  it("defaults every channel to the honest zero when absent", () => {
    const sig = outwardSignalFrom(new Map());
    expect(sig).toEqual({
      revenueDeltaCents: 0,
      dunningPressure: 0,
      churnSignals: 0,
      emailComplaints: 0,
      smsOptOuts: 0,
      trialsEnding: 0,
    });
  });
});
