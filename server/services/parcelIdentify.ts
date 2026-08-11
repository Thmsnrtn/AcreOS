/**
 * parcelIdentify — Wave 2.3 click-to-identify, and the parcels an org watches.
 *
 * The exit line this exists to serve: tap an untracked parcel in a covered
 * county → owner / APN / acres fast → tracked → the existing offer flow
 * unchanged.
 *
 * WHAT THIS IS NOT: a lookup. `/api/parcels/lookup` already calls providers,
 * burns credits and 404s on a miss. This resolver reads ONLY what the product
 * ALREADY HOLDS (the parcel_snapshots cache), so a tap costs no credits and no
 * vendor round-trip — and a miss is answered with an honest description of the
 * gap rather than a 404.
 *
 * ─── How it reads, and why that shape is load-bearing ───────────────────────
 *
 * Every read here carries a WHERE. That is not a performance nicety, it is the
 * honesty mechanism: an earlier draft of this file pulled `limit(500)` rows
 * with no predicate and filtered them in TypeScript, which means that once the
 * shared cache exceeds 500 rows the resolver is looking at an ARBITRARY slice
 * of it. A parcel we genuinely hold would then miss, and the miss would render
 * as "we do not have parcel data for this county yet" — a fabricated negative
 * about our own coverage, produced by a truncation the customer cannot see.
 * So: predicates, not truncation.
 *
 * That claim was still half true when this file first shipped, and the wave's
 * adversarial audit caught it: the point path had a predicate AND a bare
 * `.limit(200)` with no ordering, over a ~27 km box. Any county with real
 * coverage holds far more than 200 parcels in that box, so the same fabricated
 * negative came back — invisibly, and only once coverage got good. The limit
 * is now applied to a NEAREST-FIRST ordering, which makes it a bound on work
 * instead of a bound on correctness: a centroid match within
 * CENTROID_MATCH_LIMIT_METERS is necessarily inside the rows we read. The one
 * residue worth naming honestly: boundary containment for a parcel whose
 * recorded centroid is further away than 200 nearer centroids is still not
 * guaranteed, so a very large parcel in a dense cache can fall back to the
 * centroid answer (which is marked `approximate`) rather than a containment
 * answer. It cannot produce a false MISS, only a less precise match.
 *
 * Reads are also tenant-scoped. `parcel_snapshots.organization_id` is NULL for
 * the shared cache and set for an org's own private rows, so every snapshot
 * read is `org_id IS NULL OR org_id = <caller>`. An unscoped read would show
 * one customer another customer's parcel research.
 *
 * String comparison follows the gisRepo house pattern (LOWER/REPLACE on the
 * stored value) rather than a bare `=`, because snapshot rows are written from
 * several paths and only some of them normalize. A case-sensitive `=` would
 * manufacture exactly the false negative described above.
 *
 * ─── The honesty contract ───────────────────────────────────────────────────
 *
 * Every negative this module can emit is a CLAIM, and each is verified before
 * it is made:
 *
 *   "we do not have parcel data for this county yet"
 *       Only after BOTH sources of parcel truth were inspected and both came
 *       back empty: the county-GIS endpoint register AND the parcel_snapshots
 *       cache. Checking only the endpoint register would declare a county
 *       uncovered while we demonstrably hold parcels in it — a one-direction
 *       check is how a fabricated negative gets shipped. The result carries
 *       `inspected`, built from the reads THAT ACTUALLY RAN, so the claim is
 *       auditable from the payload itself and cannot be satisfied by a
 *       hardcoded constant that drifts from the queries.
 *
 *   "not recorded" (a field-level absence)
 *       Means the column is genuinely empty. It is a DIFFERENT value from
 *       "withheld", which would mean we hold the fact but a licence forbids
 *       passing it on. Rendering a suppression as an absence is a lie about
 *       why the screen is empty, so the two never share a code path. In-app
 *       display to the org that holds the cache is not egress and withholds
 *       nothing — `absence` is therefore always "not-recorded" today, and the
 *       "withheld" arm exists so a future export path cannot quietly reuse the
 *       absence wording.
 *
 *   a failed read
 *       Surfaces as "lookup-failed", never as "no data". A broken query that
 *       renders as an empty county is the most expensive kind of false
 *       negative: it teaches the customer we do not cover somewhere we do.
 *
 *   a geometric match
 *       When we hold a boundary we can say the tap landed INSIDE the parcel.
 *       When we hold only a centroid we can say "the nearest parcel we hold,
 *       N metres away" and flag it approximate — claiming containment from a
 *       point is a claim the geometry does not support.
 *
 * Licence posture comes from server/services/licenseEgress.ts (slice 11) so
 * there is exactly one posture table in the codebase, not a second drifting
 * copy. Where the county's own row carries a recorded human licence review
 * (`county_gis_endpoints.redistributable`, migration 0120) it is passed
 * through as `reviewedPostures`, so the sentence shown to the customer
 * reflects the review that actually happened. Posture is shown for the
 * customer's benefit (can this fact leave in a mailer?) and does not gate
 * in-app display of their own cache.
 */

