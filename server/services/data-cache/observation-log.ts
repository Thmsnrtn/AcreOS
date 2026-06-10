/**
 * Parcel Observation Log — the acorn (Iyari, Chief of Future).
 *
 * Append-only writer for `parcel_observations`. Every time any path (lookup,
 * ETL, fusion, customer edit) sees a fact about a parcel, we record one
 * immutable row. `parcel_snapshots` stays the fast "current best view" cache;
 * observations become the longitudinal system-of-record the cache is derived
 * from.
 *
 * Strategic bet: longitudinal parcel facts (assessed value, owner, tax status
 * over time) are the one asset you cannot buy retroactively. The cost of
 * capturing them is one async insert per fact today; backfilling later is
 * impossible.
 *
 * CONTRACT — these are load-bearing:
 *   - FIRE-AND-FORGET: every export swallows its own errors. A failure here
 *     must NEVER propagate to (or slow down) the parcel response. Callers
 *     `void recordObservation(...)` and move on.
 *   - APPEND-ONLY: we only ever INSERT. Never UPDATE, never DELETE.
 *
 * Usage at a write path (do not await; do not let it throw):
 *
 *   void recordParcelObservations({
 *     apn, state, county, source: "county_gis", organizationId,
 *     facts: { owner, assessed_value, tax_amount, acres },
 *   });
 */

import { db } from "../../db";
import { parcelObservations, type InsertParcelObservation } from "@shared/schema";
import { logger } from "../../utils/logger";

/** A single fact about a parcel, ready to be appended. */
export interface ObservationInput {
  apn: string;
  state: string;
  county: string;
  field: string;
  value?: unknown;
  source: string;
  confidence?: number | null;
  organizationId?: number | null;
  observedAt?: Date;
}

/**
 * A convenience shape for recording several fields seen in the same lookup —
 * the common case at a write path. Null/undefined fact values are skipped so
 * we never pollute the log with "we looked but found nothing" noise.
 */
export interface ObservationBatchInput {
  apn: string;
  state: string;
  county: string;
  source: string;
  organizationId?: number | null;
  confidence?: number | null;
  observedAt?: Date;
  /** field name -> observed value. Null/undefined entries are skipped. */
  facts: Record<string, unknown>;
}

function toRow(obs: ObservationInput): InsertParcelObservation | null {
  // Defensive: a missing identity makes the row useless for the delta detector.
  if (!obs.apn || !obs.state || !obs.county || !obs.field || !obs.source) {
    return null;
  }
  return {
    apn: String(obs.apn),
    state: String(obs.state).toUpperCase(),
    county: String(obs.county),
    field: obs.field,
    value: obs.value === undefined ? null : (obs.value as InsertParcelObservation["value"]),
    source: obs.source,
    confidence: obs.confidence ?? null,
    organizationId: obs.organizationId ?? null,
    ...(obs.observedAt ? { observedAt: obs.observedAt } : {}),
  };
}

/**
 * Append a single observation. Fire-and-forget — resolves to void and never
 * throws. Returns a Promise so callers may `void` it; awaiting is allowed but
 * never required.
 */
