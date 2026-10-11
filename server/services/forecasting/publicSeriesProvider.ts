/**
 * Public series as a data provider (W4 forecasting, stage 0).
 *
 * Registered in the provider registry (server/providers-init.ts) for the
 * `macro_series` category, so every read gets the registry's contract: free
 * tier, circuit breaking, and caching in provider_cache. Each family in
 * shared/forecasting/publicSeries.ts is fetched through a SANCTIONED route:
 *
 *   state_payrolls / state_unemployment   FRED API (free key FRED_API_KEY),
 *                                         read "as known today" via the
 *                                         realtime window — FRED's terms
 *                                         forbid scraping the website, so
 *                                         without the key this refuses
 *   state_permits_nsa                     Census BPS monthly state files
 *                                         (official download, keyless)
 *   state_ag_land_value                   NASS Quick Stats API (free key
 *                                         NASS_API_KEY)
 *
 * A family that cannot answer throws with the reason, so the registry falls
 * through and records a miss — it never returns a default, and the recorder
 * reads `publicSeriesReadiness` first to refuse with that reason in words.
 */
import { fetchGeo } from "../providers/fetchGeo";
import type { DataCategory, DataProvider, LookupInput, LookupResult, ProviderHealthStatus } from "../providers/types";
import { clock } from "../../utils/clock";
import { STATES, seriesFamily, type SeriesFamilyId } from "@shared/forecasting/publicSeries";
import { addMonths } from "@shared/forecasting/vintage";

export interface SeriesObservation {
  observationDate: string;
  value: number;
}

export interface SeriesLookupData {
  seriesId: string;
  family: SeriesFamilyId;
  /** The date these values were known (what the recorder stamps as the vintage). */
  knownOn: string;
  observations: SeriesObservation[];
}

/** Why a family cannot be fetched in this deploy, or null when it can. */
export function publicSeriesReadiness(family: SeriesFamilyId, env: Record<string, string | undefined> = process.env): string | null {
  const f = seriesFamily(family);
  if (f.keyEnv && !env[f.keyEnv]) {
    return `${f.keyEnv} not set — ${f.publisher} is read through ${f.keyEnv === "FRED_API_KEY" ? "the FRED API" : "the NASS Quick Stats API"}, which needs a free key; nothing is recorded for this series until it is set`;
  }
  return null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function getText(url: string): Promise<string> {
  const res = await fetchGeo(url, { timeoutMs: 30_000, ratePerSec: 2 });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return res.text();
}

// ── FRED API ──────────────────────────────────────────────────────────────

/** Parse a FRED API observations reply. "." means missing and is skipped, never zero. */
function parseFredObservations(body: unknown): SeriesObservation[] {
  const obs = (body as { observations?: Array<{ date?: string; value?: string }> } | null)?.observations;
  if (!Array.isArray(obs)) {
    const msg = (body as { error_message?: string } | null)?.error_message;
    throw new Error(`FRED API: ${msg ?? "no observations in reply"}`);
  }
  const out: SeriesObservation[] = [];
  for (const o of obs) {
    const v = Number(o.value);
    if (!o.date || o.value === "." || !Number.isFinite(v)) continue;
    out.push({ observationDate: o.date, value: v });
  }
  return out;
}

async function fredSeries(seriesId: string, today: string): Promise<SeriesObservation[]> {
  const q = new URLSearchParams({
    series_id: seriesId,
    api_key: String(process.env.FRED_API_KEY),
    file_type: "json",
    realtime_start: today,
    realtime_end: today,
    observation_start: "1990-01-01",
  });
  const text = await getText(`https://api.stlouisfed.org/fred/series/observations?${q}`);
  return parseFredObservations(JSON.parse(text));
}

// ── Census BPS ────────────────────────────────────────────────────────────

/**
 * Parse one Census BPS monthly state file ("stYYMMc.txt"): total units
 * authorised (1 + 2 + 3–4 + 5+ unit structures, the estimate columns) per
 * state FIPS. Header lines and malformed rows are skipped.
 */
export function parseBpsStateFile(text: string): { month: string; byFips: Map<string, number> } | null {
  const byFips = new Map<string, number>();
  let month: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const c = line.split(",");
    if (!/^\d{6}$/.test((c[0] ?? "").trim())) continue;
    const units = [6, 9, 12, 15].map((i) => Number(c[i]));
    if (units.some((u) => !Number.isFinite(u))) continue;
    const ym = c[0].trim();
    month = `${ym.slice(0, 4)}-${ym.slice(4, 6)}-01`;
    byFips.set(c[1].trim().padStart(2, "0"), units.reduce((a, b) => a + b, 0));
  }
  return month ? { month, byFips } : null;
}

const bpsFiles = new Map<string, Promise<{ month: string; byFips: Map<string, number> } | null>>();

