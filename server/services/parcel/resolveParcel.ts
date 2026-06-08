/**
 * resolveParcel — the single front-door for parcel data resolution.
 *
 * ## Why this exists
 *
 * AcreOS today resolves a parcel through FOUR parallel data spines, each with
 * its own cache and its own (or no) provenance contract:
 *   - `providers/provider-registry.ts` — the good one: tiering, credit metering,
 *     circuit breaking, license-aware `provider_cache`, per-category TTL, SWR,
 *     and the full `source / sourceAsOf / classification / confidence` contract.
 *   - `data-source-broker.ts` — the public `/tools/parcel-check` widget path;
 *     own 30-day cache, partial provenance.
 *   - `data-source-lookup.ts` — Deals path; flat 30-day cache, `data: any`,
 *     no provenance.
 *   - `parcelIntelligenceFusion.ts` — Properties path; own cache store.
 *
 * The consequence (Iris elevation brief, idea #1): the same APN, looked up from
 * two different doors, can return different freshness, different provenance, and
 * a different cached value. That is the exact credibility wound the honest-data
 * work was built to prevent.
 *
 * `resolveParcel` is the strangler-fig nucleus of the fix. It is ONE entry point
 * that delegates to the provider registry as the primary path (so its cache /
 * circuit / provenance story is the only one that matters), falling back to the
 * broker only for categories the registry does not yet register. It does NOT
 * change any spine's internals and does NOT migrate any other caller — those are
 * deliberate, incremental, post-launch steps (see REMAINING_CALLERS below).
 *
 * ## What it guarantees
 *   - One normalized result shape (`ResolvedParcelResult`) carrying the merged
 *     provenance contract for every category.
 *   - One cache + circuit story: the registry's. The broker fallback is used
 *     only where the registry has no provider for a category.
 *   - A sampled, async, non-blocking shadow-compare against the legacy broker
 *     path, logging field-level DIFFERENCES so we can SEE where the spines
 *     disagree before migrating more callers. This is plumbing, not behavior
 *     change — semantics are identical to the legacy path today.
 *
 * ## Incremental caller-migration plan (do NOT big-bang)
 *
 * REMAINING_CALLERS — ordered by risk (lowest first). Each should be routed
 * through `resolveParcel`, its shadow-diffs watched until clean, then the legacy
 * call deleted. This file owns the facade only; migrating these is later work.
 *   1. server/routes-public-parcel-check.ts   — DONE (this wave): public widget.
 *   2. server/routes-deals.ts                  — retire data-source-lookup.ts.
 *   3. server/services/checklistAnnotation.ts  — retire data-source-lookup.ts.
 *   4. server/routes-data-intelligence.ts      — fusion becomes a scoring layer.
 *   5. server/services/properties/index.ts     — fusion becomes a scoring layer.
 *   6. server/routes-properties.ts (landProfile) — already provenance-honest;
 *      reconcile cache so it reads the same provider_cache.
 *   7. server/services/dataSourceProbe.ts / healthCheck.ts — already registry;
 *      route through facade for uniform shadow telemetry.
 */

import { providerRegistry } from "../providers/provider-registry";
import { dataSourceBroker } from "../data-source-broker";
import type {
  DataCategory,
  DataClassification,
  LookupInput,
  ProviderTier,
} from "../providers/types";
import type { LookupCategory } from "../data-source-broker";
import { logShadowDiff } from "./resolveShadow";
import { logger } from "../../utils/logger";
import { traceAsync } from "../../tracing";

// ── Public contract ───────────────────────────────────────────

export interface ResolveParcelOptions {
  /** Categories to resolve. */
  categories: DataCategory[];
  /** Org subscription tier — gates which providers are reachable. */
  orgTier: ProviderTier;
  /** Credit balance available for paid lookups (cents). Defaults to 0. */
  creditBalance?: number;
  /** Org id — for credit metering + telemetry. Omitted on public/no-auth. */
  organizationId?: number;
  /**
   * Hard ceiling on data tier. "free" forces the free/open path only (the
   * public widget contract) — paid/byok sources are never reachable. Maps to
   * the broker's `maxTier` on the fallback path and caps `orgTier` on the
   * registry path.
   */
  maxTier?: ProviderTier;
  /**
   * Shadow-compare sample rate (0–1). When > 0, a sampled subset of resolves
   * also computes the legacy broker result async and logs field-level diffs.
   * Non-blocking; never affects the returned value. Defaults to env-configured
   * rate (see RESOLVE_PARCEL_SHADOW_SAMPLE_RATE).
   */
  shadowSampleRate?: number;
}

/**
 * One resolved category, carrying the merged provenance contract. This is the
 * single normalized shape every door should converge on.
 */
