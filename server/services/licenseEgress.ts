/**
 * licenseEgress.ts — the license-aware egress chokepoint.
 *
 * WHY THIS EXISTS
 * ---------------
 * `data-licenses.ts` already answers "may we CACHE and re-serve this source?"
 * and the provider registry consults it before writing `provider_cache`.
 * Nothing answered the other half of the same question: "may this datum LEAVE
 * the platform?" — through a CSV/JSON export, a public parcel report, a
 * founder market report, an MCP tool result, or an outbound webhook. A field
 * whose vendor contract says `redistributable: "no"` (ATTOM, Regrid,
 * BatchData) could ride out of any of those doors unexamined.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * One chokepoint every egress surface calls. Given a set of PROVENANCE-BEARING
 * REGIONS of a payload and the channel they are leaving through, it releases
 * the regions whose source may be redistributed, withholds the rest, and hands
 * back an honest notice naming how many fields were withheld and why.
 *
 * THE MAP IS DERIVED, NOT COPIED
 * ------------------------------
 * `SOURCE_POSTURE_INDEX` is built at module load from two authorities that
 * already exist:
 *   1. `DATA_LICENSE_REGISTER` (server/services/providers/data-licenses.ts) —
 *      keyed by `LookupResult.source`, e.g. "ATTOM Data", "FEMA NFHL".
 *   2. The provider objects themselves — `attomProvider.redistributable`,
 *      `regridProvider.license`, … — keyed by BOTH `provider.name` (the
 *      machine routing name, "attom") and `provider.displayName`.
 * If ATTOM's contract is renegotiated and `attom-provider.ts` flips to
 * `redistributable: "attribution"`, this chokepoint changes with it. There is
 * no hand-maintained list of "the paid ones" here to drift.
 *
 * IT FAILS CLOSED
 * ---------------
 * A region whose source is absent, empty, or absent from BOTH authorities is
 * withheld, and the reason says exactly that ("provenance is not recorded").
 * Unknown provenance is treated as non-redistributable — the register's own
 * `UNKNOWN_LICENSE_ENTRY` posture is `review-required`, and this module treats
 * `review-required` as "does not leave".
 *
 * WHAT IT DOES **NOT** CLAIM
 * --------------------------
 * This module screens what the CALLER declares as provenance-bearing. It
 * cannot discover provenance that the platform never recorded. Columns
 * populated by a provider but stored with no provenance stamp (see
 * `properties.bedrooms`/`squareFeet`/`yearBuilt`, whose schema comment reads
 * "populated by ATTOM/BatchData providers", and `properties.enrichmentData`)
 * are outside its knowledge — the export wiring therefore treats the whole
 * provider-derived REGION as unprovenanced and withholds it, rather than
 * guessing a source. Any claim that "no non-redistributable byte can leave
 * AcreOS" would be false; the honest claim is the one the exit test pins:
 * a region whose declared provenance resolves to `redistributable:"no"`
 * cannot leave through any wired channel, and an unresolvable one is
 * withheld too.
 */

import type {
  DataLicense,
  DataProvider,
  RedistributePosture,
} from "./providers/types";
import {
  DATA_LICENSE_REGISTER,
  licenseFor,
} from "./providers/data-licenses";
import { attomProvider } from "./providers/attom-provider";
import { batchdataProvider } from "./providers/batchdata-provider";
import { countyGisProvider } from "./providers/county-gis-provider";
import { openDataProvider } from "./providers/open-data-provider";
import { regridProvider } from "./providers/regrid-provider";

// ── Channels ────────────────────────────────────────────────────────────────

/**
 * Every way a payload leaves the platform. Adding a member here without
 * wiring it is a test failure BY NAME (`licenseEgress.test.ts` asserts each
 * channel's `wiredIn` files exist and import this module).
 */
