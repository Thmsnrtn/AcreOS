/**
 * Provider Registry — orchestrates multi-provider lookups with
 * tier filtering, credit deduction, circuit breaking, and caching.
 */
import { eq, and, gt } from "drizzle-orm";
import { db } from "../../db";
import { providerCache } from "@shared/schema";
import { logger } from "../../utils/logger";
import type {
  DataCategory,
  DataProvider,
  LookupInput,
  LookupResult,
  ProviderTier,
  CircuitBreakerState,
  ProviderHealthStatus,
} from "./types";

// ── Cache TTL (24 hours default) ─────────────────────────────

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  private circuits: Map<string, CircuitBreakerState> = new Map();

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

    if (candidates.length === 0) {
      logger.warn(`No providers available for category=${category} tier=${orgTier}`, {
        source: "ProviderRegistry",
      });
      return null;
    }

    for (const reg of candidates) {
      const { provider } = reg;
      const costCents = provider.costPerLookupCents(category);

      // Skip if org can't afford this provider (free lookups always pass)
      if (costCents > 0 && creditBalance < costCents) {
        logger.info(`Skipping ${provider.name}: insufficient credits (need ${costCents}, have ${creditBalance})`, {
          source: "ProviderRegistry",
        });
        continue;
      }

      // Skip if circuit breaker is open
      if (this.isCircuitOpen(provider.name)) {
        logger.info(`Skipping ${provider.name}: circuit breaker open`, {
          source: "ProviderRegistry",
        });
        continue;
      }

      // ── Cache check ────────────────────────────────────────
      const cacheKey = buildCacheKey(provider.name, category, input);

      try {
        const cached = await this.readCache(cacheKey);
        if (cached) {
          logger.info(`Provider cache hit`, {
            source: "ProviderRegistry",
            metadata: { provider: provider.name, category, cacheKey },
          });
          return cached;
        }
      } catch (cacheErr) {
        // Cache read failures are non-fatal — fall through to live lookup
        logger.warn(`Cache read error (non-fatal)`, {
          source: "ProviderRegistry",
          metadata: { error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) },
        });
      }

      // ── Live lookup ────────────────────────────────────────
      try {
        const start = Date.now();
        const result = await provider.lookup(category, input);
        const latencyMs = Date.now() - start;

        this.recordSuccess(provider.name);

        const finalResult: LookupResult = { ...result, latencyMs: result.latencyMs || latencyMs };

        logger.info(`Provider lookup succeeded`, {
          source: "ProviderRegistry",
          metadata: {
            provider: provider.name,
            category,
            costCents,
            latencyMs: finalResult.latencyMs,
            cached: false,
            confidence: result.confidence,
          },
        });

        // ── Write result to cache (fire-and-forget) ──────────
        this.writeCache(cacheKey, provider.name, category, finalResult).catch((writeErr) => {
          logger.warn(`Cache write error (non-fatal)`, {
            source: "ProviderRegistry",
            metadata: { error: writeErr instanceof Error ? writeErr.message : String(writeErr) },
          });
        });

        return finalResult;
      } catch (error) {
        this.recordFailure(provider.name);
        logger.warn(`Provider lookup failed: ${provider.name}`, {
          source: "ProviderRegistry",
          metadata: {
            category,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
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

  private getCandidates(
    category: DataCategory,
    input: LookupInput,
    orgTier: ProviderTier
  ): Registration[] {
    return this.registrations
      .filter(
        (r) =>
          r.category === category &&
          r.provider.supportedInputTypes.includes(input.type) &&
          tierAllowed(r.provider.tierRequired, orgTier)
      )
      .sort((a, b) => {
        // Sort by tier (free first), then by cost, then by priority
        const tierDiff = tierIndex(a.provider.tierRequired) - tierIndex(b.provider.tierRequired);
        if (tierDiff !== 0) return tierDiff;

        const costDiff =
          a.provider.costPerLookupCents(category) - b.provider.costPerLookupCents(category);
        if (costDiff !== 0) return costDiff;

        return a.priority - b.priority;
      });
  }

  private isCircuitOpen(providerName: string): boolean {
    const state = this.circuits.get(providerName);
    if (!state || !state.open) return false;

    // Auto-close after window expires (half-open)
    if (state.lastFailure && Date.now() - state.lastFailure.getTime() > CB_WINDOW_MS) {
      state.open = false;
      state.failures = 0;
      return false;
    }

    return true;
  }

  private recordSuccess(providerName: string): void {
    const state = this.circuits.get(providerName);
    if (state) {
      state.failures = 0;
      state.open = false;
    }
  }

  private recordFailure(providerName: string): void {
    let state = this.circuits.get(providerName);
    if (!state) {
      state = { failures: 0, lastFailure: null, open: false };
      this.circuits.set(providerName, state);
    }

    state.failures += 1;
    state.lastFailure = new Date();

    if (state.failures >= CB_FAILURE_THRESHOLD) {
      state.open = true;
      logger.warn(`Circuit breaker opened for ${providerName} (${state.failures} failures)`, {
        source: "ProviderRegistry",
      });
    }
  }

  // ── Cache helpers (provider_cache table) ─────────────────────

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

    const data = row.responseData as Record<string, unknown>;

    return {
      provider: row.provider,
      category: row.category as DataCategory,
      confidence: (data.confidence as number) ?? 80,
      costCents: 0, // cached lookups are free — no credit deduction
      fetchedAt: row.createdAt ?? now,
      cached: true,
      latencyMs: 0,
      data: data.data ?? data,
    };
  }

  /**
   * Upsert a lookup result into provider_cache with a TTL.
   */
  private async writeCache(
    cacheKey: string,
    providerName: string,
    category: DataCategory,
    result: LookupResult,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + DEFAULT_CACHE_TTL_MS);

    await db
      .insert(providerCache)
      .values({
        provider: providerName,
        category,
        cacheKey,
        responseData: { data: result.data, confidence: result.confidence },
        costCents: result.costCents,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: providerCache.cacheKey,
        set: {
          responseData: { data: result.data, confidence: result.confidence },
          costCents: result.costCents,
          expiresAt,
          createdAt: new Date(),
        },
      });
  }
}

export const providerRegistry = new ProviderRegistry();
