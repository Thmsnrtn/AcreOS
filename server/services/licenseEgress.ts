/**
 * licenseEgress.ts — the license-aware egress chokepoint.
 *
 * WHY THIS EXISTS
 * ---------------
 * `data-licenses.ts` already answers "may we CACHE and re-serve this source?"
 * and the provider registry consults it before writing `provider_cache`.
 * Nothing answered the other half of the same question: "may this datum LEAVE
 * the platform?" — through a CSV/JSON export, a public parcel report, a
 * founder market report, a branded PDF, an MCP tool result, an outbound
 * webhook, the portability ZIP, or a subject-access export. A field whose
 * vendor contract says `redistributable: "no"` (ATTOM, Regrid, BatchData)
 * could ride out of any of those doors unexamined. `EGRESS_CHANNEL_REGISTRY`
 * below is the enumeration this sentence must always match.
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
 * cannot leave through any wired REDISTRIBUTION channel, and an unresolvable
 * one is withheld too.
 *
 * THE ONE CHANNEL THAT RELEASES
 * -----------------------------
 * `dsar-subject-access` is deliberately not a redistribution channel: a GDPR
 * Art. 15 request is an obligation to hand a person their own data, which is a
 * different question from a licence to republish it. That channel consults
 * this module and then INCLUDES what the others drop, stating per field what
 * the screen resolved. The decision, its legal basis and its one-line reversal
 * point are at `subjectAccessDisclosure` at the bottom of this file. Any
 * sentence above that reads "cannot leave through any channel" means any
 * channel whose purpose is redistribution — which is every channel in the
 * registry except that one.
 *
 * AND WHAT "WITHHELD" NEVER MEANS
 * -------------------------------
 * An empty payload is not a withholding. Sources that arrive attached to no
 * data at all (a dead upstream, a lookup miss, an error) produce no notice —
 * announcing "1 field withheld" over bytes that never existed is a fabricated
 * suppression, and it buries the real reason for the emptiness.
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
  | "pdf-artifact"
  /**
   * The portability archive: the `everything` export ZIP built by
   * migrationJobs.ts behind POST /api/export/everything. Same bytes as the
   * CSV channel but bundled, so it gets the same screening; the notice rides
   * inside the archive (LICENSE-NOTICE.md + README section) because a ZIP has
   * no response header a human ever reads.
   */
  | "portability-archive"
  /**
   * GDPR Art. 15 subject-access export (gdprService.exportUserData, streamed
   * by POST /api/founder/dsar/:id/generate-export).
   *
   * THIS CHANNEL DELIBERATELY RELEASES WHAT THE OTHERS WITHHOLD — see
   * `subjectAccessDisclosure` below for the decision and its reasoning. It is
   * registered here anyway because it IS egress: bytes leave the platform, the
   * chokepoint is consulted on every one of them, and the artifact states what
   * it did. A channel that is not in this registry is a channel nobody checks.
   */
  | "dsar-subject-access";

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
  {
    channel: "portability-archive",
    label: "portability archive",
    wiredIn: ["server/services/migrationJobs.ts"],
  },
  {
    channel: "dsar-subject-access",
    label: "subject-access export",
    wiredIn: ["server/services/gdprService.ts"],
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

/**
 * BROKER DISPLAY TITLE → CANONICAL REGISTER SOURCE.
 *
 * `dataSourceBroker.lookup()` returns `source.title`, which is a DISPLAY LABEL
 * for the endpoint that served the request ("USDA NRCS SDA"), not a
 * `LookupResult.source` keyed by the license register ("USDA SSURGO"). The MCP
 * tool surface prints those titles, and fleet-12 made the MCP call sites pass
 * them as declared provenance — so the two vocabularies have to be reconciled
 * or every federal lookup would fail closed on a NAMING mismatch, which the
 * module header rightly calls a false refusal.
 *
 * Each entry below is an IDENTITY claim ("this title and this register key name
 * the same publisher + dataset"), evidenced in its comment. It never restates a
 * posture: the alias resolves to the register entry, and the register's own
 * `redistributable` governs. A title whose identity is NOT evidenced is
 * deliberately absent — it then falls to the unresolved branch and is withheld
 * with a reason, which is the correct answer for a source no human has
 * license-reviewed.
 *
 * `licenseEgress.test.ts` reads the broker's own `titleByCategory` block and
 * requires every title to either resolve here or appear in the test's declared
 * unreconciled set, so a new broker title fails BY NAME rather than silently
 * going dark.
 */
const BROKER_TITLE_TO_REGISTER_SOURCE: Readonly<Record<string, string>> = {
  // NRCS "Soil Data Access" IS the SSURGO web service — the register's own
  // USDA SSURGO entry points termsUrl at sdmdataaccess.nrcs.usda.gov.
  "USDA NRCS SDA": "USDA SSURGO",
  // 3DEP delivered through The National Map; same USGS product as the
  // register's "USGS 3DEP".
  "USGS 3DEP National Map": "USGS 3DEP",
  // USGS Water Services (waterservices.usgs.gov) is USGS-published; the
  // register carries a publisher-level "USGS" entry for exactly this case.
  "USGS Water Services": "USGS",
  // NLCD is the MRLC consortium product the register keys as "MRLC NLCD";
  // USGS leads MRLC and mirrors it under its own name.
  "USGS NLCD": "MRLC NLCD",
  // The Cropland Data Layer is a USDA NASS product; the register's publisher
  // -level "USDA NASS" entry governs it.
  "USDA NASS CropScape": "USDA NASS",
  // NOAA Storm Events is NOAA-published; register carries publisher-level
  // "NOAA".
  "NOAA Storm Events": "NOAA",
  // CadNSDI is the BLM's publication of the PLSS; register key "BLM PLSS".
  "BLM CadNSDI": "BLM PLSS",
  // The broker spells the National Risk Index out; the register abbreviates.
  "FEMA National Risk Index": "FEMA NRI",
  // Nominatim is the OSM geocoder — the two MCP geocode tools stamp
  // "OpenStreetMap Nominatim" into their own payloads. ODbL either way, so the
  // released result carries the register's attribution string.
  "OpenStreetMap Nominatim": "OpenStreetMap",
};

/**
 * BROKER TITLES THAT DELIBERATELY DO **NOT** RECONCILE, each with the reason.
 *
 * `data-source-broker.ts`'s `titleByCategory` block names 23 upstreams. Ten of
 * them reconcile above. These are the rest: every one falls to the fail-closed
 * branch, and every one is listed here so the refusal can say WHY THIS TITLE
 * rather than the generic "not in the register", which reads like an
 * accusation against an unknown vendor when the real story is usually "the
 * register has no row for this federal product yet".
 *
 * The distinction matters because these are two different debts:
 *   - a COMPOSITE title ("BLM/NPS/USFS") names several publishers at once, so
 *     no single register row can govern it — the broker has to stop collapsing
 *     three upstreams into one label before a licence answer is even possible;
 *   - a NON-FEDERAL or MIXED title ("DOT/ESRI/Census TIGER", "Open-Meteo
 *     ERA5") is withheld CORRECTLY: Esri's terms and Copernicus/ERA5's
 *     attribution requirement are real constraints, not a register gap;
 *   - a MISSING-ROW title ("EPA TRI", "USDA FSA CLU") is a public-domain
 *     federal product that simply has no `DATA_LICENSE_REGISTER` entry. Adding
 *     one lives in `server/services/providers/data-licenses.ts` — the authority
 *     this module derives from and deliberately never second-guesses. A
 *     hand-kept "these ones are fine" list HERE would fail OPEN and drift,
 *     which is the whole failure mode the derived index exists to avoid.
 *
 * So this map never grants a posture. It only makes the refusal legible and
 * the debt countable. `licenseEgress.test.ts` reads the broker's own
 * `titleByCategory` block and requires every title to either resolve through
 * the index or appear here BY NAME — so a new broker title cannot go dark
 * silently, and a title that later gains a register row fails this test until
 * it is removed from the list.
 *
 * Module-private, like EGRESS_CHANNEL_REGISTRY above and for the same reason:
 * nothing outside this file has business reading it, and the test parses it
 * out of this source rather than importing it (the reachability gate counts an
 * export whose only consumers are its own module and a test as unwired).
 */
const UNRECONCILED_BROKER_TITLES: Readonly<Record<string, string>> = {
  "EPA TRI": 'the data-license register has no row for the EPA Toxics Release Inventory (it carries EPA FRS, EPA ECHO and EPA UST Finder, which are different products), so this source has not been license-reviewed for redistribution',
  HIFLD: "HIFLD's open/secure tiers carried different redistribution terms and the category is retired (see RETIRED_CATEGORIES), so no reviewed posture exists for it",
  "USGS/FEMA/WFIGS": "this title names three publishers at once, so no single register entry governs it; the broker must attribute a result to ONE upstream before its licence can be answered",
  "BLM/NPS/USFS": "this title names three publishers at once, so no single register entry governs it; the broker must attribute a result to ONE upstream before its licence can be answered",
  "DOT/ESRI/Census TIGER": "this title mixes federal publishers with Esri, whose service terms are not public-domain and have not been reviewed for redistribution — withheld on the vendor, not on a register gap",
  "Open-Meteo ERA5": "Open-Meteo is CC-BY and the underlying ERA5 reanalysis is Copernicus-licensed; both require attribution terms nobody has recorded here yet, so it is not released bare",
  "USDA ERS / NASS": "this title names two USDA agencies at once and the register's USDA NASS row cannot be assumed to govern ERS's series, so it is not resolved by identity",
  "EPA WATERS / USGS NHD": "this title names an EPA service and a USGS product at once, so no single register entry governs it",
  "USDA FSA CLU": "the register has no row for the USDA FSA Common Land Unit (its USDA rows are SSURGO, WSS and NASS), so this source has not been license-reviewed",
  "Federal Open Data": "this is the broker's GENERIC fallback title — it names no publisher at all, so there is nothing to look up and nothing that could be released",
};

/**
 * Titles the broker returns when it CANNOT name an upstream. These are not
 * unknown vendors — they are the platform telling us provenance was erased
 * (cache hit) or never existed (lookup miss/failure). They fail closed like
 * any unresolvable source, but with a reason that says what actually happened
 * instead of "not in the data-license register", which would read as a claim
 * about a vendor named "Cache".
 *
 * The cache case is a REAL defect one layer down: `data-source-broker.ts`
 * stores `dataSourceCache.dataSourceId` on write but rebuilds the result with
 * `title: "Cache"` on read, discarding the upstream identity it already has.
 * Until that carries through, every cached lookup is unprovenanced by the time
 * it reaches an egress boundary.
 */
const PROVENANCE_ERASED_TITLES: Readonly<Record<string, string>> = {
  cache: 'the broker served this result from its own cache, which does not carry the upstream source forward (title: "Cache"), so its provenance is not recorded and it is treated as not redistributable',
  none: "no upstream source produced this result, so there is no provenance to release",
  error: "the lookup failed, so no source produced this result and there is no provenance to release",
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

  // (3) Broker DISPLAY titles → the register entry they name. Identity only;
  //     the posture is whatever the target entry already declares, so a
  //     renegotiated contract moves the alias with it. A title whose target is
  //     not in the index is skipped rather than invented — it then fails
  //     closed, which is the point.
  for (const [title, registerSource] of Object.entries(
    BROKER_TITLE_TO_REGISTER_SOURCE,
  )) {
    const target = index.get(normalizeSourceKey(registerSource));
    if (!target) continue;
    const key = normalizeSourceKey(title);
    if (!index.has(key)) index.set(key, target);
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

  // The broker's "we cannot name an upstream" sentinels. Fail closed like any
  // unresolvable source, but say what actually happened rather than describing
  // "Cache" as an unreviewed vendor.
  const erased = PROVENANCE_ERASED_TITLES[normalizeSourceKey(raw)];
  if (erased) {
    return {
      source: raw,
      posture: "review-required",
      license: null,
      origin: "unresolved",
      reason: erased,
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
    // A broker display title we have already looked at and could not reconcile.
    // Same fail-closed outcome, but the reason names THIS title's actual
    // problem instead of implying an unreviewed vendor.
    const unreconciled = UNRECONCILED_BROKER_TITLES[raw];
    if (unreconciled) {
      return {
        source: raw,
        posture: fallback.redistributable,
        license: fallback.license,
        origin: "unresolved",
        reason: `${raw} is not released: ${unreconciled}`,
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
 *
 * `attributions` carries the strings an `attribution`-postured source requires
 * when it IS released. Releasing ODbL data through a channel while dropping
 * "© OpenStreetMap contributors" would satisfy the posture check and breach
 * the licence anyway, so the caller is handed the string to render.
 */
export function screenToolResultData(
  channel: EgressChannel,
  data: unknown,
  opts: ScreenOptions & { declaredSource?: string | null } = {},
): {
  data: unknown;
  disclosure: EgressWithholdingDisclosure | null;
  attributions: string[];
} {
  // NOTHING TO WITHHOLD IS NOT A WITHHOLDING.
  //
  // The broker returns `data: null` whenever a lookup misses, fails, or hits a
  // retired category — and it still stamps a source title on that empty result
  // ("HIFLD (discontinued)", "None", "Error"). Screening the title alone would
  // then attach "1 field withheld from this MCP tool result" to a result that
  // never had a field in it: a suppression notice for bytes that do not exist,
  // which also buries the REAL reason (the upstream is dead / returned
  // nothing) under a licence story. An absence must read as an absence.
  //
  // Only genuinely empty payloads take this branch; `{}`/`0`/`""` are values a
  // caller may have meant, so they go through the screen like anything else.
  if (data === null || data === undefined) {
    return { data, disclosure: null, attributions: [] };
  }

  // An explicitly-declared source rules the whole payload.
  if (opts.declaredSource !== undefined) {
    const screen = screenForEgress(
      channel,
      [{ path: "result", source: opts.declaredSource, label: "result" }],
      opts,
    );
    const disclosure = withholdingDisclosure(screen);
    return disclosure
      ? { data: null, disclosure, attributions: [] }
      : { data, disclosure: null, attributions: screen.attributions };
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
      attributions: [],
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
    attributions: [],
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

// ── CSV column probe ────────────────────────────────────────────────────────

/**
 * Does this CSV's header row contain any provider-derived region at all?
 *
 * A CSV writer emits a fixed column projection; when none of
 * `PROVIDER_DERIVED_RECORD_FIELDS` is in it, there is nothing for the
 * chokepoint to withhold from THAT file and no notice is owed. Announcing one
 * anyway would claim a thinning that did not happen.
 *
 * NOTE: `server/routes-import-export.ts` carries a private twin of this
 * (`csvColumnsCarryProviderData`) from the fleet-11 slice. It is not this
 * function only because that file is outside fleet-12's file set; a later
 * slice should delete the twin and import this. Both read the same
 * `PROVIDER_DERIVED_RECORD_FIELDS`, so they cannot disagree about WHICH
 * columns count.
 */
export function csvHeaderCarriesProviderRegion(csv: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const headerKey = norm(csv.split("\n", 1)[0] ?? "");
  return PROVIDER_DERIVED_RECORD_FIELDS.some((f) => headerKey.includes(norm(f)));
}

// ── Subject access (GDPR Art. 15) — the one channel that RELEASES ───────────

/**
 * THE DECISION, STATED (fleet-12, 2026-08-10).
 *
 * A data-subject access request and a redistribution licence answer two
 * different questions, and the egress chokepoint only ever answered the
 * second. Applying the redistribution rule to a DSAR would hand the requester
 * an export that is silently missing personal data we demonstrably hold about
 * them, for a reason — "our vendor's contract" — that is not one of the
 * grounds Art. 15(4) / Recital 63 recognise for narrowing the right of access
 * (those cover the rights and freedoms of OTHERS: trade secrets, third-party
 * privacy — and even then, "the result of those considerations should not be a
 * refusal to provide all information to the data subject").
 *
 * So this channel INCLUDES provider-sourced regions, and says so in the
 * artifact, naming per field what the redistribution screen resolved: the
 * source where the record recorded one, and an explicit "provenance is not
 * recorded" where it did not. The constraint that rides with a paid vendor's
 * bytes is preserved by DISCLOSING it, not by dropping the bytes: supplying a
 * copy under a legal access right is not a licence to republish or resell.
 *
 * This is a legal posture, so it is a founder-ratifiable one — it is written
 * here, in one place, as a stated choice rather than an emergent behaviour, so
 * that rescinding it is a one-line edit and a test rewrite rather than an
 * archaeology exercise. `licenseEgress.test.ts` pins the decision itself, not
 * merely its side effects.
 */
const SUBJECT_ACCESS_CHANNEL = "dsar-subject-access" as const;

export interface SubjectAccessFieldNote {
  entity: string;
  field: string;
  /** Resolved source name, or "unknown" where the record recorded none. */
  source: string;
  posture: RedistributePosture;
  reason: string;
  /** How many exported rows of this entity carry this field/source pair. */
  rowCount: number;
}

/**
 * Per-entity coverage of the check. This exists because "we checked and found
 * nothing" and "there was nothing to check" are different sentences and only
 * one of them is true of an entity the export ships as an empty list. The DSAR
 * artifact folded both into "none was populated" until this was added; a
 * requester reading that would reasonably conclude we had examined their
 * property records, when in fact zero were in scope.
 */
export interface SubjectAccessEntityCoverage {
  entity: string;
  /** Rows of this entity IN THE EXPORT — so 0 reads as "none exported". */
  rowsInspected: number;
  /** Populated provider-derived regions found across those rows. */
  providerRegionsFound: number;
  /** Of those, how many a redistribution channel would have withheld. */
  wouldBeWithheldElsewhere: number;
}

export interface SubjectAccessDisclosure {
  /** Always the subject-access channel; spelled out so this exported shape
   *  does not depend on a module-private const. */
  channel: "dsar-subject-access";
  /** The deliberate choice. Never inferred from whether anything was found. */
  decision: "included-with-licence-note";
  /**
   * Field VALUES (not distinct fields) a REDISTRIBUTION channel would have
   * withheld — because the named vendor forbids redistribution, or because the
   * record does not say which provider produced the value. Not a count of
   * "values from paid vendors": for the unstamped ones we know the FIELD is
   * provider-derived and do not know the vendor, and this export says so
   * rather than naming one.
   */
  providerSourcedValueCount: number;
  /** Populated provider-derived regions found at all, released or not. */
  providerRegionValueCount: number;
  statement: string;
  legalBasis: string;
  redistributionConstraint: string;
  /** What we checked, so the negative case is a checked claim and not a shrug. */
  fieldsInspected: readonly string[];
  /** Row-by-row scope of the check, including the entities that had 0 rows. */
  coverage: SubjectAccessEntityCoverage[];
  fields: SubjectAccessFieldNote[];
}

const SUBJECT_ACCESS_LEGAL_BASIS =
  "GDPR Article 15 (right of access): the controller must supply a copy of the personal data undergoing processing. A vendor's redistribution clause governs onward commercial redistribution, which is a different act from answering a subject access request, so it is not applied as a reason to narrow this export.";

const SUBJECT_ACCESS_CONSTRAINT =
  "These values were produced by third-party data providers. Where the stored record recorded which provider, it is named below; where it recorded none, this export says so rather than guessing. Some providers' contracts forbid redistribution, so this copy is supplied to you under the right of access and is not a licence to republish or resell it.";

/**
 * Inspect the exported entities and build the disclosure. The payload is NEVER
 * modified — this channel releases. The return value is what the artifact must
 * carry so it states what it did.
 */
export function subjectAccessDisclosure(
  entities: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): SubjectAccessDisclosure {
  const notes = new Map<string, SubjectAccessFieldNote>();
  const coverage: SubjectAccessEntityCoverage[] = [];
  let valueCount = 0;
  let foundCount = 0;

  for (const [entity, rows] of Object.entries(entities)) {
    let entityFound = 0;
    let entityWithheld = 0;

    for (const row of rows) {
      const sources = recordRegionSources(row);
      const regions: EgressRegion[] = Object.keys(sources).map((field) => ({
        path: field,
        label: field,
        source: sources[field],
      }));
      if (regions.length === 0) continue;
      // recordRegionSources drops null/absent values, so this counts regions
      // that are actually POPULATED — not the schema's worth of columns.
      entityFound += regions.length;
      const screen = screenForEgress(SUBJECT_ACCESS_CHANNEL, regions);
      for (const w of screen.withheld) {
        entityWithheld++;
        const key = `${entity}.${w.path}|${w.source}`;
        const existing = notes.get(key);
        if (existing) {
          existing.rowCount++;
          continue;
        }
        notes.set(key, {
          entity,
          field: w.path,
          source: w.source,
          posture: w.posture,
          reason: w.reason,
          rowCount: 1,
        });
      }
    }

    coverage.push({
      entity,
      rowsInspected: rows.length,
      providerRegionsFound: entityFound,
      wouldBeWithheldElsewhere: entityWithheld,
    });
    foundCount += entityFound;
    valueCount += entityWithheld;
  }

  const fields = [...notes.values()].sort((a, b) => b.rowCount - a.rowCount);

  const withRows = coverage.filter((c) => c.rowsInspected > 0);
  const withoutRows = coverage.filter((c) => c.rowsInspected === 0);
  const totalRows = withRows.reduce((n, c) => n + c.rowsInspected, 0);
  const checked = `Checked ${PROVIDER_DERIVED_RECORD_FIELDS.join(", ")} on ${totalRows} exported ${totalRows === 1 ? "row" : "rows"} (${withRows.map((c) => `${c.entity}: ${c.rowsInspected}`).join(", ") || "none"})`;
  // An entity with zero exported rows was NOT examined and must not be
  // reported as examined-and-clean. Name it as out of scope instead.
  const emptyNote = withoutRows.length
    ? ` No rows were exported for ${withoutRows.map((c) => c.entity).join(", ")}, so nothing of ${withoutRows.length === 1 ? "that entity" : "those entities"} was examined here.`
    : "";

  let statement: string;
  if (valueCount > 0) {
    statement =
      `${valueCount} field ${valueCount === 1 ? "value" : "values"} in this export sit in regions AcreOS populates from third-party data providers, and a redistribution channel would have withheld ${valueCount === 1 ? "it" : "them"} — either the named provider's contract forbids redistribution, or the stored record does not say which provider produced the value. ` +
      `They are INCLUDED here deliberately; see the per-field list below for what each one resolved to. ${checked}.${emptyNote}`;
  } else if (foundCount > 0) {
    statement =
      `${foundCount} provider-derived ${foundCount === 1 ? "region was" : "regions were"} populated in this export and every one resolved to a source that may be redistributed, so nothing here was even in tension with a vendor contract. ${checked}.${emptyNote}`;
  } else if (totalRows > 0) {
    statement =
      `No provider-derived region was populated on any row in this export. ${checked}; none of those fields held a value. Nothing was withheld and nothing here is provider-licensed on that basis.${emptyNote}`;
  } else {
    statement =
      `This export contained no rows of any entity that can carry provider-derived data, so there was nothing to check. ` +
      `The fields that would have been checked are ${PROVIDER_DERIVED_RECORD_FIELDS.join(", ")}.${emptyNote}`;
  }

  return {
    channel: SUBJECT_ACCESS_CHANNEL,
    decision: "included-with-licence-note",
    providerSourcedValueCount: valueCount,
    providerRegionValueCount: foundCount,
    statement,
    legalBasis: SUBJECT_ACCESS_LEGAL_BASIS,
    redistributionConstraint: SUBJECT_ACCESS_CONSTRAINT,
    fieldsInspected: PROVIDER_DERIVED_RECORD_FIELDS,
    coverage,
    fields,
  };
}
