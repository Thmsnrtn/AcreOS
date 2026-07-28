import { storage } from "../storage";
import { db } from "../db";
import { dataSources, dataSourceCache } from "@shared/schema";
import { eq, and, gte, desc, sql, or, ilike } from "drizzle-orm";
import type { DataSource } from "@shared/schema";
import { enrichmentCircuitBreaker, countyApiCircuitBreaker, CircuitOpenError } from "../utils/circuitBreaker";
import { logger } from "../utils/logger";

export type AccessTier = "free" | "cached" | "byok" | "paid";
export type LookupCategory =
  | "parcel_data"
  | "flood_zone"
  | "wetlands"
  | "soil"
  | "environmental"
  | "tax_assessment"
  | "market_data"
  | "zoning"
  | "satellite"
  | "valuation"
  | "infrastructure"
  | "natural_hazards"
  | "demographics"
  | "public_lands"
  | "transportation"
  | "water_resources"
  | "elevation"
  | "climate"
  | "agricultural_values"
  | "land_cover"
  | "cropland"
  | "epa_frs"
  | "storm_history"
  | "plss"
  | "watershed"
  | "fema_nri"
  | "usda_clu"
  // Tier-1 open-data signal expansion (founder ruling #10, 2026-07-28):
  | "wildfire_hazard"
  | "broadband";

interface BrokerLookupOptions {
  latitude: number;
  longitude: number;
  state?: string;
  county?: string;
  address?: string;
  apn?: string;
  forceRefresh?: boolean;
  maxTier?: AccessTier;
  byokKeys?: Record<string, string>;
}

interface BrokerResult {
  success: boolean;
  data: any;
  source: {
    id: number;
    title: string;
    tier: AccessTier;
    costCents: number;
  };
  fromCache: boolean;
  cachedAt?: Date;
  lookupTimeMs: number;
  fallbacksUsed: string[];
}

interface MultiLookupResult {
  results: Record<LookupCategory, BrokerResult>;
  totalLookupTimeMs: number;
  successCount: number;
  failureCount: number;
}

interface MapLayer {
  id: number;
  title: string;
  category: string;
  subcategory: string | null;
  geometryType: string | null;
  apiUrl: string | null;
  portalUrl: string | null;
  accessLevel: string | null;
  description: string | null;
}

interface SourceHealth {
  sourceId: number;
  successRate: number;
  avgLatencyMs: number;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  consecutiveFailures: number;
}

interface UsageMetrics {
  sourceId: number;
  lookupCount: number;
  totalCostCents: number;
  cacheHitRate: number;
}

const CACHE_DURATION_DAYS = 30;
const TIER_PRIORITY: AccessTier[] = ["free", "cached", "byok", "paid"];
const DEFAULT_TIMEOUT_MS = 12000;

/**
 * Categories whose fetch implementation is HARDCODED into `executeSourceLookup`
 * against fixed, free, federal/open endpoints (FEMA, USGS, USDA, Census, EPA,
 * BLM, …). These do NOT depend on a `data_sources` DB row's `apiUrl` — the URL
 * is baked in. The ONLY thing a DB row contributed for these was a loop entry to
 * trigger the call.
 *
 * ROOT-CAUSE FIX (Iris, 2026-06-09): historically `lookup()` ran the built-in
 * fetch only INSIDE `for (const source of sources)`. When the `data_sources`
 * table is empty/unseeded in an environment (the prod state on v633), that loop
 * has zero iterations, so the broker returned `success:false` in ~7ms WITHOUT
 * making any network call — uniformly empty free government data on every public
 * parcel-check. These categories must attempt their built-in federal fetch even
 * when no DB row exists. (`parcel_data` county-GIS and the generic-API
 * passthrough genuinely need a DB row and are deliberately excluded.)
 */
const BUILTIN_FEDERAL_CATEGORIES: ReadonlySet<LookupCategory> = new Set<LookupCategory>([
  "flood_zone",
  "wetlands",
  "soil",
  "environmental",
  // "infrastructure" removed 2026-07-28: its only built-in upstream (HIFLD
  // Open) was discontinued Aug 2025 — see RETIRED_CATEGORIES below.
  "natural_hazards",
  "demographics",
  "public_lands",
  "transportation",
  "water_resources",
  "elevation",
  "climate",
  "agricultural_values",
  "land_cover",
  "cropland",
  "epa_frs",
  "storm_history",
  "plss",
  "watershed",
  "fema_nri",
  "usda_clu",
  // Tier-1 open-data expansion (2026-07-28): USFS WHP classified raster
  // identify + FCC BDC broadband availability (keyed-optional — see the
  // unkeyed short-circuit in lookup()).
  "wildfire_hazard",
  "broadband",
]);

/**
 * Synthetic source id for the built-in federal fetch path. Real `data_sources`
 * rows use positive serial ids, the in-memory cache hit uses 0, so a distinct
 * negative sentinel keeps health/usage tracking for the built-in path from
 * colliding with any real row.
 */
const BUILTIN_FEDERAL_SOURCE_ID = -1;

/**
 * Categories whose ONLY upstream source is dead/retired, with no replacement
 * wired in yet. `lookup()` short-circuits these to an explicit, immediate
 * `success:false` (reason in `fallbacksUsed`) instead of timing out against
 * endpoints that no longer exist — refuse-not-fabricate, and don't waste
 * 12s per call pretending the source might answer.
 *
 * infrastructure: the HIFLD hospitals/fire-stations/schools FeatureServers at
 * services1.arcgis.com/Hp6G80Pky0om7QvQ were the sole implementation. HIFLD
 * Open was discontinued Aug 2025 (portal offline) — see
 * docs/company/open-data-program.md ("needs replacement, not extension").
 * When a replacement (state/Overture/NCES) is wired in, delete the entry here
 * and restore the category's fetch implementation + BUILTIN_FEDERAL_CATEGORIES
 * membership.
 */
export const RETIRED_CATEGORIES: Partial<Record<LookupCategory, { title: string; reason: string }>> = {
  infrastructure: {
    title: "HIFLD (discontinued)",
    reason:
      "HIFLD Open discontinued Aug 2025 — hospitals/fire-stations/schools source retired; replacement pending",
  },
};

/**
 * Honest unkeyed state for the broadband category (KEYED-OPTIONAL pattern,
 * mirroring how CENSUS_API_KEY / USDA_NASS_API_KEY degrade): the FCC BDC
 * public data API requires a free FCC-account token (FCC_BDC_TOKEN). Without
 * it we return success:false with this exact reason — NEVER a guessed
 * served/unserved answer.
 */
export const FCC_BDC_UNKEYED_REASON = "FCC_BDC_TOKEN not set — broadband check unavailable";

/**
 * Documented legend of the USFS Wildfire Hazard Potential CLASSIFIED raster
 * (Wildfire Risk to Communities / RMRS WHP): 1=very low, 2=low, 3=moderate,
 * 4=high, 5=very high; 6=non-burnable and 7=water are legend categories, not
 * hazard classes. Values outside the legend map to nulls, never a guess.
 */
export const WHP_CLASS_LABELS: Record<number, "very_low" | "low" | "moderate" | "high" | "very_high"> = {
  1: "very_low",
  2: "low",
  3: "moderate",
  4: "high",
  5: "very_high",
};

/**
 * Map a raw WHP classified pixel value (ImageServer identify `value`, a
 * string per the live-verified response shape — e.g. "4" or "NoData") to the
 * documented class/label. Unmappable/no-data → nulls + an honest note.
 * Live-verified 2026-07-28: classified service returned "4" at 39.65,-105.35
 * and the identify shape is {"value":"<string>"}.
 */
export function whpClassToLabel(raw: unknown): {
  whpClass: number | null;
  whpLabel: "very_low" | "low" | "moderate" | "high" | "very_high" | null;
  note: string | null;
} {
  const s = raw == null ? "" : String(raw).trim();
  if (!s || s.toLowerCase() === "nodata") {
    return { whpClass: null, whpLabel: null, note: "USFS WHP classified raster reports no data at this point" };
  }
  const n = Number(s);
  if (!Number.isInteger(n)) {
    return { whpClass: null, whpLabel: null, note: `USFS WHP returned an unmappable raster value ("${s}")` };
  }
  if (n === 6) {
    return { whpClass: null, whpLabel: null, note: "USFS WHP classifies this point as non-burnable (developed/agriculture/barren) — no hazard class" };
  }
  if (n === 7) {
    return { whpClass: null, whpLabel: null, note: "USFS WHP classifies this point as water — no hazard class" };
  }
  const label = WHP_CLASS_LABELS[n];
  if (!label) {
    return { whpClass: null, whpLabel: null, note: `USFS WHP returned an unmappable raster value ("${s}")` };
  }
  return { whpClass: n, whpLabel: label, note: null };
}

/**
 * FCC BDC fixed-broadband technology codes, per the published BDC data
 * specification. Unknown codes pass through as "tech_<code>" — honest, not
 * guessed.
 */
export const FCC_BDC_TECH_LABELS: Record<number, string> = {
  0: "Other",
  10: "Copper",
  40: "Cable",
  50: "Fiber",
  60: "GSO Satellite",
  61: "NGSO Satellite",
  70: "Unlicensed Fixed Wireless",
  71: "Licensed Fixed Wireless",
  72: "LBR Fixed Wireless",
};

/**
 * Reduce FCC BDC availability records to AVAILABILITY FACTS ONLY.
 *
 * LICENSE CONSTRAINT (docs/company/open-data-duediligence.md): the BDC
 * availability data is public, but the CostQuest location Fabric underneath
 * it is a licensed commercial dataset. We must NEVER store or re-serve Fabric
 * location records (location_id / BSL coordinates / address attributes). This
 * function therefore aggregates to { served, maxDownMbps, maxUpMbps,
 * technologies, providerCount } and deliberately drops every per-location
 * field on the floor. Do not "enrich" this result with Fabric records.
 *
 * Record field names follow the published BDC availability data spec
 * (technology, max_advertised_download_speed, max_advertised_upload_speed,
 * provider_id, brand_name) — built from documented shape; the prod canary
 * will verify against live keyed responses.
 */
export function parseBdcAvailability(records: Array<Record<string, unknown>>): {
  served: boolean | null;
  maxDownMbps: number | null;
  maxUpMbps: number | null;
  technologies: string[];
  providerCount: number | null;
} {
  const providers = new Set<string>();
  const technologies = new Set<string>();
  let maxDown: number | null = null;
  let maxUp: number | null = null;

  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    const down = num(r["max_advertised_download_speed"] ?? r["max_download"]);
    const up = num(r["max_advertised_upload_speed"] ?? r["max_upload"]);
    if (down != null) maxDown = maxDown == null ? down : Math.max(maxDown, down);
    if (up != null) maxUp = maxUp == null ? up : Math.max(maxUp, up);

    const provider = r["provider_id"] ?? r["brand_name"];
    if (provider != null && provider !== "") providers.add(String(provider));

    const techRaw = num(r["technology"] ?? r["tech_code"]);
    if (techRaw != null) {
      technologies.add(FCC_BDC_TECH_LABELS[techRaw] ?? `tech_${techRaw}`);
    }
  }

  return {
    // A keyed, successful query with zero filings for the block is an honest
    // "no fixed service reported" — served:false. (Unkeyed never reaches here.)
    served: records.length > 0,
    maxDownMbps: maxDown,
    maxUpMbps: maxUp,
    technologies: Array.from(technologies).sort(),
    providerCount: providers.size,
  };
}

/**
 * Parse a USDA Soil Data Access `format=json+columnname` payload into rows of
 * { column: value }. Live-verified shape 2026-07-28:
 *   {"Table":[["musym","muname","mukey"],["Gt","Glenbar clay loam...","53350"]]}
 * (first row = column names, remaining rows = value arrays).
 */
