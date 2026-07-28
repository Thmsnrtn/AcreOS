/**
 * dataSourceProbe — per-source synthetic canary for the free data backbone.
 *
 * (Tess SRE lens, item 2.) The free county/federal data sources ARE the
 * product, but a 200 OK from a MapServer root does NOT prove a real lookup at a
 * known lat/lng still works — schemas drift, layers get renumbered, query
 * params change. This job runs a handful of GOLDEN PARCELS (known coordinates in
 * counties we demo in) through the provider registry on the warm worker every
 * ~30m and asserts each source returns the EXPECTED SHAPE and a PLAUSIBLE VALUE.
 *
 * Pass/fail + measured latency lands in two places:
 *   - `provider_health` (migration 0122) — the per-source canary history.
 *   - `provider_lookup_log` via providerIntelligence.recordLookup — so probe
 *     activity shows up in the existing providerIntelligence rollups and the
 *     /founder/providers surface, under a `probe:<source>` provider name so it
 *     never pollutes real per-org lookup stats.
 *
 * It deliberately asserts loosely on the upstream data SHAPE (we don't own the
 * broker's exact field names and must not couple to them) but strictly on
 * "did we get a usable, plausible answer at all" — the failure we actually care
 * about is a source that answers with garbage or nothing.
 */

import { logger } from "../utils/logger";
import type { DataCategory, LookupInput, LookupResult } from "../services/providers/types";

// ── Golden fixtures ──────────────────────────────────────────────
// Known coordinates in land-investor demo counties. Each names the category to
// exercise and a `check` that validates the returned result is plausible.

interface GoldenProbe {
  /** Stable label, e.g. "travis-tx-flood". */
  label: string;
  category: DataCategory;
  input: LookupInput;
  /** Returns null if plausible, or a short reason string if implausible. */
  check: (result: LookupResult | null) => string | null;
}

/** A non-empty object/array with at least one defined value. */
function hasUsableData(data: unknown): boolean {
  if (data == null) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === "object") {
    return Object.values(data as Record<string, unknown>).some((v) => v != null);
  }
  return typeof data === "string" ? data.length > 0 : true;
}

/** Generic "we got a real answer" assertion shared by most probes. */
function plausibleResult(result: LookupResult | null, minConfidence = 1): string | null {
  if (!result) return "no result (all providers exhausted)";
  if (typeof result.confidence !== "number" || result.confidence < minConfidence) {
    return `confidence too low (${result.confidence})`;
  }
  if (!hasUsableData(result.data)) return "result.data empty/null";
  if (!result.source) return "missing source/provenance";
  return null;
}

export const GOLDEN_PROBES: GoldenProbe[] = [
  {
    // Travis County, TX (Austin) — dense parcel + flood coverage.
    label: "travis-tx-environmental",
    category: "environmental",
    input: { type: "coordinates", latitude: 30.2672, longitude: -97.7431, state: "TX", county: "Travis" },
    check: (r) => plausibleResult(r, 20),
  },
  {
    // Maricopa County, AZ (Phoenix) — land-investor heavy metro.
    label: "maricopa-az-environmental",
    category: "environmental",
    input: { type: "coordinates", latitude: 33.4484, longitude: -112.074, state: "AZ", county: "Maricopa" },
    check: (r) => plausibleResult(r, 20),
  },
  {
    // Bernalillo County, NM (Albuquerque) — demographics canary (Census ACS).
    label: "bernalillo-nm-demographics",
    category: "demographics",
    input: { type: "coordinates", latitude: 35.0844, longitude: -106.6504, state: "NM", county: "Bernalillo" },
    check: (r) => plausibleResult(r, 20),
  },
  {
    // Polk County, FL — rural-ish land county, parcel_data canary (county GIS).
    label: "polk-fl-parcel",
    category: "parcel_data",
    input: { type: "coordinates", latitude: 27.8947, longitude: -81.7787, state: "FL", county: "Polk" },
    // parcel_data may legitimately MISS for a coordinate not on a parcel; we
    // only fail this probe on an outright error/exception path, not a clean
    // "no parcel here". So a null result is tolerated; a thrown error is not
    // (handled by the runner). Assert shape only when we DID get a hit.
    check: (r) => (r ? plausibleResult(r, 1) : null),
  },
  // ── Load-bearing free-data-plane categories (2026-07-28) ─────────────────
  // flood_zone / soil / wetlands / elevation are the categories the due-
  // diligence and map surfaces lean on hardest; each gets its own canary so a
  // FEMA/USDA/USFWS/USGS drift pages the founder, not the customer.
  {
    // Travis County, TX — FEMA NFHL flood-zone canary (the /arcgis/ host).
    // Even off-floodplain coordinates return an honest "Zone X" answer.
    label: "travis-tx-flood",
    category: "flood_zone",
    input: { type: "coordinates", latitude: 30.2672, longitude: -97.7431, state: "TX", county: "Travis" },
    check: (r) => plausibleResult(r, 20),
  },
  {
    // Maricopa County, AZ — USDA NRCS SDA soil canary (mapunit + extended query).
    label: "maricopa-az-soil",
    category: "soil",
    input: { type: "coordinates", latitude: 33.4484, longitude: -112.074, state: "AZ", county: "Maricopa" },
    check: (r) => plausibleResult(r, 20),
  },
  {
    // Polk County, FL — USFWS NWI wetlands canary (wetlands-dense state; a
    // clean "no wetlands here" is still a usable, non-empty payload).
    label: "polk-fl-wetlands",
    category: "wetlands",
    input: { type: "coordinates", latitude: 27.8947, longitude: -81.7787, state: "FL", county: "Polk" },
    check: (r) => plausibleResult(r, 20),
  },
  {
    // Bernalillo County, NM — USGS 3DEP elevation canary (epqs.nationalmap.gov).
    label: "bernalillo-nm-elevation",
    category: "elevation",
    input: { type: "coordinates", latitude: 35.0844, longitude: -106.6504, state: "NM", county: "Bernalillo" },
    check: (r) => plausibleResult(r, 20),
  },
  {
    // Infrastructure is RETIRED: HIFLD Open (its only upstream) was
    // discontinued Aug 2025, and the broker now short-circuits the category to
    // an explicit success:false (see RETIRED_CATEGORIES in
    // server/services/data-source-broker.ts). This probe PINS that honest
    // behavior: healthy = no usable data came back. If it ever starts
    // returning data, a replacement source was wired in — flip this probe to
    // `plausibleResult` expectations at that point.
    label: "travis-tx-infrastructure-retired",
    category: "infrastructure",
    input: { type: "coordinates", latitude: 30.2672, longitude: -97.7431, state: "TX", county: "Travis" },
    check: (r) => {
      if (!r || !hasUsableData(r.data)) return null; // expected: honest unavailable
      return "infrastructure returned data but HIFLD is retired (Aug 2025) — if a replacement source was wired in, update this probe to assert plausible data";
    },
  },
];

