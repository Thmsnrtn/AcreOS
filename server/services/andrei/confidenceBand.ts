// ============================================================================
// server/services/andrei/confidenceBand.ts
// ----------------------------------------------------------------------------
// ANDREI (2026-06-08) — confidence calibration scaffold (charter #6, light).
//
// "Premium-honest" means CALIBRATED, not just hedged. Today the grounding
// prompt tells Pax to say "high / likely / uncertain" with no feedback loop
// proving those words mean anything. This module is the first, deterministic
// rung of that ladder:
//
//   computeConfidenceBand({ confidence, cachedAt }) → "high" | "moderate" | "low"
//     A pure, deterministic mapping from a provider's numeric confidence
//     (0-100, as emitted by the provider registry) AND the staleness of the
//     cached value (older county layers are less trustworthy) to a discrete
//     band. The band is what the grounding envelope can surface and what Pax's
//     hedge phrasing should track. When a county layer is 14 months stale, the
//     band drops automatically — turning a data weakness into a trust signal.
//
//   recordBandObservation({ band, wasCorrected, ... })
//     Logs a (band, was-later-corrected) pair so a future Brier-style
//     calibration measurement has data: over time we can check whether "high"
//     claims are actually corrected LESS often than "low" ones. This is the
//     scaffold only — the detector that computes the Brier score lands once
//     enough labeled observations accrue (charter: "add a calibration detector
//     to aiQualityAudit once enough labeled turns accrue"). For now we emit a
//     structured log line the future detector / an offline job can mine.
//
// Deterministic + side-effect-free for `computeConfidenceBand` (unit-testable
// with no DB / no clock dependency beyond the explicit cachedAt input).
// ============================================================================

import { logger } from "../../utils/logger";

export type ConfidenceBand = "high" | "moderate" | "low";

export interface ConfidenceBandInput {
  /**
   * Provider confidence, 0-100, as emitted by the provider registry
   * (e.g. attom-provider confidence 80-90). Undefined/NaN → treated as
   * unknown and floors the band to "low" (we don't have a basis to claim more).
   */
  confidence?: number | null;
  /**
   * When the underlying value was cached / last observed. Older data is less
   * trustworthy, so staleness can only DROP the band, never raise it. Undefined
   * means "freshly looked up this turn" (no staleness penalty).
   */
  cachedAt?: Date | string | null;
  /** Override "now" for deterministic testing. Defaults to Date.now(). */
  now?: Date;
}

// ── Thresholds (deterministic, documented) ───────────────────────────────────

/** confidence ≥ this → eligible for "high" (before any staleness penalty). */
const HIGH_CONFIDENCE_MIN = 85;
/** confidence ≥ this → eligible for "moderate". Below → "low". */
const MODERATE_CONFIDENCE_MIN = 60;

/** Cache older than this (days) drops one band. */
const STALE_DROP_ONE_DAYS = 180; // ~6 months
/** Cache older than this (days) drops two bands (→ always "low"). */
const STALE_DROP_TWO_DAYS = 365; // ~1 year — the "14-month-stale county layer" case

const DAY_MS = 24 * 60 * 60 * 1000;

const ORDER: ConfidenceBand[] = ["low", "moderate", "high"];

function dropBand(band: ConfidenceBand, by: number): ConfidenceBand {
  const idx = ORDER.indexOf(band);
  const next = Math.max(0, idx - by);
  return ORDER[next];
}

function ageDays(cachedAt: Date | string | null | undefined, now: Date): number | null {
  if (cachedAt == null) return null;
  const t = cachedAt instanceof Date ? cachedAt.getTime() : Date.parse(String(cachedAt));
  if (!Number.isFinite(t)) return null;
  const days = (now.getTime() - t) / DAY_MS;
  return days >= 0 ? days : 0; // future timestamps → treat as fresh, never negative
}

/**
 * Deterministically map provider confidence + cache staleness to a band.
 * Staleness can only DROP the band (older data never earns more trust).
 */
export function computeConfidenceBand(input: ConfidenceBandInput): ConfidenceBand {
  const now = input.now ?? new Date();

  // 1. Base band from raw confidence.
  const c = typeof input.confidence === "number" && Number.isFinite(input.confidence)
    ? input.confidence
    : null;
  let band: ConfidenceBand;
  if (c == null) {
    band = "low"; // no confidence signal → no basis to claim more than "low"
  } else if (c >= HIGH_CONFIDENCE_MIN) {
    band = "high";
  } else if (c >= MODERATE_CONFIDENCE_MIN) {
    band = "moderate";
  } else {
    band = "low";
  }

  // 2. Staleness penalty (only drops).
  const age = ageDays(input.cachedAt, now);
  if (age != null) {
    if (age >= STALE_DROP_TWO_DAYS) band = dropBand(band, 2);
    else if (age >= STALE_DROP_ONE_DAYS) band = dropBand(band, 1);
  }

  return band;
}

/**
 * The hedge phrasing Pax should use for a band, so the words track the band
 * rather than being chosen ad hoc. Exposed for the grounding envelope.
 */
export function bandHedgePhrase(band: ConfidenceBand): string {
  switch (band) {
    case "high":
      return "This is well-supported by the source.";
    case "moderate":
      return "This is supported but worth verifying.";
    case "low":
      return "Treat this as low-confidence — the source is thin or stale; verify before relying on it.";
  }
}

// ── Calibration observation logging (Brier scaffold) ─────────────────────────

export interface BandObservation {
  /** The band the answer was surfaced with. */
  band: ConfidenceBand;
  /**
   * Whether the answer was later corrected (by the hallucination guard, the
   * live eval gate, or a human). The label a future Brier measurement needs:
   * a well-calibrated system corrects "high"-band answers far less often than
   * "low"-band ones.
   */
  wasCorrected: boolean;
  /** Provider confidence that produced the band, for the offline analysis. */
  confidence?: number | null;
  /** Cache age in days at decision time, if known. */
  cacheAgeDays?: number | null;
  /** Org for attribution. */
  orgId?: number;
  /** Conversation/message ref for joinability. */
  subjectRef?: string | null;
}

/**
 * Emit a structured (band, was-corrected) observation. Today this is a log
 * line the future calibration detector / an offline job mines; it deliberately
 * does NOT write a new table (the charter scopes this as a light scaffold).
 * Never throws — calibration logging must never break a customer turn.
 */
export function recordBandObservation(obs: BandObservation): void {
  try {
    logger.info("[andrei] confidence-band observation", {
      source: "andrei.confidenceBand",
      metadata: {
        // Stable, greppable marker for the offline Brier job.
        marker: "confidence_band_observation",
        band: obs.band,
        wasCorrected: obs.wasCorrected,
        confidence: obs.confidence ?? null,
        cacheAgeDays: obs.cacheAgeDays ?? null,
        organizationId: obs.orgId ?? null,
        subjectRef: obs.subjectRef ?? null,
      },
    });
  } catch {
    /* calibration logging is best-effort — never block a turn */
  }
}