export interface ResolvedCategory<T = unknown> {
  category: DataCategory;
  /** True when a value was resolved (success + non-null data). */
  available: boolean;
  data: T | null;
  /** Human-readable authoritative source name, e.g. "FEMA NFHL". */
  source: string | null;
  /** ISO date the authoritative source last updated this fact, or null. */
  sourceAsOf: string | null;
  /** Provenance classification. */
  classification: DataClassification;
  /** 0–100, or null when unknown. */
  confidence: number | null;
  /** True when served from cache. */
  fromCache: boolean;
  /** True when served from EXPIRED cache (stale-while-revalidate). */
  stale: boolean;
  /** Which spine produced this: the registry (primary) or broker (fallback). */
  resolvedVia: "registry" | "broker";
}

export interface ResolvedParcelResult {
  /** Per-category results, keyed by category. */
  results: Record<string, ResolvedCategory>;
  meta: {
    successCount: number;
    failureCount: number;
    lookupTimeMs: number;
  };
}

// ── Sampling ──────────────────────────────────────────────────

function defaultShadowSampleRate(): number {
  const raw = process.env.RESOLVE_PARCEL_SHADOW_SAMPLE_RATE;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1, n);
}

const TIER_ORDER: ProviderTier[] = ["free", "starter", "pro", "enterprise"];

/** Clamp orgTier to maxTier (lower of the two wins). */
function cappedTier(orgTier: ProviderTier, maxTier?: ProviderTier): ProviderTier {
  if (!maxTier) return orgTier;
  const orgI = TIER_ORDER.indexOf(orgTier);
  const maxI = TIER_ORDER.indexOf(maxTier);
  return TIER_ORDER[Math.min(orgI, maxI)] ?? "free";
}

/** Map a ProviderTier ceiling onto the broker's AccessTier vocabulary. */
function brokerMaxTier(maxTier?: ProviderTier): "free" | "cached" | "byok" | "paid" {
  // The broker's tiers are free < cached < byok < paid. We only ever cap to
  // "free" here (the public path); anything else lets the broker use its full
  // default ladder, matching prior behavior.
  if (maxTier === "free") return "free";
  return "paid";
}

/**
 * Whether the registry currently registers a provider for a category, given an
 * org tier. Computed from the registry's public `getAvailableProviders` so the
 * fallback decision tracks registration without reaching into registry
 * internals.
 */
function registryCoversCategory(category: DataCategory, orgTier: ProviderTier): boolean {
  const providers = providerRegistry.getAvailableProviders(orgTier);
  return providers.some((p) => p.categories.includes(category));
}

// ── Facade ────────────────────────────────────────────────────

/**
 * Resolve a parcel's categories through the unified spine.
 *
 * Primary path: the provider registry (`enrichAll`) — its cache, circuit
 * breaker, credit metering, and provenance contract. Fallback path: the broker,
 * used ONLY for categories the registry registers no provider for (so map-layer
 * categories the registry doesn't yet cover still resolve). Semantics are
 * identical to today; this is plumbing.
 */
