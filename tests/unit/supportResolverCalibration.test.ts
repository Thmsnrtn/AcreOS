/**
 * Andrei — close the calibration loop on the autonomous support resolver.
 *
 * Two assertions the gap analysis demanded:
 *   1. An auto-resolve DECISION writes a calibration observation carrying the
 *      model's STATED confidence + the path:"support_resolve" tag (the row the
 *      calibration plot filters to the autonomous path), and records a
 *      confidence-band observation (reviving confidenceBand.ts).
 *   2. A reopen flips the ticket's outcome label to 'reopened' and records a
 *      corrected band observation (the Brier-stream negative).
 *
 * No network, no real DB — paxObserver, confidenceBand, and db are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updated: Array<Record<string, unknown>> = [];
  let ticket: Record<string, unknown> | null = null;

  const db = {
    query: {
      supportTickets: {
        findFirst: vi.fn(async () => ticket),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        updated.push(v);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };

  const recordModelObservation = vi.fn(async () => ({ id: 1 }));
  const recordBandObservation = vi.fn(() => undefined);

  return {
    db,
    updated,
    recordModelObservation,
    recordBandObservation,
    setTicket: (t: Record<string, unknown> | null) => {
      ticket = t;
    },
    reset: () => {
      updated.length = 0;
      ticket = null;
    },
  };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));
vi.mock("../../server/services/paxObserver", () => ({
  paxObserver: { recordModelObservation: mocks.recordModelObservation },
}));
// Keep computeConfidenceBand REAL (pure, deterministic) but spy the recorder so
// we can assert the (band, wasCorrected) pair the Brier scaffold receives.
vi.mock("../../server/services/andrei/confidenceBand", async (importActual) => {
  const actual = await importActual<typeof import("../../server/services/andrei/confidenceBand")>();
  return { ...actual, recordBandObservation: mocks.recordBandObservation };
});

import {
  recordSupportResolveDecision,
  gradeAutoResolvedTicket,
  outcomeWasCorrected,
  SUPPORT_RESOLVE_PATH,
} from "../../server/services/andrei/supportResolverCalibration";

describe("autonomous support-resolve calibration loop", () => {
  beforeEach(() => mocks.reset());
  afterEach(() => vi.clearAllMocks());

  it("an auto-resolve writes a calibration observation with the stated confidence + path tag", async () => {
    await recordSupportResolveDecision({
      ticketId: 42,
      organizationId: 7,
      confidence: 82,
      decision: "auto_resolve",
      category: "general",
      threshold: 70,
    });

    // A model-derived observation was written.
    expect(mocks.recordModelObservation).toHaveBeenCalledTimes(1);
    const obs = mocks.recordModelObservation.mock.calls[0][0] as any;

    // Stated confidence: 0-100 normalised to [0,1] for recordModelObservation.
    expect(obs.modelConfidence).toBeCloseTo(0.82, 5);
    expect(obs.modelSource).toBe(SUPPORT_RESOLVE_PATH);
    expect(obs.organizationId).toBe(7);

    // The autonomous-path tag + subjectRef the calibration plot filters on.
    expect(obs.metadata.dataPoints.path).toBe("support_resolve");
    expect(obs.metadata.dataPoints.subjectRef).toBe("support_resolve:42");
    expect(obs.metadata.dataPoints.statedConfidence).toBe(82);
    expect(obs.metadata.dataPoints.decision).toBe("auto_resolve");
    expect(obs.metadata.relatedEntityId).toBe(42);

    // confidenceBand is now live: a band observation was recorded for the
    // decision, optimistically un-corrected (the grader flips it later).
    expect(mocks.recordBandObservation).toHaveBeenCalledTimes(1);
    const band = mocks.recordBandObservation.mock.calls[0][0] as any;
    expect(band.wasCorrected).toBe(false);
    expect(band.confidence).toBe(82);
    expect(band.band).toBe("moderate"); // 82 → moderate (real computeConfidenceBand)
    expect(band.subjectRef).toBe("support_resolve:42");
  });

  it("a reopen flips the outcome label and records a corrected band observation", async () => {
    mocks.setTicket({
      id: 42,
      organizationId: 7,
      aiHandled: true,
      resolvedBy: "pax",
      aiConfidenceScore: "82",
      aiResolutionOutcome: null,
      aiResolutionReopened: false,
    });

    const ok = await gradeAutoResolvedTicket(42, "reopened");
    expect(ok).toBe(true);

    // The ticket's outcome label flipped to 'reopened'.
    const write = mocks.updated.find((u) => u.aiResolutionOutcome === "reopened");
    expect(write).toBeTruthy();
    expect(write?.aiResolutionReopened).toBe(true);

    // The Brier stream got its labeled NEGATIVE (wasCorrected=true).
    expect(mocks.recordBandObservation).toHaveBeenCalledTimes(1);
    const band = mocks.recordBandObservation.mock.calls[0][0] as any;
    expect(band.wasCorrected).toBe(true);
    expect(band.confidence).toBe(82);
    expect(band.subjectRef).toBe("support_resolve:42");
  });

  it("the grader no-ops on tickets that were NOT a Pax auto-resolve", async () => {
    mocks.setTicket({
      id: 99,
      organizationId: 7,
      aiHandled: false, // human-handled — not on the autonomous path
      resolvedBy: "founder",
      aiConfidenceScore: null,
      aiResolutionOutcome: null,
    });

    const ok = await gradeAutoResolvedTicket(99, "reopened");
    expect(ok).toBe(false);
    expect(mocks.updated.length).toBe(0);
    expect(mocks.recordBandObservation).not.toHaveBeenCalled();
  });

  it("a correction is never silently downgraded back to held (idempotent grader)", async () => {
    mocks.setTicket({
      id: 42,
      organizationId: 7,
      aiHandled: true,
      resolvedBy: "pax",
      aiConfidenceScore: "82",
      aiResolutionOutcome: "reopened", // already corrected
      aiResolutionReopened: true,
    });

    const ok = await gradeAutoResolvedTicket(42, "held");
    expect(ok).toBe(false);
    expect(mocks.updated.length).toBe(0);
  });

  it("outcomeWasCorrected classifies reopen/CSAT as corrected, held as not", () => {
    expect(outcomeWasCorrected("reopened")).toBe(true);
    expect(outcomeWasCorrected("csat_negative")).toBe(true);
    expect(outcomeWasCorrected("held")).toBe(false);
    expect(outcomeWasCorrected(null)).toBe(false);
  });
});
