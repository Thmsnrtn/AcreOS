/**
 * Public county guides (W3 acquisition engine) — /land/:state/:county.
 *
 * Built ONLY from real, sourced numbers:
 *   - the parcel count: parcels AcreOS KEEPS in the county (owned_pipeline);
 *   - the share with road access: from each kept parcel's
 *     legal_access_indication fact, read through the accuracy gate
 *     (projectFactsForCustomer) — refused when the gate has not passed or when
 *     too few parcels carry the fact to state a share;
 *   - tax-sale calendar links: W2's TAX_SALE_SOURCES registry, as listed;
 *   - coverage status: W2's county source census.
 *
 * A county where AcreOS keeps no parcel gets NO guide (null → 404, absent from
 * the sitemap and llms.txt). Nothing here is typed in by hand.
 */
import { and, asc, count, eq, isNull, max, min, sql } from "drizzle-orm";
import { db } from "../db";
import { parcelSnapshots } from "@shared/schema";
import { COVERAGE_LABELS, censusRowFor, type CountyCoverage } from "@shared/landData/countySourceCensus";
import { FACT_ACCURACY } from "@shared/landData/factAccuracyGate";
import { roadAccessShare, type CountyRoadAccess } from "@shared/landData/countyRoadAccessShare";
import { PUBLIC_EXCLUDED_FACTS } from "@shared/landData/publicFactText";
import { PARCEL_FACT_KEYS, type ParcelFactSet } from "@shared/landData/parcelFacts";
import { taxSaleSourcesFor, type TaxSaleSource } from "@shared/landData/taxSaleSources";
import { OWNED_SNAPSHOT_SOURCE, normalizeCountyName } from "./landData/ownedParcelStore";
import { countyLabelOf, countySlugOf, reportPath } from "./publicParcelReport";
import { logger } from "../utils/logger";

/** Parcel report links listed on a guide page (the sitemap carries the rest). */
const GUIDE_PARCEL_LINKS = 100;

export type { CountyRoadAccess };

export interface CountyGuide {
  state: string;
  countySlug: string;
  countyLabel: string;
  parcelCount: number;
  sourceNames: string[];
  retrievedFrom: string;
  retrievedTo: string;
  roadAccess: CountyRoadAccess | null;
  roadAccessRefusal: string | null;
  taxSaleSources: TaxSaleSource[];
  coverage: CountyCoverage | null;
  coverageLabel: string | null;
  parcelLinks: Array<{ apn: string; path: string }>;
}

export function countyGuidePath(state: string, countySlug: string): string {
  return `/land/${state.toLowerCase()}/${countySlug}`;
}

const ownedIn = (state: string, county: string) =>
  and(
    isNull(parcelSnapshots.organizationId),
    eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE),
    eq(parcelSnapshots.state, state),
    eq(parcelSnapshots.county, county),
  );

/** The guide for a county, or null when AcreOS keeps no parcel there. */
export async function getCountyGuide(stateRaw: string, countyRaw: string): Promise<CountyGuide | null> {
  const state = String(stateRaw || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;
  const county = normalizeCountyName(decodeURIComponent(String(countyRaw || "")));
  if (!county || county.length > 64) return null;

  const [agg] = await db
    .select({ n: count(), first: min(parcelSnapshots.fetchedAt), last: max(parcelSnapshots.fetchedAt) })
    .from(parcelSnapshots)
    .where(ownedIn(state, county));
  const parcelCount = Number(agg?.n ?? 0);
  if (parcelCount === 0) return null;

  const sources = await db
    .selectDistinct({ name: sql<string>`${parcelSnapshots.rawData}->>'sourceName'` })
    .from(parcelSnapshots)
    .where(ownedIn(state, county))
    .limit(5);

  const access = await db
    .select({ f: sql<ParcelFactSet["legal_access_indication"] | null>`${parcelSnapshots.facts}->'legal_access_indication'` })
    .from(parcelSnapshots)
    .where(ownedIn(state, county));
  const { share, refusal } = roadAccessShare(access.map((r) => r.f), parcelCount);

  const links = await db
    .select({ apn: parcelSnapshots.apn })
    .from(parcelSnapshots)
    .where(and(ownedIn(state, county), indexableFactsSql()))
    .orderBy(asc(parcelSnapshots.apn))
    .limit(GUIDE_PARCEL_LINKS);

  const slug = countySlugOf(county);
  const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "unknown");
  const coverage = censusRowFor(state, county)?.coverage ?? null;
  return {
    state,
    countySlug: slug,
    countyLabel: countyLabelOf(county),
    parcelCount,
    sourceNames: sources.map((s) => s.name).filter((n): n is string => !!n),
    retrievedFrom: day(agg?.first),
    retrievedTo: day(agg?.last),
    roadAccess: share,
    roadAccessRefusal: refusal,
    taxSaleSources: taxSaleSourcesFor(state, county),
    coverage,
    coverageLabel: coverage ? COVERAGE_LABELS[coverage] : null,
    parcelLinks: links.map((l) => ({ apn: l.apn, path: reportPath({ state, countySlug: slug, apn: l.apn }) })),
  };
}

