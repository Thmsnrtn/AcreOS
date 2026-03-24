/**
 * Data Provider Abstraction — Core Interfaces
 *
 * All external data access flows through these interfaces.
 * Providers register by category; the registry orchestrates
 * tier-filtered lookups with credit deduction and caching.
 */

// ── Lookup Input ──────────────────────────────────────────────

export type LookupInput =
  | { type: "coordinates"; latitude: number; longitude: number; state?: string; county?: string }
  | { type: "address"; street: string; city: string; state: string; zip: string }
  | { type: "apn"; apn: string; state: string; county: string }
  | { type: "owner"; firstName: string; lastName: string; state?: string; city?: string; zip?: string };

// ── Lookup Result ─────────────────────────────────────────────

export interface LookupResult<T = unknown> {
  provider: string;
  category: DataCategory;
  confidence: number; // 0–100
  costCents: number;
  fetchedAt: Date;
  cached: boolean;
  latencyMs: number;
  data: T;
}

// ── Data Categories ───────────────────────────────────────────

export type DataCategory =
  | "parcel_data"
  | "property_details"
  | "comps"
  | "owner_info"
  | "environmental"
  | "demographics"
  | "valuation"
  | "structure"
  | "skip_trace";

// ── Subscription Tiers ────────────────────────────────────────

export type ProviderTier = "free" | "starter" | "pro" | "enterprise";

// ── Provider Interface ────────────────────────────────────────

export interface DataProvider {
  /** Unique machine name, e.g. "attom", "open-data", "regrid" */
  readonly name: string;
  /** Human-readable label for settings UI */
  readonly displayName: string;
  /** Categories this provider can fulfill */
  readonly categories: DataCategory[];
  /** Input types this provider supports */
  readonly supportedInputTypes: LookupInput["type"][];
  /** Minimum tier required to use this provider */
  readonly tierRequired: ProviderTier;
  /**
   * Cost per lookup in cents. Can be a flat number or per-category.
   * Return 0 for free providers.
   */
  costPerLookupCents(category: DataCategory): number;
  /** Whether the provider has valid credentials configured */
  isConfigured(organizationId?: number): Promise<boolean>;
  /** Perform a single-category lookup */
  lookup(category: DataCategory, input: LookupInput): Promise<LookupResult>;
  /** Quick connectivity / credential check */
  healthCheck(): Promise<ProviderHealthStatus>;
}

// ── Health ─────────────────────────────────────────────────────

export interface ProviderHealthStatus {
  healthy: boolean;
  latencyMs: number;
  message?: string;
  checkedAt: Date;
}

// ── Circuit Breaker State ─────────────────────────────────────

export interface CircuitBreakerState {
  failures: number;
  lastFailure: Date | null;
  open: boolean; // true = skip this provider
}