export type EgressChannel =
  | "csv-export"
  | "public-parcel-report"
  | "founder-market-report"
  | "mcp-tool-result"
  | "outbound-webhook"
  /**
   * Branded PDF artifacts the customer downloads and forwards. Added at
   * fleet-11 integration: the first inventory missed the file-download
   * ARTIFACT paths entirely, and the property report renders parcel_snapshots
   * fields (owner of record, mailing address) whose declared source the
   * chokepoint resolves to redistributable:"no" today. A PDF a customer mails
   * to a counterparty is the most redistributive channel there is.
   */
  | "pdf-artifact";

export interface EgressChannelSpec {
  channel: EgressChannel;
  /** Human sentence used in the withholding notice's channel context. */
  label: string;
  /**
   * Repo-relative files that MUST route through this chokepoint for the
   * channel to be considered wired. The exit test derives its per-channel
   * assertions from this list, so a channel added without wiring fails by name.
   */
  wiredIn: readonly string[];
}

const EGRESS_CHANNEL_REGISTRY: readonly EgressChannelSpec[] = [
  {
    channel: "csv-export",
    label: "data export",
    wiredIn: ["server/routes-import-export.ts"],
  },
  {
    channel: "public-parcel-report",
    label: "public parcel report",
    wiredIn: [
      "server/services/publicParcelReport.ts",
      "server/routes-public-parcel-report.ts",
    ],
  },
  {
    channel: "founder-market-report",
    label: "market report",
    wiredIn: ["server/routes-founder-market-reports.ts"],
  },
  {
    channel: "pdf-artifact",
    label: "PDF report",
    wiredIn: ["server/services/propertyReportPdf.ts"],
  },
  {
    channel: "mcp-tool-result",
    label: "MCP tool result",
    wiredIn: ["server/mcp/streamableHttp.ts", "server/mcp/index.ts"],
  },
  {
    channel: "outbound-webhook",
    label: "outbound webhook",
    wiredIn: [
      "server/services/publicWebhookDispatcher.ts",
      "server/services/webhookDispatcher.ts",
    ],
  },
] as const;

function channelLabel(channel: EgressChannel): string {
  return (
    EGRESS_CHANNEL_REGISTRY.find((c) => c.channel === channel)?.label ??
    String(channel)
  );
}

// ── The derived source → posture index ──────────────────────────────────────

/**
 * The provider objects whose declarations feed the index. These are the SAME
 * objects `server/providers-init.ts` registers; we read their declared
 * `license` / `redistributable` / `attributionText` rather than restating
 * them. `licenseEgress.test.ts` asserts every `*-provider.ts` module in
 * server/services/providers is represented here, so a sixth provider cannot
 * be added without appearing in the index.
 */
/**
 * The `source` strings each provider stamps on its own LookupResults, which
 * are NOT always its name or displayName. Grepped from the provider modules
 * (`source: "…"` literals) and pinned by the exit test, so a provider that
 * starts emitting a new source name fails by name rather than silently
 * falling through to the unresolved branch.
 */
const PROVIDER_RESULT_SOURCE_NAMES: Readonly<Record<string, readonly string[]>> = {
  attom: ["ATTOM Data", "AttomProvider"],
  batchdata: ["BatchData"],
  "county-gis": ["County GIS"],
  regrid: ["Regrid"],
  // open-data fans out to per-dataset source names; each is its own register
  // row (FEMA NFHL, EPA ECHO, USGS…), all "yes"-postured public data.
  "open-data": ["Open Data"],
};

const DECLARING_PROVIDERS: readonly DataProvider[] = [
  attomProvider,
  batchdataProvider,
  countyGisProvider,
  openDataProvider,
  regridProvider,
];

export type EgressResolutionOrigin =
  | "license-register"
  | "provider-declaration"
  | "row-license-review"
  | "first-party"
  | "unresolved";

export interface EgressLicenseEntry {
  posture: RedistributePosture;
  license: DataLicense | null;
  attributionText?: string;
  /** Canonical display name for the source, used in notices. */
  displayName: string;
  origin: Exclude<EgressResolutionOrigin, "unresolved" | "row-license-review">;
}

