/**
 * Public parcel reports — Tier 3A (elevation blueprint 2026-06-10).
 *
 * The engine behind /p/:state/:county/:apn permalinks: a saved, shareable
 * public parcel report built ONLY from free/government data, carrying the
 * honest PARTIAL Land Credit Score. The score finally appears in the tool
 * that sells it; every share is an acquisition event.
 *
 * Structural guarantees (not conventions):
 *  - FREE DATA ONLY. Every lookup goes through `resolveParcel` with
 *    `orgTier:"free" + maxTier:"free"` and NO organizationId / creditBalance.
 *    The provider registry's `tierAllowed()` filter makes paid/byok providers
 *    unreachable at tier "free" (provider-registry.ts) — there is no code
 *    path from this module to a paid lookup, and the unit test
 *    tests/unit/publicParcelReport.test.ts proves it against the registry.
 *  - ZERO credit deduction. The registry only meters credits for paid
 *    providers; free-tier providers cost 0 by contract (costPerLookupCents).
 *  - HONEST PARTIAL LCS. Only dimensions genuinely informed by free
 *    government data are scored (environmental ← FEMA NFHL + USFWS NWI;
 *    physical ← USDA SSURGO, partially). Everything else is LOCKED with
 *    score:null — never an invented value. Same weights / scale / grade
 *    thresholds as the in-app score (imported from landCredit.ts).
 *  - LICENSE-SAFE PERSISTENCE. County-assessor attributes are persisted only
 *    when the county's `county_gis_endpoints.redistributable` is
 *    'yes'/'attribution' (Beatrice rule: un-reviewed counties are
 *    live-passthrough only; a saved public page is redistribution). Federal
 *    sources (FEMA/USDA/USGS/USFWS) are US-government public domain.
 *  - THE ROW IS THE CACHE. A permalink resolves to one DB read for
 *    REPORT_TTL_MS; regeneration refreshes in place so the URL is stable.
 *  - COST GUARDS. A daily generation counter raises an alert-spine warning
 *    at PUBLIC_REPORT_DAILY_ALERT and refuses NEW generations past
 *    PUBLIC_REPORT_DAILY_HARD_CAP (existing reports still serve — only fresh
 *    upstream work is capped).
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  countyGisEndpoints,
  publicParcelReports,
  type PublicLcs,
  type PublicLcsDimension,
  type PublicLcsDimensionKey,
  type PublicParcelReport,
  type PublicReportFactCategory,
  type PublicReportFacts,
} from "@shared/schema";
import {
  normalizeParcelRef,
  parcelMatchKey,
  type ParcelRef,
} from "@shared/parcel/parcelRef";
import { resolveParcel } from "./parcel/resolveParcel";
import {
  LCS_DIMENSION_WEIGHTS,
  LCS_METHODOLOGY_VERSION,
  lcsCreditScale,
  lcsGradeForScore,
} from "./landCredit";
import { raiseAlert } from "./alertSpine";
import { DISCLAIMER_INFORMATIONAL_SCORE } from "./legalDisclaimers";
import { logger } from "../utils/logger";
import { publicParcelReportEventsTotal } from "../metrics";

// ── Tunables ─────────────────────────────────────────────────────────────────

/** A saved report serves as-is for 30 days before a hit triggers refresh. */
export const REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Daily generation count that raises an alert-spine warning (volume spike). */
export const PUBLIC_REPORT_DAILY_ALERT = Number(
  process.env.PUBLIC_REPORT_DAILY_ALERT || 250,
);

/** Daily generation ceiling — past this, new generations are refused
 *  (cached reports still serve). Bounds worst-case upstream fan-out. */
export const PUBLIC_REPORT_DAILY_HARD_CAP = Number(
  process.env.PUBLIC_REPORT_DAILY_HARD_CAP || 1000,
);

// Derives from the canonical methodology version (landCredit.ts) so a
// methodology rev automatically revs every public report's stamp.
export const PUBLIC_LCS_MODEL_VERSION = `public-partial-${LCS_METHODOLOGY_VERSION}`;

