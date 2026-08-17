#!/usr/bin/env node
/**
 * check-route-order — literal routes must not be swallowed by earlier
 * `:param` siblings.
 *
 * Express matches routes in registration order, so
 *   app.get("/api/leads/:id", …)        // registered first
 *   app.get("/api/leads/export", …)     // registered later — DEAD
 * sends "export" into the :id handler, which parses it as an id and 404s.
 *
 * The 2026-07-11 full-app sweep found 28 live instances of this
 * (leads/export, properties/export, deals/handoffs, tasks/dashboard-summary,
 * campaigns/analytics, the public e-sign consent POST, …). All were
 * reordered; this gate keeps the count at zero.
 *
 * Detection is per-file and same-method: a literal segment route whose
 * prefix matches an EARLIER `prefix/:param`-shaped route of the same HTTP
 * method. Cross-file ordering isn't modeled (registration order across
 * files isn't derivable statically) — same-file ordering covers every
 * instance found in practice.
 *
 * ----------------------------------------------------------------------------
 * VACUITY FLOORS — why this gate floors ROUTES and not just FILES
 * ----------------------------------------------------------------------------
 * This gate counts BAD THINGS FOUND, so a scan that stops seeing things finds
 * zero and prints PASS. It printed exactly one population — `scanned` FILES —
 * and floored nothing at all, which left the failure mode wide open in the one
 * place it actually lives:
 *
 *   THE FILE COUNT IS NOT THE SCAN POPULATION. The offender predicate consumes
 *   ROUTE REGISTRATIONS extracted by `pat`, not files. `pat` keys on three
 *   literal receiver names (`api`/`app`/`router`) and a STRING-LITERAL first
 *   argument. Every one of those is a thing a refactor can move:
 *     · a router factory or a different receiver name
 *       (`const r = makeRouter(); r.get("/x")` → receiver `r`, unmatched),
 *     · a `registerRoute(app, "GET", path, handler)` helper,
 *     · a path built from a constant or a template literal
 *       (`app.get(`${BASE}/:id`, …)` / `app.get(ROUTES.LEAD_BY_ID, …)`).
 *   Any of those lands the walk on all 1,370 files, extracts ZERO routes, and
 *   prints "1370 server files scanned, 0 swallowed literal routes." A totally
 *   blind gate reporting a clean bill of health, with its one printed number
 *   looking perfectly healthy the whole time.
 *
 * So FOUR populations are floored, and a missing floor fails exactly as loudly
 * as a breached one (see scripts/ratchet.mjs's `minima.files` and
 * scripts/ratchets/reachability.json's `minima`, the two references for this
 * shape). Floors are checked BEFORE any verdict is allowed to print.
 *
 * MEASURED 2026-08-16 against the live repo (node scripts/check-route-order.mjs):
 *     server files walked ............... 1,370   → floor 1,000
 *     files yielding >= 1 route ......... 279     → floor   200
 *     route registrations extracted ..... 2,860   → floor 2,100
 *     `:param`-tailed routes ............ 531     → floor   380
 * Floors sit at ~73-78% of live: a broken walk, a rotted receiver list or a
 * path-shape change trips them, while ordinary route deletion does not. If a
 * real consolidation takes a population under its floor, LOWER the floor in the
 * same commit and name the consolidation here. Never raise a floor to silence
 * something, and never delete a key.
 *
 * Why `paramRoutes` is floored separately from `routes`: it is the predicate's
 * LEFT-HAND SIDE. The swallow check only ever fires from a route matching
 * /^(.*?)\/:[A-Za-z]+$/, so if that shape stops being extracted (Express 5
 * `{:id}` syntax, a regex-constrained `:id(\d+)` param, a renamed convention)
 * the gate finds zero offenders while `routes` still looks large and healthy.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SCAN_ROOT = join(REPO_ROOT, "server");

// ----------------------------------------------------------------------------
// VACUITY FLOORS. Every key below is REQUIRED: a missing/zero/non-integer floor
// is a failure, so the guard cannot be removed later by deleting a line — which
// is precisely how a gate quietly stops gating. A floor of 0 is not a floor.
// See the header for the measurement (2026-08-16) behind each number.
// ----------------------------------------------------------------------------
const FLOORS = {
  serverFiles: 1000, // live 1,370
  routeFiles: 200, //   live   279
  routes: 2100, //      live 2,860
  paramRoutes: 380, //  live   531
};
const REQUIRED_FLOORS = ["serverFiles", "routeFiles", "routes", "paramRoutes"];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) yield p;
  }
}

// Multiline-tolerant: `app.get(` and the path string are often on separate
// lines (prettier wraps long middleware chains) — a per-line regex missed
// those registrations entirely (escrow-disbursements, found live).
const pat = /\b(?:api|app|router)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;

// The `:param`-tailed shape that seeds every swallow check.
const PARAM_TAIL = /^(.*?)\/:[A-Za-z]+$/;

const offenders = [];
let scanned = 0;
// Scan populations, printed and floored below.
let routeFiles = 0;
let totalRoutes = 0;
let paramRoutes = 0;

for (const path of walk(SCAN_ROOT)) {
  scanned += 1;
  const routes = [];
  const src = readFileSync(path, "utf8");
  for (const m of src.matchAll(pat)) {
    const line = src.slice(0, m.index).split("\n").length;
    routes.push({ line, method: m[1].toUpperCase(), route: m[2] });
  }
  totalRoutes += routes.length;
  if (routes.length > 0) routeFiles += 1;
  routes.forEach((paramRoute, idx) => {
    const m = PARAM_TAIL.exec(paramRoute.route);
    if (!m) return;
    paramRoutes += 1;
    const prefix = m[1];
    for (const later of routes.slice(idx + 1)) {
      if (later.method !== paramRoute.method) continue;
      const m2 = new RegExp(
        "^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/([A-Za-z0-9_-]+)$",
      ).exec(later.route);
      if (m2 && !m2[1].includes(":")) {
        offenders.push(
          `${path}:${later.line} ${later.method} ${later.route} is swallowed by ${paramRoute.route} (line ${paramRoute.line}) — register the literal route FIRST`,
        );
      }
    }
  });
}

// ----------------------------------------------------------------------------
// Vacuity guard, BEFORE the verdict. A count taken over a population that has
// collapsed is an artefact of a broken scan, not a measurement — so the gate
// prints no clean verdict at all when a floor is missing or breached.
// ----------------------------------------------------------------------------
const POPULATIONS = [
  ["serverFiles", "server .ts files walked", scanned],
  ["routeFiles", "files yielding >= 1 extracted route", routeFiles],
  ["routes", "route registrations extracted", totalRoutes],
  ["paramRoutes", "`:param`-tailed routes (the swallow predicate's LHS)", paramRoutes],
];

const vacuity = [];
for (const key of REQUIRED_FLOORS) {
  if (!(key in FLOORS)) {
    vacuity.push(
      `FLOORS.${key} is MISSING. Every scan population must be floored — an ` +
        `unfloored one lets a broken walk or a rotted extraction regex read as ` +
        `"0 swallowed literal routes". Restore it; do not delete the key.`,
    );
  }
}
for (const [key, label, observed] of POPULATIONS) {
  const floor = FLOORS[key];
  if (floor === undefined) continue; // already reported as MISSING above
  if (!Number.isInteger(floor) || floor < 1) {
    vacuity.push(
      `FLOORS.${key} must be an integer >= 1 (got ${JSON.stringify(floor)}). ` +
        `A floor of 0 is not a floor — it admits the empty scan this guard exists to catch.`,
    );
  } else if (observed < floor) {
    vacuity.push(
      `VACUOUS SCAN — ${label}: ${observed}, below the floor of ${floor}. This is NOT a ` +
        `clean bill of health; the scan stopped seeing things.\n` +
        `      Suspect the walk (server/ moved?), the extraction regex ` +
        `(a router factory, a registerRoute() helper, a path from a constant or a ` +
        `template literal), or the \`:param\` shape itself before you suspect progress.\n` +
        `      If a real consolidation genuinely shrank this population, lower ` +
        `FLOORS.${key} in scripts/check-route-order.mjs in the SAME commit and record the ` +
        `new measurement in the header. Never raise a floor to silence something.`,
    );
  }
}

const populationLine =
  `${scanned} server files scanned, ${routeFiles} with routes, ` +
  `${totalRoutes} route registrations extracted (${paramRoutes} \`:param\`-tailed)`;

if (vacuity.length) {
  console.error(`[check-route-order] FAIL — the gate itself is not trustworthy right now:`);
  for (const v of vacuity) console.error(`  ✗ ${v}`);
  console.error(`  observed: ${populationLine}`);
  if (offenders.length) {
    console.error(
      `  (${offenders.length} swallowed literal route(s) were also found, but the ` +
        `population is untrustworthy — fix the scan first.)`,
    );
  }
  process.exit(1);
}

if (offenders.length) {
  console.error(`[check-route-order] FAIL — ${offenders.length} literal route(s) registered after a :param sibling that swallows them:`);
  for (const o of offenders) console.error(`    ${o}`);
  console.error(`  (Population checked first: ${populationLine}.)`);
  process.exit(1);
}
console.log(`[check-route-order] PASS — ${populationLine}; 0 swallowed literal routes.`);
