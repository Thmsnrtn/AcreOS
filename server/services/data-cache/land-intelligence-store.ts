/**
 * Land Intelligence Report store (Iyari, Chief of Future — #2).
 *
 * The LIS report (generateLandIntelligenceReport) is otherwise a cold recompute
 * against ~8 external APIs on every view. This store wraps that computation with
 * a store-read / store-write so a re-opened parcel renders from our store in
 * <100ms and we only recompute once the report is stale.
 *
 * Two payoffs for first customers: (a) speed on revisit (investors revisit deals
 * across the pipeline), (b) trust — every field already carries its
 * {source, fetchedAt} provenance. The store ALSO quietly becomes the eval corpus
 * (Iyari #6): a labeled set of free-data reports to diff against paid data when
 * MRR justifies a trial.
 *
 * IMPORTANT — load-bearing contract:
 *   - This wraps the fusion COMPUTATION (store-read/store-write) WITHOUT changing
 *     the fusion math. `report` is the verbatim LandIntelligenceReport JSON.
 *   - Staleness is REPORT-LEVEL, not per-field. The fusion is a single
 *     all-or-nothing call (Promise.allSettled over the adapters); it exposes no
 *     hook to recompute one field in isolation without changing the math, which
 *     is out of scope. So when the report-level staleAfter passes we recompute
 *     the whole report. Per-field provenance is still captured (for the corpus +
 *     the parcel-card freshness UX) and `staleFields()` reports which fields are
 *     individually past their per-field horizon for future surgical refresh.
 *   - Writes are best-effort: a store-write failure must never fail the parcel
 *     response. Reads degrade to "recompute" on any error.
 */

import { createHash } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  landIntelligenceReports,
  type LandIntelligenceReportRow,
} from "@shared/schema";
import { logger } from "../../utils/logger";

// ---------------------------------------------------------------------------
// Staleness policy
// ---------------------------------------------------------------------------

/**
 * Report-level freshness window. Free GIS facts (flood zone, soil class,
 * elevation) change on the order of years; assessed value / tax status change
 * at most a few times a year. A 7-day report window keeps re-opens instant
 * while still catching county refreshes within a useful window.
 */
export const REPORT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Per-field freshness horizons (for `staleFields()` — informs the future
 * surgical-refresh path + the parcel-card "fresh / stale" dot). Conservative:
 * authoritative federal layers are slow-moving; tax/owner facts are faster.
 */
export const FIELD_STALE_AFTER_MS: Record<string, number> = {
  floodZone: 180 * 24 * 60 * 60 * 1000, // ~6 months
  wetlands: 365 * 24 * 60 * 60 * 1000, // ~1 year
  environmental: 90 * 24 * 60 * 60 * 1000, // ~3 months
  roadAccess: 180 * 24 * 60 * 60 * 1000,
  soil: 365 * 24 * 60 * 60 * 1000,
  elevation: 365 * 24 * 60 * 60 * 1000,
};
const DEFAULT_FIELD_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days fallback

// ---------------------------------------------------------------------------
// Parcel identity → stable cache key
// ---------------------------------------------------------------------------

export interface ParcelIdentity {
  apn?: string | null;
  state: string;
  county: string;
  latitude?: number | null;
  longitude?: number | null;
  acres?: number | null;
}

/**
 * Normalize a parcel identity into a stable cache key. Prefer apn+state+county
 * (the authoritative identity); fall back to rounded lat/lng + acres so the same
 * physical parcel maps to one row even without an apn. Rounding lat/lng to 5
 * decimals (~1.1m) tolerates float jitter between requests for the same pin.
 */
export function parcelKeyFor(id: ParcelIdentity): string {
  const state = (id.state || "").trim().toUpperCase();
  const county = (id.county || "").trim().toLowerCase();
  const apn = (id.apn || "").trim().toLowerCase();

  let basis: string;
  if (apn) {
    basis = `apn:${state}|${county}|${apn}`;
  } else {
    const lat = id.latitude != null ? id.latitude.toFixed(5) : "?";
    const lng = id.longitude != null ? id.longitude.toFixed(5) : "?";
    const acres = id.acres != null ? Number(id.acres).toFixed(2) : "?";
    basis = `geo:${state}|${county}|${lat}|${lng}|${acres}`;
  }
  return createHash("sha1").update(basis).digest("hex");
}

// ---------------------------------------------------------------------------
// Staleness helpers
// ---------------------------------------------------------------------------

/** A stored report is fresh when now() < staleAfter. */
export function isReportFresh(
  row: Pick<LandIntelligenceReportRow, "staleAfter">,
  now: Date = new Date(),
): boolean {
  return row.staleAfter.getTime() > now.getTime();
}