/** Free geo categories pulled for the public report (all US-gov sources). */
const REPORT_GEO_CATEGORIES = [
  "flood_zone",
  "soil",
  "elevation",
  "wetlands",
] as const;

// ── Permalink identity ───────────────────────────────────────────────────────

const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR","VI","GU","AS","MP",
]);

export interface ReportKey {
  /** 2-letter state code, uppercased. */
  state: string;
  /** Lowercased, hyphenated, " county" suffix stripped. */
  countySlug: string;
  /** Display form, e.g. "Travis". */
  countyLabel: string;
  /** Display APN (trimmed input). */
  apn: string;
  /**
   * CANDIDATE key, not an identity: `parcelMatchKey`'s loose APN — uppercase
   * alphanumerics only, punctuation stripped. See `looseApnKey` below.
   */
  apnKey: string;
}

/**
 * The loose APN — `parcelMatchKey`'s APN segment, taken from parcelRef rather
 * than re-derived here, so the punctuation rule has exactly one owner.
 *
 * The extraction is exact, not a guess: `parcelMatchKey` is
 * `${state} ${county} ${strippedApn}` and the stripped APN contains only
 * [A-Z0-9], so it can never contain the separator — the final space-separated
 * segment IS the loose APN. (It is also never empty: parcelRef refuses an APN
 * with no digit, and a digit survives the strip.) parcelRefAdoption.test.ts
 * pins this against `parcelMatchKey` so the two cannot drift apart.
 */
function looseApnKey(ref: ParcelRef): string {
  const segments = parcelMatchKey(ref).split(" ");
  return segments[segments.length - 1];
}

/**
 * Canonicalize a (state, county, apn) triple into the permalink identity, or
 * null when the input cannot be a real parcel reference.
 *
 * WHICH KEY THIS NEEDS, and why it is the loose one. `apnKey` is a CANDIDATE
 * key — it is what `findReport` looks a permalink up by and what the upsert in
 * `getOrCreateReport` conflicts on, i.e. its whole job is that
 * /p/tx/travis/123-45-678 and /p/tx/travis/12345678 land on the SAME saved
 * page instead of generating two. That is URL dedup, so `parcelMatchKey` is
 * the right rule and it is used deliberately here.
 *
 * The cost is stated plainly rather than hidden: in a county where the APN
 * separator is significant, two genuinely different parcels share one public
 * report row. That is the standing behaviour of this surface (the column is
 * `public_parcel_reports.apn_key`, already written and uniquely indexed on the
 * stripped form) — tightening it to `parcelKey` would orphan every saved
 * permalink, since rows stored under "12345678" would no longer be found by a
 * request for "123-45-678". Changing it is a data migration, not an edit here.
 * Until then: this is a lookup, and NOTHING may promote it to a claim that two
 * parcels are the same parcel. The strict identity for the same triple is
 * `parcelKey(normalizeParcelRef({state, county, apn}).ref)`.
 *
 * The parcel-shaped rules (two-letter state, county present, APN present and
 * containing a digit, whitespace collapsed) come from parcelRef — the same
 * owner dueDiligence and the tax-delinquent importer use. What stays local is
 * only genuinely URL-shaped: the real-US-state whitelist (stricter than
 * parcelRef's two-letter test — it refuses /p/zz/…), the county slug, and the
 * permalink length bounds. The accept/reject set is unchanged by the adoption;
 * parcelRefAdoption.test.ts proves it differentially against the old rule.
 */
