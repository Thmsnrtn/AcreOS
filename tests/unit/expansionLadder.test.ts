/**
 * The expansion ladder, enforced instead of trusted.
 *
 * *"No marketplace before ~25 customers and no public API before ~50"* — the
 * approved expansion ladder, in `CLAUDE.md`'s DO-NOT-DO list and
 * `docs/company/roadmap-2026-07.md`. Until this file it was registered in
 * `shared/governance/constitution.ts` as **`prose-only`**: recorded, relying on
 * vigilance, with a note reading *"Enforced today by the marketplace/API
 * surfaces staying feature-flagged off. No automated customer-count gate.
 * GOVERNANCE DEBT."*
 *
 * Checking that note against HEAD found it half-true, and the half that was
 * wrong is the interesting half.
 *
 * THE API SIDE WAS FINE. `registerPublicApiV1` has zero callers, so
 * `server/api-v1/*` is unmounted (BLOCKERS B8). `/api/v1/*` in `routes.ts` is
 * only a passthrough that rewrites to `/api/*`, so the versioned prefix is an
 * alias rather than a public surface.
 *
 * THE MARKETPLACE SIDE WAS NOT. It was mounted behind
 * `featureGate("feature_marketplace")`, and `requireFlag` — which `featureGate`
 * aliases — carries two escape hatches:
 *
 *   1. **An enterprise-tier bypass.** Its own comment calls it back-compat for
 *      legacy reseller / white-label routes. Applied here it meant a
 *      SUBSCRIPTION TIER silently overrode a founder decision: a paid plan
 *      buying its way past the ladder.
 *   2. **Failing OPEN when the flag store throws** — *"DB unavailable — fail
 *      open to avoid breaking the app during initial setup"*. Kind for a
 *      product flag. For an expansion gate it means a transient database error
 *      opens the marketplace.
 *
 * Neither is a bug in `requireFlag`; both are wrong for a governance gate. So
 * the marketplace now uses `requireLadderFlag`, which keeps the founder bypass
 * — the founder must be able to look at the surface they are deciding about —
 * and drops the other two.
 *
 * WHY THE ASSERTIONS ARE INVERTED. A test cannot know the customer count, so it
 * cannot say "25 has not been reached". What it can do is fail the moment
 * either surface is switched on, and say what to check first. That is the same
 * shape as `FOUNDER_ROUTE_BASELINE` and `BLOCKED_ON_A_REAL_LINK`: a fact that
 * may only change deliberately, by someone who reads the message.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CONSTITUTION } from "@shared/governance/constitution";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

const routes = stripComments(fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8"));
const gate = stripComments(
  fs.readFileSync(path.join(ROOT, "server/middleware/featureGate.ts"), "utf8"),
);

describe("the public API stays unmounted until the ladder says otherwise", () => {
  it("registerPublicApiV1 still has no caller", () => {
    // Inverted on purpose. When someone mounts it, this fails and asks them to
    // confirm the customer count first — which is the only thing a test can
    // usefully do about a threshold it cannot measure.
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/api-v1/index.ts"), "utf8"),
    );
    expect(src, "registerPublicApiV1 is gone — was the public API surface moved?")
      .toContain("export function registerPublicApiV1");
    expect(
      routes.includes("registerPublicApiV1("),
      "the public API v1 surface is now MOUNTED. The approved expansion ladder " +
        "puts a public API at ~50 customers. If that threshold has genuinely " +
        "been crossed, say so in the commit, update " +
        "shared/governance/constitution.ts, and change this assertion " +
        "deliberately — do not delete it.",
    ).toBe(false);
  });

  it("/api/v1 is still only a passthrough alias, not a separate surface", () => {
    // The thing that makes the claim above true in practice: a client calling
    // /api/v1/x today reaches /api/x, the internal route. If this rewrite were
    // replaced by a real v1 router, the surface would exist without
    // registerPublicApiV1 ever being called.
    const at = routes.indexOf('app.use("/api/v1/{*splat}"');
    expect(at, "the /api/v1 passthrough is gone — is there a real v1 surface now?")
      .toBeGreaterThan(-1);
    expect(routes.slice(at, at + 400)).toContain('replace("/api/v1/", "/api/")');
  });
});

/**
 * WHAT THE TWO ASSERTIONS ABOVE MISSED, and why this block exists.
 *
 * They pin `registerPublicApiV1` and `/api/v1` — the public API surface **by
 * name**. A SECOND one existed under a different name and neither noticed it:
 * `routes-epic-services.ts`, mounted at `/api` behind plain `isAuthenticated`,
 * carried
 *
 *     GET  /developer/openapi          a document titled "AcreOS Public API"
 *     POST /developer/api-keys         minted an `acr_…` secret for ANY customer
 *     GET  /developer/widget-embed/:t  handed out `pub_<orgId>_<base64(orgId)>`
 *                                      as a "publicApiKey" — the org id encoded
 *
 * while `routes-api-keys.ts` was kept deliberately dormant *because of this very
 * ladder* — the reachability ratchet's note records that as the reason its
 * `unregisteredRoutes` baseline is 1. **The decision was enforced in one place
 * and defeated in another**, which is what a name-based check cannot see.
 *
 * Worse, the keys were INERT: nothing verified `provider = "api_key"` (the only
 * consumer, `mcp-server.ts`, matches `provider = 'mcp_api_key'`), and the rate
 * limiter written for them had zero importers — while the response told the
 * customer *"Store this key securely. It will not be shown again."*
 *
 * Founder ruling (picker, 2026-08-15): remove the three endpoints. These
 * assertions are therefore SHAPE-based rather than name-based: they ask "does any
 * mounted route hand a customer an API key, or publish a public-API spec?", so a
 * third surface under a third name trips them too.
 */
