import { describe, it, expect } from "vitest";
import { assembleContextPack, type ContextPackRaw } from "../../server/services/autopilot/cognitionContext";

const base: ContextPackRaw = {
  mrrUsd: 200,
  mrrPriorUsd: 160,
  trials: 4,
  trialsEndingSoon: 1,
  supportBacklog: 2,
  supportFirstResponseHours: 3,
  churnSignals: 0,
  envelopeStatus: "green",
  uptimePct: 99.9,
  openIncidents: 0,
  complianceOpen: 0,
  emailComplaints: 0,
  effectiveCapUsd: 100,
  baseCapUsd: 50,
  mtdSpendUsd: 20,
  reservePct: 0.2,
  attributedSignups: 5,
  recentDecisions: [{ move: "grow_owned_channels", outcome: "success" }],
  calibrationGrade: "well-calibrated",
  calibrationN: 30,
  openAsks: [{ summary: "raise budget?", ageHours: 6 }],
  trust: [{ domain: "growth", level: "observe", qualityLine: "learning" }],
  standingOrders: ["never cold-blast"],
  objectives: ["first 10 paying customers"],
  recall: [{ situation: "low trials", whatWorked: "county guide content" }],
  thesis: "Own the county-data niche; grow only on proven CAC.",
};

describe("assembleContextPack — the eagle-eye briefing", () => {
  it("computes WoW MRR trend when a prior datapoint exists", () => {
    const p = assembleContextPack(base);
    expect(p.vitals.mrrWowPct).toBeCloseTo(25, 5); // (200-160)/160 = +25%
  });

  it("OMITS the trend (null, never 0) when there's no prior datapoint", () => {
    const p = assembleContextPack({ ...base, mrrPriorUsd: null });
    expect(p.vitals.mrrWowPct).toBeNull();
    expect(p.generatedNote).toMatch(/no prior MRR datapoint/i);
    expect(p.briefing).toMatch(/MRR trend: n\/a/i);
  });

  it("computes CAC from real spend + attributed signups", () => {
    const p = assembleContextPack(base);
    expect(p.books.cacUsd).toBeCloseTo(4, 5); // 20 / 5
  });

  it("treats CAC as a lower bound: null (not zero) when no attributed signups", () => {
    const p = assembleContextPack({ ...base, attributedSignups: 0 });
    expect(p.books.cacUsd).toBeNull();
    expect(p.generatedNote).toMatch(/lower bound/i);
  });

  it("reserves the protected slice before discretionary headroom", () => {
    const p = assembleContextPack(base);
    // cap 100, spent 20, reserve 20% of 100 = 20 → headroom = 100-20-20 = 60
    expect(p.books.discretionaryHeadroomUsd).toBe(60);
  });

  it("never reports negative headroom", () => {
    const p = assembleContextPack({ ...base, mtdSpendUsd: 95 });
    expect(p.books.discretionaryHeadroomUsd).toBe(0);
  });

  it("flags a ramped budget", () => {
    expect(assembleContextPack(base).books.ramped).toBe(true); // 100 > 50
    expect(assembleContextPack({ ...base, effectiveCapUsd: 50 }).books.ramped).toBe(false);
  });

  it("surfaces the oldest open ask", () => {
    const p = assembleContextPack({
      ...base,
      openAsks: [{ summary: "a", ageHours: 6 }, { summary: "b", ageHours: 30 }],
    });
    expect(p.attention.oldestAskHours).toBe(30);
  });

  it("labels absent signals honestly and reports all-present otherwise", () => {
    const allPresent = assembleContextPack(base);
    expect(allPresent.generatedNote).toMatch(/All signals present/i);
    const sparse = assembleContextPack({
      ...base,
      uptimePct: null,
      supportFirstResponseHours: null,
      calibrationGrade: null,
      thesis: null,
    });
    expect(sparse.generatedNote).toMatch(/uptime not yet sampled/i);
    expect(sparse.generatedNote).toMatch(/no strategy memory yet/i);
    expect(sparse.thesis).toBe("No strategy memory yet.");
  });
});

// ── Partial-telemetry honesty (2026-07-03) ──────────────────────────────────
// gatherContextPack tracks senses that failed to read; the briefing must
// carry a loud UNKNOWN-not-zero warning so the Operator never grounds a
// plan on a blind sense. partialTelemetryBlock is the pure prompt block.
import { partialTelemetryBlock } from "../../server/services/autopilot/cognitionContext";

describe("partialTelemetryBlock — dark senses are loud, absent senses are silent", () => {
  it("returns empty string when nothing degraded (no prompt noise)", () => {
    expect(partialTelemetryBlock([])).toBe("");
  });

  it("names every dark sense and instructs UNKNOWN-not-zero", () => {
    const block = partialTelemetryBlock(["pulse-vitals", "capital-books"]);
    expect(block).toContain("PARTIAL TELEMETRY");
    expect(block).toContain("pulse-vitals");
    expect(block).toContain("capital-books");
    expect(block).toMatch(/UNKNOWN/);
    expect(block).toMatch(/Do NOT ground plans/);
  });

  it("assembleContextPack seeds degradedSenses as empty (gatherer owns it)", () => {
    const p = assembleContextPack(base);
    expect(p.degradedSenses).toEqual([]);
  });
});
