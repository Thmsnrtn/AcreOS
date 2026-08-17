#!/usr/bin/env node
// ============================================================================
// scripts/check-residential-comps-hold.mjs
// ----------------------------------------------------------------------------
// "No residential-comps data plane before its revenue trigger", made checkable.
//
// WHY
// ───
// CLAUDE.md's DO-NOT-DO list carries the hard stop, and
// shared/governance/constitution.ts labels `data.no-residential-comps-pre-trigger`
// as enforcement kind "code-invariant" — pointing at shared/business-types.ts and
// verticalPackPurchasable.test.ts. Those two govern whether a residential VERTICAL
// PACK is purchasable. Neither of them can see a residential comps DATA PLANE
// being built. The label said code-invariant; the code enforced a different
// (adjacent) thing. That is the precise failure mode this repo already paid for
// once with the ">$500 founder-only" stop, which sat as prose in CLAUDE.md while
// SPENDING_TIERS quietly auto-executed $500–$50K.
//
// This is the missing backstop. It is a PREVENTATIVE gate, not a remediation
// one: the repo is CLEAN today (server/services/residentialComps.ts routes
// residential comps/valuation through the EXISTING provider registry, restricted
// to ATTOM, with honest unkeyed degradation), so this must pass at zero and its
// job is to make the first line of a residential-plane conversation a failing
// build. Same shape and same exception mechanism as
// scripts/check-infrastructure-restraint.mjs, which is this repo's pattern for
// exactly this situation.
//
// WHAT "A PLANE" MEANS HERE
// ─────────────────────────
// The constitution note already draws the line, and this gate implements THAT
// line rather than inventing a stricter one:
//
//   "The hard-stop bars building a dedicated residential-comps data PLANE (bulk
//    ingest, dedicated vendors, new tables) — it does not bar routing residential
//    lookups through the EXISTING provider registry."
//
// So the three plane signatures are the three primary rules: dedicated VENDORS,
// new TABLES, BULK INGEST. A fourth rule pins the sanctioned seam itself, because
// the cheapest way to grow a plane is to hollow out the seam that replaced it.
//
// WHAT IT CHECKS
// ──────────────
//   R1 residential-vendor-request  — a residential property-class selector
//      (SFR/CONDO/MULTI-FAMILY/…) handed to a property-vendor request, in a file
//      that makes its own outbound HTTP call, OUTSIDE the metered registry lane.
//   R2 residential-comps-table     — a table that IS a residential comps corpus,
//      caught two ways: by NAME (mls_/rets_/sfr_/residential_*_comps…) across
//      pgTable definitions AND raw CREATE TABLE in scripts/migrate.mjs, and by
//      SHAPE (>= 2 residential structure columns + a sale/valuation record),
//      which is name-independent on purpose — see "WHY SHAPE" below.
//   R3 residential-data-vendor     — a dedicated residential vendor arriving as
//      an npm dependency, an API host, or an API-key env var.
//   R4 seam-integrity              — server/services/residentialComps.ts must
//      still route through providerRegistry.lookup with an allowProviders
//      restriction, must not read a vendor key off process.env, must not fetch a
//      vendor directly, and RESIDENTIAL_CAPABLE_PROVIDERS must not grow past its
//      registered membership.
//   R5 bulk-ingest-residential-filter — a file that both calls a property vendor
//      and persists rows must not filter on residential structure attributes.
//
// WHY SHAPE, NOT JUST NAME
// ────────────────────────
// A name-only rule keys on what an author CHOSE to call the thing, so the same
// violation renamed walks straight past. The audit that produced this gate found
// that failure mode repeatedly in this repo's governance checks. R2's shape net
// is the answer: a table carrying bedrooms + bathrooms + living sqft alongside a
// sale price IS a residential comps corpus whatever it is named.
//
// WHAT IT DELIBERATELY DOES NOT DO — measured, not guessed
// ────────────────────────────────────────────────────────
// Every narrowing below was measured against the repo first. Run with --measure
// to re-derive all of these numbers; the rejected-predicate counts are printed
// there too, so the rejections stay falsifiable.
//
//   · It does NOT ban the token "comps". This is a LAND platform; land comps are
//     the product (server/services/comps.ts, countyAssessorIngest). The predicate
//     the audit proposed — pgTable name matching (^|_)(comps?|cma|mls|avm)(_|$) —
//     was re-measured here and is NOT zero: it hits `cma_reports` (1/771 tables),
//     a LAND comparative-market-analysis report keyed on subject_acres and land
//     comp property ids. Bare `cma` and bare `avm` are land-legitimate vocabulary
//     in this repo (see also server/services/avmFeedback.ts), so they were
//     dropped from the name net rather than exempted. `mls`/`rets`/`reso`/`sfr`
//     stay: those are residential-market feed acronyms and measure zero.
//   · It does NOT match vendor brand names as bare substrings. Word-anchored
//     brand tokens across the tracked tree measure 27 hits and essentially all of
//     them are noise: marketing prose ("real comparable sales, not Zillow
//     estimates"), the OUTBOUND listing-syndication channel list
//     (server/services/listingSyndication.ts — publishing a listing to a portal
//     is marketing, not an inbound data plane), a research deep-link, and eval
//     fixtures. R3 is therefore scoped to the three places a vendor actually
//     arrives — package.json, an API host, an API-key env var — where the count
//     is 0/0/0.
//   · It does NOT flag residential structure columns on their own. beds/baths/
//     sqft measure 51 hits in server+shared and the overwhelming majority are the
//     sanctioned rentals vertical (rental_units, rent-roll import) and rehab
//     categories. R2's shape net requires >= 2 structure columns AND a sale or
//     valuation record; R5 requires the vendor-call + row-persistence scope.
//   · It does NOT scan test files. Fixtures for this gate necessarily contain the
//     very strings it hunts. tests/unit/residentialCompsHold.test.ts drives the
//     REAL script against synthetic repos in a temp dir instead.
//
// STATED LIMITS — what this gate cannot see
// ─────────────────────────────────────────
// Honest coverage beats implied coverage, so:
//
//   1. THE INGEST-SWAP SHAPE IS COVERED, PARTLY. server/jobs/countyAssessorIngest.ts
//      already reads ATTOM_API_KEY straight off process.env and bulk-writes comps
//      for LAND. Swapping its acreage band for a beds/baths/sqft filter converts
//      it into a residential plane with NO new file. R1 catches that swap when it
//      goes through the vendor's own property-class parameter (proptype LAND →
//      SFR), and R5 catches it when the residential filter is applied in-process
//      after the fetch. What neither can see is (a) a purely NUMERIC reframing
//      that names nothing residential — e.g. narrowing the acreage band to < 0.25
//      and relying on ATTOM returning improved lots — or (b) the class literal
//      routed through a variable (`const t = "SFR"; params.set("proptype", t)`).
//      That residue is real and is not claimed as covered.
//   2. THE REGISTRY LANE IS TRUSTED FOR R1/R5. server/services/providers/** is the
//      metered, cached, credit-gated per-lookup lane the constitution note
//      explicitly permits, and attom-provider.ts genuinely issues
//      `propertytype=SFR` for the sanctioned seam. R1 and R5 exclude that lane, so
//      a plane built INSIDE a registry provider would be seen only by R2 (tables),
//      R3 (vendors) and R4 (the allowlist), not by R1/R5.
//   3. IT IS STATIC. A plane assembled at runtime from a database-driven config
//      (a provider fallbackOrder row, a feature flag) is not visible to a source
//      scan. R4's allowlist pin is the mitigation, not a cure.
//
// VACUITY GUARDS
// ──────────────
// A scan that stops seeing files must FAIL, never read as a clean bill of health
// — this repo has been bitten by exactly that, including a block-comment stripper
// that mispaired and blanked the lines a scan was counting. So:
//   · ANCHOR_FILES — all three anchors present means the real repo (floors and
//     canaries apply); none present means a synthetic fixture; SOME present is a
//     hard failure, because a scan that reaches part of the tree and not the rest
//     produces a zero that looks exactly like compliance. No env-var opt-out: an
//     opt-out flag is a bypass with a nicer name, and bypassable rules are the
//     entire reason this gate was written.
//   · floors on files scanned (>= 800) and tables parsed (>= 700);
//   · PREDICATE_SELFTEST — every regex is proved live against inline positive
//     samples and proved quiet against the exact noise strings measured above;
//   · IN-REPO CANARIES — real files that MUST keep matching (attom-provider.ts
//     still carries a residential property-class request; countyAssessorIngest.ts
//     is still selected by the R1/R5 scope), plus the registered exception, whose
//     stale check doubles as proof the R2 shape net still matches something real.
//
// Usage:
//   node scripts/check-residential-comps-hold.mjs            # gate (exit 1 on violation)
//   node scripts/check-residential-comps-hold.mjs --measure  # counts only, never fails
//
// Exit codes: 0 = clean; 1 = a plane signature, a stale exception, a dead
// predicate, or a vacuous scan.
// ============================================================================