function bpsFile(month: string): Promise<{ month: string; byFips: Map<string, number> } | null> {
  let p = bpsFiles.get(month);
  if (!p) {
    const yymm = month.slice(2, 4) + month.slice(5, 7);
    p = (async () => {
      const res = await fetchGeo(`https://www2.census.gov/econ/bps/State/st${yymm}c.txt`, { timeoutMs: 30_000, ratePerSec: 1 });
      if (res.status === 404) return null; // not released yet
      if (!res.ok) throw new Error(`Census BPS st${yymm}c.txt HTTP ${res.status}`);
      return parseBpsStateFile(await res.text());
    })();
    bpsFiles.set(month, p);
    p.catch(() => bpsFiles.delete(month));
    if (bpsFiles.size > 12) bpsFiles.delete(bpsFiles.keys().next().value as string);
  }
  return p;
}

/** The latest three released months for one state. */
async function bpsSeries(state: string, today: string): Promise<SeriesObservation[]> {
  const fips = STATES.find((s) => s.code === state)?.fips;
  if (!fips) throw new Error(`unknown state ${state}`);
  const thisMonth = `${today.slice(0, 7)}-01`;
  const out: SeriesObservation[] = [];
  for (let back = 1; back <= 6 && out.length < 3; back++) {
    const f = await bpsFile(addMonths(thisMonth, -back));
    const v = f?.byFips.get(fips);
    if (f && v != null) out.push({ observationDate: f.month, value: v });
  }
  if (out.length === 0) throw new Error("Census BPS: no released monthly state file in the last six months");
  return out.reverse();
}

// ── NASS Quick Stats ──────────────────────────────────────────────────────

function parseNassLandValues(body: unknown): SeriesObservation[] {
  const data = (body as { data?: Array<{ year?: number | string; Value?: string; reference_period_desc?: string }> } | null)?.data;
  if (!Array.isArray(data)) throw new Error(`NASS Quick Stats: ${(body as { error?: string[] } | null)?.error?.join("; ") ?? "no data in reply"}`);
  const out: SeriesObservation[] = [];
  for (const d of data) {
    if (d.reference_period_desc && d.reference_period_desc !== "YEAR") continue;
    const v = Number(String(d.Value ?? "").replace(/,/g, "").trim());
    const y = Number(d.year);
    if (!Number.isFinite(v) || !Number.isInteger(y)) continue; // "(D)" suppressed values are skipped
    out.push({ observationDate: `${y}-01-01`, value: v });
  }
  return out.sort((a, b) => a.observationDate.localeCompare(b.observationDate));
}

async function nassSeries(state: string): Promise<SeriesObservation[]> {
  const q = new URLSearchParams({
    key: String(process.env.NASS_API_KEY),
    source_desc: "SURVEY",
    short_desc: "AG LAND, INCL BUILDINGS - ASSET VALUE, MEASURED IN $ / ACRE",
    agg_level_desc: "STATE",
    state_alpha: state,
    format: "JSON",
  });
  const text = await getText(`https://quickstats.nass.usda.gov/api/api_GET/?${q}`);
  return parseNassLandValues(JSON.parse(text));
}

// ── The provider ──────────────────────────────────────────────────────────

export const publicSeriesProvider: DataProvider = {
  name: "public-series",
  displayName: "Public economic series (BLS via FRED, Census BPS, USDA NASS)",
  categories: ["macro_series"],
  supportedInputTypes: ["series"],
  tierRequired: "free",
  license: "public-domain-usgov",
  redistributable: "attribution",
  costPerLookupCents: () => 0,
  async isConfigured() {
    return true;
  },

  async lookup(category: DataCategory, input: LookupInput): Promise<LookupResult> {
    const start = clock.nowMs();
    if (category !== "macro_series" || input.type !== "series") throw new Error("public-series answers macro_series lookups by series only");
    const family = input.family as SeriesFamilyId;
    const spec = seriesFamily(family);
    if (spec.seriesIdFor(input.state) !== input.seriesId) throw new Error(`series ${input.seriesId} is not ${family} for ${input.state}`);
    const refusal = publicSeriesReadiness(family);
    if (refusal) throw new Error(refusal);
    const today = isoDay(clock.now());
    let observations: SeriesObservation[];
    switch (family) {
      case "state_payrolls":
      case "state_unemployment":
        observations = await fredSeries(input.seriesId, today);
        break;
      case "state_permits_nsa":
        observations = await bpsSeries(input.state, today);
        break;
      case "state_ag_land_value":
        observations = await nassSeries(input.state);
        break;
    }
    if (observations.length === 0) throw new Error(`${spec.publisher}: no observations for ${input.seriesId}`);
    const data: SeriesLookupData = { seriesId: input.seriesId, family, knownOn: today, observations };
    return {
      provider: "public-series",
      category,
      confidence: 95,
      costCents: 0,
      fetchedAt: clock.now(),
      cached: false,
      latencyMs: clock.nowMs() - start,
      data,
      source: spec.licenseSource,
      sourceAsOf: new Date(`${observations[observations.length - 1].observationDate}T00:00:00Z`),
      classification: "authoritative",
    };
  },

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { healthy: true, latencyMs: 0, checkedAt: clock.now(), message: "checked per family by publicSeriesReadiness" };
  },
};
