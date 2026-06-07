/**
 * Parcel Delta Detector — owner-change & tax-status delta engine
 * (Iyari, Chief of Future — roadmap lens #5).
 *
 * The append-only `parcel_observations` log (migration 0121) captures owner /
 * owner_address / tax_amount / tax_status facts on every lookup + ETL. THIS is
 * the killer app of owning history: a scheduled diff over those observations
 * that fires "Owner changed on a parcel in your pipeline" or "tax-delinquent
 * status appeared" — the exact signal investors pay PropStream/PropGrid for,
 * derived FREE from county GIS we already crawl.
 *
 * DESIGN (per the lens brief):
 *   1. Read-only REPORT first. `detectDeltasForOrg()` computes the changes as a
 *      plain report. It writes nothing. The pure decision core
 *      (`evaluateFieldDelta`) is exhaustively unit-tested for
 *      change-detected / no-change / first-observation-only / false-positive.
 *   2. Only AFTER the false-positive guard passes do we persist a parcel_alert
 *      row and emit the workflow trigger event. `runParcelDeltaDetector()` does
 *      the persistence; the dedupe unique key makes a re-run idempotent.
 *
 * The job compares the LATEST TWO observations per (apn, field) — strictly the
 * two most recent values — for parcels that appear in a customer's pipeline
 * (properties + leads). We never scan the whole observation log; the
 * (apn, field, observed_at) index makes "latest N per (apn, field)" cheap.
 *
 * This file is read-only against parcel_observations (SELECT only) and is the
 * sole writer of parcel_alerts.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  parcelObservations,
  parcelAlerts,
  properties as propertiesTable,
  leads as leadsTable,
  type InsertParcelAlert,
} from "@shared/schema";
import { logger } from "../utils/logger";
import { emitParcelEvent } from "./workflow-engine";

// ----------------------------------------------------------------------------
// Tracked fields + classification
// ----------------------------------------------------------------------------

/** Fields whose change is a meaningful lead signal. */
export const TRACKED_FIELDS = [
  "owner",
  "owner_address",
  "tax_status",
  "tax_amount",
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export type ParcelAlertType = "owner_changed" | "tax_status_changed";

/** Maps a tracked field to the alert type / workflow event family it belongs to. */
export function alertTypeForField(field: string): ParcelAlertType | null {
  switch (field) {
    case "owner":
    case "owner_address":
      return "owner_changed";
    case "tax_status":
    case "tax_amount":
      return "tax_status_changed";
    default:
      return null;
  }
}

export function workflowEventForAlertType(
  type: ParcelAlertType,
): "parcel.owner_changed" | "parcel.tax_status_changed" {
  return type === "owner_changed"
    ? "parcel.owner_changed"
    : "parcel.tax_status_changed";
}

// ----------------------------------------------------------------------------
// Pure decision core (no DB — fully unit-testable)
// ----------------------------------------------------------------------------

/** The two most-recent observations for a single (apn, field), newest first. */
export interface FieldObservationPair {
  apn: string;
  state: string;
  county: string;
  field: string;
  /** Most-recent observation. */
  current: {
    value: unknown;
    source?: string | null;
    confidence?: number | null;
    observedAt?: Date | null;
  };
  /** The observation immediately before `current`. Absent when only one exists. */
  previous?: {
    value: unknown;
    source?: string | null;
    confidence?: number | null;
    observedAt?: Date | null;
  };
}

export interface FieldDeltaResult {
  changed: boolean;
  /** Populated only when `changed` is true and the guard passed. */
  reason?:
    | "first_observation_only"
    | "no_change"
    | "untracked_field"
    | "empty_current"
    | "low_confidence"
    | "changed";
  alertType?: ParcelAlertType;
}

/**
 * Normalize an observation value for equality comparison. The observation log
 * stores jsonb, so a value may arrive as a string, number, boolean, or object.
 * We compare on a trimmed, lowercased, stringified form so cosmetic churn
 * (whitespace, casing, "123" vs 123) does NOT register as a change — that is
 * the first line of the false-positive guard.
 */
export function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim().toLowerCase();
  }
  try {
    return JSON.stringify(value).trim().toLowerCase();
  } catch {
    return String(value).trim().toLowerCase();
  }
}