/**
 * The one sentinel for data AcreOS itself produced — customer-entered records,
 * k-anonymized network aggregates, our own computed scores. It is not a vendor
 * feed, so no vendor contract governs it and it may leave.
 *
 * Deliberately a single, greppable constant rather than an ambient "if we
 * can't find a vendor, assume it's ours" default — that default is exactly the
 * hole this module exists to close. A caller marking a region first-party is
 * making a checkable claim about where the bytes came from.
 */
export const FIRST_PARTY_SOURCE = "AcreOS (first-party)";

/** Normalizes "ATTOM Data" / "attom data" / "ATTOM  Data " to one key. */
function normalizeSourceKey(source: string): string {
  return source.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildSourcePostureIndex(): Map<string, EgressLicenseEntry> {
  const index = new Map<string, EgressLicenseEntry>();

  // (0) First-party data. No vendor contract governs it.
  index.set(normalizeSourceKey(FIRST_PARTY_SOURCE), {
    posture: "yes",
    license: null,
    displayName: FIRST_PARTY_SOURCE,
    origin: "first-party",
  });

  // (1) The data-license register — the authority keyed by LookupResult.source.
  for (const entry of Object.values(DATA_LICENSE_REGISTER)) {
    index.set(normalizeSourceKey(entry.source), {
      posture: entry.redistributable,
      license: entry.license,
      attributionText: entry.attributionText,
      displayName: entry.source,
      origin: "license-register",
    });
  }

  // (2) The provider modules' own declarations, keyed by machine name AND
  //     display name. The register wins where both speak (it is the
  //     source-name-keyed authority); this fills in routing names like
  //     "attom" and any provider not yet mirrored into the register.
  for (const provider of DECLARING_PROVIDERS) {
    const entry: EgressLicenseEntry = {
      posture: provider.redistributable,
      license: provider.license,
      attributionText: provider.attributionText,
      displayName: provider.displayName,
      origin: "provider-declaration",
    };
    // Key BOTH identities AND the source strings the provider actually
    // stamps on its LookupResults. county-gis is `name: "county-gis"`,
    // `displayName: "County GIS (free, direct)"` but emits `source:
    // "County GIS"` — so before this, every real county row missed the index
    // and told the user "provenance is not recorded for this field", a false
    // negative about data whose provenance is right there (fleet-11 verifier
    // catch). The emitted names are declared alongside the provider so the
    // two cannot drift silently.
    const aliases = [provider.name, provider.displayName, ...(PROVIDER_RESULT_SOURCE_NAMES[provider.name] ?? [])];
    for (const alias of aliases) {
      const key = normalizeSourceKey(alias);
      if (!index.has(key)) index.set(key, entry);
    }
  }

  return index;
}

const SOURCE_POSTURE_INDEX = buildSourcePostureIndex();

// ── Resolution ──────────────────────────────────────────────────────────────

export interface EgressResolution {
  /** The source string as supplied; "unknown" when none was supplied. */
  source: string;
  posture: RedistributePosture;
  license: DataLicense | null;
  attributionText?: string;
  origin: EgressResolutionOrigin;
  /** Always populated — a refusal must be able to state its reason. */
  reason: string;
}

/** Postures that may cross the platform boundary. */
export function postureMayLeave(posture: RedistributePosture): boolean {
  return posture === "yes" || posture === "attribution";
}

/**
 * Resolve a declared source name to its egress posture.
 *
 * `reviewedPostures` lets a caller supply a posture recorded by a HUMAN
 * license review for a source the register cannot enumerate at build time —
 * today that is the per-county `county_gis_endpoints.redistributable` column
 * (migration 0120). It can only ever RAISE a source the register itself calls
 * `review-required`; a source the register declares `"no"` can never be
 * upgraded by a caller. That asymmetry is test-pinned.
 */
export function resolveEgressLicense(
  source: string | null | undefined,
  reviewedPostures?: Readonly<Record<string, RedistributePosture>>,
): EgressResolution {
  const raw = typeof source === "string" ? source.trim() : "";
  if (!raw) {
    return {
      source: "unknown",
      posture: "review-required",
      license: null,
      origin: "unresolved",
      reason:
        "provenance is not recorded for this field, so it is treated as not redistributable",
    };
  }

  const hit = SOURCE_POSTURE_INDEX.get(normalizeSourceKey(raw));
  if (!hit) {
    // Mirrors the register's own conservative default (UNKNOWN_LICENSE_ENTRY).
    const fallback = licenseFor(raw);
    const reviewed = reviewedPostures?.[raw];
    if (reviewed) {
      return {
        source: raw,
        posture: reviewed,
        license: fallback.license,
        attributionText: fallback.attributionText,
        origin: "row-license-review",
        reason: `${raw} carries a recorded per-row license review (${reviewed})`,
      };
    }
    return {
      source: raw,
      posture: fallback.redistributable,
      license: fallback.license,
      origin: "unresolved",
      reason: `${raw} is not in the data-license register or any provider declaration, so it is treated as not redistributable`,
    };
  }

  // A caller-supplied review may only settle what the register left open.
  if (hit.posture === "review-required" && reviewedPostures?.[raw]) {
    const reviewed = reviewedPostures[raw];
    return {
      source: hit.displayName,
      posture: reviewed,
      license: hit.license,
      attributionText: hit.attributionText,
      origin: "row-license-review",
      reason: `${hit.displayName} carries a recorded per-row license review (${reviewed})`,
    };
  }

  return {
    source: hit.displayName,
    posture: hit.posture,
    license: hit.license,
    attributionText: hit.attributionText,
    origin: hit.origin,
    reason: reasonFor(hit.displayName, hit.posture),
  };
}

function reasonFor(
  displayName: string,
  posture: RedistributePosture,
): string {
  switch (posture) {
    case "yes":
      return `${displayName} is redistributable`;
    case "attribution":
      return `${displayName} is redistributable with attribution`;
    case "no":
      return `${displayName} is not redistributable under our contract`;
    case "review-required":
    default:
      return `${displayName} has not been license-reviewed for redistribution`;
  }
}

/** Convenience predicate over a raw source name. */
function mayLeavePlatform(
  source: string | null | undefined,
  reviewedPostures?: Readonly<Record<string, RedistributePosture>>,
): boolean {
  return postureMayLeave(resolveEgressLicense(source, reviewedPostures).posture);
}

// ── Screening ───────────────────────────────────────────────────────────────

/**
 * A provenance-bearing region of a payload: a path plus the source that
 * produced it. `source` is what the payload/record ITSELF declares (a
 * `LookupResult.source`, a `PublicReportFactCategory.source`, a provider name
 * stamped on a row) — never a guess. A null/absent source is the fail-closed
 * case, not a pass.
 */
export interface EgressRegion {
  /** Dotted path within the payload, e.g. "categories[0]" or "parcelData". */
  path: string;
  source: string | null | undefined;
  /** Optional human label used in notices instead of the raw path. */
  label?: string;
}

export interface WithheldRegion {
  path: string;
  label: string;
  source: string;
  posture: RedistributePosture;
  reason: string;
}

export interface EgressScreenResult {
  channel: EgressChannel;
  /** Paths cleared to leave. */
  releasedPaths: string[];
  withheld: WithheldRegion[];
  /** Attribution strings required by released "attribution" sources. */
  attributions: string[];
  /**
   * Honest sentence naming the count and the governing reason(s). Null when
   * nothing was withheld — an artifact that withheld nothing must not imply
   * that it did.
   */
  notice: string | null;
}

export interface ScreenOptions {
  /**
   * Postures recorded by a human license review for sources the register
   * cannot enumerate (per-county GIS terms). Can only settle
   * `review-required`; never overrides a declared "no".
   */
  reviewedPostures?: Readonly<Record<string, RedistributePosture>>;
}

/**
 * THE CHOKEPOINT. Decide, per region, what may leave through `channel`.
 */
function screenForEgress(
  channel: EgressChannel,
  regions: readonly EgressRegion[],
  opts: ScreenOptions = {},
): EgressScreenResult {
  const releasedPaths: string[] = [];
  const withheld: WithheldRegion[] = [];
  const attributions = new Set<string>();

  for (const region of regions) {
    const resolution = resolveEgressLicense(region.source, opts.reviewedPostures);
    if (postureMayLeave(resolution.posture)) {
      releasedPaths.push(region.path);
      if (resolution.posture === "attribution" && resolution.attributionText) {
        attributions.add(resolution.attributionText);
      }
      continue;
    }
    withheld.push({
      path: region.path,
      label: region.label ?? region.path,
      source: resolution.source,
      posture: resolution.posture,
      reason: resolution.reason,
    });
  }

  return {
    channel,
    releasedPaths,
    withheld,
    attributions: [...attributions],
    notice: withholdingNotice(channel, withheld),
  };
}

/**
 * Build the honest notice. A thinner artifact must SAY it is thinner and why —
 * silently shipping fewer fields is the failure mode this whole slice exists
 * to prevent.
 */
export function withholdingNotice(
  channel: EgressChannel,
  withheld: readonly WithheldRegion[],
): string | null {
  if (withheld.length === 0) return null;
  const n = withheld.length;
  const noun = n === 1 ? "field" : "fields";
  // De-duplicated reasons, most-cited first, so the notice stays short when
  // twelve fields share one contract.
  const counts = new Map<string, number>();
  for (const w of withheld) counts.set(w.reason, (counts.get(w.reason) ?? 0) + 1);
  const reasons = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason]) => reason);
  return `${n} ${noun} withheld from this ${channelLabel(channel)} — ${reasons.join("; ")}.`;
}

