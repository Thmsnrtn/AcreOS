/**
 * Temporal Spine — open-data change detection (ruling #9 wave 3,
 * docs/company/founder-decisions-2026-07-28.md).
 *
 * Open data becomes EVENTS: when a refreshed lookup materially differs from
 * what we previously knew for the same place, that change is itself
 * intelligence ("FEMA redrew the map under this parcel") and is durably
 * recorded in `open_data_change_events`.
 *
 * The diff core (`diffCategoryResult`) is PURE — no DB, no fetch — so it is
 * fully unit-testable. The persistence wrapper (`recordCategoryChanges`) and
 * read API (`listRecentChangeEvents`) are thin drizzle shims around it.
 *
 * Honesty contract:
 *  - null→value is NOT a change (that's first sight, not the world changing).
 *  - value→null is NOT a change (that's a lookup gap, not the world changing).
 *  - Unknown categories produce NO events — we never guess materiality.
 *  - Structured values (objects/arrays) are never diffed field-blind; only
 *    the explicitly listed scalar fields below are compared.
 *  - narrative is one plain-words sentence built ONLY from the two real
 *    observed values — nothing invented.
 *
 * Materiality rules (v1) — conservative: only fields whose change a land
 * buyer would care about. Category names match the broker/registry categories
 * (server/services/data-source-broker.ts payload shapes):
 *
 *  ┌─────────────────┬──────────────────────────────┬──────────┐
 *  │ category        │ field                        │ severity │
 *  ├─────────────────┼──────────────────────────────┼──────────┤
 *  │ flood_zone      │ zone                         │ notable  │
 *  │ flood_zone      │ riskLevel                    │ notable  │
 *  │ wetlands        │ hasWetlands (flip)           │ notable  │
 *  │ wetlands        │ classification               │ info     │
 *  │ soil            │ hydricRating                 │ notable  │
 *  │ soil            │ floodingFrequency            │ notable  │
 *  │ soil            │ septicRating                 │ notable  │
 *  │ wildfire_hazard │ whpClass                     │ notable  │
 *  │ environmental   │ superfundCount (increase)    │ notable  │
 *  │ environmental   │ superfundCount (decrease)    │ info     │
 *  │ environmental   │ echoFacilitiesWithViolations │ info     │
 *  │ environmental   │ ustSitesNearby               │ info     │
 *  │ broadband       │ served (flip)                │ notable  │
 *  └─────────────────┴──────────────────────────────┴──────────┘
 */

import { desc, and, eq, gte } from "drizzle-orm";
import { db } from "../../db";
import { openDataChangeEvents, type OpenDataChangeEvent } from "@shared/schema";
import { logger } from "../../utils/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChangeSeverity = "info" | "notable";
export type ChangeScopeType = "point" | "county";

export interface DetectedChange {
  category: string;
  field: string;
  previousValue: string;
  newValue: string;
  severity: ChangeSeverity;
  /** One plain-words sentence built only from the two real values. */
  narrative: string;
}

type Payload = Record<string, unknown>;

interface FieldRule {
  field: string;
  /** Extract the comparable value; defaults to `data[field]`. */
  extract?: (data: Payload) => unknown;
  /** Categorical severity, optionally direction-aware. */
  severity: ChangeSeverity | ((prev: unknown, next: unknown) => ChangeSeverity);
  narrative: (prev: string, next: string) => string;
}

// ─── Value normalization ─────────────────────────────────────────────────────

/**
 * Normalize a raw payload value to a comparable string, or null when there is
 * no real value to compare. Only scalars qualify — objects/arrays are never
 * diffed blind (return null → treated as "no value" → no event).
 */
function normalizeValue(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s.length > 0 ? s : null;
  }
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw === "boolean") return String(raw);
  return null;
}

