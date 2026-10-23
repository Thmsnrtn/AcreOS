/**
 * Demand events — D1 amendment A3 (data-sourcing v2 §1.4).
 *
 * Every data lookup an organization makes is evidence of DEMAND: which org
 * wanted what kind of answer, where, which layer of the data stack answered,
 * how fast, at what marginal cost to AcreOS, and how confident the served
 * answer was. Recorded from the first lookup, this series is what later says
 * which counties to own outright and which paid feeds earn their cost.
 *
 * Storage is the existing provider_lookup_log row (migration 0287 adds
 * intent_class / answering_layer / confidence_served) — the provider registry
 * already writes one row per lookup attempt, so the demand event rides the
 * same write instead of a second table (table-count ratchet). A row is a
 * demand event only when it names an organization: system probes and
 * org-less calls are telemetry, not demand.
 *
 * Org-scoped: every row carries the organization it belongs to. This package
 * adds the shape and the write path only — no reader, so no cross-org read.
 */

/**
 * Which layer of the data stack answered. The registry decides this from
 * facts it holds at the moment of the answer — never inferred afterwards:
 *  - "open_data"   — a provider whose list price is 0 (federal, state and
 *                    county open data; AcreOS-owned parcels);
 *  - "cache"       — a provider_cache hit (any provider); no vendor call;
 *  - "vendor"      — a paid vendor answered on AcreOS's platform key;
 *  - "vendor_byok" — a paid vendor answered on the org's OWN key.
 * The design's Layer-1 (owned/open) and Layer-3 (vendor) lookups map to
 * open_data and vendor/vendor_byok; cache is recorded separately so a hit is
 * never counted as either.
 */
export type AnsweringLayer = "open_data" | "cache" | "vendor" | "vendor_byok";

export interface DemandEvent {
  organizationId: number;
  /** The lookup category asked for (parcel_data, comps, owner_info, …). */
  intentClass: string;
  geography: { state: string | null; county: string | null };
  answeringLayer: AnsweringLayer;
  /** The provider that answered (or "cache" lane's original provider). */
  provider: string;
  latencyMs: number | null;
  /** What this answer cost AcreOS, in cents. 0 for open data, cache and BYOK. */
  marginalCostCents: number;
  /** The provider's stated confidence in the served answer (0..100); null when none was served. */
  confidenceServed: number | null;
  success: boolean;
  occurredAt: Date;
}

/** Decide the answering layer from facts the registry holds at answer time. */
export function answeringLayerFor(args: { cached: boolean; listPriceCents: number; byokServed: boolean }): AnsweringLayer {
  if (args.cached) return "cache";
  if (args.byokServed) return "vendor_byok";
  return args.listPriceCents > 0 ? "vendor" : "open_data";
}
