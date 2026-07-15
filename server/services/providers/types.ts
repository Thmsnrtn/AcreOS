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

/**
 * Provenance classification for a datum (Quinn data-honesty lens).
 *  - "authoritative": a system-of-record fact (open-data parcel/federal layer,
 *    county assessor of record). The customer can rely on it modulo freshness.
 *  - "estimate": derived/heuristic but data-backed (e.g. comp-based valuation).
 *  - "modeled": output of a computed score/model (e.g. opportunity score).
 *    NEVER present a modeled value as authoritative.
 *  - "unknown": we have no value — render "Not yet pulled", never a default.
 */
export type DataClassification = "authoritative" | "estimate" | "modeled" | "unknown";

export interface LookupResult<T = unknown> {
  provider: string;
  category: DataCategory;
  confidence: number; // 0–100
  costCents: number;
  fetchedAt: Date;
  cached: boolean;
  latencyMs: number;
  data: T;
  /**
   * Human-readable authoritative source name, e.g. "FEMA NFHL", "County GIS",
   * "USDA NASS". Rendered as the provenance chip the customer sees. Distinct
   * from `provider` (the machine routing name).
   */
  source: string;
  /**
   * The date the *authoritative source* last updated this fact (e.g. the FEMA
   * effective date, the county tax year), distinct from `fetchedAt` (when WE
   * pulled it). Null when the upstream layer exposes no freshness metadata.
   */
  sourceAsOf?: Date | null;
  /** Provenance classification — see DataClassification. */
  classification: DataClassification;
  /**
   * True when this result is being served from EXPIRED cache because the live
   * provider is unavailable (circuit open / all providers failed). The data is
   * older than its TTL — render with its sourceAsOf and a "may be out of date"
   * affordance rather than as fresh. (Stale-while-revalidate.)
   */
  stale?: boolean;
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
  | "skip_trace"
  // ── Open-data environmental / land sub-kinds ──────────────────
  // These map 1:1 onto the DataSourceBroker's LookupCategory values so the
  // broker can be wrapped as the fetch implementation behind the registry's
  // single cache / circuit-breaker / provenance contract. They are all
  // free, federal/open, public-domain sources and are NEVER billed
  // (creditActionForCategory returns null for them).
  | "flood_zone"
  | "wetlands"
  | "soil"
  | "tax_assessment"
  | "market_data"
  | "zoning"
  | "satellite"
  | "infrastructure"
  | "natural_hazards"
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
  | "usda_clu";

// ── Subscription Tiers ────────────────────────────────────────

export type ProviderTier = "free" | "starter" | "pro" | "enterprise";

// ── Data licensing (Beatrice CRO lens) ────────────────────────

/**
 * Governing license for a data source.
 *  - "public-domain-usgov": U.S. federal work, 17 U.S.C. §105 — freely
 *    redistributable, no attribution legally required (we credit anyway).
 *  - "cc0" / "cc-by": Creative Commons; cc-by requires attribution.
 *  - "odbl": Open Database License (OpenStreetMap) — share-alike +
 *    mandatory attribution. Use for context only; do NOT bulk-redistribute
 *    a derived database without honoring share-alike.
 *  - "county-tos": county/portal terms-of-use govern; varies by jurisdiction
 *    and must be human-reviewed before redistribution.
 *  - "proprietary": paid vendor (Regrid/ATTOM/BatchData); contract governs
 *    redistribution + cache TTL.
 */
export type DataLicense =
  | "public-domain-usgov"
  | "cc0"
  | "cc-by"
  | "odbl"
  | "county-tos"
  | "proprietary";

/**
 * Redistribution posture for cache-and-reserve decisions.
 *  - "yes": may cache and re-serve freely.
 *  - "attribution": may cache and re-serve WITH visible attribution.
 *  - "no": never persist/redistribute — live-passthrough only.
 *  - "review-required": unknown until a human reviews terms — treat as "no"
 *    for caching purposes (live-passthrough only) until upgraded.
 */
export type RedistributePosture = "yes" | "attribution" | "no" | "review-required";

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
   * Governing license for the data this provider returns (Beatrice lens).
   * Drives whether the registry may cache-and-redistribute vs. live-passthrough.
   */
  readonly license: DataLicense;
  /**
   * Required/credited attribution string, rendered wherever this source
   * contributes a displayed value. Mandatory for "odbl" and most paid feeds.
   */
  readonly attributionText?: string;
  /** Redistribution posture — see RedistributePosture. */
  readonly redistributable: RedistributePosture;
  /**
   * Minimum monthly commit in cents (vendor floor). The procurement guard
   * (Lena 2%-of-MRR rule) refuses to enable a paid provider whose
   * minMonthlyCommit exceeds 2% of trailing MRR. Pay-per-call vendors with
   * no floor omit this (treated as 0).
   */
  readonly minMonthlyCommitCents?: number;
  /**
   * Cost per lookup in cents. Can be a flat number or per-category.
   * Return 0 for free providers.
   */
  costPerLookupCents(category: DataCategory): number;
  /** Whether the provider has valid credentials configured */
  isConfigured(organizationId?: number): Promise<boolean>;
  /** Perform a single-category lookup */
  lookup(category: DataCategory, input: LookupInput, ctx?: ProviderLookupContext): Promise<LookupResult>;
  /** Quick connectivity / credential check */
  healthCheck(): Promise<ProviderHealthStatus>;
}

/**
 * Per-lookup context threaded from the registry into a provider's `lookup`.
 * Currently carries the BYO-data-key override (R1d): when the calling org
 * has connected its own vendor account for this provider, the registry
 * resolves the customer's key and passes it here. Proprietary adapters use
 * it in preference to the platform key; open-data providers ignore it.
 */
export interface ProviderLookupContext {
  /**
   * The customer's own decrypted API key for this provider, when they've
   * connected one. NEVER log or serialize this value. Absent → platform key.
   */
  apiKeyOverride?: string;
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