describe("no mounted route hands a customer an API key", () => {
  const routeFiles = fs
    .readdirSync(path.join(ROOT, "server"))
    .filter((f) => /^routes.*\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f));

  it("the /developer/* surface is gone from routes-epic-services", () => {
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-epic-services.ts"), "utf8"),
    );
    expect(
      src,
      "a /developer/* route is back in routes-epic-services.ts. That router mounts " +
        "at /api behind plain isAuthenticated, so this is customer-reachable — and " +
        "the ladder defers a public API to ~50 customers. If that threshold has " +
        "been crossed, build the VERIFIER first: the keys this used to mint were " +
        "accepted by nothing.",
    ).not.toMatch(/["'`]\/developer\//);
  });

  it("every generateApiKey call site is founder-gated or unmounted", () => {
    // The shape check. Key MINTING is the affordance the ladder defers; where it
    // exists it must be behind requireFounder (as /api/data-api's is) or in a
    // router nothing mounts (as routes-api-keys.ts is).
    const offenders: string[] = [];
    for (const f of routeFiles) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, "server", f), "utf8"));
      if (!/\bgenerateApiKey\s*\(/.test(src)) continue;
      const founderGated = /requireFounder|founderOnly/.test(src);
      const mounted = routes.includes(f.replace(/\.tsx?$/, ""));
      if (!founderGated && mounted) offenders.push(f);
    }
    expect(
      offenders,
      "a MOUNTED route mints API keys without a founder gate. The expansion " +
        "ladder puts a public API at ~50 customers; routes-api-keys.ts stays " +
        "dormant for exactly that reason, and this is the same affordance by " +
        "another name.",
    ).toEqual([]);
  });

  it("no mounted route serves the public-API spec", () => {
    const offenders = routeFiles.filter((f) => {
      const src = stripComments(fs.readFileSync(path.join(ROOT, "server", f), "utf8"));
      return /ACREOS_OPENAPI_SPEC/.test(src);
    });
    expect(
      offenders,
      "a route serves ACREOS_OPENAPI_SPEC — a document titled 'AcreOS Public API' " +
        "instructing developers to authenticate with `Bearer acr_…`. Publishing " +
        "the spec IS launching the API, whether or not a verifier exists.",
    ).toEqual([]);
  });

  it("the spec and the minting helper still EXIST, kept for when the trigger fires", () => {
    // Deliberately not deleted. What was wrong was mounting them early, not
    // writing them — so this asserts the opposite of the three above, and stops a
    // future reader from "finishing the cleanup" and throwing away the head start.
    const svc = path.join(ROOT, "server/services/developerApiService.ts");
    expect(fs.existsSync(svc), "developerApiService.ts was deleted — see the ledger").toBe(true);
    const src = fs.readFileSync(svc, "utf8");
    expect(src).toContain("ACREOS_OPENAPI_SPEC");
    expect(src).toContain("export function generateApiKey");
  });

  it("the detectors would notice (guards against vacuous passes)", () => {
    expect(routeFiles.length, "no route files found — the scan is broken").toBeGreaterThan(20);
    expect(/\bgenerateApiKey\s*\(/.test("const k = generateApiKey();")).toBe(true);
    expect(/["'`]\/developer\//.test('router.get("/developer/openapi"')).toBe(true);
  });
});

describe("the marketplace gate is not overridable by a subscription tier", () => {
  it("the marketplace mount uses the strict ladder gate", () => {
    const at = routes.indexOf("app.use('/api/marketplace'");
    expect(at, "the marketplace mount is gone — renamed?").toBeGreaterThan(-1);
    const line = routes.slice(at, routes.indexOf("\n", at));
    expect(
      line,
      "the marketplace is back on featureGate, which lets an enterprise-tier " +
        "org bypass the flag and fails OPEN when the flag store errors — a " +
        "subscription tier must not override a founder decision",
    ).toContain("requireLadderFlag(");
    expect(line).toContain("feature_marketplace");
  });

  it("requireLadderFlag has no enterprise bypass", () => {
    const at = gate.indexOf("export function requireLadderFlag");
    expect(at, "requireLadderFlag is gone").toBeGreaterThan(-1);
    const body = gate.slice(at, gate.indexOf("\n}", at));
    expect(
      body,
      "requireLadderFlag now honours the enterprise-tier bypass — that is a " +
        "paid plan buying past the expansion ladder",
    ).not.toContain('"enterprise"');
  });

  it("requireLadderFlag fails CLOSED", () => {
    const at = gate.indexOf("export function requireLadderFlag");
    const body = gate.slice(at, gate.indexOf("\n}", at));
    const catchAt = body.indexOf("} catch");
    expect(catchAt, "the flag read is no longer guarded").toBeGreaterThan(-1);
    const tail = body.slice(catchAt);
    expect(
      tail,
      "requireLadderFlag fails OPEN on a flag-store error — a transient " +
        "database blip would open the marketplace",
    ).not.toMatch(/return next\(\)/);
    // The refusal, not the literal status. A first draft asserted `"404"` in
    // the handler and broke the moment the raw `res.status(404)` became
    // `Errors.featureUnavailable` — an assertion coupled to where the number
    // is written rather than to what the code does.
    expect(tail).toContain("Errors.featureUnavailable(");
  });

  it("featureUnavailable really is a 404 (the other half of the check above)", () => {
    // Asserted here because the assertion above deliberately stopped looking
    // for the literal. Split across two checks, the property still holds
    // end to end: the catch refuses, and the refusal is a 404.
    const errors = stripComments(
      fs.readFileSync(path.join(ROOT, "server/utils/errors.ts"), "utf8"),
    );
    const at = errors.indexOf("featureUnavailable(");
    expect(at, "Errors.featureUnavailable is gone").toBeGreaterThan(-1);
    expect(errors.slice(at, at + 220)).toContain("404");
  });

  it("the founder bypass is deliberately KEPT", () => {
    // Not an oversight and not laziness: the founder has to be able to look at
    // the surface they are deciding about. Asserted so a later "tighten
    // everything" pass does not remove it as if it were the same kind of hole.
    const at = gate.indexOf("export function requireLadderFlag");
    const body = gate.slice(at, gate.indexOf("\n}", at));
    expect(body).toContain("isFounderEmail(");
  });

  it("the ordinary featureGate still has its escape hatches (contrast guard)", () => {
    // If `requireFlag` were itself tightened, `requireLadderFlag` would be
    // redundant and this file would be asserting a distinction that no longer
    // exists — which is worth noticing rather than silently maintaining.
    const at = gate.indexOf("export function requireFlag");
    const body = gate.slice(at, gate.indexOf("\n}", at));
    expect(
      body.includes('"enterprise"'),
      "requireFlag no longer has the enterprise bypass, so requireLadderFlag " +
        "may be redundant — collapse them rather than keeping two gates that " +
        "do the same thing",
    ).toBe(true);
  });
});

describe("the constitution registry reflects reality", () => {
  const entry = CONSTITUTION.find((i) => i.id === "expansion.marketplace-25-api-50");

  it("the entry still exists", () => {
    expect(entry, "the expansion-ladder invariant is gone from the registry").toBeDefined();
  });

  it("it is no longer prose-only", () => {
    // The point of the exercise. A hard-stop-adjacent decision backed only by
    // vigilance is one refactor away from being gone, and this one already had
    // a hole (the enterprise bypass) that vigilance had not caught.
    expect(entry!.enforcement.kind).toBe("ratchet-test");
  });

  it("its refs point at things that exist", () => {
    // constitution.test.ts checks this globally; asserted here too so a bad
    // ref in THIS entry fails in the file that owns it.
    for (const ref of entry!.enforcement.refs) {
      expect(fs.existsSync(path.join(ROOT, ref)), `${ref} does not exist`).toBe(true);
    }
    expect(entry!.enforcement.refs).toContain("tests/unit/expansionLadder.test.ts");
  });
});