/** True when a normalized value is effectively empty / "unknown". */
export function isEmptyValue(value: unknown): boolean {
  const n = normalizeValue(value);
  return n === "" || n === "unknown" || n === "null" || n === "n/a" || n === "none";
}

export interface DeltaGuardOptions {
  /**
   * Minimum confidence required on the CURRENT observation before we will fire.
   * county_gis data with very low confidence shouldn't generate noisy alerts.
   * Observations with no confidence stamp are treated as passing (null = trusted
   * by the source that wrote it). Default 0.5.
   */
  minConfidence?: number;
}

/**
 * The pure decision: did this (apn, field) meaningfully change between its two
 * most-recent observations, and does it clear the false-positive guard?
 *
 * Guard rules (a change is SUPPRESSED — changed:false — when):
 *   - the field is not tracked;
 *   - there is only one observation (first-observation-only — nothing to diff);
 *   - the normalized current == normalized previous (no real change, incl.
 *     whitespace/case/number-vs-string churn);
 *   - the current value is empty/"unknown" (county dropped the field — almost
 *     always a data gap, NOT a real ownership/tax change; firing here is the
 *     classic false positive);
 *   - the current observation's confidence is below the guard threshold.
 *
 * A previous value that is empty but a current value that is real (e.g. tax
 * status went from blank to "delinquent") IS a meaningful change and fires.
 */
export function evaluateFieldDelta(
  pair: FieldObservationPair,
  opts: DeltaGuardOptions = {},
): FieldDeltaResult {
  const alertType = alertTypeForField(pair.field);
  if (!alertType) return { changed: false, reason: "untracked_field" };

  // First-observation-only: we need two observations to diff. Never fires.
  if (!pair.previous) return { changed: false, reason: "first_observation_only" };

  const curNorm = normalizeValue(pair.current.value);
  const prevNorm = normalizeValue(pair.previous.value);

  // No real change after normalization (the cosmetic-churn guard).
  if (curNorm === prevNorm) return { changed: false, reason: "no_change" };

  // Empty/"unknown" current value: county dropped the field. This is a data
  // gap, not a real change — the most common false positive. Suppress.
  if (isEmptyValue(pair.current.value)) {
    return { changed: false, reason: "empty_current" };
  }

  // Confidence guard: a low-confidence current observation isn't trustworthy
  // enough to alert on. null/undefined confidence passes (source-trusted).
  const minConfidence = opts.minConfidence ?? 0.5;
  const cur = pair.current.confidence;
  if (cur !== null && cur !== undefined && cur < minConfidence) {
    return { changed: false, reason: "low_confidence" };
  }

  return { changed: true, reason: "changed", alertType };
}

/**
 * Stable idempotency key for a detected transition. A re-run of the detector
 * that sees the same (apn, field, previous→current) transition produces the
 * same key, so the unique index on (organization_id, dedupe_key) makes the
 * INSERT a no-op the second time.
 */
export function dedupeKeyFor(pair: FieldObservationPair): string {
  const prev = normalizeValue(pair.previous?.value);
  const cur = normalizeValue(pair.current.value);
  return [
    pair.apn,
    pair.state.toUpperCase(),
    pair.county.toLowerCase(),
    pair.field,
    prev,
    "->",
    cur,
  ].join("|");
}

// ----------------------------------------------------------------------------
// Report query (read-only — writes NOTHING)
// ----------------------------------------------------------------------------

/** A single detected, guard-passing change ready to become an alert. */
export interface DetectedDelta {
  organizationId: number;
  apn: string;
  state: string;
  county: string;
  field: TrackedField;
  alertType: ParcelAlertType;
  previousValue: unknown;
  currentValue: unknown;
  source?: string | null;
  confidence?: number | null;
  observedAt?: Date | null;
  leadId?: number | null;
  propertyId?: number | null;
  dedupeKey: string;
}