// ── Object-shaped convenience wrapper ───────────────────────────────────────

export interface ScreenedPayload<T extends Record<string, unknown>> {
  payload: T;
  screen: EgressScreenResult;
}

/**
 * Screen a flat object by KEY: `regionSources` maps a top-level key to the
 * source that produced it. Keys whose source cannot leave are DELETED from a
 * shallow clone. Keys absent from `regionSources` are untouched — this
 * function screens declared provenance and makes no claim about the rest
 * (see the module header).
 */
function screenObjectForEgress<T extends Record<string, unknown>>(
  channel: EgressChannel,
  payload: T,
  regionSources: Readonly<Record<string, string | null | undefined>>,
  opts: ScreenOptions = {},
): ScreenedPayload<T> {
  const regions: EgressRegion[] = Object.keys(regionSources)
    .filter((key) => payload[key] !== undefined && payload[key] !== null)
    .map((key) => ({ path: key, source: regionSources[key] }));

  const screen = screenForEgress(channel, regions, opts);
  if (screen.withheld.length === 0) return { payload, screen };

  const clone: Record<string, unknown> = { ...payload };
  for (const w of screen.withheld) delete clone[w.path];
  return { payload: clone as T, screen };
}

/**
 * Screen an array of source-stamped nodes (the `PublicReportFactCategory[]`
 * shape, and any `{ source, data }` list). Nodes cleared to leave keep their
 * data; nodes withheld keep their identity but lose their payload, so the
 * artifact shows an honest hole rather than an unexplained absence.
 */
