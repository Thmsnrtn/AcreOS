/**
 * Provider Registry — orchestrates multi-provider lookups with
 * tier filtering, credit deduction, circuit breaking, and caching.
 */
import { eq, and, gt, lte, desc } from "drizzle-orm";
import { db } from "../../db";
import { providerCache } from "@shared/schema";
import { logger } from "../../utils/logger";
import { mayCacheAndRedistribute } from "./data-licenses";
import { cacheTtlMs } from "./cache-ttl";
import { evaluatePaidProviderGate } from "@shared/billing/data-procurement-policy";
import type {
  DataCategory,
  DataProvider,
  DataClassification,
  LookupInput,
  LookupResult,
  ProviderTier,
  ProviderHealthStatus,
} from "./types";
import { ProviderCircuitBreaker, type BreakerSnapshot } from "./circuit-breaker";
import { dbBreakerStore } from "./circuit-breaker-store";
// R1d BYO-data-keys: resolves the customer's own property-data vendor key so
// the lookup runs on their account (platform COGS $0, pool never debited).
import { getConnectedDataProviders, resolveDataProviderKey } from "../byok/dataByok";
// Static import (no cycle: providerIntelligence only pulls db/schema/logger).
// Telemetry calls remain fire-and-forget at every callsite — only the module
// loading is eager now, not the work.
import * as providerIntel from "../providerIntelligence";

/**
 * Build a deterministic cache key from provider + category + input.
 * The key is a stable string that uniquely identifies the lookup.
 */
function buildCacheKey(providerName: string, category: DataCategory, input: LookupInput): string {
  const parts = [providerName, category];

  switch (input.type) {
    case "coordinates":
      // Round to 6 decimal places for stability
      parts.push("coord", String(input.latitude), String(input.longitude));
      if (input.state) parts.push(input.state);
      if (input.county) parts.push(input.county);
      break;
    case "address":
      parts.push("addr", input.street, input.city, input.state, input.zip);
      break;
    case "apn":
      parts.push("apn", input.apn, input.state, input.county);
      break;
    case "owner":
      parts.push("owner", input.firstName, input.lastName);
      if (input.state) parts.push(input.state);
      if (input.city) parts.push(input.city);
      if (input.zip) parts.push(input.zip);
      break;
  }

  return parts.map((p) => p.toLowerCase().trim()).join("::");
}

/**
 * Best-effort state/county extraction from a lookup input, for the
 * free-miss-by-county telemetry rollup. Coordinate inputs may omit these
 * (resolved downstream), so both can be undefined.
 */
function extractStateCounty(input: LookupInput): { state?: string; county?: string } {
  switch (input.type) {
    case "coordinates":
      return { state: input.state, county: input.county };
    case "address":
      return { state: input.state };
    case "apn":
      return { state: input.state, county: input.county };
    case "owner":
      return { state: input.state };
  }
}

// ── Tier ordering (lower index = tried first) ─────────────────

const TIER_ORDER: ProviderTier[] = ["free", "starter", "pro", "enterprise"];

function tierIndex(tier: ProviderTier): number {
  return TIER_ORDER.indexOf(tier);
}

function tierAllowed(providerTier: ProviderTier, orgTier: ProviderTier): boolean {
  return tierIndex(providerTier) <= tierIndex(orgTier);
}

// ── Registration entry ────────────────────────────────────────

interface Registration {
  category: DataCategory;
  provider: DataProvider;
  priority: number; // lower = tried first within same tier
}

// ── Circuit breaker constants ─────────────────────────────────

const CB_FAILURE_THRESHOLD = 3;
const CB_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ── Registry class ────────────────────────────────────────────

class ProviderRegistry {
  private registrations: Registration[] = [];
  // Tier 1G: trip state persists to circuit_breaker_state (migration 0154)
  // so deploys don't reset the breaker, with half-open single-probe recovery.
  private breaker = new ProviderCircuitBreaker({
    failureThreshold: CB_FAILURE_THRESHOLD,
    windowMs: CB_WINDOW_MS,
    cooloffMs: CB_WINDOW_MS,
    store: dbBreakerStore,
  });

