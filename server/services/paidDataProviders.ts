/**
 * Paid-data provider implementations for the eval harness (Iyari #6 / Lena #3).
 *
 * Today there is NO paid API key. This file holds:
 *   - MockPaidProvider: deterministic, seeded from the free parcel itself, so
 *     the harness runs in sample/dry-run mode and the tests are reproducible
 *     with no network and no spend.
 *   - A documented stub for the future RegridPaidProvider — the real adapter
 *     drops in here implementing the same `PaidDataProvider` interface, and the
 *     harness needs zero changes.
 *
 * The mock's job is NOT to be "right" — it is to exercise every branch of the
 * divergence + decision-flip math with a realistic, tunable mix of:
 *   - exact matches (free already correct),
 *   - numeric drift within tolerance (acres ±2% → NOT divergent),
 *   - numeric drift beyond tolerance (assessed value 30% off → divergent),
 *   - categorical disagreement that FLIPS a decision (flood X → AE → no_buy),
 *   - gap fills (owner name free-missing, paid-present).
 */

import type { ParcelFacts, PaidDataProvider } from "./paidDataEvalHarness";

/**
 * Deterministic hash of a string → [0,1). Stable across runs (no Math.random)
 * so the sample-mode founder view and the tests are reproducible.
 */
function hash01(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Map to [0,1).
  return (h >>> 0) / 4294967296;
}

export interface MockPaidProviderConfig {
  /** Per-parcel cost reported for trial-cost projection (Regrid ~5–25¢). */
  estCostCents?: number;
  /**
   * Fraction of parcels where the mock disagrees on a decision-relevant field
   * (flood / wetlands / road access) enough to potentially flip the decision.
   * 0 = mock always agrees (free is perfect); 1 = mock always flips.
   */
  flipPropensity?: number;
  /**
   * Fraction of parcels where the mock fills owner name when free is missing.
   */
  ownerFillRate?: number;
  /**
   * Numeric drift applied to assessed value (relative). 0.3 = +30% (divergent
   * beyond the 5% tolerance). Applied deterministically per parcel.
   */
  assessedDrift?: number;
}

/**
 * MockPaidProvider — deterministic synthetic "paid" view of a parcel.
 *
 * Determinism: every decision keys off hash01(parcelKey + salt), so the same
 * parcel always yields the same paid view. This makes the founder sample-mode
 * report stable run-to-run and the unit tests exact.
 */
export class MockPaidProvider implements PaidDataProvider {
  readonly name = "mock-paid";
  private readonly cfg: Required<MockPaidProviderConfig>;

  constructor(config: MockPaidProviderConfig = {}) {
    this.cfg = {
      estCostCents: config.estCostCents ?? 0,
      flipPropensity: config.flipPropensity ?? 0.2,
      ownerFillRate: config.ownerFillRate ?? 0.5,
      assessedDrift: config.assessedDrift ?? 0.3,
    };
  }

  estCostCents(): number {
    return this.cfg.estCostCents;
  }

  async lookup(free: ParcelFacts): Promise<Partial<ParcelFacts>> {
    const k = free.parcelKey;
    const out: Partial<ParcelFacts> = {};

    // ── acres: small drift WITHIN tolerance (should NOT be divergent) ──
    if (free.acres != null) {
      const jitter = (hash01(k + "acres") - 0.5) * 0.04; // ±2%
      out.acres = Math.round(free.acres * (1 + jitter) * 100) / 100;
    }

    // ── assessed value: paid often has it when free doesn't (fill), and
    //    drifts beyond tolerance when both have it (divergent) ──
    if (free.assessedValue == null) {
      // Fill: paid supplies an assessed value.
      out.assessedValue = Math.round(10000 + hash01(k + "av") * 90000);
    } else {
      out.assessedValue = Math.round(free.assessedValue * (1 + this.cfg.assessedDrift));
    }

    // ── owner name: fill when free missing (the canonical paid-only field) ──
    if (free.ownerName == null && hash01(k + "owner") < this.cfg.ownerFillRate) {
      out.ownerName = `OWNER-${(hash01(k + "ownername") * 1e6).toFixed(0)}`;
    } else if (free.ownerName != null) {
      // Paid agrees on the name it does have.
      out.ownerName = free.ownerName;
    }

    // ── flood zone: the decision-flip lever. With flipPropensity, the mock
    //    "corrects" a benign zone to AE (a dealbreaker) or vice-versa. ──
    const flips = hash01(k + "flip") < this.cfg.flipPropensity;
    if (free.floodZone != null) {
      const fz = free.floodZone.trim().toUpperCase();
      if (flips) {
        // If free said benign, paid says AE (creates a deal-killer). If free
        // said AE, paid says X (clears it). Either way it's a flip lever.
        out.floodZone = fz === "AE" || fz === "VE" ? "X" : "AE";
      } else {
        out.floodZone = free.floodZone;
      }
    } else if (flips) {
      out.floodZone = "AE";
    }

    // ── wetlands / road access: paid agrees (keeps the flip lever on flood so
    //    tests can attribute flips cleanly), but pass through for divergence. ──
    if (free.wetlandPercent != null) out.wetlandPercent = free.wetlandPercent;
    if (free.hasRoadAccess != null) out.hasRoadAccess = free.hasRoadAccess;

    return out;
  }
}

/**
 * RegridPaidProvider — FUTURE. Not wired today (no API key).
 *
 * When Lena greenlights a trial:
 *   1. Add REGRID_API_KEY to the env + Fly secrets.
 *   2. Implement lookup() to call Regrid's parcel endpoint by APN or lat/lng,
 *      map the response into ParcelFacts (owner, assessed value, acres, flood
 *      where Regrid carries it), returning null for fields Regrid doesn't cover.
 *   3. Set estCostCents() to the contracted per-call price.
 *   4. Pass `new RegridPaidProvider()` to runPaidDataEval with mode: "trial".
 * The harness + metrics + founder surface need ZERO changes — that is the point
 * of the injection seam.
 */
export class RegridPaidProvider implements PaidDataProvider {
  readonly name = "regrid";
  constructor(private readonly _apiKey: string, private readonly _costCents = 8) {}
  estCostCents(): number {
    return this._costCents;
  }
  async lookup(_free: ParcelFacts): Promise<Partial<ParcelFacts>> {
    throw new Error(
      "RegridPaidProvider not implemented — wire the real Regrid adapter when a trial is greenlit.",
    );
  }
}
