/**
 * The POPULATION of the by-id isolation sweep (idor-sweep.ts): every
 * GET/PUT/PATCH/DELETE route under /api whose path carries an id-style param,
 * read from the comment-stripped route sources. Kept apart from the sweep so a
 * unit test can hold the floor without a server (tests/unit/
 * isolationSweepRunsInCi.test.ts) and CI fails the same way when it shrinks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../../helpers/stripComments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, "../../../server");

export interface Route {
  verb: "GET" | "PUT" | "PATCH" | "DELETE";
  path: string;
  file: string;
}

/** `app.get("/api/…", …)` / `router.patch(…)` etc. Path captured from a quoted literal. */
// ANY receiver: most route files register through `const api = app` (940
// registrations), so a receiver allow-list of app|router|r read ~a third of the
// population and silently skipped core CRUD (/api/leads/:id, /api/deals/:id).
// Found by the independent audit of this campaign; the floor below makes a
// regression of this regex fail loudly instead of shrinking the population.
export const VERB_RE = /\b[A-Za-z_$][\w$]*\.(get|put|patch|delete)\(\s*(["'`])(\/api\/[^"'`]*?)\2/g;
/**
 * Population floor: by-id routes this sweep must find. 400 when measured
 * 2026-10-06; 459 measured 2026-10-12, held at the program floor of 457. A
 * route set that legitimately shrinks lowers this in the same commit; an
 * extractor that stops reading a file is what this exists to catch.
 */
export const POPULATION_FLOOR = 457;
/**
 * Probed floor: routes whose backing table was inferred AND whose rows were
 * forged. Measured 2026-10-12: 322 against a push-built database (CI), 285
 * against one built like production (push + scripts/migrate.mjs, whose extra
 * constraints refuse more forged rows). A run under this probed too little of
 * the population to say anything, and fails rather than passing green.
 */
export const PROBED_FLOOR = 280;
/** A param whose name ends in id/Id/ID — the by-id shape this sweep governs. */
export const ID_PARAM = /:[a-zA-Z_]*[Ii][Dd]\b/;

export function routeSourceFiles(): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(SERVER_DIR)) {
    if (/^routes.*\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(path.join(SERVER_DIR, f));
  }
  const sub = path.join(SERVER_DIR, "routes");
  if (fs.existsSync(sub)) {
    for (const f of fs.readdirSync(sub)) {
      if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(path.join(sub, f));
    }
  }
  return out;
}

/** Enumerate every verb+path pair with an id-style param. Returns the per-route
 *  handler window too (for the terminal-`.from()` fallback). */
export function enumerateRoutes(): { routes: Route[]; windows: Map<string, string> } {
  const routes: Route[] = [];
  const windows = new Map<string, string>();
  const seen = new Set<string>();
  for (const file of routeSourceFiles()) {
    // Strip comments with the repo's real left-to-right lexer, NOT a two-regex
    // idiom — a route literal written inside a `// retired …` comment must not
    // enter the population, and a `/*` inside a line comment must not eat the file.
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const ms = [...src.matchAll(VERB_RE)];
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      const p = m[3];
      if (!ID_PARAM.test(p)) continue;
      const verb = m[1].toUpperCase() as Route["verb"];
      const key = `${verb} ${p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const start = m.index ?? 0;
      const end = i + 1 < ms.length ? ms[i + 1].index ?? src.length : Math.min(src.length, start + 2500);
      windows.set(key, src.slice(start, end));
      routes.push({ verb, path: p, file: path.basename(file) });
    }
  }
  return { routes, windows };
}