export async function recordObservation(obs: ObservationInput): Promise<void> {
  try {
    const row = toRow(obs);
    if (!row) return;
    await db.insert(parcelObservations).values(row);
  } catch (err) {
    // Swallow — the observation log must never break a parcel response.
    logger.warn("[observationLog] insert failed (non-fatal)", {
      metadata: {
        apn: obs.apn,
        field: obs.field,
        source: obs.source,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/**
 * Append several observations in one insert. Fire-and-forget — never throws.
 * Empty/invalid inputs are a no-op.
 */
export async function recordObservations(observations: ObservationInput[]): Promise<void> {
  try {
    const rows = observations.map(toRow).filter((r): r is InsertParcelObservation => r !== null);
    if (rows.length === 0) return;
    await db.insert(parcelObservations).values(rows);
  } catch (err) {
    logger.warn("[observationLog] batch insert failed (non-fatal)", {
      metadata: {
        count: observations.length,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Widened provider-fact capture (Tier 2A, elevation blueprint 2026-06-10).
//
// Every provider write path used to record only owner/address/tax_amount/acres.
// The valuation + sale-history facts (assessed_value, market_value, tax_status,
// sale price/date) are exactly the series the Biography engine and the tenure
// clock mine — and the sale facts come with their OWN date, so they become
// DATED observations (observedAt = the sale date), giving the tenure clock
// decades of depth instead of starting at platform age.
// ─────────────────────────────────────────────────────────────────────────────

/** The full set of parcel facts a provider write path may have seen. */
export interface ProviderParcelFacts {
  apn: string;
  state: string;
  county: string;
  source: string;
  organizationId?: number | null;
  confidence?: number | null;
  owner?: string | null;
  ownerAddress?: string | null;
  siteAddress?: string | null;
  taxAmount?: unknown;
  acres?: unknown;
  assessedValue?: unknown;
  marketValue?: unknown;
  taxStatus?: unknown;
  lastSalePrice?: unknown;
  /** Date | ISO string | epoch ms. Only a parseable, plausible date emits. */
  lastSaleDate?: unknown;
}

/** Tolerant date coercion for sale dates. Null when not confidently datelike. */
export function coerceSaleDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  let d: Date | null = null;
  if (value instanceof Date) d = value;
  else if (typeof value === "number" && value > 1_000_000_000_000) d = new Date(value);
  else {
    const s = String(value).trim();
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(s)) d = parsed;
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  // Plausibility gate: a sale outside 1900..now+1y is provider noise, and a
  // wrongly-dated observation poisons the tenure clock worse than no point.
  if (year < 1900 || d.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) return null;
  return d;
}

/**
 * PURE: split a provider's parcel facts into observation batches.
 *   - one "current" batch (observedAt defaults to now) for present-tense facts
 *   - one DATED batch (observedAt = the sale date) for sale history, emitted
 *     only when the sale date is confidently parseable — we never stamp a sale
 *     with today's date (that would fabricate history).
 * Field names match the backfill script + Biography engine vocabulary
 * (sale_price / deed_date).
 */
export function buildParcelFactBatches(input: ProviderParcelFacts): ObservationBatchInput[] {
  const batches: ObservationBatchInput[] = [];
  const base = {
    apn: input.apn,
    state: input.state,
    county: input.county,
    source: input.source,
    organizationId: input.organizationId ?? null,
    confidence: input.confidence ?? null,
  };

  const owner = input.owner && input.owner !== "Unknown" ? input.owner : undefined;
  batches.push({
    ...base,
    facts: {
      owner,
      owner_address: input.ownerAddress || undefined,
      site_address: input.siteAddress || undefined,
      tax_amount: input.taxAmount ?? undefined,
      acres: input.acres ?? undefined,
      assessed_value: input.assessedValue ?? undefined,
      market_value: input.marketValue ?? undefined,
      tax_status: input.taxStatus ?? undefined,
    },
  });

  const saleDate = coerceSaleDate(input.lastSaleDate);
  if (saleDate) {
    batches.push({
      ...base,
      observedAt: saleDate,
      facts: {
        deed_date: saleDate.toISOString().slice(0, 10),
        sale_price: input.lastSalePrice ?? undefined,
      },
    });
  }

  return batches;
}

/**
 * Record the full widened fact set from one provider sighting. Fire-and-forget
 * (same contract as everything else in this file): never throws, never blocks.
 */
export async function recordProviderParcelFacts(input: ProviderParcelFacts): Promise<void> {
  if (!input.apn || !input.state || !input.county) return;
  for (const batch of buildParcelFactBatches(input)) {
    await recordParcelObservations(batch);
  }
}

/**
 * Record every non-null fact from a single lookup as separate observation
 * rows. The ergonomic entry point for write paths. Fire-and-forget.
 */
export async function recordParcelObservations(batch: ObservationBatchInput): Promise<void> {
  const observations: ObservationInput[] = [];
  for (const [field, value] of Object.entries(batch.facts)) {
    if (value === null || value === undefined || value === "") continue;
    observations.push({
      apn: batch.apn,
      state: batch.state,
      county: batch.county,
      field,
      value,
      source: batch.source,
      confidence: batch.confidence ?? null,
      organizationId: batch.organizationId ?? null,
      observedAt: batch.observedAt,
    });
  }
  await recordObservations(observations);
}
