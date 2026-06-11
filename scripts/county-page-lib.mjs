// ============================================================================
// scripts/county-page-lib.mjs
// ----------------------------------------------------------------------------
// Build-script helpers for the /learn/county SEO generator
// (scripts/generate-county-pages.mjs). Kept as a SIBLING MODULE (not app
// runtime) so the generator's pure, testable pieces — the broker-payload
// normalizer, the FIPS-centroid fallback, and the customer-market subset
// guard — can be unit-tested WITHOUT a live broker or DB.
//
// TRUTH-RATCHET: every figure this module produces must carry a real `value`,
// a named `source`, and a valid `asOf` (ISO YYYY-MM-DD). When a broker payload
// lacks a real value or a real source-freshness date, the normalizer returns
// `null` for that figure (skip), it NEVER invents one. The generator's
// quality bar then drops any county whose required figures are incomplete.
// Centroids are handled the same way: a county with no real centroid is
// SKIPPED, never given fabricated coordinates.
// ============================================================================

// ----------------------------------------------------------------------------
// Source registry — the same named, public-domain federal sources the seed
// table cites. Kept here so the normalizer can attach the correct provenance
// when it maps a live broker payload into the display-figure shape.
// ----------------------------------------------------------------------------
export const SRC = {
  usgsElevation: {
    name: "USGS 3DEP National Map",
    url: "https://apps.nationalmap.gov/epqs/",
  },
  nrcsSoils: {
    name: "USDA NRCS Soil Data Access (SSURGO)",
    url: "https://sdmdataaccess.nrcs.usda.gov/",
  },
  femaNfhl: {
    name: "FEMA National Flood Hazard Layer (NFHL)",
    url: "https://www.fema.gov/flood-maps",
  },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce an arbitrary date-ish value (ISO string, Date, NFHL effective date)
 * into a strict YYYY-MM-DD string, or null if it isn't a real, parseable date.
 * Returning null (never `today`) is the truth-ratchet guard: a figure with no
 * real upstream freshness date is treated as un-sourced and skipped.
 */
export function toIsoDate(input) {
  if (input == null) return null;
  if (typeof input === "string" && ISO_DATE.test(input.slice(0, 10))) {
    // Validate it's an actual calendar date, not just shape-matching.
    const d = new Date(input.slice(0, 10) + "T00:00:00Z");
    return Number.isNaN(d.getTime()) ? null : input.slice(0, 10);
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function nonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Build one display figure in the { value, note, source, asOf } shape the
 * county page consumes — but ONLY when `value` is a real non-empty string and
 * we have a real `asOf` date. Otherwise return null (skip), never fabricate.
 */
function buildFigure({ value, note, source, asOf }) {
  if (!nonEmptyString(value)) return null;
  const iso = toIsoDate(asOf);
  if (!iso) return null;
  if (!source || !nonEmptyString(source.name)) return null;
  return {
    value: value.trim(),
    note: nonEmptyString(note) ? note.trim() : "",
    source: { name: source.name, url: source.url },
    asOf: iso,
  };
}

// ----------------------------------------------------------------------------
// normalizeBrokerPayload — the load-bearing missing piece.
//
// The data-source broker's `lookup(category, opts)` returns a BrokerResult of
// shape { success, data, source, ... }. The RAW per-category `data` shapes
// (from server/services/data-source-broker.ts) are:
//
//   flood_zone  -> { zone: "Zone AE", riskLevel: "high", source: "FEMA NFHL",
//                    lastUpdated, details: { ...NFHL attrs } }
//   soil        -> { soilType, soilSymbol, suitability, drainage,
//                    capabilityClass, source: "USDA NRCS SDA", lastUpdated }
//   elevation   -> { elevationFeet, elevationMeters, datum,
//                    source: "USGS 3DEP National Map", queryDate, lastUpdated }
//
// We accept the broker envelope { flood, soil, elevation } where each entry is
// a BrokerResult (or null when that category failed). We pull `.data`, map the
// provider fields -> the figure's `value`, and use the broker LookupResult's
// `sourceAsOf` if present else the payload's `queryDate`/`lastUpdated` as the
// `asOf`. Any figure we can't ground in a real value + real date returns null.
//
// Returns: { elevation|null, soil|null, flood|null } in the figure shape. The
// generator's quality bar then decides emit-vs-skip — this function never
// emits a placeholder and never invents a number.
// ----------------------------------------------------------------------------
export function normalizeBrokerPayload(payload) {
  const out = { elevation: null, soil: null, flood: null };
  if (!payload || typeof payload !== "object") return out;

  // --- flood_zone ---
  const fr = unwrap(payload.flood);
  if (fr && nonEmptyString(fr.zone)) {
    out.flood = buildFigure({
      value: fr.riskLevel
        ? `${fr.zone} (${fr.riskLevel} risk)`
        : fr.zone,
      note: fr.riskLevel === "high"
        ? "Mapped Special Flood Hazard Area at the county centroid — pull the parcel's own NFHL zone before you buy."
        : "FEMA-mapped flood read at the county centroid; flood risk concentrates in mapped washes/floodplains. Always pull the parcel's own NFHL zone.",
      source: SRC.femaNfhl,
      asOf: pickAsOf(payload.flood, fr),
    });
  }

  // --- soil ---
  const sr = unwrap(payload.soil);
  if (sr && (nonEmptyString(sr.soilType) || nonEmptyString(sr.soilSymbol))) {
    const soilType = nonEmptyString(sr.soilType) && sr.soilType !== "Unknown"
      ? sr.soilType
      : null;
    // Require a real, named map unit — "Unknown"/"Unknown" is not a figure.
    if (soilType) {
      const drainage = nonEmptyString(sr.drainage) && sr.drainage !== "Unknown"
        ? `, ${sr.drainage.toLowerCase()} drainage`
        : "";
      out.soil = buildFigure({
        value: sr.soilSymbol && sr.soilSymbol !== "Unknown"
          ? `${soilType} (${sr.soilSymbol})`
          : soilType,
        note: `Dominant SSURGO map unit at the county centroid${drainage}. Septic feasibility and perc-test cost are the buyer's real diligence; pull the parcel's own SSURGO map unit.`,
        source: SRC.nrcsSoils,
        asOf: pickAsOf(payload.soil, sr),
      });
    }
  }

  // --- elevation ---
  const er = unwrap(payload.elevation);
  if (er && typeof er.elevationFeet === "number" && Number.isFinite(er.elevationFeet)) {
    const ft = Math.round(er.elevationFeet);
    out.elevation = buildFigure({
      value: `≈ ${ft.toLocaleString("en-US")} ft (${er.datum || "NAVD88"}) at centroid`,
      note: "USGS 3DEP elevation sampled at the county centroid; slope and access vary sharply across a county, so treat this as a reference band, not a parcel value.",
      source: SRC.usgsElevation,
      asOf: pickAsOf(payload.elevation, er),
    });
  }

  return out;
}

/**
 * Pull `.data` off a BrokerResult-shaped entry. Accepts either the full
 * BrokerResult { success, data } or a bare data object (so the function is
 * forgiving of both the broker envelope and a pre-unwrapped payload). Returns
 * null when the result is missing or explicitly unsuccessful.
 */
function unwrap(entry) {
  if (!entry || typeof entry !== "object") return null;
  if ("success" in entry) {
    if (!entry.success) return null;
    return entry.data && typeof entry.data === "object" ? entry.data : null;
  }
  if ("data" in entry && entry.data && typeof entry.data === "object") {
    return entry.data;
  }
  return entry; // already a bare data object
}

/**
 * Prefer the LookupResult-level `sourceAsOf` (the authoritative upstream
 * freshness date) when present; otherwise fall back to the payload's own
 * `queryDate`/`lastUpdated`. Returns whatever date-ish value is found (toIsoDate
 * validates it). Never defaults to "today" here — that decision is buildFigure's
 * job and it returns null on a missing/invalid date.
 */
function pickAsOf(entry, data) {
  if (entry && typeof entry === "object" && entry.sourceAsOf) return entry.sourceAsOf;
  if (data && typeof data === "object") {
    return data.queryDate ?? data.lastUpdated ?? null;
  }
  return null;
}

// ----------------------------------------------------------------------------
// FIPS-centroid fallback.
//
// The county_gis_endpoints registry table carries `state`, `county`,
// `fipsCode` but NO centroid columns. Registry-mode enumeration therefore needs
// a way to resolve a county centroid from its 5-digit FIPS code when the
// registry row has none.
//
// DECISION (truth-ratchet): we DO NOT hand-enter coordinates we cannot verify.
// This static asset is seeded ONLY with county centroids that are already
// hand-verified elsewhere in this repo — namely the exact { latitude, longitude }
// pairs the COUNTY_SEEDS table in generate-county-pages.mjs already ships for the
// current customer-market counties (Cochise/Navajo AZ, Brewster TX). Those three
// have a known provenance (the verified seed table), so re-keying them by FIPS
// here is a re-projection of existing verified data, not a new fabricated figure.
//
// For ANY registry county whose FIPS is NOT in this asset, the generator SKIPS
// the county and LOGS it — it NEVER fabricates coordinates. That is the correct
// failure mode: a missing centroid means "we can't responsibly publish this
// county yet", not "make one up".
//
// To EXTEND coverage to more customer-market counties, add rows sourced from the
// U.S. Census Bureau Gazetteer county file (the official internal point of each
// county), keyed by 5-digit GEOID/FIPS:
//   https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_counties_national.zip
//   (columns: USPS, GEOID=FIPS, NAME, INTPTLAT, INTPTLONG)
// Pull INTPTLAT/INTPTLONG verbatim from that file; do not estimate by hand. This
// is the broker-connected runbook's job, not this phase's.
// ----------------------------------------------------------------------------
export const FIPS_CENTROIDS = {
  // Re-keyed from the verified COUNTY_SEEDS centroids (provenance: seed table).
  "04003": { latitude: 31.8794, longitude: -109.7522, state: "AZ", county: "Cochise" },
  "04017": { latitude: 35.0743, longitude: -110.174, state: "AZ", county: "Navajo" },
  "48043": { latitude: 29.8119, longitude: -103.2517, state: "TX", county: "Brewster" },
};

/**
 * Resolve a centroid for a registry county. Order:
 *   1. the registry row's own centroid (if present + numeric),
 *   2. the FIPS-centroid static asset keyed by the row's 5-digit FIPS,
 *   3. null  -> caller MUST skip + log this county (no fabrication).
 */
export function resolveCentroid(row) {
  if (
    row?.centroid &&
    typeof row.centroid.latitude === "number" &&
    typeof row.centroid.longitude === "number" &&
    Number.isFinite(row.centroid.latitude) &&
    Number.isFinite(row.centroid.longitude)
  ) {
    return { latitude: row.centroid.latitude, longitude: row.centroid.longitude };
  }
  const fips = normalizeFips(row?.fipsCode);
  if (fips && FIPS_CENTROIDS[fips]) {
    const c = FIPS_CENTROIDS[fips];
    return { latitude: c.latitude, longitude: c.longitude };
  }
  return null;
}

/** Pad/normalize a FIPS code to the 5-digit string form used as the asset key. */
export function normalizeFips(fips) {
  if (fips == null) return null;
  const s = String(fips).trim();
  if (!/^\d{4,5}$/.test(s)) return null;
  return s.length === 4 ? `0${s}` : s;
}

// ----------------------------------------------------------------------------
// Option-A subset guard.
//
// client/src/pages/learn/county-registry.ts bundles EVERY emitted county JSON
// into the CLIENT bundle via import.meta.glob({ eager: true }). Committing the
// full ~3,100-county registry at once would blow the bundle. Option A = commit
// only a bounded customer-market subset.
//
// This guard enforces an explicit allowlist (by FIPS or state+county) AND a
// hard cap. A registry run filters its enumerated county list through
// applySubsetGuard, which returns { allowed, skipped } so the caller can emit
// the allowed set and LOG every skip (no silent truncation).
// ----------------------------------------------------------------------------

/**
 * Customer-market allowlist by FIPS. This is the INTENT gate (which markets we
 * publish), independent of the centroid asset (whether we can responsibly
 * geolocate the county). A county must clear BOTH: be on this allowlist AND
 * resolve a real centroid (resolveCentroid). It is seeded with the current
 * AZ/TX rural-cheap-land FIPS set; extend it as new markets onboard.
 */
export const SUBSET_ALLOWLIST_FIPS = new Set([
  // Arizona rural-cheap-land counties
  "04001", // Apache
  "04003", // Cochise
  "04005", // Coconino
  "04015", // Mohave
  "04017", // Navajo
  "04025", // Yavapai
  // West Texas / Trans-Pecos cheap-land counties
  "48043", // Brewster
  "48109", // Culberson
  "48243", // Jeff Davis
  "48377", // Presidio
  "48389", // Reeves
]);

/**
 * Hard cap — a registry run never commits more than this many counties, even if
 * the allowlist grows. The backstop against an accidental full-3,100 fan-out
 * that would blow the eager-glob client bundle (Option A).
 */
export const SUBSET_HARD_CAP = 50;

/**
 * Filter an enumerated registry county list down to the bounded customer-market
 * subset. A county is allowed only if its FIPS is on the allowlist AND the run
 * is still under the hard cap. Everything else is returned in `skipped` with a
 * reason — the caller logs all of them (no silent truncation). Centroid
 * resolution is a SEPARATE gate the caller applies after this (resolveCentroid),
 * so a county can be allowed here yet still skipped for a missing centroid.
 */
export function applySubsetGuard(counties, opts = {}) {
  const cap = typeof opts.cap === "number" ? opts.cap : SUBSET_HARD_CAP;
  const allowFips = opts.allowlist instanceof Set ? opts.allowlist : SUBSET_ALLOWLIST_FIPS;
  const allowed = [];
  const skipped = [];

  for (const c of counties) {
    const fips = normalizeFips(c?.fipsCode);
    if (!fips || !allowFips.has(fips)) {
      skipped.push({ county: c, reason: "not in customer-market allowlist" });
      continue;
    }
    if (allowed.length >= cap) {
      skipped.push({ county: c, reason: `subset hard cap (${cap}) reached` });
      continue;
    }
    allowed.push(c);
  }

  return { allowed, skipped };
}
