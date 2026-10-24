/**
 * D2f — historical-use screening source adapters.
 *
 * The EPA adapters wrap the broker's existing calls (dataSourceBroker.lookup
 * "epa_frs" and "environmental" in server/services/data-source-broker.ts); the
 * broker is not modified here. What the broker returns limits what we may
 * claim, and each adapter says so in its coverage statement and its
 * absenceEligibility:
 *
 *   - EPA FRS: itemised facilities with REGISTRY_ID and coordinates, but the
 *     broker queries ACTIVE facilities only (p_act=Y), keeps the first 20, and
 *     turns a response with no Results.FRSFacility into an empty list — so an
 *     empty FRS answer cannot be told apart from an error answer. Records it
 *     returns are citable; its emptiness is not an absence.
 *   - EPA ECHO: the broker keeps only CVRows (facilities currently in
 *     violation within 3 mi). A count, never records: >0 is an unitemized
 *     signal, 0 is a narrow statement about current violations.
 *   - EPA UST Finder: the broker keeps only a count within 1 mi.
 *
 * No adapter here has a recorded positive control yet (this build container
 * cannot reach EPA hosts), so none may turn an empty answer into a verified
 * absence: today every empty answer is inconclusive. Recording one positive
 * control per adapter is the go-live step (docs/land-data/INTEGRATION-D2f.md).
 *
 * Sources whose licence is unresolved, or for which no adapter exists, are
 * listed in KNOWN_UNSCREENED_SOURCES and reported on every verdict — they ship
 * as a disclosure, never as fetch code.
 */

import { createHash } from "node:crypto";
import { dataSourceBroker, type DataSourceBroker, type LookupCategory } from "../data-source-broker";
import { clock } from "../../utils/clock";
import {
  runHistoricalUseScreening,
  type AdverseFinding,
  type CoverageStatement,
  type HistoricalUseSourceAdapter,
  type NotScreenedEntry,
  type ParcelSubject,
  type QueryGeometry,
  type QueryReceipt,
  type ScreeningCategory,
  type ScreeningVerdict,
  type SourceOutcome,
} from "./historicalUse";

type BrokerLookupResult = Awaited<ReturnType<DataSourceBroker["lookup"]>>;
type BrokerLookupFn = (
  category: Extract<LookupCategory, "epa_frs" | "environmental">,
  options: { latitude: number; longitude: number; state?: string; county?: string },
) => Promise<BrokerLookupResult>;

/** Radii are the broker's own (queryEpaFrs / queryEpaData); not ours to change. */
const FRS_RADIUS_MILES = 5;
const ECHO_RADIUS_MILES = 3;
const UST_RADIUS_MILES = 1;
const FRS_BROKER_CAP = 20;

const US_STATES = new Set(
  (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY " +
    "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
  ).split(" "),
);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.7613 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** One broker call per category per screening run, shared by the adapters that read it. */
function memoLookup(lookup: BrokerLookupFn): BrokerLookupFn {
  const memo = new Map<string, Promise<BrokerLookupResult>>();
  return (category, options) => {
    const key = `${category}:${options.latitude}:${options.longitude}`;
    let p = memo.get(key);
    if (!p) {
      p = lookup(category, options);
      memo.set(key, p);
    }
    return p;
  };
}

interface BrokerAnswer {
  data: Record<string, unknown>;
  receipt: QueryReceipt;
}

async function askBroker(
  lookup: BrokerLookupFn,
  category: Extract<LookupCategory, "epa_frs" | "environmental">,
  subject: ParcelSubject,
): Promise<BrokerAnswer | { failure: string; attemptedAt: string }> {
  const requestedAt = clock.now().toISOString();
  const request = `dataSourceBroker.lookup("${category}", lat=${subject.centroid.lat}, lng=${subject.centroid.lng}, state=${subject.state})`;
  let result: BrokerLookupResult;
  try {
    result = await lookup(category, {
      latitude: subject.centroid.lat,
      longitude: subject.centroid.lng,
      state: subject.state,
      county: subject.county,
    });
  } catch (err) {
    return { failure: err instanceof Error ? err.message : String(err), attemptedAt: requestedAt };
  }
  const respondedAt = clock.now().toISOString();
  const data = asRecord(result.data);
  if (!result.success || !data) {
    const why = result.fallbacksUsed.length > 0 ? result.fallbacksUsed.join("; ") : "broker returned no data";
    return { failure: why, attemptedAt: requestedAt };
  }
  const cachedAt = result.fromCache && result.cachedAt ? new Date(result.cachedAt).toISOString() : null;
  return {
    data,
    receipt: {
      request,
      requestedAt,
      respondedAt,
      servedFromCache: result.fromCache,
      dataAsOf: cachedAt ?? respondedAt,
      responseSha256: sha256(result.data),
      upstreamTitle: result.source.title,
      notes: result.fallbacksUsed,
    },
  };
}

function radius(subject: ParcelSubject, radiusMiles: number): QueryGeometry {
  return { kind: "point_radius", center: { ...subject.centroid }, radiusMiles };
}

