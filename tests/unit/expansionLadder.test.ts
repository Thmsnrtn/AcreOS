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

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping. See destructivePermissionCoverage for why. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

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