export interface ProbeOutcome {
  label: string;
  source: string;
  category: DataCategory;
  healthy: boolean;
  latencyMs: number;
  detail?: string;
}

/**
 * Run all golden probes once. Returns the outcomes. Used by the scheduled job
 * AND directly by tests (so the shape assertions are unit-testable without a
 * cron). Each probe failure is isolated — one dead source doesn't abort the run.
 */
export async function runDataSourceProbes(): Promise<ProbeOutcome[]> {
  const { providerRegistry } = await import("../services/providers/provider-registry");
  const outcomes: ProbeOutcome[] = [];

  for (const probe of GOLDEN_PROBES) {
    const start = Date.now();
    let healthy = false;
    let detail: string | undefined;
    let source = `probe:${probe.label}`;
    let result: LookupResult | null = null;

    try {
      // Probe the FREE tier with zero credits — exercises exactly the free
      // data stack a free-tier customer hits.
      result = await providerRegistry.lookup(probe.category, probe.input, "free", 0);
      const reason = probe.check(result);
      healthy = reason === null;
      detail = reason ?? undefined;
      if (result?.source) source = result.source;
    } catch (err) {
      healthy = false;
      detail = err instanceof Error ? err.message.slice(0, 200) : "probe threw";
    }

    const latencyMs = Date.now() - start;
    outcomes.push({ label: probe.label, source, category: probe.category, healthy, latencyMs, detail });

    if (!healthy) {
      logger.warn(`[dataSourceProbe] FAIL ${probe.label}`, {
        source: "dataSourceProbe",
        metadata: { category: probe.category, source, detail, latencyMs },
      });
    }
  }

  return outcomes;
}

/**
 * Persist probe outcomes to provider_health + the provider lookup log, then
 * raise a single system alert if any source is failing (so a county API change
 * pages the founder, not the customer).
 */
export async function runAndRecordDataSourceProbes(): Promise<{ ran: number; failed: number }> {
  const outcomes = await runDataSourceProbes();
  const failed = outcomes.filter((o) => !o.healthy);

  // 1) provider_health canary history.
  try {
    const { db } = await import("../db");
    const { providerHealth } = await import("@shared/schema");
    if (outcomes.length > 0) {
      await db.insert(providerHealth).values(
        outcomes.map((o) => ({
          source: o.source,
          category: o.category,
          probe: o.label,
          healthy: o.healthy,
          latencyMs: o.latencyMs,
          detail: o.detail ?? null,
        })),
      );
    }
  } catch (err) {
    logger.warn("[dataSourceProbe] provider_health write failed (non-blocking)", {
      source: "dataSourceProbe",
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  // 2) providerIntelligence lookup log — under a probe:* name so it shows in
  //    /founder/providers without contaminating real per-org lookup stats.
  try {
    const { recordLookup } = await import("../services/providerIntelligence");
    for (const o of outcomes) {
      await recordLookup({
        providerName: `probe:${o.label}`,
        category: o.category,
        inputType: "coordinates",
        success: o.healthy,
        cached: false,
        latencyMs: o.latencyMs,
        errorCode: o.healthy ? undefined : (o.detail ?? "probe_failed").slice(0, 100),
      });
    }
  } catch (err) {
    logger.warn("[dataSourceProbe] lookup-log write failed (non-blocking)", {
      source: "dataSourceProbe",
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  // 3) Alert when a source is down — the whole point of the canary.
  if (failed.length > 0) {
    try {
      const { storage } = await import("../storage");
      await storage.createSystemAlert({
        type: "data_source_down",
        alertType: "data_source_down",
        severity: "warning",
        title: `${failed.length} data source probe(s) failing`,
        message:
          `Synthetic data-source probes failed: ` +
          failed.map((f) => `${f.label} (${f.source}: ${f.detail})`).join("; "),
        status: "new",
        metadata: { failed: failed.map((f) => ({ label: f.label, source: f.source, detail: f.detail })) },
      });
    } catch {
      // Alert is best-effort; the provider_health row already recorded the fail.
    }
  }

  logger.info(`[dataSourceProbe] ran ${outcomes.length} probes, ${failed.length} failing`, {
    source: "dataSourceProbe",
  });

  return { ran: outcomes.length, failed: failed.length };
}
