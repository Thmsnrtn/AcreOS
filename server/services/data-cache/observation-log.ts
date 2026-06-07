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