/** A parcel that appears in a customer's pipeline (the tracked set). */
interface PipelineParcel {
  apn: string;
  state: string;
  county: string;
  leadId: number | null;
  propertyId: number | null;
}

/**
 * The set of parcels we watch for an org: every (apn, state, county) that
 * appears as a property, plus leads that carry an apn. Properties always have
 * apn + state + county; leads carry apn + state (county may be null) so we only
 * include leads whose county we can resolve from a matching property, otherwise
 * a lead-only parcel is keyed on (apn, state) and county is best-effort.
 */
export async function getPipelineParcels(
  organizationId: number,
): Promise<PipelineParcel[]> {
  const props = await db
    .select({
      apn: propertiesTable.apn,
      state: propertiesTable.state,
      county: propertiesTable.county,
      id: propertiesTable.id,
    })
    .from(propertiesTable)
    .where(eq(propertiesTable.organizationId, organizationId));

  const out: PipelineParcel[] = props.map((p) => ({
    apn: p.apn,
    state: (p.state || "").toUpperCase(),
    county: p.county,
    leadId: null,
    propertyId: p.id,
  }));

  // Leads with an APN — county may be null on a lead, so map from a matching
  // property where possible; otherwise carry an empty county (the observation
  // join is on apn+state, county is informational on the alert).
  const leadRows = await db
    .select({
      apn: leadsTable.apn,
      state: leadsTable.state,
      id: leadsTable.id,
    })
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.organizationId, organizationId),
        sql`${leadsTable.apn} IS NOT NULL`,
      ),
    );

  const countyByApnState = new Map<string, string>();
  for (const p of out) {
    countyByApnState.set(`${p.apn}|${p.state}`, p.county);
  }

  for (const l of leadRows) {
    if (!l.apn) continue;
    const state = (l.state || "").toUpperCase();
    const county = countyByApnState.get(`${l.apn}|${state}`) ?? "";
    out.push({
      apn: l.apn,
      state,
      county,
      leadId: l.id,
      propertyId: null,
    });
  }

  return out;
}

/**
 * Fetch the two most-recent observations per (apn, field) for the given parcels,
 * restricted to tracked fields. Returns one FieldObservationPair per
 * (apn, state, county, field) that has at least one observation.
 *
 * Org scoping: observations may be global (organizationId null) or org-scoped.
 * We match on parcel identity (apn+state) and accept observations that are
 * either this org's or global — county GIS facts are written global, customer
 * edits org-scoped. We never read another org's private observations.
 */
