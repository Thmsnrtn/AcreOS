/**
 * The `/api` catch-all decides auth by LINE NUMBER, and that is load-bearing.
 *
 * ── WHAT IT IS ──────────────────────────────────────────────────────────────
 * `server/routes.ts` mounts two routers with `app.use('/api', isAuthenticated,
 * getOrCreateOrg, <router>)`. In Express, middleware given to `app.use(path,
 * …)` runs for EVERY request under that path, whether or not the router has a
 * matching route — so both lines apply `isAuthenticated` + `getOrCreateOrg` to
 * every `/api/*` request registered AFTER them.
 *
 * A route's real auth therefore depends on where in a 5,000-line file it was
 * registered, which is invisible at the route's own definition site.
 *
 * ── IT HAS BITTEN THREE TIMES ───────────────────────────────────────────────
 * `/api/docs`, the public e-sign endpoints, and the transparency report were
 * each registered after the catch-all, each 401'd anonymous callers, and each
 * was fixed by MOVING the registration earlier. The file carries three comment
 * blocks saying so. Comments are not a gate; this file is.
 *
 * ── AND IT IS CURRENTLY SHIELDING A BUG ─────────────────────────────────────
 * `registerEliteFeatureRoutes` runs at ~2650, after the catch-all, so
 * `GET /api/webhooks/meta-lead-ads` is 401'd before its handler runs. That
 * accidentally hid a fail-open comparison in `verifyMetaWebhook` (fixed
 * 2026-08-18, `secretComparison.test.ts`) — and it also means the Meta lead-ads
 * webhook cannot function at all, because Meta's servers carry no Clerk
 * session. Moving it earlier, which is what the three comment blocks instruct,
 * is a real change with real consequences in both directions.
 *
 * ── WHAT THIS FILE DOES AND DOES NOT PROVE ──────────────────────────────────
 * It is a source-order check, not a request-level proof. It cannot tell you
 * whether a given handler is reachable anonymously; it pins the ordering
 * decisions already made and freezes the number of catch-alls, so the trap
 * cannot spread and the three fixes cannot silently regress.
 *
 * The structural fix — mounting each router at the prefixes it actually owns,
 * so its middleware stops applying to everyone else's routes — is NOT done
 * here. `epicServicesRouter` has six clean prefixes, but `fieldScoutRouter`
 * spans `/properties`, `/leads`, `/voice` and `/field-scout`, and scoping the
 * catch-all would strip accidental auth from every later route that never
 * declared its own. Doing that safely means auditing all of them first.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../../server/routes.ts"),
  "utf8",
);
const LINES = SRC.split("\n");

/** Line numbers (1-based) of every `/api` catch-all mount, code only. */
function catchAllLines(): number[] {
  return LINES.flatMap((line, i) => {
    const code = line.split("//")[0];
    return /app\.use\(\s*['"]\/api['"]\s*,\s*isAuthenticated/.test(code) ? [i + 1] : [];
  });
}

/** First line whose CODE (not comment) matches — comments here quote these. */
function lineOf(pattern: RegExp): number {
  const i = LINES.findIndex((l) => pattern.test(l.split("//")[0]));
  return i === -1 ? -1 : i + 1;
}

describe("the catch-all is found, and there are no more of it", () => {
  it("THE SCAN FINDS THE CATCH-ALLS", () => {
    // Vacuity guard first: every assertion below compares against these line
    // numbers, so a scan that found none would pass everything trivially.
    expect(catchAllLines().length).toBeGreaterThan(0);
  });

  it("there are exactly TWO — the trap does not spread", () => {
    // epicServicesRouter and fieldScoutRouter. A third would silently extend
    // the region in which a route's auth depends on its line number, and would
    // do so in a file nobody reads top to bottom.
    expect(
      catchAllLines(),
      "a new `app.use('/api', isAuthenticated, …)` was added. Mount the router " +
        "at the prefixes it actually owns instead — this form applies its " +
        "middleware to every /api route registered after it.",
    ).toHaveLength(2);
  });
});

describe("the anonymous-by-design registrations stay ahead of it", () => {
  const firstCatchAll = () => Math.min(...catchAllLines());

  /**
   * Each of these was registered AFTER the catch-all at some point, was 401'd,
   * and was moved. The file documents all three. Pinning them stops the
   * regression that has already happened three times.
   */
  const MUST_PRECEDE: Array<{ what: string; pattern: RegExp; why: string }> = [
    {
      what: "/api/docs (Swagger UI + OpenAPI spec)",
      pattern: /app\.use\(\s*['"]\/api\/docs['"]/,
      why: "External integrators consume the spec before signing up.",
    },
    {
      what: "public e-sign endpoints",
      pattern: /registerPublicSignRoutes\(app\)/,
      why: "External signers have no AcreOS account; they authenticate via an HMAC token in the URL.",
    },
    {
      what: "public transparency report",
      pattern: /registerTransparencyRoutes\(app\)/,
      why: "Linked from the public page and read by external auditors.",
    },
  ];

  for (const entry of MUST_PRECEDE) {
    it(`${entry.what} is registered before the catch-all`, () => {
      const at = lineOf(entry.pattern);
      expect(at, `${entry.what} is no longer registered at all — re-adjudicate`).toBeGreaterThan(0);
      expect(
        at,
        `${entry.what} moved below the /api catch-all, which 401s anonymous ` +
          `callers before the handler runs. ${entry.why} This exact regression ` +
          `has happened three times.`,
      ).toBeLessThan(firstCatchAll());
    });
  }

  it("the ordering check can actually fail — it is comparing real positions", () => {
    // Without this, a bug that made `lineOf` return 0 and `firstCatchAll`
    // return Infinity would satisfy every assertion above.
    expect(firstCatchAll()).toBeGreaterThan(0);
    expect(firstCatchAll()).toBeLessThan(LINES.length);
    // And something IS registered after it, or the ordering would be moot.
    expect(lineOf(/app\.use\(\s*['"]\/api['"]\s*,\s*isAuthenticated.*fieldScout/i))
      .toBeGreaterThan(firstCatchAll());
  });
});