export function normalizeReportKey(
  stateRaw: string,
  countyRaw: string,
  apnRaw: string,
): ReportKey | null {
  const state = String(stateRaw || "").trim().toUpperCase();
  if (!US_STATE_CODES.has(state)) return null;

  const countyDecoded = safeDecode(countyRaw).trim();
  const apn = safeDecode(apnRaw).trim();

  // ONE definition of "the same parcel" — shared/parcel/parcelRef.ts. It
  // REFUSES a half-formed key (no county, no APN, digitless APN) instead of
  // guessing, which is also what keeps crawler-fuzzed junk like
  // /p/tx/travis/about from ever creating a row.
  const parcelRef = normalizeParcelRef({ state, county: countyDecoded, apn });
  if (!parcelRef.ok) return null;

  const countySlug = parcelRef.ref.county
    .replace(/\s+county$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!countySlug || countySlug.length > 64) return null;
  const countyLabel = countySlug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

  // Permalink length bounds: a URL-shape guard, not a parcel rule.
  const apnKey = looseApnKey(parcelRef.ref);
  if (apnKey.length < 2 || apnKey.length > 64) return null;

  // `apn` stays the caller's display spelling (what the page and the county
  // GIS query use); `apnKey` is the loose lookup key described above.
  return { state: parcelRef.ref.state, countySlug, countyLabel, apn, apnKey };
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(String(v || ""));
  } catch {
    return String(v || "");
  }
}

// ── Honest partial LCS ───────────────────────────────────────────────────────

const DIMENSION_LABELS: Record<PublicLcsDimensionKey, string> = {
  location: "Location",
  physical: "Physical",
  legal: "Legal",
  financial: "Financial",
  environmental: "Environmental",
  market: "Market",
};

/** Sub-factors per dimension that need full-AcreOS (paid/owner) data. Named
 *  so the locked tiles can say exactly WHAT is missing, never guess at it. */
const LOCKED_SUBFACTORS: Record<PublicLcsDimensionKey, string[]> = {
  location: ["marketStrength", "growthRate", "economicHealth", "accessibility"],
  physical: ["waterAccess", "utilities", "roadAccess"],
  legal: ["zoning", "restrictions", "mineralRights", "waterRights", "clearTitle"],
  financial: ["cashFlow", "appreciation", "liquidity", "taxBurden", "maintenanceCost"],
  environmental: ["wildfire", "contamination", "endangered"],
  market: ["demand", "supply", "priceHistory", "daysOnMarket", "comparables"],
};

/**
 * FEMA flood-zone → 0–100 sub-factor score. Mirrors the in-app
 * scoreEnvironmental mapping (landCredit.ts) with zone-family handling for
 * the raw NFHL strings the broker returns ("Zone AE", "Zone X (Minimal …)").
 * Returns null for indeterminate zones (D / unstudied) — null means UNSCORED,
 * never a guessed value.
 */
export function floodZoneSubScore(zoneRaw: unknown): number | null {
  if (typeof zoneRaw !== "string" || !zoneRaw.trim()) return null;
  const m = /\b(VE|V|AE|AH|AO|AR|A99|A|X500|X|B|C|D)\b/i.exec(
    zoneRaw.toUpperCase().replace(/ZONE/g, " "),
  );
  if (!m) return null;
  const zone = m[1].toUpperCase();
  if (zone === "V" || zone === "VE") return 20; // coastal high-hazard
  if (zone.startsWith("A")) return 40; // high risk (A/AE/AH/AO/AR/A99)
  if (zone === "B" || zone === "X500") return 75; // moderate
  if (zone === "X" || zone === "C") return 95; // minimal
  return null; // D / unstudied — honestly unscored
}

/** USFWS NWI wetlands presence → 0–100 sub-factor score. */
export function wetlandsSubScore(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const has = (data as Record<string, unknown>).hasWetlands;
  if (typeof has !== "boolean") return null;
  // Mirrors landCredit's wetlands default (85 = no protected-area drag);
  // mapped wetlands on the parcel point are a real development constraint.
  return has ? 40 : 85;
}

/** USDA SSURGO capability/suitability → 0–100 soil-quality sub-factor. */
export function soilSubScore(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const soilType = typeof d.soilType === "string" ? d.soilType : null;
  if (!soilType || soilType === "Unknown") return null;
  const cap = typeof d.capabilityClass === "string" ? d.capabilityClass : null;
  if (cap) {
    if (["I", "II"].includes(cap)) return 90;
    if (cap === "III") return 75;
    if (["IV", "V"].includes(cap)) return 60;
    return 40; // VI–VIII — severe limitations
  }
  const suitability = typeof d.suitability === "string" ? d.suitability : null;
  if (suitability === "prime") return 90;
  if (suitability === "suitable") return 70;
  if (suitability === "limited") return 45;
  // "good" is the broker's no-capability-data default — not a measured fact.
  return null;
}