function federal(subject: ParcelSubject): boolean {
  return US_STATES.has(subject.state);
}

/** FRS program acronyms (INTEREST_TYPES) → screening category. */
function frsCategory(programs: string[]): ScreeningCategory {
  const has = (re: RegExp) => programs.some((p) => re.test(p));
  if (has(/CERCLA|NPL|SEMS|SUPERFUND/i)) return "superfund";
  if (has(/BROWNFIELD|ACRES/i)) return "brownfields";
  if (has(/RCRA|HSWA|HAZARDOUS WASTE/i)) return "rcra";
  if (has(/\bTRI\b|TOXIC/i)) return "toxics_release";
  return "federal_facility_registry";
}

function frsAdapter(lookup: BrokerLookupFn): HistoricalUseSourceAdapter {
  const sourceId = "epa_frs";
  return {
    sourceId,
    title: "EPA Facility Registry Service (via broker)",
    licenseSource: "EPA FRS",
    categories: ["federal_facility_registry", "superfund", "brownfields", "rcra", "toxics_release"],
    absenceEligibility: {
      eligible: false,
      reason:
        "the broker turns an FRS response without Results.FRSFacility into an empty list, so an empty answer cannot be told from an error answer; and no positive control has been recorded",
    },
    appliesTo: federal,
    async query(subject): Promise<SourceOutcome> {
      const answer = await askBroker(lookup, "epa_frs", subject);
      if ("failure" in answer) return { status: "unreachable", reason: answer.failure, attemptedAt: answer.attemptedAt };
      const geometry = radius(subject, FRS_RADIUS_MILES);
      const coverage: CoverageStatement = {
        geographic: `${FRS_RADIUS_MILES}-mile radius of the parcel centroid (nationwide registry)`,
        temporal: `facilities FRS flags as active (p_act=Y), as of ${answer.receipt.dataAsOf}; inactive and historical facilities are not included`,
        scope: "EPA FRS facility registry, all EPA programs",
        limitations: [
          `broker keeps the first ${FRS_BROKER_CAP} facilities`,
          "an FRS record is a regulated-facility registration, not a contamination finding",
        ],
      };
      const raw = answer.data.facilities;
      if (!Array.isArray(raw)) {
        return { status: "unreachable", reason: "broker FRS answer has no facilities list", attemptedAt: answer.receipt.requestedAt };
      }
      if (raw.length === 0) return { status: "no_records", geometry, coverage, receipt: answer.receipt };
      const findings: AdverseFinding[] = raw.map((item): AdverseFinding => {
        const f = asRecord(item) ?? {};
        const programs = Array.isArray(f.programs) ? f.programs.filter((p): p is string => typeof p === "string") : [];
        const lat = typeof f.latitude === "number" && Number.isFinite(f.latitude) ? f.latitude : null;
        const lng = typeof f.longitude === "number" && Number.isFinite(f.longitude) ? f.longitude : null;
        const sourceFields: Record<string, string> = {};
        const name = str(f.name);
        const id = str(f.id);
        if (id) sourceFields.REGISTRY_ID = id;
        if (name) sourceFields.FACILITY_NAME = name;
        if (programs.length > 0) sourceFields.INTEREST_TYPES = programs.join(", ");
        const city = str(f.city);
        const state = str(f.state);
        if (city) sourceFields.CITY_NAME = city;
        if (state) sourceFields.STATE_CODE = state;
        if (lat !== null) sourceFields.LATITUDE83 = String(lat);
        if (lng !== null) sourceFields.LONGITUDE83 = String(lng);
        return {
          sourceId,
          category: frsCategory(programs),
          recordId: id ?? "",
          recordName: name,
          relationship: {
            kind: "within_query_radius",
            radiusMiles: FRS_RADIUS_MILES,
            distanceMiles:
              lat !== null && lng !== null
                ? Math.round(haversineMiles(subject.centroid.lat, subject.centroid.lng, lat, lng) * 100) / 100
                : null,
          },
          asOf: answer.receipt.dataAsOf,
          recordDate: null,
          sourceFields,
          synthetic: subject.synthetic === true || undefined,
        };
      });
      return {
        status: "records_found",
        findings,
        geometry,
        coverage,
        receipt: answer.receipt,
        truncated: raw.length >= FRS_BROKER_CAP,
      };
    },
  };
}

function countAdapter(
  lookup: BrokerLookupFn,
  spec: {
    sourceId: string;
    title: string;
    licenseSource: string;
    categories: readonly ScreeningCategory[];
    field: "echoFacilitiesWithViolations" | "ustSitesNearby";
    radiusMiles: number;
    coverage: (asOf: string) => CoverageStatement;
    ineligibleReason: string;
  },
): HistoricalUseSourceAdapter {
  return {
    sourceId: spec.sourceId,
    title: spec.title,
    licenseSource: spec.licenseSource,
    categories: spec.categories,
    absenceEligibility: { eligible: false, reason: spec.ineligibleReason },
    appliesTo: federal,
    async query(subject): Promise<SourceOutcome> {
      const answer = await askBroker(lookup, "environmental", subject);
      if ("failure" in answer) return { status: "unreachable", reason: answer.failure, attemptedAt: answer.attemptedAt };
      const value = answer.data[spec.field];
      const geometry = radius(subject, spec.radiusMiles);
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        const note = str(answer.data.note) ?? `broker returned no ${spec.field}`;
        return { status: "unreachable", reason: note, attemptedAt: answer.receipt.requestedAt };
      }
      if (value > 0) return { status: "unitemized_signal", count: value, geometry, receipt: answer.receipt };
      return { status: "no_records", geometry, coverage: spec.coverage(answer.receipt.dataAsOf), receipt: answer.receipt };
    },
  };
}

