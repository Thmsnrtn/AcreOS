/**
 * Pre-spend parcel-quality screening (charter §7.2 — the pre-spend wedge).
 *
 * The customer's dominant cost is mail + skip-trace spend, wasted every time it
 * lands on a parcel that is flooded, landlocked, or unbuildable. This screens a
 * list against those disqualifiers using the FREE open-data plane (FEMA flood,
 * NWI wetlands, road access, 3DEP slope) BEFORE a dollar of postage is spent,
 * and surfaces the projected spend saved as a first-class number.
 *
 * Safety by construction:
 *   - FAIL-OPEN: an unknown/missing signal NEVER disqualifies a parcel. Bad or
 *     stale data can only ever let mail through, never silently suppress a lead
 *     the investor wanted.
 *   - OFF by default: with no active rules, `screenParcels` disqualifies nothing
 *     and returns spendSaved = 0 (byte-identical to no screening). What counts
 *     as "not worth mailing" is a strategy call — some investors WANT cheap
 *     flood/landlocked parcels — so rules are caller-supplied, never forced.
 *
 * Pure (no db, no I/O) so the ROI math and the fail-open invariant are directly
 * testable; the caller supplies cached signals and the cost per piece.
 */

export type DisqualifierCategory = "flood" | "wetlands" | "landlocked" | "slope";

export interface ParcelSignals {
  /** FEMA NFHL zone code, e.g. "VE", "AE", "X". */
  floodZone?: string | null;
  /** NWI wetlands coverage, 0-100. */
  wetlandsPercentage?: number | null;
  /** True when no public road access was found (landlocked). */
  landlocked?: boolean | null;
  /** Mean slope percent (3DEP). */
  slopePercent?: number | null;
}

export interface DisqualifierRules {
  /** FEMA zones that disqualify, e.g. ["VE","V","AE"]. Empty/absent = off. */
  floodZones?: string[];
  /** Disqualify when wetlands coverage >= this percent. Absent = off. */
  maxWetlandsPercent?: number;
  /** Disqualify landlocked parcels. */
  excludeLandlocked?: boolean;
  /** Disqualify when mean slope >= this percent. Absent = off. */
  maxSlopePercent?: number;
}

export interface DisqualifierReason {
  category: DisqualifierCategory;
  detail: string;
}

export interface ParcelScreenResult {
  disqualified: boolean;
  reasons: DisqualifierReason[];
}

/** True when at least one rule is active (so the caller can skip work / stay off). */
export function hasActiveRules(rules: DisqualifierRules): boolean {
  return !!(
    rules.floodZones?.length ||
    rules.maxWetlandsPercent != null ||
    rules.excludeLandlocked ||
    rules.maxSlopePercent != null
  );
}

/** Screen one parcel. Fail-open: a missing signal is never a disqualifier. */
export function screenParcel(signals: ParcelSignals, rules: DisqualifierRules): ParcelScreenResult {
  const reasons: DisqualifierReason[] = [];

  if (rules.floodZones?.length && signals.floodZone) {
    const zone = signals.floodZone.toUpperCase();
    const banned = rules.floodZones.map((z) => z.toUpperCase());
    if (banned.includes(zone)) {
      reasons.push({ category: "flood", detail: `FEMA flood zone ${signals.floodZone}` });
    }
  }

  if (
    rules.maxWetlandsPercent != null &&
    signals.wetlandsPercentage != null &&
    signals.wetlandsPercentage >= rules.maxWetlandsPercent
  ) {
    reasons.push({
      category: "wetlands",
      detail: `wetlands ${Math.round(signals.wetlandsPercentage)}% ≥ ${rules.maxWetlandsPercent}%`,
    });
  }

  if (rules.excludeLandlocked && signals.landlocked === true) {
    reasons.push({ category: "landlocked", detail: "no public road access (landlocked)" });
  }

  if (
    rules.maxSlopePercent != null &&
    signals.slopePercent != null &&
    signals.slopePercent >= rules.maxSlopePercent
  ) {
    reasons.push({
      category: "slope",
      detail: `mean slope ${Math.round(signals.slopePercent)}% ≥ ${rules.maxSlopePercent}%`,
    });
  }

  return { disqualified: reasons.length > 0, reasons };
}

export interface ScreenBatchItem {
  id: number;
  signals: ParcelSignals;
}

export interface ScreenBatchResult {
  disqualified: Array<{ id: number; reasons: DisqualifierReason[] }>;
  keptIds: number[];
  /** Count of disqualified parcels per category (a parcel can count once per matched category). */
  byCategory: Record<DisqualifierCategory, number>;
  /** disqualified parcels × cost per piece — the projected spend saved. */
  spendSavedCents: number;
}

/** Non-negative integer cents saved = disqualified × cost per piece. */
export function computeSpendSavedCents(disqualifiedCount: number, costPerPieceCents: number): number {
  return Math.max(0, Math.round(Math.max(0, disqualifiedCount) * Math.max(0, costPerPieceCents)));
}

export function screenParcels(
  items: ScreenBatchItem[],
  rules: DisqualifierRules,
  costPerPieceCents: number,
): ScreenBatchResult {
  const byCategory: Record<DisqualifierCategory, number> = { flood: 0, wetlands: 0, landlocked: 0, slope: 0 };

  // Off by default — no rules means nothing is ever disqualified.
  if (!hasActiveRules(rules)) {
    return { disqualified: [], keptIds: items.map((i) => i.id), byCategory, spendSavedCents: 0 };
  }

  const disqualified: Array<{ id: number; reasons: DisqualifierReason[] }> = [];
  const keptIds: number[] = [];
  for (const item of items) {
    const r = screenParcel(item.signals, rules);
    if (r.disqualified) {
      disqualified.push({ id: item.id, reasons: r.reasons });
      for (const cat of new Set(r.reasons.map((x) => x.category))) byCategory[cat] += 1;
    } else {
      keptIds.push(item.id);
    }
  }

  return {
    disqualified,
    keptIds,
    byCategory,
    spendSavedCents: computeSpendSavedCents(disqualified.length, costPerPieceCents),
  };
}
