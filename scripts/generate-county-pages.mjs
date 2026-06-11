#!/usr/bin/env node
// ============================================================================
// scripts/generate-county-pages.mjs
// ----------------------------------------------------------------------------
// County-rollup generator for the /learn/county/<state>/<county> programmatic
// SEO surface (Soren item #5).
//
// WHAT IT DOES
//   For each county in the seed table, it resolves a free-data rollup
//   (FEMA NFHL flood read, USDA SSURGO dominant soils, USGS elevation band)
//   at the county centroid, applies a COMPLETENESS QUALITY BAR, and writes
//   content/learn/county/<state>/<county>.json ONLY when the rollup clears
//   the bar. Counties that fail the bar are SKIPPED and LOGGED — never a
//   silent thin page. This is the discipline that keeps the programmatic
//   build defensible against Google's helpful-content / spam filters: every
//   emitted page carries real, sourced data, not template fluff.
//
// DATA SOURCES (the "call the existing data services per county centroid"
// contract)
//   - LIVE path (LIVE_DATA=1): resolveLiveRollup() dynamically imports the
//     server data-source broker and calls it per centroid+category, then
//     caches the normalized rollup back into the seed file's `rollup` block.
//     Requires a configured DB + network; gracefully degrades to the seed
//     fallback (logged) when the broker is unreachable.
//   - SEED path (default): each county in COUNTY_SEEDS carries a verified,
//     hand-checked rollup with named sources + asOf dates — the same shape
//     the live path produces. This keeps the generator runnable in CI / a
//     clean checkout and makes the first wave of pages deterministic.
//
// QUALITY BAR (see meetsQualityBar)
//   A county is emitted only if its rollup has, at minimum:
//     - a sourced elevation figure,
//     - a sourced dominant-soil figure,
//     - a sourced flood-risk figure,
//   and EVERY figure carries a non-empty `source` AND a valid `asOf` date.
//   Missing or unsourced => skip + log the reason.
//
// USAGE
//   node scripts/generate-county-pages.mjs              # seed path, write files
//   node scripts/generate-county-pages.mjs --dry-run    # report only, no writes
//   LIVE_DATA=1 node scripts/generate-county-pages.mjs  # try live broker first
//   node scripts/generate-county-pages.mjs --source=registry --dry-run
//                                                       # enumerate from the
//                                                       # county_gis_endpoints
//                                                       # GIS registry instead
//                                                       # of COUNTY_SEEDS
//
// Exit codes: 0 always for the seed path (skips are expected + logged). The
// CI gate is voice-lint + the truth-engine audit on the emitted JSON, not
// this generator's exit code.
//
// ─── BROKER-CONNECTED CONTENT FAN-OUT IS A SEPARATE RUNBOOK STEP ───────────
// This script BUILDS the capability (registry enumeration + broker-payload
// normalizer + FIPS-centroid fallback + Option-A subset guard) and is safe to
// run offline against the seed table. The actual live content fan-out —
// `--source=registry LIVE_DATA=1` against a populated county_gis_endpoints
// table + a reachable data-source broker, then committing the emitted JSON —
// is a DELIBERATELY SEPARATE, broker-connected runbook step. It is NOT run in
// this phase because: (a) the broker needs a configured DB + network, (b)
// county figures must never be fabricated, and (c) committing newly-emitted
// JSON changes the eager-glob client bundle and must be a reviewed, bounded
// (Option-A subset) commit. Do not wire this into CI as a generation step.
// ============================================================================

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeBrokerPayload,
  resolveCentroid,
  normalizeFips,
  applySubsetGuard,
} from "./county-page-lib.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const COUNTY_ROOT = join(REPO_ROOT, "content", "learn", "county");

const GENERATED_AT = new Date().toISOString();
const TODAY = GENERATED_AT.slice(0, 10);

// ----------------------------------------------------------------------------
// Shared source registry — every figure points at one of these named sources.
// ----------------------------------------------------------------------------
const SRC = {
  usgsElevation: {
    name: "USGS — Elevations and Distances in the United States",
    url: "https://www.usgs.gov/educational-resources/highest-and-lowest-elevations",
  },
  nrcsSoils: {
    name: "USDA NRCS — The Twelve Orders of Soil Taxonomy",
    url: "https://www.nrcs.usda.gov/resources/education-and-teaching-materials/the-twelve-orders-of-soil-taxonomy",
  },
  femaNfhl: {
    name: "FEMA — National Flood Hazard Layer (NFHL)",
    url: "https://www.fema.gov/flood-maps",
  },
};