  /**
   * Register a provider for a category.
   * Lower priority number = tried first within the same tier.
   */
  register(category: DataCategory, provider: DataProvider, priority: number = 50): void {
    this.registrations.push({ category, provider, priority });
    logger.info(`Provider registered: ${provider.name} for ${category} (priority ${priority})`, {
      source: "ProviderRegistry",
    });
  }

  /**
   * Single-category lookup with tier filtering, cost-aware ordering,
   * credit deduction, circuit breaking, and **response caching via
   * the provider_cache table** (DEFECT-0032 fix).
   */
  async lookup(
    category: DataCategory,
    input: LookupInput,
    orgTier: ProviderTier,
    creditBalance: number,
    organizationId?: number
  ): Promise<LookupResult | null> {
    const candidates = this.getCandidates(category, input, orgTier);
    const { state, county } = extractStateCounty(input);

    if (candidates.length === 0) {
      logger.warn(`No providers available for category=${category} tier=${orgTier}`, {
        source: "ProviderRegistry",
      });
      return null;
    }

    // R1d BYO-data-keys: one cheap, no-decrypt presence query — which paid
    // providers does this org bring its own key for? A BYOK-served lookup is
    // free to the platform, so it stays affordable with an empty pool and its
    // pool debit is skipped below. Failure degrades to "no BYOK" (platform
    // path unchanged).
    const byokProviders = organizationId
      ? await getConnectedDataProviders(organizationId)
      : new Set<string>();

    // Stale-while-revalidate: if every candidate is unavailable (circuit open
    // / live failure), we serve the freshest EXPIRED cache rather than null.
    let bestStale: LookupResult | null = null;
    let allFree = true;

    for (const reg of candidates) {
      const { provider } = reg;
      const costCents = provider.costPerLookupCents(category);
      if (costCents > 0) allFree = false;

      // A provider the org has connected its own key for costs the PLATFORM
      // nothing — don't let an empty credit pool skip it.
      const byokPresent = byokProviders.has(provider.name);
      const platformCostCents = byokPresent ? 0 : costCents;

      // Skip if org can't afford this provider (free + BYOK lookups always pass)
      if (platformCostCents > 0 && creditBalance < platformCostCents) {
        logger.info(`Skipping ${provider.name}: insufficient credits (need ${costCents}, have ${creditBalance})`, {
          source: "ProviderRegistry",
        });
        continue;
      }

      const cacheKey = buildCacheKey(provider.name, category, input);

      // Skip if circuit breaker is open — but first try serving stale cache so
      // a flaky federal endpoint degrades to "as-of date" data, not a blank.
      // After the cooloff, exactly one caller is let through as the half-open
      // probe; its success/failure below closes or re-trips the breaker.
      const gate = await this.breaker.shouldAllow(provider.name);
      if (!gate.allowed) {
        logger.info(`Skipping ${provider.name}: circuit breaker open`, {
          source: "ProviderRegistry",
        });
        if (!bestStale) {
          const stale = await this.readStaleCache(cacheKey).catch(() => null);
          if (stale) bestStale = stale;
        }
        continue;
      }

      // ── Cache check (fresh, non-expired) ──────────────────
      try {
        const cached = await this.readCache(cacheKey);
        if (cached) {
          logger.info(`Provider cache hit`, {
            source: "ProviderRegistry",
            metadata: { provider: provider.name, category, cacheKey },
          });
          // Cache-hit telemetry (Tier 2A): the early return here made hits
          // invisible in provider_lookup_log. Avoided cost is honestly known —
          // this provider's fixed per-lookup price would have been paid.
          providerIntel
            .recordLookup({
              providerName: provider.name,
              category,
              inputType: input.type,
              success: true,
              cached: true,
              cacheLane: "provider_cache",
              costCents: 0,
              avoidedCostCents: costCents,
              organizationId,
              state,
              county,
            })
            .catch(() => {});
          return cached;
        }
      } catch (cacheErr) {
        // Cache read failures are non-fatal — fall through to live lookup
        logger.warn(`Cache read error (non-fatal)`, {
          source: "ProviderRegistry",
          metadata: { error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) },
        });
      }

      // ── Resolve BYO-data-key (R1d) ──────────────────────────
      // Decrypt the customer's key only now, right before the vendor call —
      // not on cache hits. If a key row exists but decryption fails, fall
      // back to the platform key AND platform billing (byokServed stays
      // false) so a broken key never silently gives free lookups.
      let apiKeyOverride: string | undefined;
      let byokServed = false;
      if (byokPresent && organizationId) {
        const customerKey = await resolveDataProviderKey(organizationId, provider.name);
        if (customerKey) {
          apiKeyOverride = customerKey;
          byokServed = true;
        }
      }

      // ── Live lookup ────────────────────────────────────────
      try {
        const start = Date.now();
        const result = await provider.lookup(category, input, apiKeyOverride ? { apiKeyOverride } : undefined);
        const latencyMs = Date.now() - start;

        this.recordSuccess(provider.name);

        // Provider-intelligence telemetry (non-blocking). A BYOK-served lookup
        // costs the PLATFORM nothing — record 0 so the founder cost surface
        // stays truthful (the customer paid their own vendor).
        providerIntel
          .recordLookup({
            providerName: provider.name,
            category,
            inputType: input.type,
            success: true,
            cached: false,
            latencyMs,
            costCents: byokServed ? 0 : costCents,
            organizationId,
            state,
            county,
          })
          .catch(() => {});

        const finalResult: LookupResult = { ...result, latencyMs: result.latencyMs || latencyMs };

        // ── Credit metering (Lena, close the margin leak) ────
        // Debit the org credit pool only for a PAID, non-cached provider
        // success. Free providers (costCents=0), cached hits, and BYOK-served
        // lookups (customer paid their own vendor) debit 0.
        if (!byokServed && costCents > 0 && organizationId && !finalResult.cached) {
          this.debitPaidLookup(organizationId, category, provider.name, costCents, input).catch(
            (debitErr) =>
              logger.warn(`Credit debit error (non-fatal)`, {
                source: "ProviderRegistry",
                metadata: { error: debitErr instanceof Error ? debitErr.message : String(debitErr) },
              }),
          );
        }

        logger.info(`Provider lookup succeeded`, {
          source: "ProviderRegistry",
          metadata: {
            provider: provider.name,
            category,
            costCents: byokServed ? 0 : costCents,
            byokServed,
            latencyMs: finalResult.latencyMs,
            cached: false,
            confidence: result.confidence,
          },
        });

        // ── Write result to cache (fire-and-forget) ──────────
        // License guard (Beatrice): only cache-and-redistribute sources whose
        // posture is yes/attribution. Proprietary / review-required sources
        // are live-passthrough only — never persisted to the shared cache.
        if (mayCacheAndRedistribute(finalResult.source)) {
          this.writeCache(cacheKey, provider.name, category, finalResult).catch((writeErr) => {
            logger.warn(`Cache write error (non-fatal)`, {
              source: "ProviderRegistry",
              metadata: { error: writeErr instanceof Error ? writeErr.message : String(writeErr) },
            });
          });
        } else {
          logger.info(`Cache skipped (not redistributable): ${finalResult.source}`, {
            source: "ProviderRegistry",
            metadata: { provider: provider.name, category, source: finalResult.source },
          });
        }

        return finalResult;
      } catch (error) {
        this.recordFailure(provider.name);

        // Provider-intelligence telemetry (non-blocking).
        providerIntel
          .recordLookup({
            providerName: provider.name,
            category,
            inputType: input.type,
            success: false,
            cached: false,
            errorCode: error instanceof Error ? error.message.slice(0, 100) : "unknown",
            organizationId,
            state,
            county,
          })
          .catch(() => {});

        logger.warn(`Provider lookup failed: ${provider.name}`, {
          source: "ProviderRegistry",
          metadata: {
            category,
            error: error instanceof Error ? error.message : String(error),
          },
        });

        // Stale-while-revalidate fallback for THIS provider.
        if (!bestStale) {
          const stale = await this.readStaleCache(cacheKey).catch(() => null);
          if (stale) bestStale = stale;
        }
      }
    }