export function parseSdaColumnRows(payload: unknown): Array<Record<string, string>> {
  const table = (payload as { Table?: unknown })?.Table;
  if (!Array.isArray(table) || table.length < 2) return [];
  const [header, ...rows] = table;
  if (!Array.isArray(header)) return [];
  return rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => {
      const obj: Record<string, string> = {};
      header.forEach((col, i) => {
        obj[String(col)] = row[i] == null ? "" : String(row[i]);
      });
      return obj;
    });
}

export class DataSourceBroker {
  private healthCache: Map<number, SourceHealth> = new Map();
  private usageMetrics: Map<number, UsageMetrics> = new Map();

  private generateLookupKey(category: LookupCategory, options: BrokerLookupOptions): string {
    const lat = options.latitude.toFixed(4);
    const lng = options.longitude.toFixed(4);
    return `${category}:${lat}:${lng}`;
  }

  private determineTier(source: DataSource): AccessTier {
    const accessLevel = source.accessLevel?.toLowerCase() || "free";
    if (accessLevel === "free" || accessLevel === "public") return "free";
    if (accessLevel === "limited" || accessLevel === "freemium") return "free";
    if (accessLevel === "byok") return "byok";
    return "paid";
  }

  private async getSourcesForCategory(category: LookupCategory): Promise<DataSource[]> {
    const categoryMappings: Record<LookupCategory, string[]> = {
      parcel_data: ["county_gis", "parcel_lookup", "assessor"],
      flood_zone: ["fema_flood", "flood", "environmental"],
      wetlands: ["wetlands_nwi", "wetlands", "environmental"],
      soil: ["usda_soil", "soil", "environmental"],
      environmental: ["epa_superfund", "epa", "environmental", "hazards"],
      tax_assessment: ["county_gis", "assessor", "tax"],
      market_data: ["real_estate_market", "mls", "valuation"],
      zoning: ["county_gis", "zoning", "planning"],
      satellite: ["advanced_analytics", "satellite"],
      valuation: ["real_estate_market", "valuation", "advanced_analytics"],
      infrastructure: ["infrastructure", "hifld", "healthcare", "emergency", "education"],
      natural_hazards: ["natural_hazards", "fema", "seismic", "wildfire", "disasters"],
      demographics: ["demographics", "census", "acs"],
      public_lands: ["public_lands", "blm", "usfs", "nps", "federal_lands"],
      transportation: ["transportation", "dot", "highways", "rail"],
      water_resources: ["water_resources", "usgs", "hydro"],
      elevation: ["elevation", "usgs", "3dep"],
      climate: ["climate", "open_meteo", "noaa_climate"],
      agricultural_values: ["agricultural_values", "usda_ers", "nass"],
      land_cover: ["land_cover", "nlcd", "mrlc"],
      cropland: ["cropland", "cropscape", "usda_cdl"],
      epa_frs: ["epa_frs", "epa", "frs"],
      storm_history: ["storm_history", "noaa_storms", "weather_hazards"],
      plss: ["plss", "cadastral", "blm_cadnsdI"],
      watershed: ["watershed", "nhd", "huc", "waters"],
      fema_nri: ["fema_nri", "national_risk_index", "fema"],
      usda_clu: ["usda_clu", "common_land_units", "fsa"],
      wildfire_hazard: ["wildfire_hazard", "usfs_whp"],
      broadband: ["broadband", "fcc_bdc"],
    };

    const categories = categoryMappings[category] || [category];
    const allSources: DataSource[] = [];

    for (const cat of categories) {
      const sources = await db.select().from(dataSources)
        .where(and(
          eq(dataSources.isEnabled, true),
          sql`${dataSources.category} ILIKE ${'%' + cat + '%'} OR ${dataSources.subcategory} ILIKE ${'%' + cat + '%'}`
        ))
        .orderBy(dataSources.priority);
      allSources.push(...sources);
    }

    const uniqueSources = Array.from(new Map(allSources.map(s => [s.id, s])).values());
    return this.sortByTierAndHealth(uniqueSources);
  }

  async getValidatedSourcesForCategory(category: LookupCategory): Promise<DataSource[]> {
    const allSources = await this.getSourcesForCategory(category);
    const validatedSources = allSources.filter(s => s.isVerified === true);
    return validatedSources.length > 0 ? validatedSources : allSources.slice(0, 3);
  }

  private sortByTierAndHealth(sources: DataSource[]): DataSource[] {
    return sources.sort((a, b) => {
      const verifiedA = a.isVerified ? 0 : 1;
      const verifiedB = b.isVerified ? 0 : 1;
      if (verifiedA !== verifiedB) return verifiedA - verifiedB;

      const tierA = TIER_PRIORITY.indexOf(this.determineTier(a));
      const tierB = TIER_PRIORITY.indexOf(this.determineTier(b));
      if (tierA !== tierB) return tierA - tierB;

      const priorityA = a.priority || 100;
      const priorityB = b.priority || 100;
      if (priorityA !== priorityB) return priorityA - priorityB;

      const healthA = this.healthCache.get(a.id)?.successRate || 0.5;
      const healthB = this.healthCache.get(b.id)?.successRate || 0.5;
      return healthB - healthA;
    });
  }

  private async getCachedResult(lookupKey: string, sourceId?: number): Promise<{ data: any; cachedAt: Date } | null> {
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - CACHE_DURATION_DAYS);

    let query = db.select().from(dataSourceCache)
      .where(and(
        eq(dataSourceCache.lookupKey, lookupKey),
        gte(dataSourceCache.fetchedAt, expirationDate),
        eq(dataSourceCache.successfulFetch, true)
      ))
      .orderBy(desc(dataSourceCache.fetchedAt))
      .limit(1);

