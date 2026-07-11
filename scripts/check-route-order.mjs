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
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

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

const offenders = [];
let scanned = 0;
for (const path of walk("server")) {
  scanned += 1;
  const routes = [];
  const src = readFileSync(path, "utf8");
  for (const m of src.matchAll(pat)) {
    const line = src.slice(0, m.index).split("\n").length;
    routes.push({ line, method: m[1].toUpperCase(), route: m[2] });
  }
  routes.forEach((paramRoute, idx) => {
    const m = /^(.*?)\/:[A-Za-z]+$/.exec(paramRoute.route);
    if (!m) return;
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

if (offenders.length) {
  console.error(`[check-route-order] FAIL — ${offenders.length} literal route(s) registered after a :param sibling that swallows them:`);
  for (const o of offenders) console.error(`    ${o}`);
  process.exit(1);
}
console.log(`[check-route-order] PASS — ${scanned} server files scanned, 0 swallowed literal routes.`);