export function screenSourcedNodes<T extends object>(
  channel: EgressChannel,
  nodes: readonly T[],
  opts: ScreenOptions & {
    /** Key holding the source name. Default "source". */
    sourceKey?: string;
    /** Keys emptied (set to null) when the node is withheld. Default ["data"]. */
    dataKeys?: readonly string[];
    /** Key used in the path/label. Default the array index. */
    labelKey?: string;
  } = {},
): { nodes: T[]; screen: EgressScreenResult } {
  const sourceKey = opts.sourceKey ?? "source";
  const dataKeys = opts.dataKeys ?? ["data"];

  const regions: EgressRegion[] = nodes.map((node, i) => {
    const bag = node as unknown as Record<string, unknown>;
    const rawLabel = opts.labelKey ? bag[opts.labelKey] : undefined;
    const label = typeof rawLabel === "string" ? rawLabel : `#${i}`;
    return {
      path: `[${i}]`,
      label,
      source: typeof bag[sourceKey] === "string" ? (bag[sourceKey] as string) : null,
    };
  });

  const screen = screenForEgress(channel, regions, opts);
  const withheldIdx = new Set(
    screen.withheld.map((w) => Number(w.path.replace(/[^0-9]/g, ""))),
  );

  const out = nodes.map((node, i) => {
    if (!withheldIdx.has(i)) return node;
    const copy: Record<string, unknown> = { ...(node as unknown as Record<string, unknown>) };
    for (const key of dataKeys) copy[key] = null;
    copy.withheld = true;
    copy.withheldReason =
      screen.withheld.find((w) => w.path === `[${i}]`)?.reason ?? null;
    // A withheld node must not read as an ABSENCE. Public-report categories
    // carry `available`, and the renderer keys on it — leaving it true while
    // nulling the data made the page say "we looked and found nothing", which
    // is a fabricated negative about the parcel rather than a disclosed
    // suppression (fleet-11 verifier catch). Only touched when the node
    // actually has the flag, so non-report shapes are unaffected.
    if ("available" in copy) copy.available = false;
    return copy as unknown as T;
  });

  return { nodes: out, screen };
}