export async function resolveParcel(
  input: LookupInput,
  opts: ResolveParcelOptions,
): Promise<ResolvedParcelResult> {
  const started = Date.now();
  const tier = cappedTier(opts.orgTier, opts.maxTier);
  const creditBalance = opts.creditBalance ?? 0;

  // Partition: registry-covered vs. broker-only categories.
  const registryCats: DataCategory[] = [];
  const brokerOnlyCats: DataCategory[] = [];
  for (const c of opts.categories) {
    if (registryCoversCategory(c, tier)) registryCats.push(c);
    else brokerOnlyCats.push(c);
  }

  const results: Record<string, ResolvedCategory> = {};

  // ── Primary: provider registry ──────────────────────────────
  if (registryCats.length > 0) {
    // Tess #4 — explicit span around the highest-variance customer call so the
    // waterfall shows whether a slow parcel lookup was the registry (county
    // provider / cache miss / circuit) vs the broker fallback below. Auto-
    // tagged with git.sha by traceAsync.
    const registryMap = await traceAsync(
      "resolveParcel.registry.enrichAll",
      () =>
        providerRegistry.enrichAll(
          registryCats,
          input,
          tier,
          creditBalance,
          opts.organizationId,
        ),
      {
        "parcel.categories": registryCats.join(","),
        "parcel.category_count": registryCats.length,
        "parcel.tier": tier,
        "parcel.input_type": input.type,
      },
    );
    for (const category of registryCats) {
      const r = registryMap.get(category);
      if (r && r.data != null) {
        results[category] = {
          category,
          available: true,
          data: r.data,
          source: r.source ?? null,
          sourceAsOf: r.sourceAsOf ? new Date(r.sourceAsOf).toISOString() : null,
          classification: r.classification,
          confidence: typeof r.confidence === "number" ? r.confidence : null,
          fromCache: r.cached,
          stale: r.stale ?? false,
          resolvedVia: "registry",
        };
      } else {
        results[category] = emptyCategory(category, "registry");
      }
    }
  }

  // ── Fallback: broker, only for categories the registry can't serve ──
  if (brokerOnlyCats.length > 0) {
    const coords = toCoords(input);
    if (coords) {
      // Tess #4 — span the broker fallback separately so a slow lookup is
      // attributable to the registry span above vs this broker span.
      const multi = await traceAsync(
        "resolveParcel.broker.lookupMultiple",
        () =>
          dataSourceBroker.lookupMultiple(brokerOnlyCats as LookupCategory[], {
            latitude: coords.latitude,
            longitude: coords.longitude,
            maxTier: brokerMaxTier(opts.maxTier),
          }),
        {
          "parcel.categories": brokerOnlyCats.join(","),
          "parcel.category_count": brokerOnlyCats.length,
          "parcel.resolved_via": "broker",
        },
      );
      for (const category of brokerOnlyCats) {
        const br = multi.results[category as LookupCategory];
        results[category] = normalizeBroker(category, br);
      }
    } else {
      // Broker fallback requires coordinates; without them, honest empties.
      for (const category of brokerOnlyCats) {
        results[category] = emptyCategory(category, "broker");
      }
    }
  }

  // ── Shadow-compare (sampled, async, non-blocking) ───────────
  const sampleRate = opts.shadowSampleRate ?? defaultShadowSampleRate();
  if (sampleRate > 0 && Math.random() < sampleRate) {
    // Snapshot the unified result; compare against the legacy broker path.
    const unifiedSnapshot = results;
    void runShadowCompare(input, opts, unifiedSnapshot).catch((err) => {
      logger.warn("[resolveParcel] shadow-compare failed (non-fatal)", {
        source: "resolveParcel",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  let successCount = 0;
  let failureCount = 0;
  for (const c of opts.categories) {
    if (results[c]?.available) successCount += 1;
    else failureCount += 1;
  }

  return {
    results,
    meta: {
      successCount,
      failureCount,
      lookupTimeMs: Date.now() - started,
    },
  };
}

// ── Normalization helpers ─────────────────────────────────────

function emptyCategory(
  category: DataCategory,
  via: "registry" | "broker",
): ResolvedCategory {
  return {
    category,
    available: false,
    data: null,
    source: null,
    sourceAsOf: null,
    classification: "unknown",
    confidence: null,
    fromCache: false,
    stale: false,
    resolvedVia: via,
  };
}

/**
 * Normalize a broker BrokerResult into the unified ResolvedCategory shape.
 * Mirrors the provenance derivation the public widget did inline today, so the
 * facade output is compatible with the legacy broker path.
 */
function normalizeBroker(
  category: DataCategory,
  br:
    | {
        success: boolean;
        data: unknown;
        source?: { title?: string };
        fromCache?: boolean;
      }
    | undefined,
): ResolvedCategory {
  const ok = !!br && br.success && br.data != null;
  if (!ok || !br) return emptyCategory(category, "broker");
  const sourceTitle =
    ((br.data as { source?: string })?.source) || br.source?.title || null;
  return {
    category,
    available: true,
    data: br.data,
    source: sourceTitle,
    sourceAsOf: null,
    classification: classificationForBroker(category),
    confidence: null,
    fromCache: br.fromCache ?? false,
    stale: false,
    resolvedVia: "broker",
  };
}

/**
 * Broker categories carry no provenance classification of their own; derive the
 * same one the public widget did. Authoritative government records read as
 * authoritative; modeled point layers as modeled; tract estimates as estimate.
 */
export function classificationForBroker(category: DataCategory): DataClassification {
  switch (category) {
    case "flood_zone":
    case "wetlands":
    case "soil":
    case "parcel_data":
    case "tax_assessment":
      return "authoritative";
    case "elevation":
      return "modeled";
    case "demographics":
      return "estimate";
    default:
      return "unknown";
  }
}

function toCoords(
  input: LookupInput,
): { latitude: number; longitude: number } | null {
  if (input.type === "coordinates") {
    return { latitude: input.latitude, longitude: input.longitude };
  }
  return null;
}

// ── Shadow compare ────────────────────────────────────────────

/**
 * Compute the LEGACY broker result for the same input and log field-level
 * differences against the unified result. Non-blocking and best-effort. This is
 * the evidence base for the eventual full caller migration: when the diff log is
 * empty across the surfaces we care about, flipping a caller to the facade is
 * provably safe.
 *
 * Exported for direct unit testing of the diff logic with mock providers.
 */
export async function runShadowCompare(
  input: LookupInput,
  opts: ResolveParcelOptions,
  unified: Record<string, ResolvedCategory>,
): Promise<void> {
  const coords = toCoords(input);
  if (!coords) return; // legacy broker path is coordinate-only

  const legacy = await dataSourceBroker.lookupMultiple(
    opts.categories as LookupCategory[],
    {
      latitude: coords.latitude,
      longitude: coords.longitude,
      maxTier: brokerMaxTier(opts.maxTier),
    },
  );

  const legacyNormalized: Record<string, ResolvedCategory> = {};
  for (const category of opts.categories) {
    legacyNormalized[category] = normalizeBroker(
      category,
      legacy.results[category as LookupCategory],
    );
  }

  logShadowDiff(input, opts.categories, unified, legacyNormalized);
}