export async function loadObservationPairs(
  organizationId: number,
  parcels: PipelineParcel[],
): Promise<FieldObservationPair[]> {
  if (parcels.length === 0) return [];

  // De-dup the parcel set on (apn, state) — multiple pipeline rows can point at
  // the same parcel. Keep the richest county/lead/property association.
  const byKey = new Map<string, PipelineParcel>();
  for (const p of parcels) {
    if (!p.apn || !p.state) continue;
    const key = `${p.apn}|${p.state}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, p);
    } else {
      // Prefer an entry that has a county, then one with a propertyId.
      if (!existing.county && p.county) existing.county = p.county;
      if (existing.propertyId === null && p.propertyId !== null) {
        existing.propertyId = p.propertyId;
      }
      if (existing.leadId === null && p.leadId !== null) {
        existing.leadId = p.leadId;
      }
    }
  }

  const apns = Array.from(new Set(Array.from(byKey.values()).map((p) => p.apn)));
  if (apns.length === 0) return [];

  // Pull all tracked-field observations for these APNs (this org or global),
  // newest first. The (apn, field, observed_at) index serves this. We then
  // window the latest two per (apn, state, county, field) in JS — the parcel
  // set is the customer's pipeline, which is small.
  const rows = await db
    .select({
      apn: parcelObservations.apn,
      state: parcelObservations.state,
      county: parcelObservations.county,
      field: parcelObservations.field,
      value: parcelObservations.value,
      source: parcelObservations.source,
      confidence: parcelObservations.confidence,
      observedAt: parcelObservations.observedAt,
    })
    .from(parcelObservations)
    .where(
      and(
        inArray(parcelObservations.apn, apns),
        inArray(parcelObservations.field, TRACKED_FIELDS as unknown as string[]),
        sql`(${parcelObservations.organizationId} = ${organizationId} OR ${parcelObservations.organizationId} IS NULL)`,
      ),
    )
    .orderBy(desc(parcelObservations.observedAt), desc(parcelObservations.id));

  // Group newest-first; keep the first two per (apn, state, county, field).
  const grouped = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.apn}|${(r.state || "").toUpperCase()}|${(r.county || "").toLowerCase()}|${r.field}`;
    const arr = grouped.get(key);
    if (!arr) {
      grouped.set(key, [r]);
    } else if (arr.length < 2) {
      arr.push(r);
    }
  }

  const pairs: FieldObservationPair[] = [];
  for (const arr of grouped.values()) {
    const [current, previous] = arr;
    pairs.push({
      apn: current.apn,
      state: (current.state || "").toUpperCase(),
      county: current.county || "",
      field: current.field,
      current: {
        value: current.value,
        source: current.source,
        confidence: current.confidence,
        observedAt: current.observedAt,
      },
      previous: previous
        ? {
            value: previous.value,
            source: previous.source,
            confidence: previous.confidence,
            observedAt: previous.observedAt,
          }
        : undefined,
    });
  }

  return pairs;
}

/**
 * READ-ONLY report: compute the guard-passing deltas for an org. Writes nothing.
 * This is the "report query first" the lens brief asks for — eyeball the output
 * (and false-positive rate) before letting it fire notifications.
 */
export async function detectDeltasForOrg(
  organizationId: number,
  opts: DeltaGuardOptions = {},
): Promise<DetectedDelta[]> {
  const parcels = await getPipelineParcels(organizationId);
  const pairs = await loadObservationPairs(organizationId, parcels);

  // Build an apn+state -> pipeline association so detected deltas can link back
  // to the lead/property that put the parcel on the radar.
  const assoc = new Map<string, PipelineParcel>();
  for (const p of parcels) {
    if (!p.apn || !p.state) continue;
    const key = `${p.apn}|${p.state.toUpperCase()}`;
    const existing = assoc.get(key);
    if (!existing) {
      assoc.set(key, { ...p });
    } else {
      if (!existing.county && p.county) existing.county = p.county;
      if (existing.propertyId === null && p.propertyId !== null) existing.propertyId = p.propertyId;
      if (existing.leadId === null && p.leadId !== null) existing.leadId = p.leadId;
    }
  }

  const deltas: DetectedDelta[] = [];
  for (const pair of pairs) {
    const result = evaluateFieldDelta(pair, opts);
    if (!result.changed || !result.alertType) continue;

    const link = assoc.get(`${pair.apn}|${pair.state.toUpperCase()}`);
    deltas.push({
      organizationId,
      apn: pair.apn,
      state: pair.state,
      county: pair.county || link?.county || "",
      field: pair.field as TrackedField,
      alertType: result.alertType,
      previousValue: pair.previous?.value ?? null,
      currentValue: pair.current.value,
      source: pair.current.source ?? null,
      confidence: pair.current.confidence ?? null,
      observedAt: pair.current.observedAt ?? null,
      leadId: link?.leadId ?? null,
      propertyId: link?.propertyId ?? null,
      dedupeKey: dedupeKeyFor(pair),
    });
  }

  return deltas;
}

// ----------------------------------------------------------------------------
// Persistence + event emission (the side-effecting layer)
// ----------------------------------------------------------------------------

export interface DetectorRunResult {
  orgsScanned: number;
  deltasDetected: number;
  alertsCreated: number;
  eventsEmitted: number;
}