// ── Provider-derived record regions (the unstamped-provenance case) ─────────

/**
 * Columns on `properties` / `leads` that hold data a DATA PROVIDER returned,
 * but which the platform persists WITHOUT recording which provider produced
 * it. Each entry names the evidence in shared/schema.ts:
 *
 *  - `parcelData`      — schema: "Parcel boundary data (GeoJSON polygon from
 *                        Regrid)"; the object's own `regridId` key. Written
 *                        from `resolveParcel` results, which may be Regrid
 *                        (redistributable "no") OR county GIS ("review-
 *                        required") — the row does not say which.
 *  - `parcelBoundary`  — same write path, same comment.
 *  - `parcelCentroid`  — same write path.
 *  - `enrichmentData`  — schema: "Enrichment data (from
 *                        PropertyEnrichmentService)"; a free-form jsonb with
 *                        no source key (see leadScoring.ts, which writes
 *                        `enrichmentData.parcelData = parcelResult.data`).
 *
 * Because none of these records its provider, every one resolves to the
 * fail-closed branch and is withheld with the reason "provenance is not
 * recorded". That is the intended, conservative outcome — and the pressure
 * that makes stamping provenance at write time worth doing. This list is
 * about WHICH FIELDS carry provider bytes; the posture decision for each is
 * still made by the derived index, never by this list.
 */
export const PROVIDER_DERIVED_RECORD_FIELDS: readonly string[] = [
  "parcelData",
  "parcelBoundary",
  "parcelCentroid",
  "enrichmentData",
] as const;

/**
 * Build the region-source map for one entity record: each provider-derived
 * field mapped to whatever source THE RECORD ITSELF declares, and null when it
 * declares none. Never guesses.
 */
function recordRegionSources(
  record: Record<string, unknown>,
): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const field of PROVIDER_DERIVED_RECORD_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null) continue;
    let declared: string | null = null;
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      // The only provenance these blobs ever carry is a `source`/`provider`
      // key some writers set. Read it; do not infer one from sibling keys.
      for (const key of ["source", "provider", "dataSource"]) {
        if (typeof obj[key] === "string" && (obj[key] as string).trim()) {
          declared = obj[key] as string;
          break;
        }
      }
    }
    map[field] = declared;
  }
  return map;
}

/**
 * Screen one entity record for export. Returns the record with withheld
 * fields removed and, when anything was withheld, an inline `_license`
 * disclosure so the exported artifact SAYS it is thinner and why.
 */