/** The EPA adapters over one broker lookup function. Test seam: tests pass a fake lookup. */
export function createEpaBrokerAdapters(lookup: BrokerLookupFn): HistoricalUseSourceAdapter[] {
  const shared = memoLookup(lookup);
  return [
    frsAdapter(shared),
    countAdapter(shared, {
      sourceId: "epa_echo_current_violations",
      title: "EPA ECHO — facilities currently in violation (via broker)",
      licenseSource: "EPA ECHO",
      categories: ["federal_enforcement"],
      field: "echoFacilitiesWithViolations",
      radiusMiles: ECHO_RADIUS_MILES,
      coverage: (asOf) => ({
        geographic: `${ECHO_RADIUS_MILES}-mile radius of the parcel centroid (nationwide)`,
        temporal: `facilities in violation at the time of the query, as of ${asOf}; past violations are not included`,
        scope: "EPA ECHO facilities currently in violation (CVRows); facilities not in violation are not counted",
        limitations: ["count only — the broker keeps no facility records"],
      }),
      ineligibleReason: "no positive control has been recorded for the broker's ECHO query",
    }),
    countAdapter(shared, {
      sourceId: "epa_ust_finder",
      title: "EPA UST Finder (via broker)",
      licenseSource: "EPA UST Finder",
      categories: ["state_tank_release"],
      field: "ustSitesNearby",
      radiusMiles: UST_RADIUS_MILES,
      coverage: (asOf) => ({
        geographic: `${UST_RADIUS_MILES}-mile radius of the parcel centroid (state-submitted national composite)`,
        temporal: `queried ${asOf}; the composite's own data vintage is not returned by the query`,
        scope: "EPA UST Finder layer 0 as queried by the broker (layer identity not verified in this build)",
        limitations: ["count only — the broker keeps no tank or release records", "states submit voluntarily"],
      }),
      ineligibleReason:
        "no positive control has been recorded, and which UST Finder layer (facilities vs releases) the broker counts is not verified",
    }),
  ];
}

/**
 * Sources we know of and do not query. Each is disclosed on every verdict.
 * Licence positions: docs/land-data/d2f-historical-use-screening.md §4.
 */
const KNOWN_UNSCREENED_SOURCES: readonly NotScreenedEntry[] = [
  {
    sourceId: "epa_tri",
    title: "EPA Toxics Release Inventory",
    categories: ["toxics_release"],
    reason:
      'licence unresolved: "EPA TRI" has no data-licence register entry; and the broker\'s Envirofacts query shape is unverified',
  },
  {
    sourceId: "epa_sems",
    title: "EPA SEMS (Superfund, incl. archived sites)",
    categories: ["superfund"],
    reason: "no adapter: the broker does not query SEMS directly (FRS active-only stands in)",
  },
  {
    sourceId: "epa_acres",
    title: "EPA ACRES (Brownfields)",
    categories: ["brownfields"],
    reason: "no adapter and no data-licence register entry",
  },
  {
    sourceId: "epa_rcrainfo",
    title: "EPA RCRAInfo (incl. inactive handlers)",
    categories: ["rcra"],
    reason: "no adapter in the broker and no data-licence register entry",
  },
  {
    sourceId: "state_tank_registry",
    title: "State UST/LUST registry",
    categories: ["state_tank_release", "state_contaminated_sites"],
    reason: "licence unresolved for every wave-1 state registry (NC, IN, OH, WI, AR, MT)",
  },
  {
    sourceId: "historical_aerials",
    title: "Historical aerial photography",
    categories: ["historical_aerial"],
    reason: "no source exists in AcreOS",
  },
  {
    sourceId: "usgs_htmc",
    title: "USGS Historical Topographic Map Collection",
    categories: ["historical_topo"],
    reason: "no adapter and no data-licence register entry; USGS hosts unreachable from the build container",
  },
];

/**
 * Production entry point: screen one parcel against every applicable source.
 * Not yet mounted — routes and the Pax tool are proposals in
 * docs/land-data/INTEGRATION-D2f.md.
 */
export async function screenParcelHistoricalUse(
  subject: ParcelSubject,
  lookup: BrokerLookupFn = (category, options) => dataSourceBroker.lookup(category, options),
): Promise<ScreeningVerdict> {
  return runHistoricalUseScreening(subject, createEpaBrokerAdapters(lookup), {
    now: () => clock.now(),
    knownUnscreened: KNOWN_UNSCREENED_SOURCES,
  });
}