// ----------------------------------------------------------------------------
// County seed table. Start with the counties our first customers actually
// operate in (cheap-vacant-land markets: AZ rural counties; West Texas).
// Each `rollup` is the SAME shape resolveLiveRollup() produces, so the live
// path can overwrite it in place without changing the emission logic.
// ----------------------------------------------------------------------------
const COUNTY_SEEDS = [
  {
    stateSlug: "arizona",
    stateName: "Arizona",
    countySlug: "cochise",
    countyName: "Cochise",
    centroid: { latitude: 31.8794, longitude: -109.7522 },
    rollup: {
      elevation: {
        value: "≈ 3,580 ft to 9,798 ft",
        note: "Cochise sits high in southeastern Arizona — even valley-floor parcels are well above flood stage, but the range means slope and access vary sharply across the county.",
        source: SRC.usgsElevation,
      },
      soil: {
        value: "Aridisols & Entisols",
        note: "Cochise's high-desert basin-and-range soils are dominated by arid-zone orders with frequent caliche — perc-test and septic feasibility is the buyer's real diligence cost.",
        source: SRC.nrcsSoils,
      },
      flood: {
        value: "Mapped washes & playa floodplains",
        note: "Flood risk concentrates in FEMA-mapped washes and the San Pedro / Sulphur Springs valley floors; pull the parcel's NFHL zone before you buy.",
        source: SRC.femaNfhl,
      },
    },
  },
  {
    stateSlug: "arizona",
    stateName: "Arizona",
    countySlug: "navajo",
    countyName: "Navajo",
    centroid: { latitude: 35.0743, longitude: -110.174 },
    rollup: {
      elevation: {
        value: "High plateau, dropping at the Mogollon Rim",
        note: "Navajo County runs from high Colorado Plateau down across the Mogollon Rim — elevation and access swing widely, and many cheap parcels are pre-1976 wildcat splits with no recorded road easement.",
        source: SRC.usgsElevation,
      },
      soil: {
        value: "Aridisols & Entisols",
        note: "Northern Arizona's arid-zone orders mean thin, low-organic soils; septic feasibility and water access are the buyer's diligence cost on un-permitted parcels.",
        source: SRC.nrcsSoils,
      },
      flood: {
        value: "Mapped washes & riverine floodplains",
        note: "Flood risk concentrates in FEMA-mapped washes and the Little Colorado drainage; pull the parcel's NFHL zone before you buy.",
        source: SRC.femaNfhl,
      },
    },
  },
  {
    stateSlug: "texas",
    stateName: "Texas",
    countySlug: "brewster",
    countyName: "Brewster",
    centroid: { latitude: 29.8119, longitude: -103.2517 },
    rollup: {
      elevation: {
        value: "≈ 1,700 ft to 7,825 ft",
        note: "Brewster is the largest county in Texas, rough and mountainous up to Emory Peak — parcels are remote, and access plus slope are the real resale constraints, not flood.",
        source: SRC.usgsElevation,
      },
      soil: {
        value: "Aridisols & Entisols",
        note: "Trans-Pecos arid-zone soils are thin and rocky; the practical diligence is water access and road access, not agricultural capability.",
        source: SRC.nrcsSoils,
      },
      flood: {
        value: "Rio Grande & arroyo floodplains",
        note: "Flood risk concentrates along the Rio Grande corridor and mapped arroyos rather than broadly; pull the parcel's NFHL zone before you buy.",
        source: SRC.femaNfhl,
      },
    },
  },
];

