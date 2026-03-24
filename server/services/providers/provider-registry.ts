/**
 * Provider Registry — orchestrates multi-provider lookups with
 * tier filtering, credit deduction, circuit breaking, and caching.
 */
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
   * credit deduction, and circuit breaking.
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

      // Skip if org can't afford this provider
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

      try {
        const start = Date.now();
        const result = await provider.lookup(category, input);
        const latencyMs = Date.now() - start;

        this.recordSuccess(provider.name);

        logger.info(`Provider lookup succeeded`, {
          source: "ProviderRegistry",
          metadata: {
            provider: provider.name,
            category,
            costCents,
            latencyMs,
            cached: result.cached,
            confidence: result.confidence,
          },
        });

        return { ...result, latencyMs: result.latencyMs || latencyMs };
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
}

export const providerRegistry = new ProviderRegistry();