/**
 * Compute the honest PARTIAL Land Credit Score from free-data categories.
 *
 * Invariants (unit-tested):
 *  - A locked dimension ALWAYS carries score:null.
 *  - A dimension is scored only when ≥1 sub-factor has a real observed value.
 *  - partialScore is computed over scored dimensions only (weights
 *    renormalized) on the same 300–850 scale + grade thresholds as the
 *    in-app score; null when nothing could be scored.
 */
export function computePartialLcs(
  categories: PublicReportFactCategory[],
): PublicLcs {
  const byCat = new Map(categories.map((c) => [c.category, c]));
  const get = (cat: string) => {
    const c = byCat.get(cat);
    return c && c.available ? c : null;
  };

  // ── Environmental: FEMA flood + USFWS wetlands ──
  const flood = get("flood_zone");
  const wetlands = get("wetlands");
  const floodScore = flood
    ? floodZoneSubScore((flood.data as Record<string, unknown> | null)?.zone)
    : null;
  const wetScore = wetlands ? wetlandsSubScore(wetlands.data) : null;
  const envParts: Array<{ name: string; score: number; source: string }> = [];
  if (floodScore !== null) envParts.push({ name: "floodRisk", score: floodScore, source: flood?.source ?? "FEMA NFHL" });
  if (wetScore !== null) envParts.push({ name: "wetlands", score: wetScore, source: wetlands?.source ?? "USFWS NWI" });

  // ── Physical: USDA SSURGO soil (the one sub-factor free data informs) ──
  const soil = get("soil");
  const soilScore = soil ? soilSubScore(soil.data) : null;
  const physParts: Array<{ name: string; score: number; source: string }> = [];
  if (soilScore !== null) physParts.push({ name: "soilQuality", score: soilScore, source: soil?.source ?? "USDA SSURGO" });

  const dimensions: PublicLcsDimension[] = (
    Object.keys(LCS_DIMENSION_WEIGHTS) as PublicLcsDimensionKey[]
  ).map((key) => {
    const weight = LCS_DIMENSION_WEIGHTS[key];
    const parts =
      key === "environmental" ? envParts : key === "physical" ? physParts : [];
    if (parts.length === 0) {
      return {
        key,
        label: DIMENSION_LABELS[key],
        weight,
        status: "locked" as const,
        score: null, // invariant: locked never carries a value
        coverage: [],
        missing: LOCKED_SUBFACTORS[key],
        sources: [],
      };
    }
    const score = Math.round(
      parts.reduce((sum, p) => sum + p.score, 0) / parts.length,
    );
    return {
      key,
      label: DIMENSION_LABELS[key],
      weight,
      status: "scored" as const,
      score,
      coverage: parts.map((p) => p.name),
      missing: LOCKED_SUBFACTORS[key].filter(
        (f) => !parts.some((p) => p.name === f),
      ),
      sources: Array.from(new Set(parts.map((p) => p.source))),
    };
  });

  const scored = dimensions.filter((d) => d.status === "scored");
  // Total LCS dimension weight (the in-app score's denominator — sums to 100
  // across all six dimensions). Computed, not hardcoded, so it tracks any
  // future weight change in landCredit.ts.
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const scoredWeight = scored.reduce((s, d) => s + d.weight, 0);
  // How much of the scoring weight the partial score actually covers — the
  // honest quantification of partiality (truth-ratchet). 0 when nothing scored.
  const weightCoveredPct =
    totalWeight > 0 ? Math.round((scoredWeight / totalWeight) * 100) : 0;
  let partialScore: number | null = null;
  let partialGrade: string | null = null;
  if (scored.length > 0) {
    const weighted =
      scored.reduce((s, d) => s + (d.score as number) * d.weight, 0) /
      scoredWeight;
    partialScore = lcsCreditScale(Math.round(weighted));
    partialGrade = lcsGradeForScore(partialScore);
  }

  return {
    kind: "partial",
    basis: "government-data-only",
    scoredDimensions: scored.length,
    totalDimensions: dimensions.length,
    weightCoveredPct,
    partialScore,
    partialGrade,
    dimensions,
    modelVersion: PUBLIC_LCS_MODEL_VERSION,
    computedAt: new Date().toISOString(),
    // L1 liability shield — the legend travels with the score payload so
    // any renderer or forwarder of this JSON carries the framing too.
    disclaimer: DISCLAIMER_INFORMATIONAL_SCORE,
  };
}