    // All live providers exhausted. Prefer stale cache over a blank card.
    if (bestStale) {
      logger.warn(`Serving stale cache (all providers unavailable) for category=${category}`, {
        source: "ProviderRegistry",
        metadata: { provider: bestStale.provider, source: bestStale.source },
      });
      // Cache-hit telemetry (Tier 2A). Avoided cost is 0 here — the live
      // lookup FAILED, so no spend was provably avoided by serving stale.
      providerIntel
        .recordLookup({
          providerName: bestStale.provider,
          category,
          inputType: input.type,
          success: true,
          cached: true,
          cacheLane: "provider_cache_stale",
          costCents: 0,
          avoidedCostCents: 0,
          organizationId,
          state,
          county,
        })
        .catch(() => {});
      return bestStale;
    }

    // Genuine miss — record a free-miss-by-county signal so the eventual paid
    // buy is data-driven (Iris/Lena). Only when all available candidates were
    // free; a paid-tier miss is a different signal.
    if (allFree && (state || county)) {
      providerIntel.recordFreeMiss({ category, state, county, organizationId }).catch(() => {});
    }

    logger.warn(`All providers exhausted for category=${category}`, {
      source: "ProviderRegistry",
    });
    return null;
  }

  /**
   * Multi-category enrichment lookup — runs categories in parallel.
   */
  async enrichAll(
    categories: DataCategory[],
    input: LookupInput,
    orgTier: ProviderTier,
    creditBalance: number,
    organizationId?: number
  ): Promise<Map<DataCategory, LookupResult>> {
    let remainingBalance = creditBalance;
    const results = new Map<DataCategory, LookupResult>();

    // Run lookups in parallel, but each deducts from a shared balance.
    // For simplicity, run sequentially to track balance correctly.
    for (const category of categories) {
      const result = await this.lookup(category, input, orgTier, remainingBalance, organizationId);
      if (result) {
        results.set(category, result);
        remainingBalance -= result.costCents;
      }
    }

    return results;
  }

  /**
   * Get available providers for an org's tier, useful for the settings UI.
   */
  getAvailableProviders(orgTier: ProviderTier, organizationId?: number): DataProvider[] {
    const seen = new Set<string>();
    const providers: DataProvider[] = [];

    for (const reg of this.registrations) {
      if (seen.has(reg.provider.name)) continue;
      if (tierAllowed(reg.provider.tierRequired, orgTier)) {
        seen.add(reg.provider.name);
        providers.push(reg.provider);
      }
    }

    return providers;
  }

  /**
   * Run health checks on all registered providers.
   */
  async healthCheckAll(): Promise<Map<string, ProviderHealthStatus>> {
    const seen = new Set<string>();
    const checks = new Map<string, ProviderHealthStatus>();

    for (const reg of this.registrations) {
      if (seen.has(reg.provider.name)) continue;
      seen.add(reg.provider.name);

      try {
        const status = await reg.provider.healthCheck();
        checks.set(reg.provider.name, status);
      } catch (error) {
        checks.set(reg.provider.name, {
          healthy: false,
          latencyMs: 0,
          message: error instanceof Error ? error.message : "Health check failed",
          checkedAt: new Date(),
        });
      }
    }

    return checks;
  }

  // ── Private helpers ───────────────────────────────────────────

  // In-memory cache of recent per-category performance scores.
  // Refreshed at most every PERF_CACHE_TTL_MS; callers get whatever is
  // current without blocking the hot path.
  private perfCache = new Map<string, { scores: Map<string, number>; fetchedAt: number }>();
  private readonly PERF_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  private getPerfScoresSync(category: DataCategory): Map<string, number> {
    const hit = this.perfCache.get(category);
    const now = Date.now();
    if (!hit || now - hit.fetchedAt > this.PERF_CACHE_TTL_MS) {
      // Kick off a refresh in the background; return stale/empty for now.
      providerIntel
        .getCategoryPerformance(category, 7)
        .then((stats) => {
          const scores = new Map<string, number>();
          for (const [name, s] of stats.entries()) {
            // Require at least 5 lookups before trusting the score
            // — small samples are too noisy to use for routing.
            scores.set(name, s.n >= 5 ? s.score : 50);
          }
          this.perfCache.set(category, { scores, fetchedAt: Date.now() });
        })
        .catch(() => {});
      return hit?.scores ?? new Map();
    }
    return hit.scores;
  }

  // In-memory cache of trailing MRR (dollars) for the procurement gate.
  // Refreshed at most every MRR_CACHE_TTL_MS off the hot path. Defaults to 0
  // (locks all paid data) until the first refresh lands — fail-safe: we never
  // accidentally enable a paid vendor because the MRR figure wasn't loaded.
  private mrrCache: { dollars: number; fetchedAt: number } = { dollars: 0, fetchedAt: 0 };
  private readonly MRR_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  private getTrailingMrrSync(): number {
    const now = Date.now();
    if (now - this.mrrCache.fetchedAt > this.MRR_CACHE_TTL_MS) {
      import("../financialForecaster")
        .then(async ({ projectMRR }) => {
          const proj = await projectMRR();
          this.mrrCache = { dollars: proj.currentMRR ?? 0, fetchedAt: Date.now() };
        })
        .catch(() => {
          // Leave the previous value; do not unlock paid data on error.
          this.mrrCache = { ...this.mrrCache, fetchedAt: Date.now() };
        });
    }
    return this.mrrCache.dollars;
  }

  /**
   * Vendor-commit guardrail (Lena item 6): refuse to ROUTE to a paid provider
   * that carries a fixed monthly commit exceeding 2% of trailing MRR. This is
   * deliberately narrow — it gates only the recurring-floor risk, NOT
   * pay-per-call providers (floor = 0), which remain governed by per-lookup
   * credit metering. A provider with no monthly floor always passes here; one
   * with a floor is blocked until MRR can absorb it (and locked entirely below
   * the $200 phase gate).
   */
  private paidProviderAllowed(provider: DataProvider): boolean {
    const floor = provider.minMonthlyCommitCents ?? 0;
    // No monthly floor → not a recurring-commit risk; metering handles spend.
    if (floor === 0) return true;
    const gate = evaluatePaidProviderGate({
      trailingMrrDollars: this.getTrailingMrrSync(),
      minMonthlyCommitCents: floor,
    });
    return gate.allowed;
  }

  private getCandidates(
    category: DataCategory,
    input: LookupInput,
    orgTier: ProviderTier
  ): Registration[] {
    const perfScores = this.getPerfScoresSync(category);
    return this.registrations
      .filter(
        (r) =>
          r.category === category &&
          r.provider.supportedInputTypes.includes(input.type) &&
          tierAllowed(r.provider.tierRequired, orgTier) &&
          this.paidProviderAllowed(r.provider)
      )
      .sort((a, b) => {
        // Sort by tier (free first), then by cost, then by performance
        // score (higher first), then by hard-coded priority as final
        // tiebreaker. Performance score only reorders within the same
        // tier+cost bracket — it never prefers a paid tier over a
        // free one, and never overrides cost.
        const tierDiff = tierIndex(a.provider.tierRequired) - tierIndex(b.provider.tierRequired);
        if (tierDiff !== 0) return tierDiff;

        const costDiff =
          a.provider.costPerLookupCents(category) - b.provider.costPerLookupCents(category);
        if (costDiff !== 0) return costDiff;

        const aScore = perfScores.get(a.provider.name) ?? 50;
        const bScore = perfScores.get(b.provider.name) ?? 50;
        if (aScore !== bScore) return bScore - aScore; // higher score first

        return a.priority - b.priority;
      });
  }

  private recordSuccess(providerName: string): void {
    this.breaker.recordSuccess(providerName);
  }

  private recordFailure(providerName: string): void {
    this.breaker.recordFailure(providerName);
  }

  /** Read-only breaker view for health surfaces and tests. */
  getBreakerSnapshot(providerName: string): BreakerSnapshot {
    return this.breaker.snapshot(providerName);
  }

  // ── Credit metering (Lena: close the paid-data margin leak) ──

  /**
   * Debit the org credit pool for a paid, non-cached provider success.
   * Routes through the canonical credit-pool surface (poolDebit) which writes
   * a financial_ledger row and is idempotent on externalEventId. Free
   * providers never reach here (guarded by costCents > 0 at the call site).
   *
   * The data-lookup CreditAction is selected per category so the unit
   * economics roll up by action on the founder cost surface.
   */
  private async debitPaidLookup(
    organizationId: number,
    category: DataCategory,
    providerName: string,
    costCents: number,
    input: LookupInput,
  ): Promise<void> {
    const { poolDebit } = await import("../creditPool");
    const { creditActionForCategory } = await import("@shared/billing/credit-weights");
    const action = creditActionForCategory(category);
    if (!action) return; // category has no paid-lookup weight — nothing to debit

    // Idempotency anchor: provider + category + a stable input fingerprint,
    // bucketed by UTC day. The old `Date.now()` suffix made every call unique,
    // defeating poolDebit's externalEventId dedup entirely — request replays
    // and double-fires wrote duplicate opex rows and inflated per-org COGS in
    // unitEconomics. Day-bucketing collapses same-day duplicates of the same
    // lookup into one ledger row while a genuine repeat lookup on a later day
    // (a fresh provider charge) still records.
    const fingerprint = buildCacheKey(providerName, category, input);
    const dayBucket = new Date().toISOString().slice(0, 10);
    await poolDebit({
      organizationId,
      action,
      units: 1,
      externalEventId: `datalookup:${fingerprint}:${dayBucket}`,
      notes: `${providerName} ${category} lookup (${costCents}¢ provider cost)`,
      // Post-hoc COGS recorder: the paid lookup already happened, so the
      // ledger row must be written even when the pool is over — never gate.
      enforce: "record",
    });
  }

  // ── Cache helpers (provider_cache table) ─────────────────────

  /**
   * Hydrate a provider_cache row into a LookupResult. The provenance fields
   * (source / sourceAsOf / classification) are persisted in responseData so a
   * cache hit carries the same chip the live result would.
   */
  private rowToResult(
    row: typeof providerCache.$inferSelect,
    now: Date,
    stale: boolean,
  ): LookupResult {
    const data = row.responseData as Record<string, unknown>;
    const sourceAsOfRaw = data.sourceAsOf as string | number | null | undefined;
    return {
      provider: row.provider,
      category: row.category as DataCategory,
      confidence: (data.confidence as number) ?? 80,
      costCents: 0, // cached lookups are free — no credit deduction
      fetchedAt: row.createdAt ?? now,
      cached: true,
      latencyMs: 0,
      data: data.data ?? data,
      source: (data.source as string) ?? row.provider,
      sourceAsOf: sourceAsOfRaw != null ? new Date(sourceAsOfRaw) : null,
      classification: (data.classification as DataClassification) ?? "authoritative",
      stale,
    };
  }

  /**
   * Read a non-expired entry from provider_cache.
   * Returns a fully-hydrated LookupResult or null on miss.
   */
  private async readCache(cacheKey: string): Promise<LookupResult | null> {
    const now = new Date();

    const [row] = await db
      .select()
      .from(providerCache)
      .where(
        and(
          eq(providerCache.cacheKey, cacheKey),
          gt(providerCache.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row) return null;
    return this.rowToResult(row, now, false);
  }

  /**
   * Stale-while-revalidate read: return the freshest EXPIRED entry for a key
   * when the live provider is unavailable (circuit open / live failure). The
   * result is flagged `stale: true` so the UI renders it with its sourceAsOf
   * and a "may be out of date" affordance instead of as fresh.
   */
  private async readStaleCache(cacheKey: string): Promise<LookupResult | null> {
    const now = new Date();

    const [row] = await db
      .select()
      .from(providerCache)
      .where(
        and(
          eq(providerCache.cacheKey, cacheKey),
          lte(providerCache.expiresAt, now),
        ),
      )
      .orderBy(desc(providerCache.createdAt))
      .limit(1);

    if (!row) return null;
    return this.rowToResult(row, now, true);
  }

  /**
   * Upsert a lookup result into provider_cache with a per-category TTL.
   * Persists provenance (source / sourceAsOf / classification) so cache hits
   * and stale reads carry the same chip the live result would.
   */
  private async writeCache(
    cacheKey: string,
    providerName: string,
    category: DataCategory,
    result: LookupResult,
  ): Promise<void> {
    const ttlMs = cacheTtlMs(category, result.source);
    const expiresAt = new Date(Date.now() + ttlMs);

    const responseData = {
      data: result.data,
      confidence: result.confidence,
      source: result.source,
      sourceAsOf: result.sourceAsOf ? result.sourceAsOf.toISOString() : null,
      classification: result.classification,
    };

    await db
      .insert(providerCache)
      .values({
        provider: providerName,
        category,
        cacheKey,
        responseData,
        costCents: result.costCents,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: providerCache.cacheKey,
        set: {
          responseData,
          costCents: result.costCents,
          expiresAt,
          createdAt: new Date(),
        },
      });
  }
}

export const providerRegistry = new ProviderRegistry();