import { and, eq, isNull, or, sql, type AnyColumn } from "drizzle-orm";
import { countyGisEndpoints, parcelSnapshots, trackedParcels } from "@shared/schema";
import { db } from "../db";
import { dbForReads } from "../db-replica";
import { logger } from "../utils/logger";
import {
  postureMayLeave,
  resolveEgressLicense,
  type EgressResolution,
} from "./licenseEgress";
import { normalizeCounty, normalizeState } from "./coverageLedger";

/**
 * The tables this module is willing to consult before it will say a county has
 * no parcel data. Module-local on purpose: the payload's `inspected` array is
 * built from the reads that ACTUALLY RAN, not from this list, so the two can
 * never quietly diverge.
 */
const PARCEL_IDENTIFY_SOURCES = ["county_gis_endpoints", "parcel_snapshots"] as const;

export type ParcelIdentifySource = (typeof PARCEL_IDENTIFY_SOURCES)[number];

export type ParcelIdentifyStatus =
  /** We hold a snapshot and are showing it. */
  | "identified"
  /** The county is covered, but this particular parcel is not cached yet. */
  | "county-covered-no-parcel"
  /** Both sources inspected, both empty: we genuinely do not cover this county. */
  | "county-not-covered"
  /** A lat/lng tap that hit nothing, where no county was ever established. */
  | "location-unidentified"
  /** A read failed. NOT an absence of data. */
  | "lookup-failed";

/** Why a fact has no value. Kept as distinct values on purpose — see header. */
export type ParcelFactAbsence = "not-recorded" | "withheld";

export interface ParcelFact {
  key: string;
  /** Names what the value IS, not the category it belongs to. */
  label: string;
  value: string | null;
  absence: ParcelFactAbsence | null;
  /** Customer-facing sentence for the absence; empty when there is a value. */
  absenceLabel: string;
}

export interface ParcelProvenance {
  /** The source string the snapshot row itself declares. Never inferred. */
  source: string;
  /** When AcreOS last fetched it (snapshot.fetchedAt), ISO. Null if unstamped. */
  retrievedAt: string | null;
  /** Vintage AT the source, when the row records one (e.g. tax year). */
  vintageYear: number | null;
  posture: EgressResolution["posture"];
  /** Why that posture — always populated, so a refusal can state its reason. */
  postureReason: string;
  attribution: string | null;
  /** True when these facts may be passed on outside AcreOS. */
  mayRedistribute: boolean;
}

export interface ParcelMatch {
  by: "apn" | "boundary-contains" | "nearest-centroid";
  /** Present for a centroid match — how far the tap was from the centroid. */
  distanceMeters?: number;
  /** True when the match is proximity-based rather than geometric containment. */
  approximate: boolean;
}