/**
 * Persist a single detected delta as a parcel_alert and emit its workflow
 * event. Idempotent via the (organization_id, dedupe_key) unique index — a
 * duplicate transition is silently skipped (returns false). Returns true when a
 * NEW alert row was written (and an event emitted).
 */
export async function persistDelta(delta: DetectedDelta): Promise<boolean> {
  const row: InsertParcelAlert = {
    organizationId: delta.organizationId,
    apn: delta.apn,
    state: delta.state,
    county: delta.county,
    alertType: delta.alertType,
    field: delta.field,
    previousValue: delta.previousValue as InsertParcelAlert["previousValue"],
    currentValue: delta.currentValue as InsertParcelAlert["currentValue"],
    source: delta.source ?? null,
    confidence: delta.confidence ?? null,
    leadId: delta.leadId ?? null,
    propertyId: delta.propertyId ?? null,
    dedupeKey: delta.dedupeKey,
    ...(delta.observedAt ? { observedAt: delta.observedAt } : {}),
  };

  const inserted = await db
    .insert(parcelAlerts)
    .values(row)
    .onConflictDoNothing({
      target: [parcelAlerts.organizationId, parcelAlerts.dedupeKey],
    })
    .returning({ id: parcelAlerts.id });

  if (inserted.length === 0) {
    // Already alerted on this exact transition — idempotent no-op.
    return false;
  }

  const alertId = inserted[0].id;
  emitParcelEvent(
    workflowEventForAlertType(delta.alertType),
    delta.organizationId,
    alertId,
    {
      apn: delta.apn,
      state: delta.state,
      county: delta.county,
      field: delta.field,
      alertType: delta.alertType,
      currentValue: delta.currentValue,
      leadId: delta.leadId,
      propertyId: delta.propertyId,
    },
    { previousValue: delta.previousValue },
  );

  return true;
}

/**
 * The scheduled job entrypoint. Scans every org that has any tracked parcels in
 * its pipeline, detects guard-passing deltas, persists alerts, and emits events.
 * Designed to be wrapped in withJobLock by runScheduledJobs.ts.
 */
export async function runParcelDeltaDetector(
  opts: DeltaGuardOptions = {},
): Promise<DetectorRunResult> {
  const result: DetectorRunResult = {
    orgsScanned: 0,
    deltasDetected: 0,
    alertsCreated: 0,
    eventsEmitted: 0,
  };

  // Orgs worth scanning: those with at least one property OR an apn-bearing lead.
  const orgRows = await db
    .select({ organizationId: propertiesTable.organizationId })
    .from(propertiesTable)
    .groupBy(propertiesTable.organizationId);
  const leadOrgRows = await db
    .select({ organizationId: leadsTable.organizationId })
    .from(leadsTable)
    .where(sql`${leadsTable.apn} IS NOT NULL`)
    .groupBy(leadsTable.organizationId);

  const orgIds = Array.from(
    new Set([
      ...orgRows.map((r) => r.organizationId),
      ...leadOrgRows.map((r) => r.organizationId),
    ]),
  ).filter((id): id is number => typeof id === "number");

  for (const orgId of orgIds) {
    result.orgsScanned += 1;
    try {
      const deltas = await detectDeltasForOrg(orgId, opts);
      result.deltasDetected += deltas.length;
      for (const delta of deltas) {
        const created = await persistDelta(delta);
        if (created) {
          result.alertsCreated += 1;
          result.eventsEmitted += 1;
        }
      }
    } catch (err) {
      logger.error("[parcelDeltaDetector] org scan failed", err, {
        metadata: { organizationId: orgId },
      });
    }
  }

  if (result.alertsCreated > 0) {
    logger.info("[parcelDeltaDetector] run complete", {
      metadata: {
        orgsScanned: result.orgsScanned,
        deltasDetected: result.deltasDetected,
        alertsCreated: result.alertsCreated,
      },
    });
  }

  return result;
}