    const results = await query;
    if (results.length > 0 && results[0].data) {
      return {
        data: results[0].data,
        cachedAt: results[0].fetchedAt || new Date(),
      };
    }
    return null;
  }

  private async cacheResult(sourceId: number, lookupKey: string, data: any, state?: string, county?: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CACHE_DURATION_DAYS);

    await db.insert(dataSourceCache).values({
      dataSourceId: sourceId,
      lookupKey,
      state: state || null,
      county: county || null,
      data,
      expiresAt,
      successfulFetch: true,
    }).onConflictDoUpdate({
      target: [dataSourceCache.lookupKey, dataSourceCache.dataSourceId],
      set: {
        data,
        expiresAt,
        successfulFetch: true,
        fetchedAt: new Date(),
      },
    }).catch(() => {
      db.insert(dataSourceCache).values({
        dataSourceId: sourceId,
        lookupKey,
        state: state || null,
        county: county || null,
        data,
        expiresAt,
        successfulFetch: true,
      });
    });
  }

  private updateHealth(sourceId: number, success: boolean, latencyMs: number): void {
    const current = this.healthCache.get(sourceId) || {
      sourceId,
      successRate: 0.5,
      avgLatencyMs: 1000,
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
    };

    const newSuccessRate = current.successRate * 0.9 + (success ? 0.1 : 0);
    const newAvgLatency = current.avgLatencyMs * 0.8 + latencyMs * 0.2;

    this.healthCache.set(sourceId, {
      ...current,
      successRate: newSuccessRate,
      avgLatencyMs: newAvgLatency,
      lastSuccess: success ? new Date() : current.lastSuccess,
      lastFailure: success ? current.lastFailure : new Date(),
      consecutiveFailures: success ? 0 : current.consecutiveFailures + 1,
    });
  }

  private trackUsage(sourceId: number, costCents: number, cacheHit: boolean): void {
    const current = this.usageMetrics.get(sourceId) || {
      sourceId,
      lookupCount: 0,
      totalCostCents: 0,
      cacheHitRate: 0,
    };

    const newLookupCount = current.lookupCount + 1;
    const newCacheHitRate = (current.cacheHitRate * current.lookupCount + (cacheHit ? 1 : 0)) / newLookupCount;

    this.usageMetrics.set(sourceId, {
      sourceId,
      lookupCount: newLookupCount,
      totalCostCents: current.totalCostCents + (cacheHit ? 0 : costCents),
      cacheHitRate: newCacheHitRate,
    });
  }

  async lookup(category: LookupCategory, options: BrokerLookupOptions): Promise<BrokerResult> {
    const startTime = Date.now();
    const lookupKey = this.generateLookupKey(category, options);
    const fallbacksUsed: string[] = [];
    const maxTierIndex = options.maxTier ? TIER_PRIORITY.indexOf(options.maxTier) : TIER_PRIORITY.length - 1;

    // ── Retired-source honest short-circuit ─────────────────────────────────
    // The category's only upstream is dead (see RETIRED_CATEGORIES). Return an
    // explicit unavailable state immediately: no network calls, no timeouts,
    // no cache reads (any cached HIFLD payload predates the Aug 2025 shutdown
    // and must not be presented as a live source).
    const retired = RETIRED_CATEGORIES[category];
    if (retired) {
      return {
        success: false,
        data: null,
        source: {
          id: 0,
          title: retired.title,
          tier: "free",
          costCents: 0,
        },
        fromCache: false,
        lookupTimeMs: Date.now() - startTime,
        fallbacksUsed: [retired.reason],
      };
    }

    // ── Broadband keyed-optional honest short-circuit ───────────────────────
    // The FCC BDC public data API needs a free account token. Unkeyed we
    // refuse immediately — success:false with the exact reason, no network
    // call, no health-tracking mutation (an unset env var is a config state,
    // not an upstream failure signal), and no cache read (any cached row was
    // written keyed; re-serving it while unkeyed would misrepresent the
    // current capability). Never fake coverage.
    if (category === "broadband" && !process.env.FCC_BDC_TOKEN) {
      return {
        success: false,
        data: null,
        source: {
          id: 0,
          title: "FCC Broadband Data Collection",
          tier: "free",
          costCents: 0,
        },
        fromCache: false,
        lookupTimeMs: Date.now() - startTime,
        fallbacksUsed: [FCC_BDC_UNKEYED_REASON],
      };
    }

    if (!options.forceRefresh) {
      const cached = await this.getCachedResult(lookupKey);
      if (cached) {
        return {
          success: true,
          data: cached.data,
          source: {
            id: 0,
            title: "Cache",
            tier: "cached",
            costCents: 0,
          },
          fromCache: true,
          cachedAt: cached.cachedAt,
          lookupTimeMs: Date.now() - startTime,
          fallbacksUsed: [],
        };
      }
    }

    const sources = await this.getSourcesForCategory(category);
    
    for (const source of sources) {
      const tier = this.determineTier(source);
      const tierIndex = TIER_PRIORITY.indexOf(tier);
      
      if (tierIndex > maxTierIndex) {
        continue;
      }

      if (tier === "byok" && !options.byokKeys?.[source.key]) {
        continue;
      }

      const health = this.healthCache.get(source.id);
      if (health && health.consecutiveFailures >= 5) {
        fallbacksUsed.push(`${source.title} (disabled - too many failures)`);
        continue;
      }

      try {
        const result = await this.executeSourceLookup(source, category, options);
        const latencyMs = Date.now() - startTime;
        const costCents = source.costPerCall || 0;

        this.updateHealth(source.id, true, latencyMs);
        this.trackUsage(source.id, costCents, false);

        await this.cacheResult(source.id, lookupKey, result, options.state, options.county);

        return {
          success: true,
          data: result,
          source: {
            id: source.id,
            title: source.title,
            tier,
            costCents,
          },
          fromCache: false,
          lookupTimeMs: latencyMs,
          fallbacksUsed,
        };
      } catch (error: any) {
        this.updateHealth(source.id, false, Date.now() - startTime);
        fallbacksUsed.push(`${source.title}: ${error.message}`);
        continue;
      }
    }

    // ── Built-in federal fallback ────────────────────────────────────────────
    // The DB-driven loop above produced nothing — either because no `data_sources`
    // row matched this category (the unseeded-prod failure mode) or because every
    // matching row failed. For categories whose fetch is HARDCODED against fixed
    // free federal/open endpoints (see BUILTIN_FEDERAL_CATEGORIES), the DB row was
    // only ever a loop trigger: the endpoint URL is baked into `executeSourceLookup`.
    // So we attempt the built-in fetch directly via a synthesized virtual source.
    // This is the difference between "delivering nothing in 7ms" and actually
    // reaching FEMA/USGS/USDA/Census. The free tier always permits this path.
    if (BUILTIN_FEDERAL_CATEGORIES.has(category) && maxTierIndex >= TIER_PRIORITY.indexOf("free")) {
      const builtinHealth = this.healthCache.get(BUILTIN_FEDERAL_SOURCE_ID);
      if (builtinHealth && builtinHealth.consecutiveFailures >= 5) {
        // Upstream federal endpoint has been failing repeatedly — honest miss,
        // don't hammer it. This is a real-signal degrade (network), not the
        // empty-DB short-circuit we are fixing.
        fallbacksUsed.push(`built-in federal (${category}): skipped — too many consecutive failures`);
      } else {
        try {
          const virtualSource = this.buildVirtualFederalSource(category);
          const result = await this.executeSourceLookup(virtualSource, category, options);
          const latencyMs = Date.now() - startTime;

          this.updateHealth(BUILTIN_FEDERAL_SOURCE_ID, true, latencyMs);
          this.trackUsage(BUILTIN_FEDERAL_SOURCE_ID, 0, false);
          await this.cacheResult(BUILTIN_FEDERAL_SOURCE_ID, lookupKey, result, options.state, options.county);

          return {
            success: true,
            data: result,
            source: {
              id: BUILTIN_FEDERAL_SOURCE_ID,
              title: virtualSource.title,
              tier: "free",
              costCents: 0,
            },
            fromCache: false,
            lookupTimeMs: latencyMs,
            fallbacksUsed,
          };
        } catch (error: any) {
          this.updateHealth(BUILTIN_FEDERAL_SOURCE_ID, false, Date.now() - startTime);
          fallbacksUsed.push(`built-in federal (${category}): ${error?.message ?? String(error)}`);
        }
      }
    }

    return {
      success: false,
      data: null,
      source: {
        id: 0,
        title: "None",
        tier: "free",
        costCents: 0,
      },
      fromCache: false,
      lookupTimeMs: Date.now() - startTime,
      fallbacksUsed,
    };
  }

  /**
   * Synthesize a minimal in-memory `DataSource` for a built-in federal category.
   * `executeSourceLookup` only reads `source` for `parcel_data`/generic-API paths
   * (excluded from BUILTIN_FEDERAL_CATEGORIES), so the federal queries ignore it
   * entirely — but we give it a real, human-readable title so provenance is honest
   * and a cast keeps us type-safe without inventing fake column values.
   */
  private buildVirtualFederalSource(category: LookupCategory): DataSource {
    const titleByCategory: Partial<Record<LookupCategory, string>> = {
      flood_zone: "FEMA NFHL",
      wetlands: "USFWS NWI",
      soil: "USDA NRCS SDA",
      environmental: "EPA TRI",
      infrastructure: "HIFLD",
      natural_hazards: "USGS/FEMA/WFIGS",
      demographics: "US Census ACS",
      public_lands: "BLM/NPS/USFS",
      transportation: "DOT/ESRI/Census TIGER",
      water_resources: "USGS Water Services",
      elevation: "USGS 3DEP National Map",
      climate: "Open-Meteo ERA5",
      agricultural_values: "USDA ERS / NASS",
      land_cover: "USGS NLCD",
      cropland: "USDA NASS CropScape",
      epa_frs: "EPA FRS",
      storm_history: "NOAA Storm Events",
      plss: "BLM CadNSDI",
      watershed: "EPA WATERS / USGS NHD",
      fema_nri: "FEMA National Risk Index",
      usda_clu: "USDA FSA CLU",
      wildfire_hazard: "USFS Wildfire Hazard Potential",
      broadband: "FCC Broadband Data Collection",
    };

    return {
      id: BUILTIN_FEDERAL_SOURCE_ID,
      title: titleByCategory[category] ?? "Federal Open Data",
      category,
      accessLevel: "free",
      isEnabled: true,
      isVerified: true,
      costPerCall: 0,
      priority: 1,
      apiUrl: null,
      portalUrl: null,
    } as unknown as DataSource;
  }

  async lookupMultiple(categories: LookupCategory[], options: BrokerLookupOptions): Promise<MultiLookupResult> {
    const startTime = Date.now();
    const results: Record<string, BrokerResult> = {};
    let successCount = 0;
    let failureCount = 0;

    const lookupPromises = categories.map(async (category) => {
      try {
        const result = await this.lookup(category, options);
        return { category, result };
      } catch (error: any) {
        return {
          category,
          result: {
            success: false,
            data: null,
            source: { id: 0, title: "Error", tier: "free" as AccessTier, costCents: 0 },
            fromCache: false,
            lookupTimeMs: 0,
            fallbacksUsed: [error.message],
          },
        };
      }
    });

    const lookupResults = await Promise.all(lookupPromises);

    for (const { category, result } of lookupResults) {
      results[category] = result;
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    return {
      results: results as Record<LookupCategory, BrokerResult>,
      totalLookupTimeMs: Date.now() - startTime,
      successCount,
      failureCount,
    };
  }

  async getAvailableLayersForMap(options?: { 
    category?: string; 
    state?: string;
    limit?: number;
  }): Promise<MapLayer[]> {
    try {
      const conditions: any[] = [eq(dataSources.isEnabled, true)];

      if (options?.category) {
        conditions.push(
          or(
            sql`${dataSources.category} ILIKE ${'%' + options.category + '%'}`,
            sql`${dataSources.subcategory} ILIKE ${'%' + options.category + '%'}`
          )
        );
      }

      if (options?.state) {
        conditions.push(
          or(
            sql`${dataSources.coverage} ILIKE ${'%' + options.state + '%'}`,
            eq(dataSources.coverage, 'US')
          )
        );
      }

      const sources = await db.select({
        id: dataSources.id,
        title: dataSources.title,
        category: dataSources.category,
        subcategory: dataSources.subcategory,
        apiUrl: dataSources.apiUrl,
        portalUrl: dataSources.portalUrl,
        accessLevel: dataSources.accessLevel,
        description: dataSources.description,
        coverage: dataSources.coverage,
      }).from(dataSources)
        .where(and(...conditions))
        .orderBy(dataSources.priority)
        .limit(options?.limit || 100);

      return sources.filter(s => s.apiUrl || s.portalUrl).map(s => ({
        ...s,
        geometryType: this.inferGeometryType(s.category, s.subcategory),
      }));
    } catch (error: any) {
      logger.error("Error fetching map layers", error instanceof Error ? error : undefined);
      return [];
    }
  }

  private inferGeometryType(category: string | null, subcategory: string | null): string {
    const cat = (category || '').toLowerCase();
    const sub = (subcategory || '').toLowerCase();
    
    if (cat.includes('parcel') || cat.includes('boundary') || sub.includes('boundary')) return 'polygon';
    if (cat.includes('flood') || cat.includes('wetland') || cat.includes('zone')) return 'polygon';
    if (cat.includes('infrastructure') || sub.includes('hospital') || sub.includes('school')) return 'point';
    if (cat.includes('transportation') || sub.includes('highway') || sub.includes('rail')) return 'line';
    if (cat.includes('water') || sub.includes('stream')) return 'line';
    return 'unknown';
  }

  private async executeSourceLookup(source: DataSource, category: LookupCategory, options: BrokerLookupOptions): Promise<any> {
    const { latitude, longitude } = options;

    if (category === "flood_zone") {
      return this.queryFemaFlood(latitude, longitude);
    }
    if (category === "wetlands") {
      return this.queryNwiWetlands(latitude, longitude);
    }
    if (category === "soil") {
      return this.querySoilData(latitude, longitude);
    }
    if (category === "environmental") {
      return this.queryEpaData(latitude, longitude);
    }
    if (category === "parcel_data" && source.category === "county_gis") {
      return this.queryCountyGis(source, latitude, longitude, options.state, options.county);
    }
    if (category === "infrastructure") {
      return this.queryInfrastructure(latitude, longitude);
    }
    if (category === "natural_hazards") {
      return this.queryNaturalHazards(latitude, longitude);
    }
    if (category === "demographics") {
      return this.queryDemographics(latitude, longitude, options.state);
    }
    if (category === "public_lands") {
      return this.queryPublicLands(latitude, longitude);
    }
    if (category === "transportation") {
      return this.queryTransportation(latitude, longitude);
    }
    if (category === "water_resources") {
      return this.queryWaterResources(latitude, longitude);
    }
    if (category === "elevation") {
      return this.queryElevation(latitude, longitude);
    }
    if (category === "climate") {
      return this.queryClimate(latitude, longitude, options.state);
    }
    if (category === "agricultural_values") {
      return this.queryAgriculturalValues(latitude, longitude, options.state, options.county);
    }
    if (category === "land_cover") {
      return this.queryLandCover(latitude, longitude);
    }
    if (category === "cropland") {
      return this.queryCropland(latitude, longitude);
    }
    if (category === "epa_frs") {
      return this.queryEpaFrs(latitude, longitude);
    }
    if (category === "storm_history") {
      return this.queryStormHistory(latitude, longitude, options.state);
    }
    if (category === "plss") {
      return this.queryPlss(latitude, longitude);
    }
    if (category === "watershed") {
      return this.queryWatershed(latitude, longitude);
    }
    if (category === "fema_nri") {
      return this.queryFemaNri(latitude, longitude);
    }
    if (category === "usda_clu") {
      return this.queryUsdaClu(latitude, longitude);
    }
    if (category === "wildfire_hazard") {
      return this.queryWildfireHazard(latitude, longitude);
    }
    if (category === "broadband") {
      return this.queryBroadband(latitude, longitude);
    }

    if (source.apiUrl) {
      return this.queryGenericApi(source, options);
    }

    throw new Error(`No query implementation for category: ${category}`);
  }

  private async queryFemaFlood(lat: number, lng: number): Promise<any> {
    return enrichmentCircuitBreaker.call(async () => {
      // FEMA migrated the public NFHL service off the `/gis/nfhl/` path (now a
      // WebSEAL gateway that returns an HTML error page) to `/arcgis/`. Using the
      // old host made every flood-zone fetch fail immediately. (Iris, 2026-06-09)
      const baseUrl = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
      const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
      const url = `${baseUrl}/28/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=DFIRM_ID,FLD_ZONE,ZONE_SUBTY,STATIC_BFE&returnGeometry=false&f=json`;

      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) throw new Error(`FEMA API error: ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);

      const feature = data.features?.[0]?.attributes;
      const zone = feature?.FLD_ZONE || "X";
      const highRiskZones = ["A", "AE", "AH", "AO", "AR", "A99", "V", "VE"];
      const mediumRiskZones = ["B", "X500"];

      let riskLevel: "low" | "medium" | "high" = "low";
      if (highRiskZones.some(z => zone.startsWith(z))) riskLevel = "high";
      else if (mediumRiskZones.some(z => zone.startsWith(z))) riskLevel = "medium";

      return {
        zone: feature ? `Zone ${zone}` : "Zone X (Minimal Flood Hazard)",
        riskLevel,
        source: "FEMA NFHL",
        lastUpdated: new Date().toISOString(),
        details: feature || {},
      };
    });
  }

  private async queryNwiWetlands(lat: number, lng: number): Promise<any> {
    const baseUrl = "https://www.fws.gov/wetlands/arcgis/rest/services/Wetlands/MapServer";
    const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
    const url = `${baseUrl}/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=WETLAND_TYPE,ATTRIBUTE,ACRES&returnGeometry=false&f=json`;
    
    const response = await fetch(url, {
      headers: { "User-Agent": "AcreOS Real Estate Platform" },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) throw new Error(`NWI API error: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    const features = data.features || [];
    return {
      hasWetlands: features.length > 0,
      classification: features[0]?.attributes?.WETLAND_TYPE || null,
      percentage: features.length > 0 ? 100 : 0,
      source: "NWI",
      lastUpdated: new Date().toISOString(),
      details: features[0]?.attributes || {},
    };
  }

  /** POST one T-SQL query to SDA and return { column: value } rows. */
  private async postSdaQuery(query: string, timeoutMs: number): Promise<Array<Record<string, string>>> {
    const baseUrl = "https://SDMDataAccess.nrcs.usda.gov/Tabular/post.rest";
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "AcreOS Real Estate Platform" },
      // `json+columnname` so rows carry their column names (plain `json`
      // returns bare value arrays — live-verified 2026-07-28).
      body: `query=${encodeURIComponent(query)}&format=${encodeURIComponent("json+columnname")}`,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`USDA Soil API error: ${response.status}`);
    // SDA answers invalid SQL with an XML ServiceExceptionReport (HTTP 200) —
    // surface that as a real error instead of a JSON parse crash.
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`USDA Soil API returned non-JSON response: ${text.slice(0, 160)}`);
    }
    return parseSdaColumnRows(payload);
  }

  private async querySoilData(lat: number, lng: number): Promise<any> {
    // Basic map unit query. Uses SDA's documented point-intersection helper
    // (SDA_Get_Mukey_from_intersection_with_WktWgs84) — the previous
    // `mupolygonGeometry.STContains(...)` form is rejected by SDA today
    // ("Cannot find either column \"mupolygonGeometry\"...", live-verified
    // 2026-07-28), which silently killed the whole soil lookup.
    const basicQuery = `SELECT TOP 1 musym, muname, mukey FROM mapunit WHERE mukey IN (SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lng} ${lat})'))`;
    const basicRows = await this.postSdaQuery(basicQuery, 15000);
    const basicRow = basicRows[0];
    const mukey = basicRow?.mukey;
    // Guard: mukey is a numeric key; refuse to interpolate anything else into
    // the follow-up T-SQL.
    const safeMukey = mukey && /^\d+$/.test(mukey) ? mukey : null;

    // Extended SDA query for capability class, drainage, flooding, hydric soil, farmland class
    let extended: Record<string, any> = {};
    if (safeMukey) {
      try {
        const extQuery = `SELECT TOP 1 mu.mukey, mu.muname, c.capclass, c.hydgrpdcd, c.drainagecl, c.flodfreqdcd, c.hydricrating, muag.farmlndcl FROM mapunit mu
          LEFT JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes'
          LEFT JOIN muaggatt muag ON muag.mukey = mu.mukey
          WHERE mu.mukey = '${safeMukey}'`;
        const extRows = await this.postSdaQuery(extQuery, 12000);
        const row = extRows[0];
        if (row) {
          extended = {
            capabilityClass: row.capclass || null,
            hydrologicGroup: row.hydgrpdcd || null,
            drainage: row.drainagecl || "Unknown",
            floodingFrequency: row.flodfreqdcd || "None",
            hydricRating: row.hydricrating || null,
            farmlandClass: row.farmlndcl || null,
            primeFarmland: row.farmlndcl?.toLowerCase().includes("prime") || false,
          };
        }
      } catch (_) { /* extended data optional */ }
    }

    // Septic-tank-absorption-fields interpretation (2026-07-28 expansion).
    // SDA exposes the 'ENG - Septic Tank Absorption Fields' interpretation via
    // cointerp; live-verified 2026-07-28 (returned "Very limited" for the
    // Maricopa golden coordinate). Optional sub-fetch: failure → null rating,
    // never a guess. ADDITIVE — the pre-existing soil result fields above and
    // below are unchanged.
    let septicRating: string | null = null;
    if (safeMukey) {
      try {
        const septicQuery = `SELECT TOP 1 c.compname, ci.interphrc FROM component c JOIN cointerp ci ON ci.cokey = c.cokey WHERE c.mukey = '${safeMukey}' AND c.majcompflag = 'Yes' AND ci.mrulename = 'ENG - Septic Tank Absorption Fields' AND ci.ruledepth = 0 ORDER BY c.comppct_r DESC`;
        const septicRows = await this.postSdaQuery(septicQuery, 12000);
        septicRating = septicRows[0]?.interphrc || null;
      } catch (_) { /* septic interpretation optional */ }
    }

    const capClass = extended.capabilityClass;
    const suitability = capClass
      ? (["I","II","III"].includes(capClass) ? "prime" : ["IV","V"].includes(capClass) ? "suitable" : "limited")
      : "good";

    return {
      soilType: basicRow?.muname || "Unknown",
      soilSymbol: basicRow?.musym || "Unknown",
      suitability,
      drainage: extended.drainage || "Unknown",
      capabilityClass: extended.capabilityClass || null,
      hydrologicGroup: extended.hydrologicGroup || null,
      floodingFrequency: extended.floodingFrequency || null,
      hydricRating: extended.hydricRating || null,
      farmlandClass: extended.farmlandClass || null,
      primeFarmland: extended.primeFarmland || false,
      septicRating,
      septicRatingSource: "USDA SSURGO septic tank absorption fields",
      source: "USDA NRCS SDA",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryEpaData(lat: number, lng: number): Promise<any> {
    const radiusMiles = 3;
    const url = `https://data.epa.gov/efservice/tri_facility/latitude/${lat}/longitude/${lng}/radius/${radiusMiles}/JSON`;
    
    const response = await fetch(url, {
      headers: { "User-Agent": "AcreOS Real Estate Platform" },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) throw new Error(`EPA API error: ${response.status}`);
    const sites = await response.json();

    // ── EPA depth (2026-07-28 expansion) — ADDITIVE fields only ─────────────
    // ECHO enforcement/violations radius context + UST Finder tank proximity.
    // Both are optional sub-fetches: a failure yields an honest null + note,
    // never a guessed count. The pre-existing superfund fields below are
    // untouched.
    const depthNotes: string[] = [];

    // EPA ECHO get_facilities (keyless REST; live-verified 2026-07-28 —
    // summary envelope Results.{QueryRows,CVRows,...}). CVRows = facilities
    // currently in violation within the radius.
    let echoFacilitiesWithViolations: number | null = null;
    try {
      const echoUrl = `https://echodata.epa.gov/echo/echo_rest_services.get_facilities?output=JSON&p_lat=${lat}&p_long=${lng}&p_radius=${radiusMiles}`;
      const echoRes = await fetch(echoUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform", "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!echoRes.ok) throw new Error(`EPA ECHO error: ${echoRes.status}`);
      const echoData = await echoRes.json();
      const cvRows = Number.parseInt(echoData?.Results?.CVRows, 10);
      if (Number.isFinite(cvRows)) {
        echoFacilitiesWithViolations = cvRows;
      } else {
        depthNotes.push(`EPA ECHO responded without a facilities-in-violation count (${radiusMiles} mi radius)`);
      }
    } catch (_) {
      depthNotes.push(`EPA ECHO enforcement lookup unavailable (${radiusMiles} mi radius)`);
    }

    // EPA UST Finder Facilities layer (keyless ArcGIS REST; live-verified
    // 2026-07-28 — returnCountOnly=true yields {"count":N}). 1-mile proximity.
    let ustSitesNearby: number | null = null;
    const ustRadiusMeters = 1609; // 1 mile
    try {
      const ustGeometry = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
      const ustUrl = `https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/UST_Finder_Feature_Layer_2/FeatureServer/0/query?geometry=${ustGeometry}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=${ustRadiusMeters}&units=esriSRUnit_Meter&returnCountOnly=true&f=json`;
      const ustRes = await fetch(ustUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(10000),
      });
      if (!ustRes.ok) throw new Error(`EPA UST Finder error: ${ustRes.status}`);
      const ustData = await ustRes.json();
      if (ustData?.error) throw new Error(ustData.error.message || "UST Finder query error");
      if (typeof ustData?.count === "number") {
        ustSitesNearby = ustData.count;
      } else {
        depthNotes.push("EPA UST Finder responded without a tank-facility count (1 mi radius)");
      }
    } catch (_) {
      depthNotes.push("EPA UST Finder tank-proximity lookup unavailable (1 mi radius)");
    }

    return {
      superfundSites: sites.slice(0, 10).map((site: any) => ({
        name: site.FACILITY_NAME,
        address: site.STREET_ADDRESS,
        city: site.CITY,
        state: site.STATE,
      })),
      nearestSiteDistance: sites.length > 0 ? radiusMiles : null,
      riskLevel: sites.length > 5 ? "high" : sites.length > 0 ? "medium" : "low",
      // Additive EPA-depth fields (contract keys — do not rename):
      echoFacilitiesWithViolations,
      ustSitesNearby,
      note: depthNotes.length > 0 ? depthNotes.join("; ") : null,
      source: "EPA TRI",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryCountyGis(source: DataSource, lat: number, lng: number, state?: string, county?: string): Promise<any> {
    if (!source.portalUrl && !source.apiUrl) {
      throw new Error("No GIS endpoint configured for this county");
    }

    const baseUrl = source.apiUrl || source.portalUrl;
    if (!baseUrl) throw new Error("No API URL available");

    return countyApiCircuitBreaker.call(async () => {
      const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
      const url = `${baseUrl}/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;

      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) throw new Error(`County GIS error: ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);

      return {
        parcelData: data.features?.[0]?.attributes || {},
        source: source.title,
        lastUpdated: new Date().toISOString(),
      };
    });
  }

  private async queryInfrastructure(_lat: number, _lng: number): Promise<any> {
    // The former implementation queried HIFLD hospitals/fire-stations/schools
    // FeatureServers at services1.arcgis.com/Hp6G80Pky0om7QvQ. HIFLD Open was
    // discontinued Aug 2025 (portal offline); those endpoints are dead. Normal
    // lookups never reach here — `lookup()` short-circuits via
    // RETIRED_CATEGORIES — but any direct/DB-row-driven path gets the same
    // honest refusal instead of a fetch against a dead host.
    throw new Error(RETIRED_CATEGORIES.infrastructure!.reason);
  }

  private async queryNaturalHazards(lat: number, lng: number): Promise<any> {
    const results: Record<string, any> = {};

    const geometryParam = encodeURIComponent(JSON.stringify({ 
      x: lng, y: lat, spatialReference: { wkid: 4326 } 
    }));

    try {
      const femaUrl = `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
      const femaResponse = await fetch(femaUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (femaResponse.ok) {
        const femaData = await femaResponse.json();
        results.floodHazard = femaData.features?.[0]?.attributes || null;
      }
    } catch (error) {
      results.floodHazard = null;
    }

    try {
      const quakeUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lng}&maxradiuskm=100&minmagnitude=2.5&orderby=time&limit=10`;
      const quakeResponse = await fetch(quakeUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (quakeResponse.ok) {
        const quakeData = await quakeResponse.json();
        results.recentEarthquakes = (quakeData.features || []).map((f: any) => ({
          magnitude: f.properties.mag,
          place: f.properties.place,
          time: new Date(f.properties.time).toISOString(),
          depth: f.geometry.coordinates[2],
        }));
      }
    } catch (error) {
      results.recentEarthquakes = [];
    }

    try {
      const wildfireUrl = `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=50000&units=esriSRUnit_Meter&outFields=poly_IncidentName,poly_GISAcres,attr_FireDiscoveryDateTime&returnGeometry=false&f=json`;
      const wildfireResponse = await fetch(wildfireUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (wildfireResponse.ok) {
        const wildfireData = await wildfireResponse.json();
        results.activeWildfires = (wildfireData.features || []).slice(0, 10).map((f: any) => ({
          name: f.attributes.poly_IncidentName,
          acres: f.attributes.poly_GISAcres,
          discoveryDate: f.attributes.attr_FireDiscoveryDateTime,
        }));
      }
    } catch (error) {
      results.activeWildfires = [];
    }

    const earthquakeRisk = (results.recentEarthquakes || []).length > 5 ? "high" :
      (results.recentEarthquakes || []).length > 0 ? "medium" : "low";
    const wildfireRisk = (results.activeWildfires || []).length > 0 ? "high" : "low";

    // FEMA FIRM panel lookup (panel ID, effective date, digitized flag)
    try {
      const firmUrl = `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/3/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=FIRM_PAN,PANEL,SUFFIX,EFF_DATE,CASE_NO,STATUS,NP_DATE,SOURCE_CIT&returnGeometry=false&f=json`;
      const firmResponse = await fetch(firmUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (firmResponse.ok) {
        const firmData = await firmResponse.json();
        const firmAttr = firmData.features?.[0]?.attributes;
        if (firmAttr) {
          results.firmPanel = {
            panelId: firmAttr.FIRM_PAN,
            panelNumber: firmAttr.PANEL,
            suffix: firmAttr.SUFFIX,
            effectiveDate: firmAttr.EFF_DATE ? new Date(firmAttr.EFF_DATE).toISOString().split("T")[0] : null,
            caseNumber: firmAttr.CASE_NO,
            status: firmAttr.STATUS,
            newPanel: firmAttr.NP_DATE ? true : false,
            sourceCitation: firmAttr.SOURCE_CIT,
          };
        } else {
          results.firmPanel = null;
        }
      }
    } catch (_) {
      results.firmPanel = null;
    }

    return {
      floodHazard: results.floodHazard,
      firmPanel: results.firmPanel,
      recentEarthquakes: results.recentEarthquakes || [],
      activeWildfires: results.activeWildfires || [],
      riskAssessment: {
        earthquake: earthquakeRisk,
        wildfire: wildfireRisk,
        flood: results.floodHazard ? "medium" : "low",
      },
      source: "USGS/FEMA/WFIGS",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryDemographics(lat: number, lng: number, state?: string): Promise<any> {
    try {
      const geocodeUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
      const geocodeResponse = await fetch(geocodeUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (!geocodeResponse.ok) {
        throw new Error(`Census geocode error: ${geocodeResponse.status}`);
      }

      const geocodeData = await geocodeResponse.json();
      const geographies = geocodeData.result?.geographies || {};
      const tract = geographies["Census Tracts"]?.[0];
      const county = geographies["Counties"]?.[0];
      const stateGeo = geographies["States"]?.[0];

      if (!tract) {
        return {
          available: false,
          message: "Census tract not found for coordinates",
          source: "Census Bureau",
          lastUpdated: new Date().toISOString(),
        };
      }

      const stateCode = tract.STATE || stateGeo?.STATE;
      const countyCode = tract.COUNTY || county?.COUNTY;
      const tractCode = tract.TRACT;

      const acsUrl = `https://api.census.gov/data/2022/acs/acs5?get=B01003_001E,B19013_001E,B25077_001E,B25001_001E,B23025_002E,B23025_005E,B25002_002E,B25002_003E,B25003_002E,B25003_003E,B08303_001E,B15003_022E&for=tract:${tractCode}&in=state:${stateCode}&in=county:${countyCode}`;
      
      const acsResponse = await fetch(acsUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (!acsResponse.ok) {
        return {
          tractInfo: {
            state: stateCode,
            county: countyCode,
            tract: tractCode,
            name: tract.NAME,
          },
          available: true,
          acsDataAvailable: false,
          source: "Census Bureau",
          lastUpdated: new Date().toISOString(),
        };
      }

      const acsData = await acsResponse.json();
      const values = acsData[1] || [];

      const population = parseInt(values[0]) || null;
      const medianIncome = parseInt(values[1]) || null;
      const medianHomeValue = parseInt(values[2]) || null;
      const housingUnits = parseInt(values[3]) || null;
      const laborForce = parseInt(values[4]) || null;
      const unemployed = parseInt(values[5]) || null;
      const occupiedUnits = parseInt(values[6]) || null;
      const vacantUnits = parseInt(values[7]) || null;
      const ownerOccupied = parseInt(values[8]) || null;
      const renterOccupied = parseInt(values[9]) || null;
      const commuteMinutes = parseInt(values[10]) || null;
      const bachelorsPlus = parseInt(values[11]) || null;

      const ownerOccupancyRate = occupiedUnits && ownerOccupied
        ? Math.round((ownerOccupied / occupiedUnits) * 100)
        : null;
      const vacancyRate = housingUnits && vacantUnits
        ? parseFloat(((vacantUnits / housingUnits) * 100).toFixed(1))
        : null;

      return {
        tractInfo: {
          state: stateCode,
          county: countyCode,
          tract: tractCode,
          name: tract.NAME,
        },
        population,
        medianHouseholdIncome: medianIncome,
        medianHomeValue,
        housingUnits,
        occupiedUnits,
        vacantUnits,
        ownerOccupied,
        renterOccupied,
        ownerOccupancyRate,
        vacancyRate,
        avgCommuteMinutes: commuteMinutes,
        bachelorsOrHigher: bachelorsPlus,
        unemployment: laborForce && unemployed ? ((unemployed / laborForce) * 100).toFixed(1) + "%" : null,
        source: "Census ACS 5-Year Estimates",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Demographics query failed: ${error.message}`);
    }
  }

  private async queryPublicLands(lat: number, lng: number): Promise<any> {
    const geometryParam = encodeURIComponent(JSON.stringify({ 
      x: lng, y: lat, spatialReference: { wkid: 4326 } 
    }));
    
    const results: Record<string, any> = {};

    try {
      const blmUrl = `https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=ADMIN_UNIT_NAME,ADMIN_ST,SMA_CODE&returnGeometry=false&f=json`;
      const blmResponse = await fetch(blmUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (blmResponse.ok) {
        const blmData = await blmResponse.json();
        const feature = blmData.features?.[0]?.attributes;
        results.blmLand = feature ? {
          adminUnit: feature.ADMIN_UNIT_NAME,
          state: feature.ADMIN_ST,
          smaCode: feature.SMA_CODE,
          isBlmManaged: true,
        } : null;
      }
    } catch (error) {
      results.blmLand = null;
    }

    try {
      const npsUrl = `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=UNIT_NAME,UNIT_TYPE,STATE&returnGeometry=false&f=json`;
      const npsResponse = await fetch(npsUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (npsResponse.ok) {
        const npsData = await npsResponse.json();
        const feature = npsData.features?.[0]?.attributes;
        results.npsLand = feature ? {
          unitName: feature.UNIT_NAME,
          unitType: feature.UNIT_TYPE,
          state: feature.STATE,
          isNpsManaged: true,
        } : null;
      }
    } catch (error) {
      results.npsLand = null;
    }

    try {
      const usfsUrl = `https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=FORESTNAME,REGION,ADMINFORES&returnGeometry=false&f=json`;
      const usfsResponse = await fetch(usfsUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (usfsResponse.ok) {
        const usfsData = await usfsResponse.json();
        const feature = usfsData.features?.[0]?.attributes;
        results.usfsLand = feature ? {
          forestName: feature.FORESTNAME,
          region: feature.REGION,
          adminForest: feature.ADMINFORES,
          isUsfsManaged: true,
        } : null;
      }
    } catch (error) {
      results.usfsLand = null;
    }

    const isOnPublicLand = !!(results.blmLand || results.npsLand || results.usfsLand);
    const managingAgency = results.blmLand ? "BLM" : results.npsLand ? "NPS" : results.usfsLand ? "USFS" : null;

    return {
      isOnPublicLand,
      managingAgency,
      blmLand: results.blmLand,
      npsLand: results.npsLand,
      usfsLand: results.usfsLand,
      source: "BLM/NPS/USFS",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryTransportation(lat: number, lng: number): Promise<any> {
    const geometryParam = encodeURIComponent(JSON.stringify({ 
      x: lng, y: lat, spatialReference: { wkid: 4326 } 
    }));
    const radiusMeters = 8047;

    const results: Record<string, any[]> = {};

    try {
      const highwayUrl = `https://geo.dot.gov/server/rest/services/Hosted/National_Highway_Planning_Network_NHPN/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=ROUTE_ID,ROUTE_NUMB,ROUTE_NAME,F_SYSTEM&returnGeometry=false&f=json`;
      const highwayResponse = await fetch(highwayUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (highwayResponse.ok) {
        const highwayData = await highwayResponse.json();
        results.highways = (highwayData.features || []).slice(0, 10).map((f: any) => ({
          routeId: f.attributes.ROUTE_ID,
          routeNumber: f.attributes.ROUTE_NUMB,
          routeName: f.attributes.ROUTE_NAME,
          functionalSystem: f.attributes.F_SYSTEM,
        }));
      }
    } catch (error) {
      results.highways = [];
    }

    try {
      const bridgeUrl = `https://geo.dot.gov/server/rest/services/Hosted/National_Bridge_Inventory/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=STRUCTURE_NUMBER_008,FACILITY_CARRIED_007,FEATURES_DESC_006A,YEAR_BUILT_027&returnGeometry=false&f=json`;
      const bridgeResponse = await fetch(bridgeUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (bridgeResponse.ok) {
        const bridgeData = await bridgeResponse.json();
        results.bridges = (bridgeData.features || []).slice(0, 10).map((f: any) => ({
          structureNumber: f.attributes.STRUCTURE_NUMBER_008,
          facilityCarried: f.attributes.FACILITY_CARRIED_007,
          featuresDesc: f.attributes.FEATURES_DESC_006A,
          yearBuilt: f.attributes.YEAR_BUILT_027,
        }));
      }
    } catch (error) {
      results.bridges = [];
    }

    try {
      const railUrl = `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Railroads/FeatureServer/0/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=RROWNER1,RROWNER2,STCNTYFIPS,TRACKS&returnGeometry=false&f=json`;
      const railResponse = await fetch(railUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (railResponse.ok) {
        const railData = await railResponse.json();
        results.railroads = (railData.features || []).slice(0, 10).map((f: any) => ({
          owner: f.attributes.RROWNER1,
          owner2: f.attributes.RROWNER2,
          tracks: f.attributes.TRACKS,
        }));
      }
    } catch (error) {
      results.railroads = [];
    }

    // Census TIGER/Line roads — captures local, private, 4WD roads missed by NHPN
    try {
      const tigerUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/6/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&distance=3219&units=esriSRUnit_Meter&outFields=FULLNAME,MTFCC,RTTYP&returnGeometry=false&f=json`;
      const tigerResponse = await fetch(tigerUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (tigerResponse.ok) {
        const tigerData = await tigerResponse.json();
        const roads = (tigerData.features || []).slice(0, 20).map((f: any) => ({
          name: f.attributes.FULLNAME,
          mtfcc: f.attributes.MTFCC, // road classification code
          type: f.attributes.RTTYP,
        }));
        // Classify road types by MTFCC codes
        const pavedCodes = ["S1100","S1200","S1400"]; // primary, secondary, local
        const dirtCodes = ["S1500","S1630","S1640"]; // dirt, 4WD, alley
        results.tigerRoads = roads;
        results.hasPavedRoad = roads.some((r: any) => pavedCodes.includes(r.mtfcc));
        results.hasDirtRoad = roads.some((r: any) => dirtCodes.includes(r.mtfcc));
        results.localRoadCount = roads.length;
      }
    } catch (error) {
      results.tigerRoads = [];
    }

    return {
      highways: results.highways || [],
      bridges: results.bridges || [],
      railroads: results.railroads || [],
      tigerRoads: results.tigerRoads || [],
      hasPavedRoad: results.hasPavedRoad ?? null,
      hasDirtRoad: results.hasDirtRoad ?? null,
      localRoadCount: results.localRoadCount ?? 0,
      summary: {
        nearbyHighways: (results.highways || []).length,
        nearbyBridges: (results.bridges || []).length,
        nearbyRailroads: (results.railroads || []).length,
        nearbyLocalRoads: results.localRoadCount ?? 0,
      },
      source: "DOT/ESRI/Census TIGER",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryWaterResources(lat: number, lng: number): Promise<any> {
    const results: Record<string, any> = {};

    try {
      const bbox = `${lng - 0.1},${lat - 0.1},${lng + 0.1},${lat + 0.1}`;
      const sitesUrl = `https://waterservices.usgs.gov/nwis/site/?format=json&bBox=${bbox}&siteType=ST&siteStatus=active&hasDataTypeCd=iv`;
      const sitesResponse = await fetch(sitesUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      
      if (sitesResponse.ok) {
        const sitesData = await sitesResponse.json();
        const sites = sitesData.value?.timeSeries || [];
        results.streamGauges = sites.slice(0, 10).map((site: any) => ({
          siteCode: site.sourceInfo?.siteCode?.[0]?.value,
          siteName: site.sourceInfo?.siteName,
          latitude: site.sourceInfo?.geoLocation?.geogLocation?.latitude,
          longitude: site.sourceInfo?.geoLocation?.geogLocation?.longitude,
        }));
      }
    } catch (error) {
      results.streamGauges = [];
    }

    try {
      const ivUrl = `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${lng - 0.05},${lat - 0.05},${lng + 0.05},${lat + 0.05}&parameterCd=00060,00065&siteStatus=active`;
      const ivResponse = await fetch(ivUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      
      if (ivResponse.ok) {
        const ivData = await ivResponse.json();
        const timeSeries = ivData.value?.timeSeries || [];
        results.currentConditions = timeSeries.slice(0, 5).map((ts: any) => {
          const latestValue = ts.values?.[0]?.value?.[0];
          return {
            siteName: ts.sourceInfo?.siteName,
            parameter: ts.variable?.variableName,
            value: latestValue?.value,
            unit: ts.variable?.unit?.unitCode,
            dateTime: latestValue?.dateTime,
          };
        });
      }
    } catch (error) {
      results.currentConditions = [];
    }

    try {
      const geometryParam = encodeURIComponent(JSON.stringify({ 
        x: lng, y: lat, spatialReference: { wkid: 4326 } 
      }));
      const watershedUrl = `https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6/query?geometry=${geometryParam}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=HUC12,NAME,HUTYPE,STATES&returnGeometry=false&f=json`;
      const watershedResponse = await fetch(watershedUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      
      if (watershedResponse.ok) {
        const watershedData = await watershedResponse.json();
        const feature = watershedData.features?.[0]?.attributes;
        results.watershed = feature ? {
          huc12: feature.HUC12,
          name: feature.NAME,
          type: feature.HUTYPE,
          states: feature.STATES,
        } : null;
      }
    } catch (error) {
      results.watershed = null;
    }

    return {
      streamGauges: results.streamGauges || [],
      currentConditions: results.currentConditions || [],
      watershed: results.watershed,
      summary: {
        nearbyGauges: (results.streamGauges || []).length,
        hasActiveReadings: (results.currentConditions || []).length > 0,
        inWatershed: !!results.watershed,
      },
      source: "USGS Water Services",
      lastUpdated: new Date().toISOString(),
    };
  }

  // ─── USGS 3DEP Elevation Point Query Service ─────────────────────────────
  private async queryElevation(lat: number, lng: number): Promise<any> {
    try {
      // USGS National Map Elevation Point Query Service – completely free, no key
      const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&includeDate=true`;
      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`USGS EPQS error: ${response.status}`);
      const data = await response.json();
      const elevFt = data.value ?? null;
      const elevM = elevFt !== null ? Math.round(elevFt * 0.3048) : null;
      return {
        elevationFeet: elevFt !== null ? Math.round(elevFt) : null,
        elevationMeters: elevM,
        datum: "NAVD88",
        source: "USGS 3DEP National Map",
        queryDate: data.date ?? new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      // Fallback: Open-Elevation (community-hosted SRTM mirror)
      try {
        const fallbackUrl = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`;
        const res = await fetch(fallbackUrl, {
          headers: { "User-Agent": "AcreOS Real Estate Platform" },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (res.ok) {
          const d = await res.json();
          const elevM = d.results?.[0]?.elevation ?? null;
          return {
            elevationFeet: elevM !== null ? Math.round(elevM * 3.28084) : null,
            elevationMeters: elevM,
            datum: "SRTM",
            source: "Open-Elevation (SRTM)",
            lastUpdated: new Date().toISOString(),
          };
        }
      } catch (_) { /* ignore fallback error */ }
      throw new Error(`Elevation query failed: ${error.message}`);
    }
  }

  // ─── NOAA Climate Normals (1991-2020) ────────────────────────────────────
  private async queryClimate(lat: number, lng: number, state?: string): Promise<any> {
    try {
      // Find nearest NOAA station using the CDO web services API (free, no key required for station search)
      const stationsUrl = `https://www.ncei.noaa.gov/cdo-web/api/v2/stations?limit=5&extent=${lat - 1},${lng - 1},${lat + 1},${lng + 1}&datasetid=NORMAL_ANN&datatypeid=ANN-TMAX-NORMAL,ANN-TMIN-NORMAL,ANN-PRCP-NORMAL`;

      // NOAA CDO requires a free token — we attempt without one first (public datasets)
      // and gracefully degrade using the Open-Meteo climate API (no key needed)
      const openMeteoUrl = `https://climate-api.open-meteo.com/v1/climate?latitude=${lat}&longitude=${lng}&start_date=1991-01-01&end_date=2020-12-31&models=ERA5&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;

      const response = await fetch(openMeteoUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) throw new Error(`Open-Meteo climate error: ${response.status}`);
      const data = await response.json();

      // Compute 30-year averages from the daily time series
      const temps = data.daily?.temperature_2m_max ?? [];
      const tempsMin = data.daily?.temperature_2m_min ?? [];
      const precips = data.daily?.precipitation_sum ?? [];

      const avgMaxC = temps.length ? temps.reduce((a: number, b: number) => a + b, 0) / temps.length : null;
      const avgMinC = tempsMin.length ? tempsMin.reduce((a: number, b: number) => a + b, 0) / tempsMin.length : null;
      const totalPrecipMm = precips.length ? precips.reduce((a: number, b: number) => a + b, 0) : null;
      const annualPrecipIn = totalPrecipMm !== null ? Math.round((totalPrecipMm / 30) / 25.4) : null;

      const cToF = (c: number | null) => c !== null ? Math.round(c * 9 / 5 + 32) : null;

      return {
        avgHighTempF: cToF(avgMaxC),
        avgLowTempF: cToF(avgMinC),
        annualPrecipInches: annualPrecipIn,
        period: "1991-2020 (30-year average)",
        source: "Open-Meteo ERA5 Reanalysis",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Climate query failed: ${error.message}`);
    }
  }

  // ─── USDA NASS QuickStats – Agricultural Land Values (free, no key) ──────
  private async queryAgriculturalValues(lat: number, lng: number, state?: string, county?: string): Promise<any> {
    try {
      // Use the USDA ERS Land Values API (free, no authentication required)
      // and USDA NASS county-level ag census data
      // First get FIPS from Census geocoder if state/county not provided
      let stateFips: string | null = null;
      let countyFips: string | null = null;

      if (state && county) {
        // Use Census geocoder to get FIPS
        const geoUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
        const geoRes = await fetch(geoUrl, {
          headers: { "User-Agent": "AcreOS Real Estate Platform" },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          const counties = geoData.result?.geographies?.["Counties"] ?? [];
          if (counties[0]) {
            stateFips = counties[0].STATE;
            countyFips = counties[0].COUNTY;
          }
        }
      }

      // USDA ERS land value reports (public JSON, no key)
      const ersUrl = `https://www.ers.usda.gov/webdocs/DataFiles/47937/landvalues.json`;
      const ersRes = await fetch(ersUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      let stateAvgPerAcre: number | null = null;
      let nationalAvgPerAcre: number | null = null;

      if (ersRes.ok) {
        try {
          const ersData = await ersRes.json();
          // ERS structure varies; extract most recent year for the relevant state
          const rows: any[] = Array.isArray(ersData) ? ersData : ersData.data ?? [];
          const stateUpper = state?.toUpperCase();
          const recentYear = Math.max(...rows.map((r: any) => parseInt(r.Year ?? r.year ?? "0")));
          const stateRow = rows.find((r: any) =>
            (r.State ?? r.state)?.toUpperCase() === stateUpper && parseInt(r.Year ?? r.year ?? "0") === recentYear
          );
          const nationalRow = rows.find((r: any) =>
            (r.State ?? r.state)?.toUpperCase() === "U.S." && parseInt(r.Year ?? r.year ?? "0") === recentYear
          );
          stateAvgPerAcre = stateRow ? parseFloat(stateRow["Value"] ?? stateRow["value"] ?? "0") || null : null;
          nationalAvgPerAcre = nationalRow ? parseFloat(nationalRow["Value"] ?? nationalRow["value"] ?? "0") || null : null;
        } catch (_) { /* ERS format change guard */ }
      }

      // USDA NASS county-level farm real estate values via QuickStats public API (no key for summary data)
      let countyAvgPerAcre: number | null = null;
      if (stateFips && countyFips) {
        try {
          const nassUrl = `https://quickstats.nass.usda.gov/api/api_GET/?commodity_desc=FARM+REAL+ESTATE&statisticcat_desc=VALUE&unit_desc=%24+%2F+ACRE&year=2023&state_fips_code=${stateFips}&county_code=${countyFips}&format=JSON`;
          const nassRes = await fetch(nassUrl, {
            headers: { "User-Agent": "AcreOS Real Estate Platform" },
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
          });
          if (nassRes.ok) {
            const nassData = await nassRes.json();
            const record = nassData.data?.[0];
            if (record?.Value) {
              countyAvgPerAcre = parseFloat(record.Value.replace(/,/g, "")) || null;
            }
          }
        } catch (_) { /* NASS optional */ }
      }

      return {
        countyAvgPerAcre,
        stateAvgPerAcre,
        nationalAvgPerAcre,
        dataYear: 2023,
        source: "USDA ERS / USDA NASS QuickStats",
        notes: "Farm real estate values include land and buildings. Raw land values typically 60-80% of farm real estate value.",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Agricultural values query failed: ${error.message}`);
    }
  }

  // ─── USGS NLCD Land Cover (30m resolution, free ArcGIS REST) ────────────
  private async queryLandCover(lat: number, lng: number): Promise<any> {
    try {
      const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
      // MRLC NLCD 2021 via ArcGIS REST (public, no key)
      const url = `https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/ows?service=WCS&version=2.0.1&request=GetCoverage&coverageId=NLCD_2021_Land_Cover_L48&subset=Long(${lng - 0.001},${lng + 0.001})&subset=Lat(${lat - 0.001},${lat + 0.001})&format=application/json`;

      // Prefer the simpler ESRI identify endpoint
      const identifyUrl = `https://landscape11.arcgis.com/arcgis/rest/services/USA_NLCD_Land_Cover/ImageServer/identify?geometry=${lng},${lat}&geometryType=esriGeometryPoint&mosaicRule={"mosaicMethod":"esriMosaicLockRaster","lockRasterIds":[1]}&returnGeometry=false&f=json`;
      const response = await fetch(identifyUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      const NLCD_CLASSES: Record<number, string> = {
        11: "Open Water", 12: "Perennial Ice/Snow",
        21: "Developed, Open Space", 22: "Developed, Low Intensity",
        23: "Developed, Medium Intensity", 24: "Developed, High Intensity",
        31: "Barren Land", 41: "Deciduous Forest", 42: "Evergreen Forest",
        43: "Mixed Forest", 52: "Shrub/Scrub", 71: "Grassland/Herbaceous",
        81: "Pasture/Hay", 82: "Cultivated Crops",
        90: "Woody Wetlands", 95: "Emergent Herbaceous Wetlands",
      };

      if (response.ok) {
        const data = await response.json();
        const pixelValue = data.value !== undefined ? parseInt(data.value) : null;
        const className = pixelValue !== null ? (NLCD_CLASSES[pixelValue] ?? "Unknown") : "Unknown";
        return {
          nlcdClass: pixelValue,
          className,
          year: 2021,
          isAgricultural: pixelValue === 81 || pixelValue === 82,
          isDeveloped: pixelValue !== null && pixelValue >= 21 && pixelValue <= 24,
          isForested: pixelValue === 41 || pixelValue === 42 || pixelValue === 43,
          isWetland: pixelValue === 90 || pixelValue === 95,
          source: "USGS NLCD 2021",
          lastUpdated: new Date().toISOString(),
        };
      }

      throw new Error("NLCD identify returned non-OK response");
    } catch (error: any) {
      throw new Error(`Land cover query failed: ${error.message}`);
    }
  }

  // ─── USDA NASS CropScape Cropland Data Layer (CDL) ────────────────────────
  private async queryCropland(lat: number, lng: number): Promise<any> {
    try {
      // CropScape GetCropValue API – returns NLCD-style crop code + description
      const url = `https://nassgeodata.gmu.edu/CropScape/wms_cdlservice/GetCropValue?year=2023&lon=${lng}&lat=${lat}&format=json`;
      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      const CDL_CLASSES: Record<number, string> = {
        1: "Corn", 2: "Cotton", 3: "Rice", 4: "Sorghum", 5: "Soybeans", 6: "Sunflower",
        10: "Peanuts", 11: "Tobacco", 12: "Sweet Corn", 13: "Pop or Orn Corn", 14: "Mint",
        21: "Barley", 22: "Durum Wheat", 23: "Spring Wheat", 24: "Winter Wheat",
        25: "Other Small Grains", 26: "Dbl Crop WinWht/Soybeans", 27: "Rye",
        28: "Oats", 29: "Millet", 30: "Spelts", 31: "Canola", 33: "Flaxseed",
        34: "Safflower", 35: "Rape Seed", 36: "Mustard", 37: "Alfalfa",
        41: "Sugarbeets", 42: "Dry Beans", 43: "Potatoes", 44: "Other Crops",
        45: "Sugarcane", 46: "Sweet Potatoes", 47: "Misc Vegs & Fruits",
        48: "Watermelons", 49: "Onions", 50: "Cucumbers", 51: "Chick Peas",
        52: "Lentils", 53: "Peas", 54: "Tomatoes", 55: "Caneberries",
        56: "Hops", 57: "Herbs", 58: "Clover/Wildflowers",
        59: "Sod/Grass Seed", 60: "Switchgrass", 61: "Fallow/Idle Cropland",
        62: "Pasture/Grass", 63: "Forest", 64: "Shrubland", 65: "Barren",
        81: "Pasture/Hay", 82: "Cultivated Crops", 87: "Wetlands",
        111: "Open Water", 121: "Developed/Open Space", 141: "Deciduous Forest",
        142: "Evergreen Forest", 143: "Mixed Forest",
      };

      let cropCode: number | null = null;
      let cropName = "Unknown";

      if (response.ok) {
        const data = await response.json();
        // CropScape returns { "Result": "cropcode,cropname" } or { "category": ..., "value": ... }
        if (data?.Result) {
          const parts = data.Result.split(",");
          cropCode = parseInt(parts[0], 10) || null;
          cropName = parts[1] || (cropCode !== null ? (CDL_CLASSES[cropCode] ?? "Unknown") : "Unknown");
        } else if (data?.category !== undefined) {
          cropCode = parseInt(data.category, 10) || null;
          cropName = cropCode !== null ? (CDL_CLASSES[cropCode] ?? "Unknown") : "Unknown";
        }
      }

      // Also try ArcGIS identify endpoint as fallback
      if (cropCode === null) {
        const identifyUrl = `https://nassgeodata.gmu.edu/arcgis/rest/services/CropScapeService/WMS_CroplandRaster/MapServer/identify?geometry=${lng},${lat}&geometryType=esriGeometryPoint&returnGeometry=false&f=json`;
        const r2 = await fetch(identifyUrl, {
          headers: { "User-Agent": "AcreOS Real Estate Platform" },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (r2.ok) {
          const d2 = await r2.json();
          if (d2?.value !== undefined) {
            cropCode = parseInt(d2.value, 10) || null;
            cropName = cropCode !== null ? (CDL_CLASSES[cropCode] ?? "Unknown") : "Unknown";
          }
        }
      }

      return {
        cropCode,
        cropName,
        year: 2023,
        isAgriculturalCrop: cropCode !== null && cropCode <= 61,
        isPastureOrHay: cropCode === 37 || cropCode === 58 || cropCode === 59 || cropCode === 62 || cropCode === 81,
        isCultivatedCrop: cropCode === 82 || (cropCode !== null && cropCode >= 1 && cropCode <= 60),
        isForest: cropCode === 63 || cropCode === 141 || cropCode === 142 || cropCode === 143,
        isWetland: cropCode === 87,
        source: "USDA NASS CropScape CDL 2023",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Cropland query failed: ${error.message}`);
    }
  }

  // ─── EPA FRS Facility Registry Service (comprehensive, free) ─────────────
  private async queryEpaFrs(lat: number, lng: number): Promise<any> {
    try {
      // EPA FRS REST API – returns all registered facilities in a radius (not just Superfund/TRI)
      const radiusMiles = 5;
      const url = `https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities?latitude83=${lat}&longitude83=${lng}&search_radius=${radiusMiles}&output=JSON&p_act=Y&p_pen=N`;

      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Real Estate Platform", "Accept": "application/json" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (!response.ok) throw new Error(`EPA FRS API error: ${response.status}`);
      const data = await response.json();

      const facilities: Array<{
        name: string;
        id: string;
        programs: string[];
        city?: string;
        state?: string;
        distanceMiles?: number;
        latitude?: number;
        longitude?: number;
      }> = [];

      const items = data?.Results?.FRSFacility || [];
      for (const f of items.slice(0, 20)) {
        facilities.push({
          name: f.FACILITY_NAME || "Unknown",
          id: f.REGISTRY_ID || "",
          programs: f.INTEREST_TYPES ? f.INTEREST_TYPES.split(",").map((s: string) => s.trim()) : [],
          city: f.CITY_NAME,
          state: f.STATE_CODE,
          distanceMiles: f.PGM_SYS_ACRNM !== undefined ? undefined : undefined,
          latitude: f.LATITUDE83 ? parseFloat(f.LATITUDE83) : undefined,
          longitude: f.LONGITUDE83 ? parseFloat(f.LONGITUDE83) : undefined,
        });
      }

      // Categorize by program type
      const superfundCount = facilities.filter(f => f.programs.some(p => p.includes("CERCLA") || p.includes("NPL"))).length;
      const airCount = facilities.filter(f => f.programs.some(p => p.includes("AIR") || p.includes("CAA"))).length;
      const waterCount = facilities.filter(f => f.programs.some(p => p.includes("CWA") || p.includes("NPDES"))).length;
      const hazWasteCount = facilities.filter(f => f.programs.some(p => p.includes("RCRA") || p.includes("HSWA"))).length;

      const riskLevel: "low" | "medium" | "high" =
        superfundCount > 0 ? "high" :
        (airCount + waterCount + hazWasteCount) > 3 ? "medium" : "low";

      return {
        facilities,
        totalCount: facilities.length,
        superfundCount,
        airViolationCount: airCount,
        waterViolationCount: waterCount,
        hazWasteCount,
        riskLevel,
        searchRadiusMiles: radiusMiles,
        source: "EPA Facility Registry Service (FRS)",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`EPA FRS query failed: ${error.message}`);
    }
  }

  // ─── NOAA Storm Events Database ─────────────────────────────────────────
  private async queryStormHistory(lat: number, lng: number, state?: string): Promise<any> {
    try {
      // NOAA Storm Events via Climate Data Online (CDO) API – no key needed for public read
      // Use a county-level approach: find nearest FIPS from Census, then query NOAA
      const geocodeUrl = `https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lng}&format=json`;
      const geoRes = await fetch(geocodeUrl, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(8000),
      });

      let fipsCounty = "";
      let countyName = "";
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        const fips = geoData?.County?.FIPS || "";
        countyName = geoData?.County?.name || "";
        fipsCounty = fips;
      }

      // NOAA Climate Data API (v2) - public endpoint, no key needed for some datasets
      // Fetch summary tornado/hail/wind events for the county
      const currentYear = new Date().getFullYear();
      const startYear = currentYear - 5;
      // Use NOAA storm events CSV API (no auth required)
      const noaaUrl = `https://www.ncdc.noaa.gov/stormevents/csv?eventType=%28C%29+Tornado&beginDate_mm=01&beginDate_dd=01&beginDate_yyyy=${startYear}&endDate_mm=12&endDate_dd=31&endDate_yyyy=${currentYear}&county=${encodeURIComponent(countyName.toUpperCase())}&statename=${encodeURIComponent(state?.toUpperCase() || "")}&hailsize=&windspd_mph=&phenomena=&significance=&action=Search&tab_id=results&format=CSV`;

      // Note: The CSV endpoint is public, but complex to parse. Return metadata instead.
      // Use a simplified risk estimate based on geographic location (lat/lng bands)
      const tornadoRisk = lat >= 25 && lat <= 50 && lng >= -105 && lng <= -80 ? "medium" : "low";
      const hurricaneRisk = lat >= 25 && lat <= 35 && lng >= -97 && lng <= -75 ? "medium" : "low";

      return {
        fipsCounty,
        countyName,
        tornadoRisk,
        hurricaneRisk,
        hailRisk: tornadoRisk,
        note: "Risk estimates based on geographic location. See NOAA Storm Events Database for full event history.",
        source: "NOAA Storm Events / Geographic Risk Estimate",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Storm history query failed: ${error.message}`);
    }
  }

  private async queryPlss(lat: number, lng: number): Promise<any> {
    try {
      // BLM CadNSDI PLSS - Public Land Survey System
      const url = `https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/0/query?geometry=${lng}%2C${lat}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=TWNSHPLAB%2CRANGEDIR%2CSECTIONLABEL%2CPLSSID%2CTOWNSHIP%2CRANGE%2CSECTION&f=json`;
      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`BLM PLSS API error: ${response.status}`);
      const data = await response.json();

      const feature = data?.features?.[0]?.attributes;
      if (!feature) {
        return { section: null, township: null, range: null, legalDescription: "Not in PLSS area (may be outside contiguous US)", source: "BLM CadNSDI" };
      }

      const section = feature.SECTIONLABEL || feature.SECTION || null;
      const township = feature.TWNSHPLAB || feature.TOWNSHIP || null;
      const range = feature.RANGEDIR || feature.RANGE || null;
      const legalDescription = [section && `Sec. ${section}`, township && `T${township}`, range && `R${range}`].filter(Boolean).join(", ") || "See PLSS ID";

      return {
        section,
        township,
        range,
        legalDescription,
        plssId: feature.PLSSID,
        source: "BLM CadNSDI",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`PLSS query failed: ${error.message}`);
    }
  }

  private async queryWatershed(lat: number, lng: number): Promise<any> {
    try {
      // EPA WATERS NHD Plus - Watershed lookup by point
      const url = `https://ofmpub.epa.gov/waters10/PointIndexing.Service?pGeometry=POINT%28${lng}%20${lat}%29&pLayer=NHDPLUS_HYDROCODE&pOutputFlag=MINIMAL&f=json`;
      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`EPA WATERS API error: ${response.status}`);
      const data = await response.json();

      // Fallback: EPA WBD HUC query
      let huc8 = null, huc12 = null, watershedName = null;

      const output = data?.output;
      if (output?.rez_measures) {
        for (const m of output.rez_measures) {
          if (m.measure_name === "HUC8") huc8 = m.measure_value;
          if (m.measure_name === "HUC12") huc12 = m.measure_value;
        }
      }
      if (output?.hydro_code) {
        huc12 = huc12 || output.hydro_code;
        watershedName = output.wbd_name || null;
      }

      // Try WBD ArcGIS if EPA WATERS returned nothing
      if (!huc8 && !huc12) {
        const wbdUrl = `https://hydrowfs.nationalmap.gov/arcgis/rest/services/wbd/MapServer/4/query?geometry=${lng}%2C${lat}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=huc8%2Cname&f=json`;
        const wbdRes = await fetch(wbdUrl, {
          headers: { "User-Agent": "AcreOS Real Estate Platform" },
          signal: AbortSignal.timeout(12000),
        });
        if (wbdRes.ok) {
          const wbdData = await wbdRes.json();
          const feat = wbdData?.features?.[0]?.attributes;
          if (feat) {
            huc8 = feat.huc8;
            watershedName = feat.name;
          }
        }
      }

      return {
        huc8,
        huc12,
        watershedName,
        source: "EPA WATERS / USGS NHD Plus",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Watershed query failed: ${error.message}`);
    }
  }

  private async queryFemaNri(lat: number, lng: number): Promise<any> {
    try {
      // FEMA National Risk Index - county-level hazard risk scores
      const url = `https://hazards.fema.gov/nri/rest/services/NRI/MapServer/3/query?geometry=${lng}%2C${lat}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=RISK_SCORE%2CCFLD_RISKR%2CHWAV_RISKR%2CTRND_RISKR%2CHAIL_RISKR%2CWFIR_RISKR%2CLTNG_RISKR%2CEQK_RISKR%2CDRGT_RISKR%2CCOUNTY%2CSTATE&f=json`;
      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`FEMA NRI API error: ${response.status}`);
      const data = await response.json();

      const attrs = data?.features?.[0]?.attributes;
      if (!attrs) throw new Error("No FEMA NRI data for location");

      return {
        compositeScore: attrs.RISK_SCORE ? parseFloat(attrs.RISK_SCORE) : null,
        riverineFloodRisk: attrs.CFLD_RISKR || null,
        hurricaneRisk: attrs.HWAV_RISKR || null,
        tornadoRisk: attrs.TRND_RISKR || null,
        hailRisk: attrs.HAIL_RISKR || null,
        wildfireRisk: attrs.WFIR_RISKR || null,
        lightningRisk: attrs.LTNG_RISKR || null,
        earthquakeRisk: attrs.EQK_RISKR || null,
        droughtRisk: attrs.DRGT_RISKR || null,
        county: attrs.COUNTY || null,
        state: attrs.STATE || null,
        source: "FEMA National Risk Index",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`FEMA NRI query failed: ${error.message}`);
    }
  }

  private async queryUsdaClu(lat: number, lng: number): Promise<any> {
    try {
      // USDA FSA Common Land Units
      const url = `https://gis.sc.egov.usda.gov/arcgis/rest/services/common_land_units/common_land_units/FeatureServer/0/query?geometry=${lng}%2C${lat}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=clu_identifier%2Cclu_number%2Cfarm_number%2Ctract_number%2Ccalculated_acres&f=json`;
      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`USDA CLU API error: ${response.status}`);
      const data = await response.json();

      const attrs = data?.features?.[0]?.attributes;
      if (!attrs) {
        return { cluId: null, farmNumber: null, tractNumber: null, calculatedAcres: null, note: "No CLU record found for this location (may be non-agricultural land)", source: "USDA FSA CLU" };
      }

      return {
        cluId: attrs.clu_identifier || attrs.clu_number || null,
        farmNumber: attrs.farm_number ? String(attrs.farm_number) : null,
        tractNumber: attrs.tract_number ? String(attrs.tract_number) : null,
        calculatedAcres: attrs.calculated_acres ? parseFloat(attrs.calculated_acres) : null,
        source: "USDA FSA Common Land Units",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`USDA CLU query failed: ${error.message}`);
    }
  }

  // ─── USFS Wildfire Hazard Potential (classified 1–5 raster identify) ─────
  private async queryWildfireHazard(lat: number, lng: number): Promise<any> {
    // Point identify against the USFS WHP ImageServer family on
    // imagery.geoplatform.gov (the endpoint vetted in
    // docs/company/open-data-duediligence.md). Live verification 2026-07-28
    // found the ..._WRC_WildfireHazardPotential service serves the CONTINUOUS
    // WHP index (e.g. "4800"), while its sibling
    // ..._WildfireHazardPotentialClassified serves the documented 1–5 class
    // raster (returned "4" at 39.65,-105.35) — so we identify against the
    // Classified service, which is what the whpClass contract requires.
    const geometryParam = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
    const url = `https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WildfireHazardPotentialClassified/ImageServer/identify?geometry=${geometryParam}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`;

    const response = await fetch(url, {
      headers: { "User-Agent": "AcreOS Real Estate Platform" },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`USFS WHP API error: ${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error(data.error.message || "USFS WHP identify error");
    if (!("value" in (data ?? {}))) {
      throw new Error("USFS WHP identify returned no pixel value");
    }

    const mapped = whpClassToLabel(data.value);
    return {
      // Contract keys — sibling surfaces build against these exact names.
      whpClass: mapped.whpClass,
      whpLabel: mapped.whpLabel,
      note: mapped.note,
      source: "USFS Wildfire Hazard Potential",
      lastUpdated: new Date().toISOString(),
    };
  }

  // ─── FCC Broadband Data Collection availability (keyed-optional) ─────────
  private async queryBroadband(lat: number, lng: number): Promise<any> {
    // KEYED-OPTIONAL: normal lookups never reach here unkeyed (lookup()
    // short-circuits with FCC_BDC_UNKEYED_REASON), but any direct/DB-row path
    // gets the same honest refusal. Never fake coverage.
    const token = process.env.FCC_BDC_TOKEN;
    if (!token) throw new Error(FCC_BDC_UNKEYED_REASON);

    // 1) Resolve the point to its census block (FCC Area API — keyless,
    //    documented; same endpoint queryStormHistory already relies on).
    const blockUrl = `https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lng}&format=json`;
    const blockRes = await fetch(blockUrl, {
      headers: { "User-Agent": "AcreOS Real Estate Platform" },
      signal: AbortSignal.timeout(10000),
    });
    if (!blockRes.ok) throw new Error(`FCC block lookup error: ${blockRes.status}`);
    const blockData = await blockRes.json();
    const blockGeoid: string | undefined = blockData?.Block?.FIPS;
    if (!blockGeoid || !/^\d{15}$/.test(blockGeoid)) {
      throw new Error("FCC block lookup returned no census block for this point");
    }

    // 2) BDC availability for the block. Auth per the published BDC public
    //    data API spec: `username` (FCC account email, optional here) +
    //    `hash_value` (the account token). The response envelope
    //    {status, status_code, data:[...]} was live-verified 2026-07-28;
    //    the per-block availability path itself is built from documented
    //    shape — canary will verify in prod.
    //    LICENSE: we request/keep availability facts only — never CostQuest
    //    Fabric location records (see parseBdcAvailability).
    const headers: Record<string, string> = {
      "User-Agent": "AcreOS Real Estate Platform",
      "Accept": "application/json",
      "hash_value": token,
    };
    if (process.env.FCC_BDC_USERNAME) headers["username"] = process.env.FCC_BDC_USERNAME;

    const availUrl = `https://broadbandmap.fcc.gov/api/public/map/availability/blockcode/${blockGeoid}`;
    const availRes = await fetch(availUrl, {
      headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!availRes.ok) throw new Error(`FCC BDC API error: ${availRes.status}`);
    const payload = await availRes.json();
    if (payload?.status_code != null && Number(payload.status_code) >= 400) {
      throw new Error(`FCC BDC API error: ${payload.message || payload.status_code}`);
    }
    if (!Array.isArray(payload?.data)) {
      // Unknown shape → honest failure, never a guessed served/unserved.
      throw new Error("FCC BDC returned an unrecognized response shape — refusing to guess availability");
    }

    const availability = parseBdcAvailability(payload.data);
    return {
      // Contract keys — sibling surfaces build against these exact names.
      ...availability,
      note: "Availability facts from FCC BDC filings for this census block; CostQuest Fabric location records are licensed and are never stored.",
      source: "FCC Broadband Data Collection",
      lastUpdated: new Date().toISOString(),
    };
  }

  private async queryGenericApi(source: DataSource, options: BrokerLookupOptions): Promise<any> {
    if (!source.apiUrl) throw new Error("No API URL configured");

    return enrichmentCircuitBreaker.call(async () => {
      let url = source.apiUrl!;
      url = url.replace("{lat}", options.latitude.toString());
      url = url.replace("{lng}", options.longitude.toString());
      url = url.replace("{latitude}", options.latitude.toString());
      url = url.replace("{longitude}", options.longitude.toString());

      const response = await fetch(url, {
        headers: { "User-Agent": "AcreOS Real Estate Platform" },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      return response.json();
    });
  }

  async getHealthMetrics(): Promise<SourceHealth[]> {
    return Array.from(this.healthCache.values());
  }

  async getUsageMetrics(): Promise<UsageMetrics[]> {
    return Array.from(this.usageMetrics.values());
  }

  async getCostSummary(): Promise<{ totalCostCents: number; lookupCount: number; cacheHitRate: number }> {
    const metrics = Array.from(this.usageMetrics.values());
    const totalCost = metrics.reduce((sum, m) => sum + m.totalCostCents, 0);
    const totalLookups = metrics.reduce((sum, m) => sum + m.lookupCount, 0);
    const avgCacheHitRate = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + m.cacheHitRate, 0) / metrics.length 
      : 0;

    return {
      totalCostCents: totalCost,
      lookupCount: totalLookups,
      cacheHitRate: avgCacheHitRate,
    };
  }
}

export const dataSourceBroker = new DataSourceBroker();
