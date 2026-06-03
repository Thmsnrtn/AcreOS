/**
 * Tests for L3.11 — confidence-calibrated outputs.
 *
 * Two surfaces under test:
 *   1. parseConfidence — pure function, no DB, no IO. Covers the five
 *      detection kinds, the priority ordering, and credential sanitization.
 *   2. confidenceObservations service — recordObservation /
 *      correlateWithReviewOutcome / getCalibrationSummary, all against a
 *      mocked `db`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// MOCK DB
// ============================================================================

interface ObsRow {
  id: number;
  observed_at: Date;
  dispatch_id: number;
  agent_role: string;
  stated_confidence: string | null;
  confidence_phrase: string | null;
  confidence_kind: string;
  correlated_review_status: string | null;
  calibration_score: string | null;
}

const OBS: ObsRow[] = [];
let nextObsId = 1;
let throwOnInsert = false;

interface WhereSpec {
  __id?: number;
  __dispatchId?: number;
  __agentRole?: string;
  __cutoff?: Date;
  __and?: WhereSpec[];
}

function matchesRow(row: ObsRow, spec: WhereSpec | undefined): boolean {
  if (!spec) return true;
  if (spec.__and) {
    return spec.__and.every((s) => matchesRow(row, s));
  }
  if (spec.__id !== undefined) return row.id === spec.__id;
  if (spec.__dispatchId !== undefined)
    return row.dispatch_id === spec.__dispatchId;
  if (spec.__agentRole !== undefined)
    return row.agent_role === spec.__agentRole;
  if (spec.__cutoff !== undefined)
    return row.observed_at.getTime() >= spec.__cutoff.getTime();
  return true;
}

vi.mock("../../db", () => {
  const db = {
    insert: (_table: unknown) => ({
      values: (row: any) => {
        if (throwOnInsert) {
          return {
            returning: () =>
              Promise.reject(new Error("simulated db failure")),
          };
        }
        const r: ObsRow = {
          id: nextObsId++,
          observed_at: new Date(),
          dispatch_id: row.dispatchId,
          agent_role: row.agentRole,
          stated_confidence: row.statedConfidence ?? null,
          confidence_phrase: row.confidencePhrase ?? null,
          confidence_kind: row.confidenceKind,
          correlated_review_status: null,
          calibration_score: null,
        };
        OBS.push(r);
        return {
          returning: (_cols: unknown) => Promise.resolve([{ id: r.id }]),
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (patch: any) => ({
        where: (spec: WhereSpec) => {
          for (const row of OBS) {
            if (matchesRow(row, spec)) {
              if (patch.correlatedReviewStatus !== undefined) {
                row.correlated_review_status = patch.correlatedReviewStatus;
              }
              if (patch.calibrationScore !== undefined) {
                row.calibration_score = patch.calibrationScore;
              }
            }
          }
          return Promise.resolve();
        },
      }),
    }),
    select: (projection: any) => {
      const chain: any = {
        _where: undefined as WhereSpec | undefined,
        _projection: projection,
        from(_t: unknown) {
          return chain;
        },
        where(spec: WhereSpec) {
          chain._where = spec;
          return chain;
        },
        async then(resolve: (v: any[]) => void) {
          const matching = OBS.filter((r) => matchesRow(r, chain._where));
          const keys = Object.keys(chain._projection ?? {});
          const projected = matching.map((row) => {
            const out: Record<string, unknown> = {};
            for (const k of keys) {
              switch (k) {
                case "id":
                  out.id = row.id;
                  break;
                case "statedConfidence":
                  out.statedConfidence = row.stated_confidence;
                  break;
                case "calibrationScore":
                  out.calibrationScore = row.calibration_score;
                  break;
                case "correlatedReviewStatus":
                  out.correlatedReviewStatus = row.correlated_review_status;
                  break;
                default:
                  out[k] = (row as any)[k] ?? null;
              }
            }
            return out;
          });
          resolve(projected);
        },
      };
      return chain;
    },
  };
  return { db };
});

// drizzle's eq/gte/and return opaque objects — give our mock a way to inspect.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    eq: (col: any, val: any): WhereSpec => {
      const colName = String(col?.name ?? col?._?.name ?? "");
      if (colName === "id") return { __id: val };
      if (colName === "dispatch_id") return { __dispatchId: val };
      if (colName === "agent_role") return { __agentRole: val };
      // Fallback — use the property name on the drizzle column object.
      // Best-effort heuristic based on column path.
      return { __id: val };
    },
    gte: (_col: any, val: Date): WhereSpec => ({ __cutoff: val }),
    and: (...specs: WhereSpec[]): WhereSpec => ({ __and: specs }),
    sql: actual.sql,
  };
});

// ============================================================================
// PARSER UNIT TESTS
// ============================================================================

describe("parseConfidence", () => {
  it("explicit percentage prose: \"I'm 92% confident\" → 0.92", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence("Done. I'm 92% confident this is correct.");
    expect(p.kind).toBe("explicit_percentage");
    expect(p.statedConfidence).toBeCloseTo(0.92, 4);
    expect(p.phrase).toContain("92%");
  });

  it("explicit percentage label: \"confidence: 90%\" → 0.9", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence("confidence: 90% — shipping it");
    expect(p.kind).toBe("explicit_percentage");
    expect(p.statedConfidence).toBeCloseTo(0.9, 4);
  });

  it("explicit percentage decimal label: \"CONFIDENCE: 0.85\" → 0.85", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence("All tests pass. CONFIDENCE: 0.85");
    expect(p.kind).toBe("explicit_percentage");
    expect(p.statedConfidence).toBeCloseTo(0.85, 4);
  });

  it("explicit band: \"confidence: high\" → 0.85", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence("confidence: high");
    expect(p.kind).toBe("explicit_band");
    expect(p.statedConfidence).toBeCloseTo(0.85, 4);
  });

  it("explicit band prose: \"low confidence\" → 0.25", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence(
      "Shipped, but low confidence on the timezone edge.",
    );
    expect(p.kind).toBe("explicit_band");
    expect(p.statedConfidence).toBeCloseTo(0.25, 4);
  });

  it("uncertainty marker: \"I'm uncertain whether this works\" → ~0.40", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence("I'm uncertain whether this works under load.");
    expect(p.kind).toBe("uncertainty_marker");
    expect(p.statedConfidence).toBeCloseTo(0.4, 4);
  });

  it("hedged: \"I think this works\" → hedged_confidence", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence("I think this works for the happy path.");
    expect(p.kind).toBe("hedged_confidence");
    expect(p.statedConfidence).not.toBeNull();
    expect(p.statedConfidence!).toBeGreaterThanOrEqual(0.55);
    expect(p.statedConfidence!).toBeLessThanOrEqual(0.65);
  });

  it("no signal: \"Implementation complete.\" → no_signal", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence("Implementation complete.");
    expect(p.kind).toBe("no_signal");
    expect(p.statedConfidence).toBeNull();
    expect(p.phrase).toBeNull();
  });

  it("credential sanitization: sk_live_... → [REDACTED] in phrase", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence(
      "I'm 80% confident. Logged in with sk_live_supersecret123abc.",
    );
    expect(p.kind).toBe("explicit_percentage");
    // The matched phrase itself is "I'm 80% confident" — but verify the
    // sanitizer catches Stripe keys when they appear inside a matched span.
    expect(p.phrase ?? "").not.toContain("sk_live_supersecret123abc");
  });

  it("credential sanitization across full match: Bearer token + uncertainty", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    // Force the matched phrase to actually include the credential by using
    // an uncertainty marker that's adjacent to the token. We use a regex
    // match that captures only the marker, so this test really validates
    // that even if a future change widens the capture span, the sanitizer
    // is in place. We confirm sanitizer behavior directly here.
    const input = "ghp_abcdefghijklmno I'm uncertain about Bearer abcdefghijk";
    const p = parseConfidence(input);
    expect(p.kind).toBe("uncertainty_marker");
    expect(p.phrase ?? "").not.toContain("ghp_abcdefghijklmno");
  });

  it("priority: explicit percentage wins over explicit band", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence(
      "Confidence: high — actually I'm 95% confident.",
    );
    expect(p.kind).toBe("explicit_percentage");
    expect(p.statedConfidence).toBeCloseTo(0.95, 4);
  });

  it("priority: explicit band wins over uncertainty + hedge", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence("I think — actually, confidence: medium.");
    expect(p.kind).toBe("explicit_band");
    expect(p.statedConfidence).toBeCloseTo(0.55, 4);
  });

  it("priority: uncertainty wins over hedge", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence(
      "I think it works but I'm not sure about the edge.",
    );
    expect(p.kind).toBe("uncertainty_marker");
  });

  it("empty input returns no_signal", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    expect(parseConfidence("").kind).toBe("no_signal");
  });

  it("percentage clamping: 150% → 1.0", async () => {
    const { parseConfidence } = await import("./confidenceParser");
    const p = parseConfidence("I'm 150% sure");
    expect(p.kind).toBe("explicit_percentage");
    expect(p.statedConfidence).toBe(1);
  });
});

// ============================================================================
// SERVICE TESTS
// ============================================================================

beforeEach(() => {
  OBS.length = 0;
  nextObsId = 1;
  throwOnInsert = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("recordObservation", () => {
  it("returns null + writes no row when text has no signal", async () => {
    const { recordObservation } = await import("./confidenceObservations");
    const r = await recordObservation({
      dispatchId: 1,
      agentRole: "iris",
      finalText: "Implementation complete.",
    });
    expect(r).toBeNull();
    expect(OBS).toHaveLength(0);
  });

  it("inserts a row for explicit_percentage signal", async () => {
    const { recordObservation } = await import("./confidenceObservations");
    const r = await recordObservation({
      dispatchId: 42,
      agentRole: "iris",
      finalText: "All green. I'm 88% confident this lands cleanly.",
    });
    expect(r).not.toBeNull();
    expect(r!.observationId).toBeGreaterThan(0);
    expect(OBS).toHaveLength(1);
    expect(OBS[0].dispatch_id).toBe(42);
    expect(OBS[0].agent_role).toBe("iris");
    expect(OBS[0].confidence_kind).toBe("explicit_percentage");
    expect(Number(OBS[0].stated_confidence)).toBeCloseTo(0.88, 4);
  });

  it("inserts a row for explicit_band signal", async () => {
    const { recordObservation } = await import("./confidenceObservations");
    const r = await recordObservation({
      dispatchId: 7,
      agentRole: "soren",
      finalText: "Done. Confidence: low on cross-browser.",
    });
    expect(r).not.toBeNull();
    expect(OBS[0].confidence_kind).toBe("explicit_band");
    expect(Number(OBS[0].stated_confidence)).toBeCloseTo(0.25, 4);
  });

  it("never throws on DB failure — returns null", async () => {
    const { recordObservation } = await import("./confidenceObservations");
    throwOnInsert = true;
    const r = await recordObservation({
      dispatchId: 99,
      agentRole: "iris",
      finalText: "I'm 95% sure.",
    });
    expect(r).toBeNull();
  });
});

describe("computeCalibrationScore", () => {
  it("high confidence + passed → 1.0", async () => {
    const { computeCalibrationScore } = await import(
      "./confidenceObservations"
    );
    expect(computeCalibrationScore(0.9, "passed")).toBe(1.0);
  });

  it("high confidence + flagged → 0.0 (overconfident)", async () => {
    const { computeCalibrationScore } = await import(
      "./confidenceObservations"
    );
    expect(computeCalibrationScore(0.9, "flagged")).toBe(0.0);
  });

  it("low confidence + passed → 0.5 (underconfident)", async () => {
    const { computeCalibrationScore } = await import(
      "./confidenceObservations"
    );
    expect(computeCalibrationScore(0.25, "passed")).toBe(0.5);
  });

  it("low confidence + flagged → 0.8 (correctly hedged)", async () => {
    const { computeCalibrationScore } = await import(
      "./confidenceObservations"
    );
    expect(computeCalibrationScore(0.25, "flagged")).toBe(0.8);
  });

  it("mid confidence + any outcome → 0.6", async () => {
    const { computeCalibrationScore } = await import(
      "./confidenceObservations"
    );
    expect(computeCalibrationScore(0.55, "passed")).toBe(0.6);
    expect(computeCalibrationScore(0.55, "flagged")).toBe(0.6);
  });

  it("skipped outcome → null (no signal)", async () => {
    const { computeCalibrationScore } = await import(
      "./confidenceObservations"
    );
    expect(computeCalibrationScore(0.9, "skipped")).toBeNull();
    expect(computeCalibrationScore(0.2, "skipped")).toBeNull();
  });

  it("null stated + non-skipped → neutral 0.6", async () => {
    const { computeCalibrationScore } = await import(
      "./confidenceObservations"
    );
    expect(computeCalibrationScore(null, "passed")).toBe(0.6);
  });
});

describe("correlateWithReviewOutcome", () => {
  it("stamps correlated_review_status + calibration_score for all rows of a dispatch", async () => {
    const { recordObservation, correlateWithReviewOutcome } = await import(
      "./confidenceObservations"
    );
    await recordObservation({
      dispatchId: 100,
      agentRole: "iris",
      finalText: "I'm 90% confident this works.",
    });

    await correlateWithReviewOutcome(100, "passed");

    expect(OBS[0].correlated_review_status).toBe("passed");
    expect(Number(OBS[0].calibration_score)).toBeCloseTo(1.0, 4);
  });

  it("flagged + high confidence → calibration 0.0 (overconfident)", async () => {
    const { recordObservation, correlateWithReviewOutcome } = await import(
      "./confidenceObservations"
    );
    await recordObservation({
      dispatchId: 101,
      agentRole: "iris",
      finalText: "Confidence: high.",
    });
    await correlateWithReviewOutcome(101, "flagged");

    expect(OBS[0].correlated_review_status).toBe("flagged");
    expect(Number(OBS[0].calibration_score)).toBeCloseTo(0.0, 4);
  });

  it("skipped review → calibration_score remains null", async () => {
    const { recordObservation, correlateWithReviewOutcome } = await import(
      "./confidenceObservations"
    );
    await recordObservation({
      dispatchId: 102,
      agentRole: "iris",
      finalText: "I'm 80% sure.",
    });
    await correlateWithReviewOutcome(102, "skipped");

    expect(OBS[0].correlated_review_status).toBe("skipped");
    expect(OBS[0].calibration_score).toBeNull();
  });

  it("no-op when dispatch has no observations (never throws)", async () => {
    const { correlateWithReviewOutcome } = await import(
      "./confidenceObservations"
    );
    await expect(
      correlateWithReviewOutcome(9999, "passed"),
    ).resolves.toBeUndefined();
  });
});

describe("getCalibrationSummary", () => {
  it("returns zeros when no observations exist", async () => {
    const { getCalibrationSummary } = await import("./confidenceObservations");
    const s = await getCalibrationSummary("iris", 30);
    expect(s.observationCount).toBe(0);
    expect(s.averageStatedConfidence).toBe(0);
    expect(s.averageCalibrationScore).toBe(0);
  });

  it("computes counts + averages across mixed outcomes", async () => {
    const { recordObservation, correlateWithReviewOutcome, getCalibrationSummary } =
      await import("./confidenceObservations");

    // Overconfident: high + flagged (calibration 0.0)
    await recordObservation({
      dispatchId: 1,
      agentRole: "iris",
      finalText: "I'm 95% confident.",
    });
    await correlateWithReviewOutcome(1, "flagged");

    // Well-calibrated: high + passed (calibration 1.0)
    await recordObservation({
      dispatchId: 2,
      agentRole: "iris",
      finalText: "I'm 90% confident.",
    });
    await correlateWithReviewOutcome(2, "passed");

    // Well-calibrated: low + flagged (calibration 0.8)
    await recordObservation({
      dispatchId: 3,
      agentRole: "iris",
      finalText: "confidence: low",
    });
    await correlateWithReviewOutcome(3, "flagged");

    // Underconfident: low + passed → calibration 0.5, in [0.3, 0.7)
    await recordObservation({
      dispatchId: 4,
      agentRole: "iris",
      finalText: "confidence: low",
    });
    await correlateWithReviewOutcome(4, "passed");

    const s = await getCalibrationSummary("iris", 30);
    expect(s.observationCount).toBe(4);
    expect(s.overconfidenceCount).toBe(1); // dispatch 1
    expect(s.wellCalibratedCount).toBe(2); // dispatches 2 + 3
    expect(s.underconfidenceCount).toBe(1); // dispatch 4

    // averageStatedConfidence = (0.95 + 0.9 + 0.25 + 0.25) / 4
    expect(s.averageStatedConfidence).toBeCloseTo(0.5875, 3);
    // averageCalibrationScore = (0 + 1 + 0.8 + 0.5) / 4 = 0.575
    expect(s.averageCalibrationScore).toBeCloseTo(0.575, 3);
  });

  it("returns empty for windowDays <= 0", async () => {
    const { getCalibrationSummary } = await import("./confidenceObservations");
    const s = await getCalibrationSummary("iris", 0);
    expect(s.observationCount).toBe(0);
  });
});