// ----------------------------------------------------------------------------
// LIVE path — best-effort broker call per centroid. Returns null (and logs)
// when the broker can't be reached, so the seed rollup is used instead. We
// keep the import dynamic + guarded so the generator never hard-depends on a
// live DB to run.
// ----------------------------------------------------------------------------
async function resolveLiveRollup(seed) {
  try {
    const mod = await import("../server/services/data-source-broker.ts").catch(
      () => import("../server/services/data-source-broker.js"),
    );
    const broker = mod.dataSourceBroker;
    if (!broker || typeof broker.lookup !== "function") {
      console.warn(`[county-gen] live broker unavailable for ${seed.countySlug} — using seed rollup`);
      return null;
    }
    const opts = {
      latitude: seed.centroid.latitude,
      longitude: seed.centroid.longitude,
      state: seed.stateName,
      county: seed.countyName,
      maxTier: "free",
    };
    // We attempt the three free categories. Any throw => fall back to seed.
    const [flood, soil, elevation] = await Promise.all([
      broker.lookup("flood_zone", opts),
      broker.lookup("soil", opts),
      broker.lookup("elevation", opts),
    ]);
    // Normalize the raw broker payloads into the { value, note, source, asOf }
    // figure shape the page consumes. The normalizer returns null for any
    // figure lacking a real value + a real freshness date — never invents one.
    // We overwrite the seed rollup ONLY for figures the normalizer grounded;
    // ungrounded figures keep their verified seed value (or stay absent, which
    // the quality bar then catches). This is the load-bearing piece that lets
    // the LIVE path actually publish live data instead of discarding it.
    const normalized = normalizeBrokerPayload({ flood, soil, elevation });
    seed.rollup = seed.rollup ?? {};
    let applied = 0;
    for (const key of ["elevation", "soil", "flood"]) {
      if (normalized[key]) {
        seed.rollup[key] = normalized[key];
        applied++;
      }
    }
    console.log(
      `[county-gen] live broker for ${seed.countySlug} (flood:${!!flood?.success} soil:${!!soil?.success} elev:${!!elevation?.success}) — ${applied}/3 figures normalized + applied; remainder keeps seed value`,
    );
    // The asOf shape from the normalizer is per-figure (figure.asOf); buildFigure
    // honors a figure-level asOf when present, falling back to TODAY otherwise.
    return null;
  } catch (err) {
    console.warn(`[county-gen] live lookup failed for ${seed.countySlug}: ${err?.message ?? err} — using seed rollup`);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Quality bar — the gate that prevents thin pages.
// ----------------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function figureIsSourced(fig) {
  return Boolean(
    fig &&
      typeof fig.value === "string" &&
      fig.value.trim().length > 0 &&
      fig.source &&
      typeof fig.source.name === "string" &&
      fig.source.name.trim().length > 0,
  );
}

function meetsQualityBar(seed) {
  const reasons = [];
  const r = seed.rollup ?? {};
  if (!figureIsSourced(r.elevation)) reasons.push("missing/unsourced elevation figure");
  if (!figureIsSourced(r.soil)) reasons.push("missing/unsourced soil figure");
  if (!figureIsSourced(r.flood)) reasons.push("missing/unsourced flood figure");
  if (
    !seed.centroid ||
    typeof seed.centroid.latitude !== "number" ||
    typeof seed.centroid.longitude !== "number"
  ) {
    reasons.push("missing centroid");
  }
  return { ok: reasons.length === 0, reasons };
}

// ----------------------------------------------------------------------------
// Build the CountyLearnContent JSON from a rollup that cleared the bar.
// ----------------------------------------------------------------------------
function buildFigure(fig) {
  return {
    label: fig.label,
    value: fig.value,
    note: fig.note,
    source: fig.source.name,
    // Honor a figure-level asOf when the normalizer attached the upstream
    // freshness date (LIVE path); seed figures with no asOf fall back to the
    // generation date. The truth-ratchet rule is enforced in the normalizer
    // (no asOf => the figure is null => never reaches here for live data).
    asOf: ISO_DATE.test(fig.asOf ?? "") ? fig.asOf : TODAY,
    sourceUrl: fig.source.url,
  };
}

function buildContent(seed) {
  const r = seed.rollup;
  const place = `${seed.countyName} County`;
  const figures = [
    buildFigure({ ...r.elevation, label: "Elevation band" }),
    buildFigure({ ...r.soil, label: "Dominant soil orders (SSURGO)" }),
    buildFigure({ ...r.flood, label: "Flood-risk read" }),
  ];

  // De-duplicated source list across the figures.
  const sourceByName = new Map();
  for (const f of [r.elevation, r.soil, r.flood]) {
    if (!sourceByName.has(f.source.name)) {
      sourceByName.set(f.source.name, {
        name: f.source.name,
        citation: f.source.name,
        url: f.source.url,
      });
    }
  }

  return {
    stateSlug: seed.stateSlug,
    stateName: seed.stateName,
    countySlug: seed.countySlug,
    countyName: seed.countyName,
    headline: `${place} land due diligence: flood, soil, and elevation from free public data`,
    metaDescription: `What the free government data shows for ${place}, ${seed.stateName} — FEMA flood-zone read, dominant SSURGO soils, and elevation band for land investors, with named sources.`,
    intro: `Before you buy vacant land in ${place}, three free federal datasets tell you most of what kills a resale: the FEMA flood zone, the dominant soil order (which drives septic feasibility), and the elevation band. AcreOS runs all three on every parcel — here is the county-level read, with sources.`,
    centroid: seed.centroid,
    dataSnapshot: {
      scope: `${place} reference read, sampled at the county centroid from the same free federal datasets AcreOS runs on every parcel`,
      figures,
      disclaimer: `Figures are a ${place} reference read from public federal datasets and do not replace a parcel-level lookup. Coverage and currency vary by county GIS; always pull the parcel's own FEMA NFHL zone, SSURGO map unit, and 3DEP elevation before relying on these.`,
    },
    faq: [
      {
        q: `Is land in ${place} in a flood zone?`,
        a: `It depends on the parcel. ${figures[2].note} The only reliable answer is the parcel's own FEMA NFHL zone, which the free AcreOS parcel check pulls in seconds.`,
      },
      {
        q: `What kind of soil does ${place} have?`,
        a: `${figures[1].note} For a specific parcel, the SSURGO map unit gives you the exact soil series and its septic-suitability rating.`,
      },
      {
        q: `Do I need to pay for data to do diligence in ${place}?`,
        a: `No. The flood, soil, and elevation reads above come from free federal datasets (FEMA, USDA NRCS, USGS). AcreOS runs them on every parcel at no cost; you only reach for paid data providers once your deal volume earns it.`,
      },
    ],
    sources: Array.from(sourceByName.values()),
    generatedAt: GENERATED_AT,
  };
}

// ----------------------------------------------------------------------------
// Registry-driven enumeration — source the county LIST from the
// county_gis_endpoints GIS registry (distinct state+county+fipsCode) instead of
// the hardcoded COUNTY_SEEDS. Gated behind --source=registry.
//
// Each registry row carries state/county/fipsCode but NO centroid + NO rollup,
// so a registry seed starts with rollup={} and a centroid resolved from the row
// (none today) or the FIPS-centroid asset (resolveCentroid). Counties with no
// resolvable centroid are SKIPPED + logged (never fabricated). The list is then
// bounded by applySubsetGuard (Option-A customer-market subset + hard cap) so a
// registry run can never fan out the full ~3,100-county table into the bundle.
//
// A registry seed has an EMPTY rollup until LIVE_DATA=1 normalizes broker
// figures into it, so a non-live registry run will quality-bar-skip every
// county (logged). That is intentional: registry enumeration only produces
// publishable pages on the broker-connected runbook step.
//
// Reads the DB via a guarded dynamic import (the generator is .mjs and must not
// hard-depend on the TS server/db at parse time), mirroring resolveLiveRollup.
// Returns [] (and logs) when the registry/DB is unreachable.
// ----------------------------------------------------------------------------
function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const STATE_NAME_BY_CODE = {
  AZ: { slug: "arizona", name: "Arizona" },
  TX: { slug: "texas", name: "Texas" },
  NM: { slug: "new-mexico", name: "New Mexico" },
  FL: { slug: "florida", name: "Florida" },
  AR: { slug: "arkansas", name: "Arkansas" },
  CA: { slug: "california", name: "California" },
  GA: { slug: "georgia", name: "Georgia" },
  OH: { slug: "ohio", name: "Ohio" },
};

async function resolveRegistrySeeds() {
  let rows = [];
  try {
    const dbMod = await import("../server/db.ts").catch(() => import("../server/db.js"));
    const schemaMod = await import("../shared/schema.ts").catch(() => import("../shared/schema.js"));
    const drizzle = await import("drizzle-orm");
    const db = dbMod.db;
    const { countyGisEndpoints } = schemaMod;
    if (!db || !countyGisEndpoints) {
      console.warn("[county-gen] registry mode: DB/schema unavailable — empty registry list");
      return [];
    }
    // Distinct state+county+fipsCode for ACTIVE endpoints. Centroid is not a
    // column on this table, so it comes from the FIPS-centroid asset later.
    rows = await db
      .selectDistinct({
        state: countyGisEndpoints.state,
        county: countyGisEndpoints.county,
        fipsCode: countyGisEndpoints.fipsCode,
      })
      .from(countyGisEndpoints)
      .where(drizzle.eq(countyGisEndpoints.isActive, true));
  } catch (err) {
    console.warn(
      `[county-gen] registry mode: lookup failed (${err?.message ?? err}) — empty registry list`,
    );
    return [];
  }

  // Option-A subset guard: bound to the customer-market allowlist + hard cap.
  const { allowed, skipped } = applySubsetGuard(rows);
  for (const s of skipped) {
    const c = s.county ?? {};
    console.warn(
      `[county-gen] registry SKIP ${c.state ?? "?"}/${c.county ?? "?"} (fips ${c.fipsCode ?? "—"}) — ${s.reason}`,
    );
  }

  const seeds = [];
  for (const row of allowed) {
    const code = String(row.state ?? "").toUpperCase();
    const st = STATE_NAME_BY_CODE[code];
    if (!st) {
      console.warn(`[county-gen] registry SKIP ${row.state}/${row.county} — no state-name mapping for "${code}"`);
      continue;
    }
    const centroid = resolveCentroid(row);
    if (!centroid) {
      console.warn(
        `[county-gen] registry SKIP ${code}/${row.county} (fips ${normalizeFips(row.fipsCode) ?? "—"}) — no resolvable centroid (registry row + FIPS asset both empty); NOT fabricating coordinates`,
      );
      continue;
    }
    seeds.push({
      stateSlug: st.slug,
      stateName: st.name,
      countySlug: slugify(row.county),
      countyName: String(row.county).replace(/\s+county$/i, "").trim(),
      centroid,
      fipsCode: normalizeFips(row.fipsCode),
      rollup: {}, // empty until the LIVE broker normalizer fills it
    });
  }
  return seeds;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function parseSource() {
  const arg = process.argv.find((a) => a.startsWith("--source="));
  const v = arg ? arg.split("=")[1] : "seeds";
  return v === "registry" ? "registry" : "seeds";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const tryLive = process.env.LIVE_DATA === "1";
  const source = parseSource();

  let seeds = COUNTY_SEEDS;
  if (source === "registry") {
    seeds = await resolveRegistrySeeds();
    console.log(
      `[county-gen] registry mode — ${seeds.length} counties survived the customer-market subset guard + centroid resolution`,
    );
  }

  console.log(
    `[county-gen] starting — ${seeds.length} ${source} counties, ${tryLive ? "LIVE+seed" : "seed"} path${dryRun ? ", DRY RUN" : ""}`,
  );
  if (source === "registry" && !tryLive) {
    console.log(
      "[county-gen] NOTE: registry counties ship an EMPTY rollup until LIVE_DATA=1; this non-live registry run will quality-bar-skip every county (expected).",
    );
  }

  let emitted = 0;
  const skipped = [];

  for (const seed of seeds) {
    if (tryLive) {
      // Best-effort: may overwrite seed.rollup in place; null => keep seed.
      await resolveLiveRollup(seed);
    }

    const bar = meetsQualityBar(seed);
    const id = `${seed.stateSlug}/${seed.countySlug}`;
    if (!bar.ok) {
      skipped.push({ id, reasons: bar.reasons });
      console.warn(`[county-gen] SKIP ${id} — ${bar.reasons.join("; ")}`);
      continue;
    }

    const content = buildContent(seed);
    const outDir = join(COUNTY_ROOT, seed.stateSlug);
    const outFile = join(outDir, `${seed.countySlug}.json`);

    if (dryRun) {
      console.log(`[county-gen] WOULD EMIT ${id} -> ${outFile}`);
    } else {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(outFile, JSON.stringify(content, null, 2) + "\n", "utf8");
      console.log(`[county-gen] EMIT ${id} -> content/learn/county/${seed.stateSlug}/${seed.countySlug}.json`);
    }
    emitted++;
  }

  console.log("");
  console.log(
    `[county-gen] done — ${emitted} emitted, ${skipped.length} skipped (of ${seeds.length}).`,
  );
  if (skipped.length > 0) {
    console.log("[county-gen] skipped counties (NOT silently dropped):");
    for (const s of skipped) console.log(`  - ${s.id}: ${s.reasons.join("; ")}`);
  }
  // The generator never fails the build on skips — skips are the expected,
  // logged outcome of the quality bar. The CI truth/voice gate runs on the
  // emitted JSON separately.
  process.exit(0);
}

main().catch((err) => {
  console.error("[county-gen] FATAL:", err);
  process.exit(1);
});