export function screenRecordForExport<T extends Record<string, unknown>>(
  channel: EgressChannel,
  record: T,
  opts: ScreenOptions = {},
): { record: Record<string, unknown>; screen: EgressScreenResult } {
  const { payload, screen } = screenObjectForEgress(
    channel,
    record,
    recordRegionSources(record),
    opts,
  );
  const disclosure = withholdingDisclosure(screen);
  if (!disclosure) return { record: payload, screen };
  return { record: { ...payload, _license: disclosure }, screen };
}

/**
 * Screen a tool-result / webhook payload of unknown shape.
 *
 * Handles the two shapes these surfaces actually emit: one entity object, or
 * an array of entity objects. Screens the provider-derived regions
 * (`PROVIDER_DERIVED_RECORD_FIELDS`) that a record carries WITHOUT a
 * provenance stamp — the fail-closed case — and attaches a `_license`
 * disclosure to any object it thinned.
 *
 * It deliberately does NOT try to infer provenance from a payload's own
 * free-form `source` string: those strings are display labels
 * ("OpenStreetMap Nominatim") that the license register keys differently, and
 * withholding a legitimately-redistributable federal fact because of a naming
 * mismatch would be a false refusal, which is its own kind of dishonesty.
 * Callers holding a real `LookupResult.source` should pass `declaredSource`.
 */
export function screenToolResultData(
  channel: EgressChannel,
  data: unknown,
  opts: ScreenOptions & { declaredSource?: string | null } = {},
): { data: unknown; disclosure: EgressWithholdingDisclosure | null } {
  // An explicitly-declared source rules the whole payload.
  if (opts.declaredSource !== undefined) {
    const screen = screenForEgress(
      channel,
      [{ path: "result", source: opts.declaredSource, label: "result" }],
      opts,
    );
    const disclosure = withholdingDisclosure(screen);
    return disclosure ? { data: null, disclosure } : { data, disclosure: null };
  }

  const screenOne = (
    value: unknown,
  ): { value: unknown; withheld: WithheldRegion[] } => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { value, withheld: [] };
    }
    const { record, screen } = screenRecordForExport(
      channel,
      value as Record<string, unknown>,
      opts,
    );
    return { value: record, withheld: [...screen.withheld] };
  };

  if (Array.isArray(data)) {
    const all: WithheldRegion[] = [];
    const out = data.map((item) => {
      const r = screenOne(item);
      all.push(...r.withheld);
      return r.value;
    });
    const notice = withholdingNotice(channel, all);
    return {
      data: out,
      disclosure: notice
        ? {
            channel,
            withheldCount: all.length,
            notice,
            fields: all.map((w) => ({
              field: w.label,
              source: w.source,
              reason: w.reason,
            })),
          }
        : null,
    };
  }

  const r = screenOne(data);
  const notice = withholdingNotice(channel, r.withheld);
  return {
    data: r.value,
    disclosure: notice
      ? {
          channel,
          withheldCount: r.withheld.length,
          notice,
          fields: r.withheld.map((w) => ({
            field: w.label,
            source: w.source,
            reason: w.reason,
          })),
        }
      : null,
  };
}

/**
 * The wire shape every surface attaches when it withheld something. Kept in
 * one place so "N fields withheld" reads identically on a CSV header comment,
 * a JSON envelope, an MCP tool result and a webhook body.
 */
export interface EgressWithholdingDisclosure {
  channel: EgressChannel;
  withheldCount: number;
  notice: string;
  fields: { field: string; source: string; reason: string }[];
}

export function withholdingDisclosure(
  screen: EgressScreenResult,
): EgressWithholdingDisclosure | null {
  if (screen.withheld.length === 0 || !screen.notice) return null;
  return {
    channel: screen.channel,
    withheldCount: screen.withheld.length,
    notice: screen.notice,
    fields: screen.withheld.map((w) => ({
      field: w.label,
      source: w.source,
      reason: w.reason,
    })),
  };
}