import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MEASURE = process.argv.includes("--measure");

// ----------------------------------------------------------------------------
// Predicates. Each is measured; see the header for the count and the reason a
// looser form was rejected.
// ----------------------------------------------------------------------------

/** Residential property CLASSES as a data vendor names them. */
const RESIDENTIAL_CLASS =
  "SFR|SINGLE[ _-]?FAMILY|RESIDENTIAL|CONDO(?:MINIUM)?|TOWNHOUSE|DUPLEX|TRIPLEX|FOURPLEX|MULTI[ _-]?FAMILY|APARTMENT|MOBILE[ _-]?HOME";

/**
 * A residential class handed to a property-type REQUEST parameter, in the three
 * shapes a request actually takes:
 *   A  searchParams.set("proptype", "SFR")   — quoted key, comma, value
 *   B  { propertyType: "CONDOMINIUM" }       — params object literal
 *   C  ...&propertytype=SFR                  — URL query string, no whitespace
 *
 * A plain spaced assignment (`propType = 'Residential'`) is deliberately NOT a
 * match: measured, that form is how this repo classifies a ZONING string
 * (portfolioOptimizer.ts) and parses a founder's INTENT (founderIntentV14.ts),
 * neither of which is a vendor request. Those two exact lines are pinned in
 * PREDICATE_SELFTEST so a future widening that re-admits them fails loudly.
 * A bare `\bSFR\b` token was also measured and rejected: 13 hits, essentially
 * all the sanctioned rentals vertical (lease/unit prose, onboarding tags).
 *
 * Measured in request shape: 1 hit repo-wide — attom-provider.ts, the sanctioned
 * seam — and 0 outside the registry lane.
 */