function isPayload(v: unknown): v is Payload {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Superfund site count from an `environmental` payload. The broker's EPA TRI
 * shape carries `superfundSites` (array); the EPA FRS shape carries
 * `superfundCount` (number). Anything else → null (no value, never a guess).
 */
function extractSuperfundCount(data: Payload): number | null {
  if (Array.isArray(data.superfundSites)) return data.superfundSites.length;
  if (typeof data.superfundCount === "number" && Number.isFinite(data.superfundCount)) {
    return data.superfundCount;
  }
  return null;
}

// ─── Materiality rules ───────────────────────────────────────────────────────

const MATERIALITY_RULES: Record<string, FieldRule[]> = {
  flood_zone: [
    {
      field: "zone",
      severity: "notable",
      narrative: (p, n) => `FEMA flood zone changed from ${p} to ${n} at this point`,
    },
    {
      field: "riskLevel",
      severity: "notable",
      narrative: (p, n) => `FEMA flood risk level changed from ${p} to ${n} at this point`,
    },
  ],
  wetlands: [
    {
      field: "hasWetlands",
      severity: "notable",
      narrative: (p, n) => `USFWS NWI mapped wetlands presence changed from ${p} to ${n} at this point`,
    },
    {
      field: "classification",
      severity: "info",
      narrative: (p, n) => `USFWS NWI wetland classification changed from ${p} to ${n} at this point`,
    },
  ],
  soil: [
    {
      field: "hydricRating",
      severity: "notable",
      narrative: (p, n) => `USDA SSURGO hydric soil rating changed from ${p} to ${n} at this point`,
    },
    {
      field: "floodingFrequency",
      severity: "notable",
      narrative: (p, n) => `USDA SSURGO flooding frequency changed from ${p} to ${n} at this point`,
    },
    {
      field: "septicRating",
      severity: "notable",
      narrative: (p, n) => `USDA SSURGO septic suitability rating changed from ${p} to ${n} at this point`,
    },
  ],
  wildfire_hazard: [
    {
      field: "whpClass",
      severity: "notable",
      narrative: (p, n) =>
        `USFS wildfire hazard potential class changed from ${p} to ${n} at this point`,
    },
  ],
  environmental: [
    {
      field: "superfundCount",
      extract: extractSuperfundCount,
      // A NEW superfund site appearing within the radius is notable; a
      // decrease (delisting / data correction) is info.
      severity: (prev, next) =>
        typeof prev === "number" && typeof next === "number" && next > prev ? "notable" : "info",
      narrative: (p, n) =>
        `EPA superfund sites within the search radius changed from ${p} to ${n}`,
    },
    {
      field: "echoFacilitiesWithViolations",
      severity: "info",
      narrative: (p, n) =>
        `EPA ECHO facilities in violation within the search radius changed from ${p} to ${n}`,
    },
    {
      field: "ustSitesNearby",
      severity: "info",
      narrative: (p, n) =>
        `EPA underground storage tank sites nearby changed from ${p} to ${n}`,
    },
  ],
  broadband: [
    {
      field: "served",
      severity: "notable",
      narrative: (p, n) =>
        `FCC reported fixed broadband service at this point changed from ${p} to ${n}`,
    },
  ],
};

// ─── Pure diff core ──────────────────────────────────────────────────────────

/**
 * Diff two payloads for a category against the materiality rules.
 *
 * Returns [] for unknown categories (never guess), non-object payloads, and
 * any null-transition (null→value is first sight; value→null is a lookup
 * gap — neither is the world changing).
 */
export function diffCategoryResult(
  category: string,
  previous: unknown,
  next: unknown,
): DetectedChange[] {
  const rules = MATERIALITY_RULES[category];
  if (!rules) return []; // unknown category → no events, never guess
  if (!isPayload(previous) || !isPayload(next)) return [];

  const changes: DetectedChange[] = [];
  for (const rule of rules) {
    const prevRaw = rule.extract ? rule.extract(previous) : previous[rule.field];
    const nextRaw = rule.extract ? rule.extract(next) : next[rule.field];
    const prevStr = normalizeValue(prevRaw);
    const nextStr = normalizeValue(nextRaw);
    // Both sides must be REAL values — null transitions are non-events.
    if (prevStr === null || nextStr === null) continue;
    if (prevStr === nextStr) continue;
    const severity =
      typeof rule.severity === "function" ? rule.severity(prevRaw, nextRaw) : rule.severity;
    changes.push({
      category,
      field: rule.field,
      previousValue: prevStr,
      newValue: nextStr,
      severity,
      narrative: rule.narrative(prevStr, nextStr),
    });
  }
  return changes;
}

// ─── Scope refs ──────────────────────────────────────────────────────────────

/** Point scopeRef contract: "lat,lng" rounded to 4 decimal places. */
export function pointScopeRef(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

// ─── Persistence wrapper (thin, best-effort) ─────────────────────────────────

export interface RecordCategoryChangesInput {
  category: string;
  scopeType: ChangeScopeType;
  scopeRef: string;
  previous: unknown;
  next: unknown;
  /** When the previous knowledge was as-of (source freshness or cache time). */
  previousAsOf?: Date | null;
  /** The instrument name, e.g. "FEMA NFHL". */
  source: string;
}

/**
 * Diff + persist. Best-effort by contract: a diff or persist failure logs and
 * NEVER throws — recording history must never break a live lookup. Returns
 * the detected changes (persisted or not).
 */
export async function recordCategoryChanges(
  input: RecordCategoryChangesInput,
): Promise<DetectedChange[]> {
  let changes: DetectedChange[] = [];
  try {
    changes = diffCategoryResult(input.category, input.previous, input.next);
    if (changes.length === 0) return changes;

    await db.insert(openDataChangeEvents).values(
      changes.map((c) => ({
        category: c.category,
        scopeType: input.scopeType,
        scopeRef: input.scopeRef,
        field: c.field,
        previousValue: c.previousValue,
        newValue: c.newValue,
        previousAsOf: input.previousAsOf ?? null,
        source: input.source,
        severity: c.severity,
        narrative: c.narrative,
      })),
    );

    logger.info(`Open-data change events recorded`, {
      source: "OpenDataChangeDetection",
      metadata: {
        category: input.category,
        scopeType: input.scopeType,
        scopeRef: input.scopeRef,
        count: changes.length,
        fields: changes.map((c) => c.field),
      },
    });
  } catch (err) {
    logger.warn(`Open-data change event persistence failed (non-fatal)`, {
      source: "OpenDataChangeDetection",
      metadata: {
        category: input.category,
        scopeRef: input.scopeRef,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
  return changes;
}

// ─── Read API ────────────────────────────────────────────────────────────────

export interface ListRecentChangeEventsOptions {
  /**
   * "point" | "county". Accepts plain strings so HTTP query params can pass
   * through uncast — an unknown value simply matches no rows (text column).
   */
  scopeType?: ChangeScopeType | (string & {});
  scopeRef?: string;
  /** How far back to look. Default 90 days. */
  sinceDays?: number;
  /** Max rows. Default 50, capped at 500. */
  limit?: number;
}

/** Recent change events, newest first, for siblings/consumers. */
export async function listRecentChangeEvents(
  options: ListRecentChangeEventsOptions = {},
): Promise<OpenDataChangeEvent[]> {
  const sinceDays = options.sinceDays ?? 90;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const conditions = [gte(openDataChangeEvents.detectedAt, cutoff)];
  if (options.scopeType) conditions.push(eq(openDataChangeEvents.scopeType, options.scopeType));
  if (options.scopeRef) conditions.push(eq(openDataChangeEvents.scopeRef, options.scopeRef));

  return db
    .select()
    .from(openDataChangeEvents)
    .where(and(...conditions))
    .orderBy(desc(openDataChangeEvents.detectedAt))
    .limit(limit);
}