// ── Report generation ────────────────────────────────────────────────────────

export type ReportResult =
  | { ok: true; report: PublicParcelReport; generated: boolean }
  | { ok: false; reason: "no_free_source" | "daily_capacity" };

function isFresh(report: PublicParcelReport): boolean {
  const refreshed = report.refreshedAt
    ? new Date(report.refreshedAt).getTime()
    : 0;
  return Date.now() - refreshed < REPORT_TTL_MS;
}

async function findReport(key: ReportKey): Promise<PublicParcelReport | null> {
  const [row] = await db
    .select()
    .from(publicParcelReports)
    .where(
      and(
        eq(publicParcelReports.state, key.state),
        eq(publicParcelReports.countySlug, key.countySlug),
        eq(publicParcelReports.apnKey, key.apnKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** UTC-day generation count — the spike detector + hard-cap input. */
async function countGeneratedToday(): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(publicParcelReports)
    .where(gte(publicParcelReports.createdAt, dayStart));
  return row?.n ?? 0;
}

/**
 * Per-county redistribution status from the GIS registry (Beatrice licensing
 * policy). Defaults to NOT redistributable on any miss/error.
 */
async function countyRedistribution(
  key: ReportKey,
): Promise<{ allowed: boolean; attribution: string | null }> {
  try {
    const rows = await db
      .select({
        county: countyGisEndpoints.county,
        redistributable: countyGisEndpoints.redistributable,
        attribution: countyGisEndpoints.attribution,
      })
      .from(countyGisEndpoints)
      .where(
        and(
          eq(countyGisEndpoints.state, key.state),
          eq(countyGisEndpoints.isActive, true),
        ),
      );
    const match = rows.find(
      (r) =>
        r.county
          .toLowerCase()
          .replace(/\s+county$/i, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") === key.countySlug,
    );
    if (!match) return { allowed: false, attribution: null };
    const allowed =
      match.redistributable === "yes" || match.redistributable === "attribution";
    return { allowed, attribution: allowed ? match.attribution ?? null : null };
  } catch (err) {
    logger.warn("[public-parcel-report] redistribution lookup failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return { allowed: false, attribution: null };
  }
}

const GEO_SOURCE_NAMES: Record<string, string> = {
  flood_zone: "FEMA NFHL",
  soil: "USDA SSURGO",
  elevation: "USGS 3DEP",
  wetlands: "USFWS NWI",
};

/**
 * Build the free-data facts for a parcel. EVERY lookup is pinned to
 * orgTier:"free" + maxTier:"free" with no org/credit context — the registry's
 * tier filter makes paid providers structurally unreachable on this path.
 */
async function buildFacts(key: ReportKey): Promise<PublicReportFacts | null> {
  // 1) Parcel identity via the county GIS registry (free tier only).
  const parcelResolved = await resolveParcel(
    { type: "apn", apn: key.apn, state: key.state, county: key.countyLabel },
    { categories: ["parcel_data"], orgTier: "free", maxTier: "free" },
  );
  const parcelCat = parcelResolved.results["parcel_data"];
  const parcelData =
    parcelCat && parcelCat.available
      ? (parcelCat.data as {
          centroid?: { lat: number; lng: number };
          data?: Record<string, unknown>;
        } | null)
      : null;

  const centroid =
    parcelData?.centroid &&
    Number.isFinite(parcelData.centroid.lat) &&
    Number.isFinite(parcelData.centroid.lng) &&
    (parcelData.centroid.lat !== 0 || parcelData.centroid.lng !== 0)
      ? { lat: parcelData.centroid.lat, lng: parcelData.centroid.lng }
      : null;

  // Without a county match there are no coordinates and therefore no facts —
  // the permalink stays honest (404) instead of fabricating an empty report.
  if (!parcelData || !centroid) return null;

  const acresRaw = parcelData.data?.acres;
  const acres =
    typeof acresRaw === "number" && Number.isFinite(acresRaw)
      ? acresRaw
      : typeof acresRaw === "string" && Number.isFinite(Number(acresRaw))
        ? Number(acresRaw)
        : null;

  // 2) Federal geo facts from the centroid (US-gov public domain sources).
  const geoResolved = await resolveParcel(
    { type: "coordinates", latitude: centroid.lat, longitude: centroid.lng },
    {
      categories: [...REPORT_GEO_CATEGORIES],
      orgTier: "free",
      maxTier: "free",
    },
  );

  const categories: PublicReportFactCategory[] = REPORT_GEO_CATEGORIES.map(
    (category) => {
      const r = geoResolved.results[category];
      const ok = !!r && r.available && r.data != null;
      return {
        category,
        available: ok,
        data: ok ? r.data : null,
        // Provenance survives an empty result (honesty contract — same as
        // routes-public-parcel-check): an absence stays attributable.
        source: r?.source ?? GEO_SOURCE_NAMES[category] ?? null,
        sourceAsOf: r?.sourceAsOf ?? null,
        classification: ok ? r.classification : "unknown",
        fromCache: ok ? r.fromCache : false,
      };
    },
  );

  // 3) County-assessor attributes — persisted only where the county's terms
  //    allow redistribution. acres rides along (it is the load-bearing parcel
  //    fact); owner/tax/value attributes are the license-sensitive ones.
  const redistribution = await countyRedistribution(key);
  let assessorData: Record<string, unknown> | null = null;
  if (redistribution.allowed && parcelData.data) {
    const d = parcelData.data;
    assessorData = {};
    for (const field of [
      "owner",
      "taxAmount",
      "assessedValue",
      "marketValue",
      "taxStatus",
      "lastSalePrice",
      "lastSaleDate",
    ]) {
      if (d[field] !== undefined && d[field] !== null && d[field] !== "") {
        assessorData[field] = d[field];
      }
    }
    if (Object.keys(assessorData).length === 0) assessorData = null;
  }

  return {
    parcel: {
      apn: key.apn,
      state: key.state,
      county: key.countyLabel,
      acres,
      centroid,
      countyAttributes: redistribution.allowed
        ? "included"
        : "not-redistributable",
      attribution: redistribution.attribution,
      assessorData,
    },
    categories,
  };
}

/** Once-per-day spike alert + the hard-cap refusal, wired into telemetry. */
async function applyDailyGuards(): Promise<{ capped: boolean }> {
  let todayCount = 0;
  try {
    todayCount = await countGeneratedToday();
  } catch (err) {
    // Counting failure must not take the surface down — log and proceed.
    logger.warn("[public-parcel-report] daily count failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return { capped: false };
  }

  const day = new Date().toISOString().slice(0, 10);
  if (todayCount >= PUBLIC_REPORT_DAILY_ALERT) {
    // raiseAlert dedupes on (source, dedupeKey) — per-day key means one
    // durable finding per spike day, not one per request.
    void raiseAlert({
      severity: "warning",
      source: "public_parcel_reports",
      title: "Public parcel report generation spike",
      detail: `${todayCount} reports generated today (alert threshold ${PUBLIC_REPORT_DAILY_ALERT}, hard cap ${PUBLIC_REPORT_DAILY_HARD_CAP}). Free upstreams only, but volume may indicate scraping.`,
      dedupeKey: `daily-spike:${day}`,
      domain: "reliability",
      citedReason:
        "Tier 3A cost guard — public generation volume must stay bounded.",
      metadata: { todayCount, day },
    }).catch(() => {});
  }
  return { capped: todayCount >= PUBLIC_REPORT_DAILY_HARD_CAP };
}

/**
 * Resolve (or build) the saved public report for a permalink. Idempotent:
 * repeat calls within the TTL are a single SELECT; a stale row is refreshed
 * in place so the permalink id/URL never changes.
 */
export async function getOrCreateReport(key: ReportKey): Promise<ReportResult> {
  const existing = await findReport(key);
  if (existing && isFresh(existing)) {
    publicParcelReportEventsTotal.inc({ event: "cache_hit" });
    return { ok: true, report: existing, generated: false };
  }

  // Cost guard BEFORE any upstream work.
  const { capped } = await applyDailyGuards();
  if (capped) {
    publicParcelReportEventsTotal.inc({ event: "capped" });
    if (existing) {
      // Serve the stale-but-real report rather than failing the permalink.
      return { ok: true, report: existing, generated: false };
    }
    return { ok: false, reason: "daily_capacity" };
  }

  let facts: PublicReportFacts | null = null;
  try {
    facts = await buildFacts(key);
  } catch (err) {
    logger.error("[public-parcel-report] fact build failed", err instanceof Error ? err : undefined, {
      metadata: { state: key.state, county: key.countySlug },
    });
    facts = null;
  }

  if (!facts) {
    publicParcelReportEventsTotal.inc({ event: "unavailable" });
    if (existing) {
      // Upstream blinked but we have a saved report — keep serving it.
      return { ok: true, report: existing, generated: false };
    }
    return { ok: false, reason: "no_free_source" };
  }

  const lcs = computePartialLcs(facts.categories);

  const values = {
    state: key.state,
    countySlug: key.countySlug,
    countyLabel: key.countyLabel,
    apn: key.apn,
    apnKey: key.apnKey,
    facts,
    lcs,
    latitude: facts.parcel.centroid?.lat ?? null,
    longitude: facts.parcel.centroid?.lng ?? null,
  };

  // Upsert on the permalink identity so a concurrent first-hit race resolves
  // to one row (the unique index is the arbiter, not application logic).
  const [report] = await db
    .insert(publicParcelReports)
    .values(values)
    .onConflictDoUpdate({
      target: [
        publicParcelReports.state,
        publicParcelReports.countySlug,
        publicParcelReports.apnKey,
      ],
      set: {
        facts: values.facts,
        lcs: values.lcs,
        latitude: values.latitude,
        longitude: values.longitude,
        refreshedAt: sql`now()`,
      },
    })
    .returning();

  publicParcelReportEventsTotal.inc({ event: "generated" });
  logger.info("[public-parcel-report] generated", {
    metadata: {
      state: key.state,
      county: key.countySlug,
      generated: !existing,
      scoredDimensions: lcs.scoredDimensions,
    },
  });

  return { ok: true, report, generated: true };
}

/** Read-only lookup — used by the HTML/OG/sitemap paths, which must NEVER
 *  trigger generation work (crawler URL fuzzing cannot create rows). */
export async function getExistingReport(
  key: ReportKey,
): Promise<PublicParcelReport | null> {
  return findReport(key);
}

/** Server-side truth for report consumption: bump view_count atomically. */
export async function recordReportView(reportId: number): Promise<void> {
  try {
    await db
      .update(publicParcelReports)
      .set({
        viewCount: sql`${publicParcelReports.viewCount} + 1`,
        lastViewedAt: new Date(),
      })
      .where(eq(publicParcelReports.id, reportId));
    publicParcelReportEventsTotal.inc({ event: "view" });
  } catch (err) {
    logger.warn("[public-parcel-report] view count update failed", {
      metadata: { reportId, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

/** Reports that actually exist, newest first — the /p sitemap source. */
export async function listReportsForSitemap(
  limit = 5000,
): Promise<
  Array<{ state: string; countySlug: string; apn: string; refreshedAt: Date | null }>
> {
  const rows = await db
    .select({
      state: publicParcelReports.state,
      countySlug: publicParcelReports.countySlug,
      apn: publicParcelReports.apn,
      refreshedAt: publicParcelReports.refreshedAt,
    })
    .from(publicParcelReports)
    .orderBy(sql`${publicParcelReports.refreshedAt} DESC`)
    .limit(limit);
  return rows;
}

/** Canonical permalink path for a report key (used by routes + sitemap). */
export function reportPath(key: {
  state: string;
  countySlug: string;
  apn: string;
}): string {
  return `/p/${key.state.toLowerCase()}/${key.countySlug}/${encodeURIComponent(key.apn)}`;
}

// ── OG image (SVG → PNG via sharp in the route) ─────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render the per-report OG card as SVG (1200×630). Pure string assembly from
 * the report's REAL values — the partial grade, the scored dimensions, and
 * the honest "government data only" framing. No fabricated numbers.
 *
 * NOTE on the hex color literals below (#16211a, #7c9a6d, …): these are
 * INTENTIONAL OG-card paint, not a theming surface. This is a rasterized
 * social-share image (SVG → PNG via sharp), rendered server-side outside the
 * app's light/dark theme — there are no design tokens at the SVG layer. The
 * no-hex ratchet (scripts/lint-page-hex.mjs) only scans client/src/pages/**.tsx
 * and does not reach this server .ts string, so the literals stay as-is.
 */
export function buildOgSvg(report: PublicParcelReport): string {
  const lcs = report.lcs;
  const grade = lcs.partialGrade ?? "—";
  const score = lcs.partialScore != null ? String(lcs.partialScore) : "Not yet scored";
  const title = `${report.countyLabel} County, ${report.state}`;
  const apn = `APN ${report.apn}`;
  const scoredDims = lcs.dimensions.filter((d) => d.status === "scored");
  // Server sets weightCoveredPct on every fresh report; derive it from the
  // dimension weights for any legacy row saved before the field existed.
  const totalWeight = lcs.dimensions.reduce((s, d) => s + d.weight, 0);
  const coveredPct =
    typeof lcs.weightCoveredPct === "number"
      ? lcs.weightCoveredPct
      : totalWeight > 0
        ? Math.round(
            (scoredDims.reduce((s, d) => s + d.weight, 0) / totalWeight) * 100,
          )
        : 0;
  const dimLines = scoredDims
    .map(
      (d, i) =>
        `<text x="80" y="${420 + i * 44}" font-size="26" fill="#d6d3cb" font-family="Helvetica, Arial, sans-serif">${escapeXml(
          d.label,
        )} · ${d.score}/100</text>`,
    )
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#16211a"/>
  <rect x="0" y="0" width="1200" height="8" fill="#7c9a6d"/>
  <text x="80" y="120" font-size="34" fill="#9aa896" font-family="Helvetica, Arial, sans-serif">Public parcel report · AcreOS</text>
  <text x="80" y="196" font-size="58" font-weight="bold" fill="#f3f1ea" font-family="Helvetica, Arial, sans-serif">${escapeXml(title)}</text>
  <text x="80" y="252" font-size="30" fill="#bcc5b4" font-family="Helvetica, Arial, sans-serif">${escapeXml(apn)}</text>
  <text x="80" y="356" font-size="96" font-weight="bold" fill="#e8e4d8" font-family="Helvetica, Arial, sans-serif">${escapeXml(score)}</text>
  <text x="${lcs.partialScore != null ? 80 + String(score).length * 56 + 24 : 80}" y="356" font-size="56" font-weight="bold" fill="#7c9a6d" font-family="Helvetica, Arial, sans-serif">${escapeXml(lcs.partialScore != null ? `(${grade})` : "")}</text>
  ${dimLines}
  <text x="80" y="546" font-size="24" fill="#9aa896" font-family="Helvetica, Arial, sans-serif">Based on ${coveredPct}% of scoring weight — government-data dimensions only.</text>
  <text x="80" y="582" font-size="24" fill="#9aa896" font-family="Helvetica, Arial, sans-serif">Partial Land Credit Score. Full score inside AcreOS.</text>
</svg>`;
}