export interface ParcelIdentifyResult {
  status: ParcelIdentifyStatus;
  state: string | null;
  county: string | null;
  apn: string | null;
  snapshotId: number | null;
  /**
   * The matched parcel's own centroid, when the row records one. Carried so a
   * quick action can hand REAL coordinates to the existing Add-Property flow
   * (/properties?addAtLat=…&addAtLng=…) instead of the surface inventing a
   * location. Null means we hold no centroid — the action then opens the flow
   * without a location rather than guessing one.
   */
  centroid: { lat: number; lng: number } | null;
  match: ParcelMatch | null;
  facts: ParcelFact[];
  provenance: ParcelProvenance | null;
  /** Whether the CALLER'S org already tracks this parcel. */
  tracked: boolean;
  /** The tables this call actually read, so a negative claim is auditable. */
  inspected: ParcelIdentifySource[];
  /**
   * Prefill for the existing RequestCountyCTA, and null when a coverage
   * request would be the wrong offer (covered county, failed read). A CTA that
   * misdescribes the situation is worse than no CTA.
   */
  requestCoverage: { state: string | null; county: string | null } | null;
  message: string;
}

export interface IdentifyParcelInput {
  organizationId: number;
  state?: string | null;
  county?: string | null;
  apn?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * How far from a cached centroid a tap may land and still be called a match,
 * when we hold no boundary to test containment against. 400 m is roughly the
 * long edge of a quarter-quarter section — beyond it, calling the nearest
 * cached parcel "the one you tapped" stops being defensible.
 */
const CENTROID_MATCH_LIMIT_METERS = 400;

/**
 * Half-width of the SQL bounding box used to fetch candidate rows for a
 * lat/lng tap. 0.25° is ~27 km — far wider than CENTROID_MATCH_LIMIT_METERS,
 * deliberately: the box also has to catch a LARGE parcel whose recorded
 * centroid sits kilometres from the point the customer tapped inside it. It is
 * a candidate filter, never the match test; containment and distance are still
 * decided per row below.
 */
const POINT_CANDIDATE_BOX_DEGREES = 0.25;

/** Upper bound on candidate rows pulled for geometry testing. */
const POINT_CANDIDATE_LIMIT = 200;

/**
 * Upper bound on rows pulled for an APN lookup. An APN is unique within a
 * county, so more than a handful of hits means the normalized form collided
 * across counties — which is a disambiguation problem, not a deeper-read one.
 */
const APN_CANDIDATE_LIMIT = 25;

const EARTH_RADIUS_METERS = 6_371_000;

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ray-casting point-in-ring, [lng, lat] order (GeoJSON). */
function pointInRing(point: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    const intersects =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Containment against a Polygon/MultiPolygon, honouring holes. */
function pointInBoundary(point: [number, number], boundary: unknown): boolean {
  if (!boundary || typeof boundary !== "object") return false;
  const geom = boundary as { type?: string; coordinates?: unknown };
  const polygons: number[][][][] =
    geom.type === "MultiPolygon"
      ? ((geom.coordinates as number[][][][]) ?? [])
      : geom.type === "Polygon"
        ? [((geom.coordinates as number[][][]) ?? [])]
        : [];

  for (const rings of polygons) {
    if (!rings?.length) continue;
    if (!pointInRing(point, rings[0])) continue;
    // Inside the outer ring — reject if it falls in a hole.
    const inHole = rings.slice(1).some((hole) => pointInRing(point, hole));
    if (!inHole) return true;
  }
  return false;
}

/** The facts the inspector shows, in the order it shows them. */
const FACT_FIELDS: ReadonlyArray<{
  key: string;
  label: string;
  pick: (row: Record<string, any>) => unknown;
}> = [
  { key: "owner", label: "Owner of record", pick: (r) => r.owner },
  { key: "apn", label: "Parcel number (APN)", pick: (r) => r.apn },
  { key: "acres", label: "Acres", pick: (r) => r.acres },
  { key: "assessedValue", label: "Assessed value", pick: (r) => r.assessedValue },
  { key: "siteAddress", label: "Site address", pick: (r) => r.siteAddress },
  { key: "landUse", label: "Land use", pick: (r) => r.landUse },
  { key: "zoning", label: "Zoning", pick: (r) => r.zoning },
];

const NOT_RECORDED_LABEL = "Not recorded in the data we hold for this parcel";

function buildFacts(row: Record<string, any>): ParcelFact[] {
  return FACT_FIELDS.map(({ key, label, pick }) => {
    const raw = pick(row);
    const value =
      raw === null || raw === undefined || String(raw).trim() === ""
        ? null
        : String(raw);
    return {
      key,
      label,
      value,
      // In-app display of the org's own cache withholds nothing, so an empty
      // value can only ever mean the column is empty. The "withheld" arm is
      // NOT reachable from here by design — see the module header.
      absence: value === null ? ("not-recorded" as const) : null,
      absenceLabel: value === null ? NOT_RECORDED_LABEL : "",
    };
  });
}

function buildProvenance(
  row: Record<string, any>,
  reviewedPostures?: Record<string, EgressResolution["posture"]>,
): ParcelProvenance {
  const resolution = resolveEgressLicense(row.source, reviewedPostures);
  const fetchedAt = row.fetchedAt ? new Date(row.fetchedAt) : null;
  return {
    source: typeof row.source === "string" && row.source.trim() ? row.source : "unknown",
    retrievedAt:
      fetchedAt && !Number.isNaN(fetchedAt.getTime()) ? fetchedAt.toISOString() : null,
    vintageYear: typeof row.taxYear === "number" ? row.taxYear : null,
    posture: resolution.posture,
    postureReason: resolution.reason,
    attribution: resolution.attributionText ?? null,
    // One predicate for "may this leave the platform", shared with every other
    // egress decision in the codebase — not a second copy that can drift.
    mayRedistribute: postureMayLeave(resolution.posture),
  };
}

// ─── SQL predicate helpers ──────────────────────────────────────────────────

/**
 * The shared cache plus this org's own private rows — never another tenant's.
 * `parcel_snapshots.organization_id` is NULL for the shared cache.
 */
function orgVisibleSnapshots(organizationId: number) {
  return or(
    isNull(parcelSnapshots.organizationId),
    eq(parcelSnapshots.organizationId, organizationId),
  );
}

/** county comparison, normalized on BOTH sides (gisRepo house pattern). */
function countyMatches(column: AnyColumn, normalizedCounty: string) {
  return sql`LOWER(REPLACE(TRIM(${column}), ' County', '')) = ${normalizedCounty}`;
}

/** state comparison, normalized on BOTH sides. */
function stateMatches(column: AnyColumn, normalizedState: string) {
  return sql`UPPER(TRIM(${column})) = ${normalizedState}`;
}

/** apn comparison, punctuation- and case-insensitive (gisRepo house pattern). */
function apnMatches(column: AnyColumn, apn: string) {
  return sql`LOWER(REPLACE(REPLACE(${column}, '-', ''), ' ', '')) = ${apn
    .replace(/[-\s]/g, "")
    .toLowerCase()}`;
}

/** Candidate box around a tapped point, evaluated on the jsonb centroid. */
function centroidInBox(lat: number, lng: number) {
  const d = POINT_CANDIDATE_BOX_DEGREES;
  return sql`(${parcelSnapshots.centroid}->>'lat')::float8 BETWEEN ${lat - d} AND ${
    lat + d
  } AND (${parcelSnapshots.centroid}->>'lng')::float8 BETWEEN ${lng - d} AND ${lng + d}`;
}

/**
 * Squared planar distance from the tapped point to a row's recorded centroid,
 * for ORDERING only. Squared (no sqrt) and planar (no cos-latitude correction)
 * because ordering is monotonic under both — the exact metre distance is
 * computed per row in JS by `haversineMeters`, which is what decides a match.
 * Cheap to evaluate, and it makes `POINT_CANDIDATE_LIMIT` a bound on work
 * rather than a bound on correctness.
 */
function centroidDistanceSq(lat: number, lng: number) {
  return sql`power((${parcelSnapshots.centroid}->>'lat')::float8 - ${lat}, 2) + power((${parcelSnapshots.centroid}->>'lng')::float8 - ${lng}, 2)`;
}

/**
 * Does this row agree with the point the customer actually tapped?
 *
 * Used to corroborate an APN match, which carries no geographic predicate of
 * its own. Containment settles it outright; failing that, the recorded
 * centroid has to be within the same radius the centroid path would accept.
 * A row with neither a boundary nor a usable centroid cannot corroborate
 * anything, so it does not — silence is not agreement.
 */
function corroboratesPoint(row: Record<string, any>, lat: number, lng: number): boolean {
  if (pointInBoundary([lng, lat], row.boundary)) return true;
  const c = row.centroid as { lat: number; lng: number } | null;
  if (!c || typeof c.lat !== "number" || typeof c.lng !== "number") return false;
  return haversineMeters({ lat, lng }, c) <= CENTROID_MATCH_LIMIT_METERS;
}

function emptyResult(
  status: ParcelIdentifyStatus,
  over: Partial<ParcelIdentifyResult> & { message: string },
): ParcelIdentifyResult {
  return {
    status,
    state: null,
    county: null,
    apn: null,
    snapshotId: null,
    centroid: null,
    match: null,
    facts: [],
    provenance: null,
    tracked: false,
    inspected: [],
    requestCoverage: null,
    ...over,
  };
}

/**
 * Identify a parcel from what we already hold.
 *
 * Accepts either an explicit (state, county, apn) — the "tapped a parcel whose
 * identity the map already knew" path — or a bare (lat, lng) tap. The lat/lng
 * path resolves the county FROM THE MATCHED ROW rather than from a client
 * hint: a hint would let a tap 200 miles from the selected property produce a
 * confident, wrong sentence about a county nobody looked at.
 */
export async function identifyParcel(
  input: IdentifyParcelInput,
): Promise<ParcelIdentifyResult> {
  const state = input.state ? normalizeState(input.state) : null;
  const county = input.county ? normalizeCounty(input.county) : null;
  const apn = input.apn?.trim() || null;
  const hasPoint =
    typeof input.lat === "number" &&
    typeof input.lng === "number" &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng);

  if (!apn && !hasPoint) {
    return emptyResult("location-unidentified", {
      requestCoverage: { state: null, county: null },
      message:
        "We need either a parcel number or a point on the map to identify a parcel.",
    });
  }

  /**
   * Built from the reads that actually ran. This is what makes the "we checked
   * both" claim auditable rather than decorative — if a future edit drops one
   * of the two coverage reads, this array stops naming it and the exit test
   * goes red.
   */
  const inspected: ParcelIdentifySource[] = [];
  const noteRead = (source: ParcelIdentifySource) => {
    if (!inspected.includes(source)) inspected.push(source);
  };

  try {
    const reader = await dbForReads("parcel-identify");
    const visible = orgVisibleSnapshots(input.organizationId);

    // ── Match ──────────────────────────────────────────────────────────────
    let matched: Record<string, any> | null = null;
    let match: ParcelMatch | null = null;
    // Set when an APN hit several rows we could not tell apart. Reported as a
    // miss with its own sentence rather than resolved by picking one.
    let apnAmbiguous = false;
    // The nearest parcel we hold to the tapped point, matched or not. Only
    // used to establish WHICH COUNTY the tap was in when the caller named
    // none — never to answer as if it were the parcel the customer tapped.
    let nearestRow: Record<string, any> | null = null;

    if (apn) {
      noteRead("parcel_snapshots");
      const byApn = (await reader
        .select()
        .from(parcelSnapshots)
        .where(
          and(
            visible,
            apnMatches(parcelSnapshots.apn, apn),
            ...(state ? [stateMatches(parcelSnapshots.state, state)] : []),
            ...(county ? [countyMatches(parcelSnapshots.county, county)] : []),
          ),
        )
        .limit(APN_CANDIDATE_LIMIT)) as Record<string, any>[];

      // An APN is unique only WITHIN a county, and `apnMatches` strips hyphens
      // and spaces and lowercases — so with no state/county predicate this
      // query can return several real parcels in different counties. Taking
      // [0] of an unordered read then presented a DIFFERENT county's owner,
      // acres and assessed value as `by: "apn", approximate: false` — the
      // strongest confidence this API can express, attached to the wrong
      // parcel, and the quick actions would have carried that row onward.
      //
      // So when we have the tapped point, the APN must agree with it: the row
      // has to contain the point or sit within the same radius the centroid
      // path uses. A row that cannot be corroborated is not a confident match,
      // and we fall through to the point path rather than guess between them.
      const apnCandidates = hasPoint
        ? byApn.filter((r) =>
            corroboratesPoint(r, input.lat as number, input.lng as number),
          )
        : byApn;

      // Ambiguity that survives corroboration is reported as no APN match at
      // all: two rows we cannot tell apart is not a fact about one of them.
      if (apnCandidates.length === 1) {
        matched = apnCandidates[0];
        match = { by: "apn", approximate: false };
      } else if (apnCandidates.length > 1 && !hasPoint) {
        apnAmbiguous = true;
      }
    }

    if (!matched && hasPoint) {
      const lat = input.lat as number;
      const lng = input.lng as number;
      noteRead("parcel_snapshots");
      // A bounded candidate box, not the whole cache — see the module header
      // on why an unpredicated read is an honesty problem, not just a perf one.
      //
      // ORDERED BY DISTANCE, and that ordering is load-bearing rather than
      // cosmetic. The box is ~27 km a side; any county with real coverage
      // holds far more than POINT_CANDIDATE_LIMIT parcels inside it, so an
      // unordered `.limit()` returned an ARBITRARY slice and a parcel we
      // genuinely hold could render as "we could not identify a parcel" — a
      // false negative that appears only once coverage is real, which is the
      // worst time to discover it. Nearest-first makes the centroid match
      // exact: if the true match is within CENTROID_MATCH_LIMIT_METERS it is
      // necessarily inside the nearest N rows.
      const candidates = (await reader
        .select()
        .from(parcelSnapshots)
        .where(and(visible, centroidInBox(lat, lng)))
        .orderBy(centroidDistanceSq(lat, lng))
        .limit(POINT_CANDIDATE_LIMIT)) as Record<string, any>[];

      // Ordered nearest-first above, so candidates[0] is genuinely the closest
      // parcel we hold — the honest basis for naming the county on a miss.
      nearestRow = candidates[0] ?? null;

      const point: [number, number] = [lng, lat];
      const contained = candidates.find((r) => pointInBoundary(point, r.boundary));
      if (contained) {
        matched = contained;
        match = { by: "boundary-contains", approximate: false };
      } else {
        let best: { row: Record<string, any>; d: number } | null = null;
        for (const row of candidates) {
          const c = row.centroid as { lat: number; lng: number } | null;
          if (!c || typeof c.lat !== "number" || typeof c.lng !== "number") continue;
          const d = haversineMeters({ lat, lng }, c);
          if (d <= CENTROID_MATCH_LIMIT_METERS && (!best || d < best.d)) {
            best = { row, d };
          }
        }
        if (best) {
          matched = best.row;
          match = {
            by: "nearest-centroid",
            distanceMeters: Math.round(best.d),
            // We hold no boundary, so we cannot claim the tap landed on it.
            approximate: true,
          };
        }
      }
    }

    // ── Hit ────────────────────────────────────────────────────────────────
    if (matched) {
      const rowState = normalizeState(String(matched.state ?? ""));
      const rowCounty = normalizeCounty(String(matched.county ?? ""));
      const rowApn = String(matched.apn ?? "").trim() || null;

      // The county's own recorded licence review, if there is one. Read for
      // the matched county only — and it is a REVIEW, so it can only settle a
      // source the register left open (licenseEgress enforces that asymmetry).
      let reviewedPostures: Record<string, EgressResolution["posture"]> | undefined;
      if (rowState && rowCounty) {
        noteRead("county_gis_endpoints");
        const [endpoint] = (await reader
          .select()
          .from(countyGisEndpoints)
          .where(
            and(
              stateMatches(countyGisEndpoints.state, rowState),
              countyMatches(countyGisEndpoints.county, rowCounty),
            ),
          )
          .limit(1)) as Record<string, any>[];
        const reviewed = endpoint?.redistributable;
        if (
          typeof matched.source === "string" &&
          matched.source.trim() &&
          (reviewed === "yes" ||
            reviewed === "attribution" ||
            reviewed === "no" ||
            reviewed === "review-required")
        ) {
          reviewedPostures = { [matched.source]: reviewed };
        }
      }

      // Tracking is asked as a single org-scoped question, not filtered out of
      // a page of other tenants' rows.
      let tracked = false;
      if (rowState && rowCounty && rowApn) {
        const [mine] = (await reader
          .select()
          .from(trackedParcels)
          .where(
            and(
              eq(trackedParcels.organizationId, input.organizationId),
              eq(trackedParcels.state, rowState),
              eq(trackedParcels.county, rowCounty),
              eq(trackedParcels.apn, rowApn),
            ),
          )
          .limit(1)) as Record<string, any>[];
        tracked = Boolean(mine);
      }

      return {
        status: "identified",
        state: rowState || null,
        county: rowCounty || null,
        apn: rowApn,
        snapshotId: typeof matched.id === "number" ? matched.id : null,
        centroid:
          matched.centroid &&
          typeof matched.centroid.lat === "number" &&
          typeof matched.centroid.lng === "number"
            ? { lat: matched.centroid.lat, lng: matched.centroid.lng }
            : null,
        match,
        facts: buildFacts(matched),
        provenance: buildProvenance(matched, reviewedPostures),
        tracked,
        inspected,
        requestCoverage: null,
        message: "",
      };
    }

    // ── Establish the county from what we hold, if the caller named none ───
    //
    // The only production caller is a map tap, which sends `{lat, lng, apn}`
    // and no state/county — deliberately, so a client hint can never produce a
    // confident sentence about a county nobody looked at. That instinct is
    // right, but taken alone it made this branch swallow EVERY miss: the two
    // coverage answers below were unreachable in production, and a covered
    // county fell through to a "request coverage" CTA for a county we already
    // cover. Reconstructing the county SERVER-SIDE from the nearest parcel we
    // actually hold keeps the honesty (the answer still comes from our own
    // data, never from the client) while making the coverage question
    // answerable from a bare point.
    let resolvedState = state;
    let resolvedCounty = county;
    if ((resolvedState === null || resolvedCounty === null) && nearestRow) {
      const ns = normalizeState(String(nearestRow.state ?? ""));
      const nc = normalizeCounty(String(nearestRow.county ?? ""));
      // Both or neither — half a location is not a location.
      if (ns && nc) {
        resolvedState = resolvedState ?? ns;
        resolvedCounty = resolvedCounty ?? nc;
      }
    }

    // ── Miss, and no county was ever established ───────────────────────────
    if (resolvedState === null || resolvedCounty === null) {
      return emptyResult("location-unidentified", {
        inspected,
        // Deliberately blank: we never learned which county this is, so the CTA
        // must not be prefilled with a guess, and the copy must not name one.
        requestCoverage: { state: null, county: null },
        message: apnAmbiguous
          ? "We hold more than one parcel with that number and cannot tell which one you tapped. Tell us where you are working and we will pull the right records."
          : "We could not identify a parcel at this point from the parcel data we hold. Tell us where you are working and we will go and get it.",
      });
    }

    // ── Miss with a known county: is the county covered? BOTH directions. ──
    noteRead("county_gis_endpoints");
    const activeEndpoints = (await reader
      .select()
      .from(countyGisEndpoints)
      .where(
        and(
          stateMatches(countyGisEndpoints.state, resolvedState),
          countyMatches(countyGisEndpoints.county, resolvedCounty),
          eq(countyGisEndpoints.isActive, true),
        ),
      )
      .limit(1)) as Record<string, any>[];
    const hasActiveEndpoint = activeEndpoints.length > 0;

    // A county we hold cached parcels for IS covered, endpoint row or not.
    // Checking only the endpoint register is the one-direction check that
    // manufactures a false "we don't cover this".
    noteRead("parcel_snapshots");
    const countyRows = (await reader
      .select()
      .from(parcelSnapshots)
      .where(
        and(
          visible,
          stateMatches(parcelSnapshots.state, resolvedState),
          countyMatches(parcelSnapshots.county, resolvedCounty),
        ),
      )
      .limit(1)) as Record<string, any>[];
    const hasCachedParcels = countyRows.length > 0;

    if (hasActiveEndpoint || hasCachedParcels) {
      return emptyResult("county-covered-no-parcel", {
        state: resolvedState,
        county: resolvedCounty,
        apn,
        inspected,
        // Covered county — a coverage request would misdescribe the situation.
        requestCoverage: null,
        message:
          "We cover this county, but we have not pulled this particular parcel yet.",
      });
    }

    return emptyResult("county-not-covered", {
      state: resolvedState,
      county: resolvedCounty,
      apn,
      inspected,
      requestCoverage: {
        state: input.state ?? resolvedState,
        county: input.county ?? resolvedCounty,
      },
      message:
        "We do not have parcel data for this county yet. Request it and we will prioritise it.",
    });
  } catch (err) {
    logger.error(
      "parcelIdentify: read failed",
      err instanceof Error ? err : new Error(String(err)),
    );
    // A failed read is a failure. Collapsing it into "this county has no data"
    // would fabricate a negative about coverage we never actually checked.
    return emptyResult("lookup-failed", {
      state: input.state ?? null,
      county: input.county ?? null,
      apn,
      inspected: [],
      message:
        "We could not read the parcel data just now, so we cannot say what we hold for this location. Try again in a moment.",
    });
  }
}

// ─── Tracking ───────────────────────────────────────────────────────────────

export interface TrackParcelInput {
  organizationId: number;
  state: string;
  county: string;
  apn: string;
  parcelSnapshotId?: number | null;
  trackedByUserId?: string | null;
  note?: string | null;
}

export interface TrackParcelResult {
  tracked: boolean;
  /** True when the row already existed — a second tap is a no-op, not an error. */
  alreadyTracked: boolean;
  id: number | null;
}

/**
 * Track a parcel for an org. Idempotent by the unique index on
 * (organization_id, state, county, apn): a collision returns zero rows from
 * onConflictDoNothing, which we read as "already tracked" rather than as a
 * failure, so a double-tap is genuinely harmless.
 */
export async function trackParcel(input: TrackParcelInput): Promise<TrackParcelResult> {
  const state = normalizeState(input.state);
  const county = normalizeCounty(input.county);
  const apn = input.apn.trim();

  const inserted = (await db
    .insert(trackedParcels)
    .values({
      organizationId: input.organizationId,
      state,
      county,
      apn,
      parcelSnapshotId: input.parcelSnapshotId ?? null,
      trackedByUserId: input.trackedByUserId ?? null,
      note: input.note ?? null,
    })
    .onConflictDoNothing()
    .returning()) as Record<string, any>[];

  if (inserted.length > 0) {
    return { tracked: true, alreadyTracked: false, id: Number(inserted[0].id) };
  }
  return { tracked: true, alreadyTracked: true, id: null };
}

export interface UntrackParcelResult {
  untracked: boolean;
}

/** Stop tracking. Scoped to the caller's org — never a bare parcel-key delete. */
export async function untrackParcel(input: {
  organizationId: number;
  state: string;
  county: string;
  apn: string;
}): Promise<UntrackParcelResult> {
  const removed = (await db
    .delete(trackedParcels)
    .where(
      and(
        eq(trackedParcels.organizationId, input.organizationId),
        eq(trackedParcels.state, normalizeState(input.state)),
        eq(trackedParcels.county, normalizeCounty(input.county)),
        eq(trackedParcels.apn, input.apn.trim()),
      ),
    )
    .returning()) as Record<string, any>[];

  return { untracked: removed.length > 0 };
}

/*
 * A `listTrackedParcels` reader lived here and was removed during fleet-12b
 * integration. It was correct code — org-scoped at the query, ordered, capped
 * — but nothing read it: no client surface fetched the endpoint it backed, and
 * the reachability linters could not see the gap because the export fed a
 * route handler and the route file was registered. It comes back with the
 * watch-list surface that needs it, not before.
 *
 * The tracking WRITE path above is genuinely wired: `trackParcel`/
 * `untrackParcel` are called by the inspector, and `identifyParcel` reads the
 * tracked row to render the toggle state.
 */