/**
 * SQL: the kept parcel has at least one fact a public page would SHOW — a
 * computed fact whose gate passed (derived from FACT_ACCURACY, not a list).
 * Used so the sitemap and guide links name only pages that are indexable.
 */
function indexableFactsSql() {
  const keys = PARCEL_FACT_KEYS.filter((k) => FACT_ACCURACY[k].status === "passed" && !PUBLIC_EXCLUDED_FACTS.includes(k));
  if (keys.length === 0) return sql`false`;
  const any = sql.join(
    keys.map((k) => sql`(${parcelSnapshots.facts}->${k}->>'status') = 'computed'`),
    sql` OR `,
  );
  return sql`(${any})`;
}

/** Every county with a guide: AcreOS keeps at least one parcel there. */
export async function listCountyGuides(): Promise<Array<{ state: string; countySlug: string; countyLabel: string; parcelCount: number; lastRetrieved: Date | null }>> {
  const rows = await db
    .select({ state: parcelSnapshots.state, county: parcelSnapshots.county, n: count(), last: max(parcelSnapshots.fetchedAt) })
    .from(parcelSnapshots)
    .where(and(isNull(parcelSnapshots.organizationId), eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE)))
    .groupBy(parcelSnapshots.state, parcelSnapshots.county)
    .orderBy(asc(parcelSnapshots.state), asc(parcelSnapshots.county));
  return rows
    .filter((r) => Number(r.n) > 0)
    .map((r) => ({ state: r.state, countySlug: countySlugOf(r.county), countyLabel: countyLabelOf(r.county), parcelCount: Number(r.n), lastRetrieved: r.last ?? null }));
}

export const SITEMAP_PARCELS_PER_PAGE = 40_000;

/** Owned parcels whose report page is indexable, one sitemap page at a time. */
export async function listIndexableParcels(page: number): Promise<Array<{ state: string; county: string; apn: string; fetchedAt: Date | null }>> {
  return db
    .select({ state: parcelSnapshots.state, county: parcelSnapshots.county, apn: parcelSnapshots.apn, fetchedAt: parcelSnapshots.fetchedAt })
    .from(parcelSnapshots)
    .where(and(isNull(parcelSnapshots.organizationId), eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE), indexableFactsSql()))
    .orderBy(asc(parcelSnapshots.id))
    .limit(SITEMAP_PARCELS_PER_PAGE)
    .offset(Math.max(0, page - 1) * SITEMAP_PARCELS_PER_PAGE);
}

export async function countIndexableParcels(): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(parcelSnapshots)
    .where(and(isNull(parcelSnapshots.organizationId), eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE), indexableFactsSql()));
  return Number(r?.n ?? 0);
}

/**
 * Tell IndexNow (Bing, Yandex) a county's guide and its first parcel pages
 * exist, the moment its parcels land. Best-effort, never throws; dormant when
 * no IndexNow key or public URL is configured.
 */
export async function announceCountyLoaded(stateRaw: string, countyRaw: string): Promise<void> {
  try {
    const guide = await getCountyGuide(stateRaw, countyRaw);
    if (!guide) return;
    const { submitToIndexNow } = await import("./autopilot/searchEngineSubmit");
    const urls = [countyGuidePath(guide.state, guide.countySlug), ...guide.parcelLinks.slice(0, 99).map((p) => p.path)];
    const r = await submitToIndexNow(urls);
    logger.info("[county-guide] IndexNow announce", { metadata: { state: guide.state, county: guide.countySlug, submitted: r.submitted, reason: r.reason } });
  } catch (err) {
    logger.warn("[county-guide] IndexNow announce failed", { metadata: { error: err instanceof Error ? err.message : String(err) } });
  }
}