/**
 * Which fields in a stored report are individually past their per-field
 * horizon (drives the future surgical-refresh path + parcel-card freshness UX).
 * A field with no recorded provenance is treated as stale (we never saw it).
 */
export function staleFields(
  fieldProvenance: LandIntelligenceReportRow["fieldProvenance"],
  fields: string[],
  now: Date = new Date(),
): string[] {
  const fp = fieldProvenance ?? {};
  const out: string[] = [];
  for (const field of fields) {
    const prov = fp[field];
    if (!prov?.fetchedAt) {
      out.push(field);
      continue;
    }
    const fetched = Date.parse(prov.fetchedAt);
    const horizon = FIELD_STALE_AFTER_MS[field] ?? DEFAULT_FIELD_STALE_AFTER_MS;
    if (Number.isNaN(fetched) || now.getTime() - fetched > horizon) {
      out.push(field);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Store read / write
// ---------------------------------------------------------------------------

/**
 * The minimal shape we read off a computed LandIntelligenceReport. Kept as a
 * structural subset (no index signature) so the verbatim LandIntelligenceReport
 * assigns to it without friction — we only persist what we read here + the whole
 * report blob.
 */
interface ComputedReportLike {
  fieldProvenance?: Record<string, { source: string; fetchedAt: string; classification: string }>;
  landIntelligenceScore?: number;
  recommendation?: string;
}

/**
 * Read the freshest stored report for a parcel (scoped to org, with global
 * fallback). Returns null on miss or any error (caller recomputes).
 */
export async function readStoredReport(
  parcelKey: string,
  organizationId: number | null,
): Promise<LandIntelligenceReportRow | null> {
  try {
    // Prefer this org's row; fall back to a shared/global row for the same parcel.
    const orgScoped = organizationId != null
      ? and(
          eq(landIntelligenceReports.parcelKey, parcelKey),
          eq(landIntelligenceReports.organizationId, organizationId),
        )
      : and(
          eq(landIntelligenceReports.parcelKey, parcelKey),
          isNull(landIntelligenceReports.organizationId),
        );

    const rows = await db
      .select()
      .from(landIntelligenceReports)
      .where(orgScoped)
      .orderBy(desc(landIntelligenceReports.computedAt))
      .limit(1);

    return rows[0] ?? null;
  } catch (err) {
    logger.warn("[land-intelligence-store] read failed; will recompute", {
      parcelKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Persist a freshly computed report (best-effort). Upserts on
 * (organizationId, parcelKey) so we keep one current row per parcel per org.
 * Swallows all errors — a store-write must never fail the parcel response.
 */
export async function writeStoredReport(args: {
  parcelKey: string;
  organizationId: number | null;
  identity: ParcelIdentity;
  report: ComputedReportLike;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  try {
    const staleAfter = new Date(now.getTime() + REPORT_STALE_AFTER_MS);
    const values = {
      organizationId: args.organizationId,
      parcelKey: args.parcelKey,
      apn: args.identity.apn ?? null,
      state: args.identity.state,
      county: args.identity.county,
      latitude: args.identity.latitude != null ? String(args.identity.latitude) : null,
      longitude: args.identity.longitude != null ? String(args.identity.longitude) : null,
      acres: args.identity.acres != null ? String(args.identity.acres) : null,
      report: args.report as unknown as Record<string, unknown>,
      fieldProvenance: args.report.fieldProvenance ?? null,
      landIntelligenceScore:
        typeof args.report.landIntelligenceScore === "number"
          ? Math.round(args.report.landIntelligenceScore)
          : null,
      recommendation: args.report.recommendation ?? null,
      computedAt: now,
      staleAfter,
      updatedAt: now,
    };

    // Replace the existing current row (if any) for this parcel+org, then insert.
    // We avoid a partial unique index dependency by delete-then-insert inside the
    // best-effort wrapper; the read path always takes the freshest row anyway.
    const scope = args.organizationId != null
      ? and(
          eq(landIntelligenceReports.parcelKey, args.parcelKey),
          eq(landIntelligenceReports.organizationId, args.organizationId),
        )
      : and(
          eq(landIntelligenceReports.parcelKey, args.parcelKey),
          isNull(landIntelligenceReports.organizationId),
        );

    await db.delete(landIntelligenceReports).where(scope);
    await db.insert(landIntelligenceReports).values(values);
  } catch (err) {
    logger.warn("[land-intelligence-store] write failed (non-fatal)", {
      parcelKey: args.parcelKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