const RESIDENTIAL_CLASS_IN_REQUEST = new RegExp(
  `(?:["'\`]?\\bprop(?:erty)?_?type\\b["'\`]?\\s*[,:]\\s*["'\`]?\\s*(?:${RESIDENTIAL_CLASS})\\b)` +
    `|(?:\\bprop(?:erty)?_?type=(?:${RESIDENTIAL_CLASS})\\b)`,
  "i",
);

/** The file talks to the outside world itself (as opposed to via the registry). */
const OUTBOUND_HTTP = /\b(?:fetch\s*\(|axios\s*[.(]|got\s*\(|https?\.request\s*\(|node-fetch)/;

/** The file persists rows. */
const PERSISTS_ROWS = /(?:\bdb\s*\.\s*insert\s*\(|INSERT\s+INTO\b)/i;

/** Property-data vendor endpoints already in the tree (the land lane). */
const PROPERTY_VENDOR_HOST = /(?:attomdata\.com|api\.regrid\.com|propertyapi|datatree)/i;

/**
 * Residential-comps table names. `comps`, `cma` and `avm` are deliberately NOT
 * here — measured land-legitimate; see header.
 */
const RESIDENTIAL_TABLE_NAME =
  /(?:(?:^|_)(?:mls|rets|reso|sfr)(?:_|$))|(?:(?:^|_)(?:residential|resi|house|home|single_family|condo|townhouse|duplex|multi_?family|dwelling)_[a-z0-9_]*(?:comps?|cma|avm|valuations?|sales)(?:_|$))/i;

/** Residential STRUCTURE columns — a house has these, a parcel does not. */
const STRUCTURE_COLUMNS = [
  ["beds", /\b(?:bedrooms?|beds|bed_count|num_?bedrooms)\b/i],
  ["baths", /\b(?:bathrooms?|baths|bath_count|baths_?full|baths_?total|num_?bathrooms)\b/i],
  ["living", /\b(?:living_?(?:area|size|sqft)|sq_?ft|square_?feet|square_?footage|gla|finished_?sqft)\b/i],
  ["yearBuilt", /\b(?:year_?built)\b/i],
  ["stories", /\b(?:stories|num_?stories)\b/i],
  ["garage", /\b(?:garage(?:_?spaces)?)\b/i],
];

/** A sale or valuation record — what turns structure data into a COMP. */
const SALE_OR_VALUATION =
  /\b(?:sale_?(?:price|amt|amount|date|rec_?date)|sold_?(?:price|date)|close_?price|last_?sale|avm_?(?:value|amount)|valuation_?(?:cents|value|low|mid|high))\b/i;

/** How many structure columns make a row a house record rather than a stray field. */
const STRUCTURE_COLUMN_THRESHOLD = 2;

/** Residential structure attributes used inside an ingest loop. */
const RESIDENTIAL_ATTRIBUTE =
  /\b(?:beds|bedrooms|baths|bathrooms|baths_?full|baths_?total|livingsize|living_?area|living_?sqft|storiescount|garagespaces|year_?built)\b/i;

/**
 * Dedicated residential-data vendors. Matched as npm package names, as API
 * HOSTS, and as API-key env vars — never as bare prose tokens (27 measured
 * false positives; see header).
 */
const VENDOR_DEP =
  /(?:zillow|redfin|corelogic|housecanary|rentcast|realtymole|mlsgrid|simplyrets|retsly|rets-client|estated|datafiniti|clearcapital|blackknight|bridgedataoutput|^reso-)/i;
const VENDOR_API_HOST =
  /(?:api\.zillow\.com|zillow\.com\/webservice|api\.bridgedataoutput\.com|api\.housecanary\.com|api\.rentcast\.io|api\.realtymole\.com|api\.simplyrets\.com|api(?:-prod)?\.corelogic\.com|api\.clearcapital\.com|api\.datafiniti\.co|apis?\.estated\.com|api\.mlsgrid\.com|api\.trestle\.corelogic\.com|retsly\.com|blackknightinc\.com)/i;
// The vendor token must be a WHOLE underscore-delimited segment of the env name.
// A bare-substring form matched RESOLVE_PARCEL_SHADOW_SAMPLE_RATE on "RESO".
const VENDOR_ENV_KEY =
  /process\.env\.(?:[A-Z0-9]+_)*(?:ZILLOW|REDFIN|CORELOGIC|HOUSECANARY|RENTCAST|REALTYMOLE|MLS|RETS|RESO|TRESTLE|SIMPLYRETS|ESTATED|DATAFINITI|CLEARCAPITAL|BLACKKNIGHT|BRIDGEDATA)(?:_[A-Z0-9]+)*\b/;

const RULES = {
  "residential-vendor-request":
    "Plane signature 1 of 3 (dedicated vendors / bulk ingest): a residential property-class selector handed to a property vendor outside the metered registry lane. Residential lookups route through providerRegistry (server/services/residentialComps.ts), which meters credits per lookup and degrades honestly without a key.",
  "residential-comps-table":
    "Plane signature 2 of 3 (new tables): a residential comparable-sales corpus persisted in this database. The sanctioned seam holds NO residential rows — the registry's provider_cache does, with a TTL.",
  "residential-data-vendor":
    "Plane signature 3 of 3 (dedicated vendors): a residential-data vendor as a dependency, API host, or API key. The hold permits exactly one residential-capable provider, already registered: ATTOM, pay-per-call/BYOK.",
  "bulk-ingest-residential-filter":
    "Plane signature 1+3 combined: a job that calls a property vendor AND persists rows must not select on residential structure attributes. countyAssessorIngest.ts is the LAND version of exactly this shape; a beds/baths/sqft filter is what converts it.",
  "seam-integrity":
    "The sanctioned seam must stay a seam: registry-routed, allowlist-restricted, no direct vendor key, no direct vendor fetch. Hollowing it out is how a plane grows without a new file.",
};

// ----------------------------------------------------------------------------
// REGISTERED EXCEPTIONS — a match that IS present and is NOT a plane.
//
// Adding an entry is a deliberate act: `reason` must say why the match is not a
// residential comps corpus, in terms of what the rows ARE. A stale entry (the
// match is gone) FAILS this gate, so the list cannot rot — and each live entry
// doubles as a canary proving its predicate still matches something real.
// ----------------------------------------------------------------------------
const REGISTERED_EXCEPTIONS = [
  {
    id: "residential-comps-table",
    where: "shared/schema.ts:properties",
    reason:
      "Not a comps corpus — the org's OWN inventory. `properties` is the table an org's acquired/listed parcels and houses live in, and the fix-and-flip vertical legitimately records bedrooms/bathrooms/squareFeet/yearBuilt/stories/garageSpaces on a house it owns. Its sale columns are soldPrice/soldDate — that property's own disposition, one row per owned asset, not third-party comparable sales. Verified by hand 2026-08-16: the table carries no subject/distance/comp-id/source columns, i.e. nothing that references a subject property, which is what a comparables corpus is for.",
    decidedBy:
      "CLAUDE.md DO-NOT-DO + constitution data.no-residential-comps-pre-trigger (the hard stop bars a comps PLANE, not owning houses); founder ruling #11 wave V3, 2026-07-29",
  },
];

// ----------------------------------------------------------------------------
// PREDICATE SELF-TEST — every regex proved live against a positive sample and
// proved quiet against the EXACT noise strings measured in this repo. A widening
// that reintroduces measured noise fails here, immediately, with the reason.
// ----------------------------------------------------------------------------
const PREDICATE_SELFTEST = [
  {
    name: "RESIDENTIAL_CLASS_IN_REQUEST",
    re: RESIDENTIAL_CLASS_IN_REQUEST,
    must: [
      'url.searchParams.set("proptype", "SFR");',
      "`/propertyapi/v1.0.0/sale/comparables?${loc}&radius=5&propertytype=SFR`",
      'const params = { propertyType: "CONDOMINIUM", radius: 2 };',
    ],
    mustNot: [
      // the LAND request this repo actually makes today
      'url.searchParams.set("proptype", "LAND");',
      // measured false positives of the looser form
      "if (z.includes('res') || z.includes('residential')) propType = 'Residential';",
      'if (/\\b(residential)\\b/i.test(lower)) goal.filters!.propertyType = "residential";',
    ],
  },
  {
    name: "RESIDENTIAL_TABLE_NAME",
    re: RESIDENTIAL_TABLE_NAME,
    must: ["mls_listings", "residential_comps", "sfr_sales", "house_comp_cache", "rets_feed_rows"],
    mustNot: [
      // measured: the land CMA report table, and the substring noise a loose
      // /comp/ predicate produced (company_*, compliance_*, compass_*)
      "cma_reports",
      "company_agents",
      "compliance_alerts",
      "compass_recommendations",
      "properties",
      "rental_units",
    ],
  },
  {
    name: "VENDOR_API_HOST",
    re: VENDOR_API_HOST,
    must: ["https://api.housecanary.com/v2/property/value", "https://api.mlsgrid.com/v2/Property"],
    mustNot: [
      // a bare `rets.` alternative matched all of these; 23 measured hits
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in Fly secrets.",
      "meanRegret: regrets.length ? total / regrets.length : 0,",
      "https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/detail",
    ],
  },
  {
    name: "VENDOR_ENV_KEY",
    re: VENDOR_ENV_KEY,
    must: ["const k = process.env.MLS_GRID_API_KEY;", "process.env.HOUSECANARY_API_KEY"],
    mustNot: [
      // measured false positive of the bare-substring form ("RESO" in RESOLVE_)
      "const raw = process.env.RESOLVE_PARCEL_SHADOW_SAMPLE_RATE;",
      "const apiKey = process.env.ATTOM_API_KEY;",
    ],
  },
  {
    name: "RESIDENTIAL_ATTRIBUTE",
    re: RESIDENTIAL_ATTRIBUTE,
    must: ["const ok = p?.building?.rooms?.beds >= 2;", "filter((p) => p.livingSize > 900)"],
    mustNot: ["const acres = parseFloat(p?.lot?.lotsize2 || \"0\") / 43560;", "pricePerAcre: acres > 0 ? price / acres : 0,"],
  },
  {
    name: "SALE_OR_VALUATION",
    re: SALE_OR_VALUATION,
    must: ["salePrice: integer(\"sale_price\")", "soldDate: timestamp(\"sold_date\")"],
    mustNot: ["organizationId: integer(\"organization_id\").notNull(),"],
  },
];

// ----------------------------------------------------------------------------
// ANCHOR FILES — the three files this hold is actually about. Their presence is
// how the gate knows whether it is scanning the real repo or a synthetic fixture,
// and the rule is deliberately all-or-nothing:
//
//   all three present → REAL repo   → floors, canaries and the seam rule apply
//   none present      → fixture     → floors/canaries/seam skipped (nothing to check)
//   some present      → FAIL        → the scan sees part of the real tree and not
//                                     the rest, which is either a deletion nobody
//                                     recorded or a broken walker. Both must be
//                                     loud. There is no env-var escape hatch: an
//                                     opt-out flag is just a bypass with a nicer
//                                     name, and this whole gate exists because a
//                                     rule with a bypass is not a rule.
// ----------------------------------------------------------------------------
const SEAM_FILE = join("server", "services", "residentialComps.ts");
const ANCHOR_FILES = [
  SEAM_FILE,
  join("server", "services", "providers", "attom-provider.ts"),
  join("server", "jobs", "countyAssessorIngest.ts"),
];

// ----------------------------------------------------------------------------
// IN-REPO CANARIES — real files that must keep MATCHING their predicate. These
// prove the scan is looking at the right things; without them "0 violations" is
// indistinguishable from "0 files read".
// ----------------------------------------------------------------------------
const CANARIES = [
  {
    file: "server/services/providers/attom-provider.ts",
    label: "the sanctioned registry seam still issues a residential property-class request",
    check: (src) => RESIDENTIAL_CLASS_IN_REQUEST.test(src),
    why: "R1's predicate is proved live against the one real residential vendor request in the tree. If this stops matching, R1 has rotted and its zero means nothing.",
  },
  {
    file: "server/jobs/countyAssessorIngest.ts",
    label: "the land bulk-ingest job is still selected by the R1/R5 scope",
    check: (src) => OUTBOUND_HTTP.test(src) && PERSISTS_ROWS.test(src) && PROPERTY_VENDOR_HOST.test(src),
    why: "This job is the exact file the ingest-swap rule exists for: it reads ATTOM_API_KEY off process.env and bulk-writes comps. If a refactor moves it out of scope, R5 silently stops watching the highest-risk file in the repo.",
  },
];

/** Floors. A scan that sees fewer than this has broken, not cleaned up. */
const MIN_SOURCE_FILES = 800; // measured 2026-08-16: 1,300+ under the scan roots
const MIN_TABLES = 700; // measured 2026-08-16: 771 pgTable definitions

// ----------------------------------------------------------------------------
// File walking
// ----------------------------------------------------------------------------
const SCAN_ROOTS = ["server", "shared", "client/src"];

function isTestPath(rel) {
  return (
    /\.(?:test|spec)\.[tj]sx?$/.test(rel) ||
    rel.split(sep).includes("tests") ||
    rel.split(sep).includes("__tests__")
  );
}

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!/\.(?:ts|tsx|mjs)$/.test(entry)) continue;
    if (entry.endsWith(".d.ts") || entry.endsWith(".bak")) continue;
    const rel = relative(REPO_ROOT, full);
    if (isTestPath(rel)) continue;
    out.push(rel);
  }
  return out;
}

function loadSources() {
  const rels = [];
  for (const root of SCAN_ROOTS) walk(join(REPO_ROOT, root), rels);
  const map = new Map();
  for (const rel of rels) {
    try {
      map.set(rel, readFileSync(join(REPO_ROOT, rel), "utf8"));
    } catch {
      /* unreadable file: skipped, and the floor below notices if that is systemic */
    }
  }
  return map;
}

/**
 * Extract every pgTable("name", { ... }) block, brace-balanced.
 * Returns { name, file, body }.
 */
function extractTables(sources) {
  const tables = [];
  for (const [rel, src] of sources) {
    if (!src.includes("pgTable(")) continue;
    const re = /pgTable\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{/g;
    let m;
    while ((m = re.exec(src))) {
      let depth = 1;
      let i = re.lastIndex;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
      tables.push({ name: m[1], file: rel, body: src.slice(re.lastIndex, i) });
    }
  }
  return tables;
}

/** Raw DDL table names, so a table added only to the migrator is still seen. */
function migratorTableNames() {
  const p = join(REPO_ROOT, "scripts/migrate.mjs");
  if (!existsSync(p)) return [];
  const src = readFileSync(p, "utf8");
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi;
  const names = [];
  let m;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

function structureColumnsIn(body) {
  return STRUCTURE_COLUMNS.filter(([, re]) => re.test(body)).map(([k]) => k);
}

function linesMatching(src, re) {
  const out = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) out.push({ line: i + 1, text: lines[i].trim() });
  return out;
}

// ----------------------------------------------------------------------------
// The rules
// ----------------------------------------------------------------------------
function collectViolations(sources, tables) {
  const violations = [];
  const add = (id, where, detail) => violations.push({ id, where, detail, rule: RULES[id] });

  // ── R1 · residential property-class handed to a vendor, outside the registry
  for (const [rel, src] of sources) {
    if (rel.startsWith(join("server", "services", "providers") + sep)) continue; // metered lane; see STATED LIMITS 2
    if (!OUTBOUND_HTTP.test(src)) continue;
    for (const hit of linesMatching(src, RESIDENTIAL_CLASS_IN_REQUEST)) {
      add("residential-vendor-request", `${rel}:${hit.line}`, hit.text.slice(0, 140));
    }
  }

  // ── R2 · a residential comps corpus, by NAME and by SHAPE
  for (const t of tables) {
    if (RESIDENTIAL_TABLE_NAME.test(t.name)) {
      add("residential-comps-table", `${t.file}:${t.name}`, `table name matches the residential-comps naming net`);
      continue;
    }
    const cols = structureColumnsIn(t.body);
    if (cols.length >= STRUCTURE_COLUMN_THRESHOLD && SALE_OR_VALUATION.test(t.body)) {
      add(
        "residential-comps-table",
        `${t.file}:${t.name}`,
        `${cols.length} residential structure columns (${cols.join(", ")}) alongside a sale/valuation record`,
      );
    }
  }
  for (const name of migratorTableNames()) {
    if (RESIDENTIAL_TABLE_NAME.test(name)) {
      add("residential-comps-table", `scripts/migrate.mjs:${name}`, "CREATE TABLE matches the residential-comps naming net");
    }
  }

  // ── R3 · a dedicated residential-data vendor
  const pkgPath = join(REPO_ROOT, "package.json");
  let depCount = 0;
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    depCount = deps.length;
    for (const d of deps) {
      if (VENDOR_DEP.test(d)) add("residential-data-vendor", `package.json:${d}`, "dependency");
    }
  }
  for (const [rel, src] of sources) {
    for (const hit of linesMatching(src, VENDOR_API_HOST)) {
      add("residential-data-vendor", `${rel}:${hit.line}`, `API host — ${hit.text.slice(0, 120)}`);
    }
    for (const hit of linesMatching(src, VENDOR_ENV_KEY)) {
      add("residential-data-vendor", `${rel}:${hit.line}`, `API key env var — ${hit.text.slice(0, 120)}`);
    }
  }

  // ── R4 · seam integrity
  const SEAM = SEAM_FILE;
  const seam = sources.get(SEAM);
  if (seam !== undefined) {
    if (!/providerRegistry\s*\.\s*lookup\s*\(/.test(seam)) {
      add("seam-integrity", SEAM, "no providerRegistry.lookup call — the seam no longer routes through the registry");
    }
    if (!/allowProviders/.test(seam)) {
      add("seam-integrity", SEAM, "no allowProviders restriction — any registered provider could serve residential comps");
    }
    if (/process\.env\./.test(seam)) {
      add("seam-integrity", SEAM, "reads process.env directly — a vendor key in the seam is the first brick of a plane");
    }
    if (/\bfetch\s*\(/.test(seam)) {
      add("seam-integrity", SEAM, "calls fetch() directly — bypasses the registry's cache, circuit breaker and credit metering");
    }
    const allow = seam.match(/RESIDENTIAL_CAPABLE_PROVIDERS[^\n=]*=\s*\[([^\]]*)\]/);
    if (allow) {
      const listed = [...allow[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
      const REGISTERED = new Set(["attom"]);
      for (const p of listed) {
        if (!REGISTERED.has(p)) {
          add("seam-integrity", `${SEAM}:RESIDENTIAL_CAPABLE_PROVIDERS`, `unregistered residential-capable provider "${p}"`);
        }
      }
    }
  }

  // ── R5 · bulk ingest filtering on residential structure attributes
  for (const [rel, src] of sources) {
    if (rel.startsWith(join("server", "services", "providers") + sep)) continue; // metered lane; see STATED LIMITS 2
    if (!OUTBOUND_HTTP.test(src)) continue;
    if (!PERSISTS_ROWS.test(src)) continue;
    if (!PROPERTY_VENDOR_HOST.test(src) && !VENDOR_API_HOST.test(src)) continue;
    for (const hit of linesMatching(src, RESIDENTIAL_ATTRIBUTE)) {
      add("bulk-ingest-residential-filter", `${rel}:${hit.line}`, hit.text.slice(0, 140));
    }
  }

  return { violations, depCount };
}

// ----------------------------------------------------------------------------
function runSelfTest() {
  const failures = [];
  for (const t of PREDICATE_SELFTEST) {
    for (const s of t.must) {
      if (!t.re.test(s)) failures.push(`${t.name} no longer matches a known positive: ${JSON.stringify(s)}`);
    }
    for (const s of t.mustNot) {
      if (t.re.test(s)) failures.push(`${t.name} now matches measured NOISE: ${JSON.stringify(s)}`);
    }
  }
  return failures;
}

function runCanaries(sources) {
  const failures = [];
  for (const c of CANARIES) {
    const src = sources.get(c.file);
    if (src === undefined) {
      failures.push(`canary MISSING — ${c.file} was not read by the scan`);
      continue;
    }
    if (!c.check(src)) failures.push(`canary DEAD — ${c.file}: ${c.label}\n      ${c.why}`);
  }
  return failures;
}

/** REAL repo, synthetic fixture, or a broken scan. See ANCHOR_FILES. */
function scanMode(sources) {
  const present = ANCHOR_FILES.filter((f) => sources.has(f));
  if (present.length === ANCHOR_FILES.length) return { mode: "real", present };
  if (present.length === 0) return { mode: "fixture", present };
  return { mode: "partial", present };
}

function measure(sources, tables) {
  console.log(`[residential-comps-hold --measure] ${sources.size} source files, ${tables.length} tables\n`);

  const looseName = /(^|_)(comps?|cma|mls|avm)(_|$)/i;
  const looseSubstr = /comp/i;
  console.log("TABLE NAME NETS");
  console.log(`  adopted  RESIDENTIAL_TABLE_NAME            ${tables.filter((t) => RESIDENTIAL_TABLE_NAME.test(t.name)).length}`);
  console.log(
    `  rejected (^|_)(comps?|cma|mls|avm)(_|$)     ${tables.filter((t) => looseName.test(t.name)).length}  → ${tables
      .filter((t) => looseName.test(t.name))
      .map((t) => t.name)
      .join(", ") || "none"}  [land CMA; bare cma/avm are land vocabulary here]`,
  );
  console.log(
    `  rejected /comp/ substring                   ${tables.filter((t) => looseSubstr.test(t.name)).length}  [company_*, compliance_*, compass_*]`,
  );

  const shaped = tables
    .map((t) => ({ t, cols: structureColumnsIn(t.body), sale: SALE_OR_VALUATION.test(t.body) }))
    .filter((x) => x.cols.length >= STRUCTURE_COLUMN_THRESHOLD && x.sale);
  const anyStruct = tables.filter((t) => structureColumnsIn(t.body).length >= 1);
  console.log("\nTABLE SHAPE NET");
  console.log(`  rejected >=1 structure column               ${anyStruct.length}  → ${anyStruct.map((t) => t.name).join(", ")}`);
  console.log(
    `  adopted  >=${STRUCTURE_COLUMN_THRESHOLD} structure cols + sale/valuation  ${shaped.length}  → ${shaped.map((x) => `${x.t.name}(${x.cols.length})`).join(", ") || "none"}`,
  );

  const count = (re, filter = () => true) => {
    let n = 0;
    for (const [rel, src] of sources) if (filter(rel, src)) n += linesMatching(src, re).length;
    return n;
  };
  console.log("\nVENDOR NETS");
  console.log(
    `  rejected bare brand tokens (word-anchored)  ${count(/\b(?:zillow|redfin|corelogic|housecanary|rentcast|estated|mlsgrid|trestle|simplyrets|retsly|datafiniti|clearcapital)\b/i)}  [syndication channels, marketing prose, research links]`,
  );
  console.log(`  adopted  VENDOR_API_HOST                    ${count(VENDOR_API_HOST)}`);
  console.log(`  adopted  VENDOR_ENV_KEY                     ${count(VENDOR_ENV_KEY)}`);

  console.log("\nREQUEST / INGEST NETS");
  console.log(`  rejected RESIDENTIAL_CLASS anywhere         ${count(RESIDENTIAL_CLASS_IN_REQUEST)}  [incl. the sanctioned registry seam + intent/zoning parsers]`);
  console.log(
    `  adopted  ...outside providers/, HTTP files  ${count(RESIDENTIAL_CLASS_IN_REQUEST, (rel, src) => !rel.startsWith(join("server", "services", "providers") + sep) && OUTBOUND_HTTP.test(src))}`,
  );
  console.log(`  rejected RESIDENTIAL_ATTRIBUTE anywhere     ${count(RESIDENTIAL_ATTRIBUTE)}  [rentals vertical, rehab categories]`);
  console.log(
    `  adopted  ...in vendor-call + persisting files ${count(
      RESIDENTIAL_ATTRIBUTE,
      (rel, src) =>
        !rel.startsWith(join("server", "services", "providers") + sep) &&
        OUTBOUND_HTTP.test(src) &&
        PERSISTS_ROWS.test(src) &&
        (PROPERTY_VENDOR_HOST.test(src) || VENDOR_API_HOST.test(src)),
    )}`,
  );
}

// ----------------------------------------------------------------------------
function main() {
  const sources = loadSources();
  const tables = extractTables(sources);

  if (MEASURE) {
    measure(sources, tables);
    process.exit(0);
  }

  const hardFailures = [];

  // ── Vacuity guards, before anything is allowed to read as "clean" ───────
  hardFailures.push(...runSelfTest());

  const { mode, present } = scanMode(sources);
  if (mode === "partial") {
    hardFailures.push(
      `PARTIAL ANCHOR SET — the scan found ${present.length}/${ANCHOR_FILES.length} anchor files ` +
        `(${present.join(", ")}). Missing: ${ANCHOR_FILES.filter((f) => !present.includes(f)).join(", ")}. ` +
        `Either one of them was deleted/renamed without updating this gate, or the file walker is ` +
        `no longer reaching part of the tree. Both make every "0" below meaningless.`,
    );
  }
  const isRealRepo = mode === "real";
  if (isRealRepo) {
    hardFailures.push(...runCanaries(sources));
    if (sources.size < MIN_SOURCE_FILES) {
      hardFailures.push(
        `VACUOUS SCAN — only ${sources.size} source files under ${SCAN_ROOTS.join(", ")} (floor ${MIN_SOURCE_FILES}). ` +
          `An empty scan is not a clean bill of health.`,
      );
    }
    if (tables.length < MIN_TABLES) {
      hardFailures.push(
        `VACUOUS SCAN — only ${tables.length} pgTable definitions parsed (floor ${MIN_TABLES}). ` +
          `The table extractor has broken; every table rule below is meaningless.`,
      );
    }
  }

  const { violations, depCount } = collectViolations(sources, tables);

  // ── Reconcile against the registered exceptions ─────────────────────────
  const exceptionKeys = new Set(REGISTERED_EXCEPTIONS.map((e) => `${e.id}::${e.where}`));
  const unregistered = violations.filter((v) => !exceptionKeys.has(`${v.id}::${v.where}`));
  const seen = new Set(violations.map((v) => `${v.id}::${v.where}`));
  const stale = isRealRepo ? REGISTERED_EXCEPTIONS.filter((e) => !seen.has(`${e.id}::${e.where}`)) : [];

  console.log(
    `[residential-comps-hold] scanned ${sources.size} source files + ${tables.length} tables + ` +
      `${depCount} dependencies; plane signatures found: ${violations.length}; ` +
      `registered exceptions: ${REGISTERED_EXCEPTIONS.length}; ` +
      `unregistered: ${unregistered.length}; stale: ${stale.length}; scan mode: ${mode}`,
  );

  if (hardFailures.length > 0) {
    console.error("[residential-comps-hold] FAIL — the gate itself is not trustworthy right now:");
    for (const f of hardFailures) console.error(`  ✗ ${f}`);
    console.error(
      "\n  A predicate that matches nothing, or a scan that reads no files, produces a\n" +
        "  zero that looks exactly like compliance. Fix the gate before trusting it.",
    );
  }

  if (unregistered.length > 0) {
    console.error("[residential-comps-hold] FAIL — a residential-comps data plane signature appeared:");
    for (const v of unregistered) {
      console.error(`  ✗ ${v.where}  [${v.id}]`);
      console.error(`      ${v.detail}`);
      console.error(`      ${v.rule}`);
    }
    console.error(
      "\n  CLAUDE.md DO-NOT-DO: \"No residential-comps data plane before its revenue trigger.\"\n" +
        "  Recorded machine-readably as data.no-residential-comps-pre-trigger in\n" +
        "  shared/governance/constitution.ts. Only the founder may rescind it.\n" +
        "\n  Residential comps ARE allowed — through the existing seam. Route the lookup via\n" +
        "  server/services/residentialComps.ts (providerRegistry, restricted to ATTOM,\n" +
        "  pay-per-call/BYOK, honest 'unavailable' when unkeyed). What is barred is the\n" +
        "  PLANE: dedicated vendors, bulk ingest, a comps corpus of our own.\n" +
        "\n  If a match here is genuinely not a plane, add a REGISTERED_EXCEPTIONS entry in\n" +
        "  this file saying what the rows ARE. Do not widen the predicates to make it pass.",
    );
  }

  if (stale.length > 0) {
    console.error("[residential-comps-hold] FAIL — stale exception(s); the match is gone, so the entry must go too:");
    for (const e of stale) console.error(`  ✗ ${e.id} :: ${e.where}`);
    console.error(
      "\n  A live exception also serves as a canary for its predicate. A stale one means\n" +
        "  either the thing was removed (delete the entry) or the predicate stopped\n" +
        "  matching (fix the predicate) — and the second case is a silently dead rule.",
    );
  }

  if (hardFailures.length === 0 && unregistered.length === 0 && stale.length === 0) {
    console.log("[residential-comps-hold] PASS — no residential-comps data plane; the seam is intact.");
    process.exit(0);
  }
  process.exit(1);
}

main();
