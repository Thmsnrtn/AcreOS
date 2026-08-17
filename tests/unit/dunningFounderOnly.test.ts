/**
 * The comment said the API was founder-only. The API was not.
 *
 * `client/src/App.tsx` gates the Dunning Manager page:
 *
 *   > The dunning API is founder-only (requireFounder on the whole router,
 *   > P1-5) — a customer reaching this page saw every panel 404 (2026-07-11
 *   > sweep). Gate the page like its API.
 *
 * The router carried `app.use('/api/dunning', isAuthenticated, dunningRouter)`
 * and nothing else. **A client-side route guard was the only thing in front of
 * AcreOS's own billing console**, and a route guard is not an access control —
 * every endpoint was reachable with a session cookie and curl:
 *
 *   GET  /summary          active cases, cases by stage, and the TOTAL AMOUNT
 *                          AT RISK across the whole platform — AcreOS's own
 *                          revenue-distress number
 *   GET  /cases            every organization's dunning events
 *   GET  /history          every organization's dunning history
 *   POST /:id/retry        charge a Stripe invoice on any org's case
 *   POST /:id/cancel       cancel any org's case
 *   POST /:id/resolve      resolve any org's case, with notes
 *
 * The service is unambiguous about scope: `getActiveCases` selects from
 * `dunning_events` with a status filter and no org predicate at all, and
 * `retryPayment(eventId)` resolves by primary key and then calls Stripe.
 *
 * WHY FOUNDER-ONLY IS THE RIGHT VERDICT, not org-scoping. Dunning chases failed
 * **subscription payments TO AcreOS** — under "be the rail, not the provider",
 * the one flow AcreOS is a party to. No organization owns this queue; it is a
 * platform operations console, and it belongs behind the same gate as
 * `/api/founder/*`. Org-scoping it would have invented a per-customer view of a
 * platform-level list.
 *
 * THE PATTERN, fourth time in this program. A comment is a factual claim about
 * the code and decays exactly like an audit finding: the 2026-07-11 sweep read
 * "the API is founder-only", hardened the UI on the strength of it, and moved
 * on. See also unit 53 (a TODO claiming a service method did not exist), unit 55
 * (a lint header claiming a scope it did not have), and unit 56 (a metering note
 * false about two of its six endpoints).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

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
const app = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");
const service = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/dunning.ts"), "utf8"),
);

describe("the dunning API is founder-only on the SERVER", () => {
  it("the mount carries requireFounder", () => {
    const at = routes.indexOf("app.use('/api/dunning'");
    expect(at, "the dunning mount is gone — renamed?").toBeGreaterThan(-1);
    const line = routes.slice(at, routes.indexOf("\n", at));
    expect(
      line,
      "the dunning router is reachable by any authenticated user again. It " +
        "lists every organization's failed subscription payments and the " +
        "platform's total amount at risk, and its POST routes charge a Stripe " +
        "invoice and mutate another org's case. The page's FounderProtectedRoute " +
        "is a client route guard, not an access control.",
    ).toContain("requireFounder");
  });

  it("requireFounder needs only the session, so the mount order works", () => {
    // Asserted because the fix looks like it might need getOrCreateOrg in front
    // of it, and adding that would give a platform console an org context it
    // has no use for. requireFounder reads req.user, which isAuthenticated
    // sets — the same shape as the /api/founder/* mounts.
    const auth = stripComments(fs.readFileSync(path.join(ROOT, "server/auth/clerkAuth.ts"), "utf8"));
    const at = auth.indexOf("export const requireFounder");
    expect(at, "requireFounder is gone").toBeGreaterThan(-1);
    const body = auth.slice(at, auth.indexOf("\n};", at));
    expect(body).toContain("req.user");
    expect(
      body,
      "requireFounder now depends on req.organization, so mounts that omit " +
        "getOrCreateOrg — including this one — would fail open or crash",
    ).not.toContain("req.organization");
  });
});

describe("the page gate and the API gate agree", () => {
  it("the page is still founder-gated", () => {
    // Half of a pair. If the page gate went away while the API gate stayed,
    // nothing would break; the reverse is what shipped, and the two are
    // asserted together so the pairing is what is maintained.
    const at = app.indexOf("DunningManagerPage");
    expect(at, "the Dunning Manager page is gone").toBeGreaterThan(-1);
    const routeAt = app.indexOf("DunningManagerPage", at + 1);
    expect(routeAt, "the page is imported but never routed").toBeGreaterThan(-1);
    const window = app.slice(routeAt - 400, routeAt + 100);
    expect(window, "the dunning page lost its founder gate").toContain("FounderProtectedRoute");
  });

  it("App.tsx's claim about the API is now true", () => {
    // The specific sentence that was false. Left in place deliberately rather
    // than deleted: it states the intent correctly, and it is now checkable.
    const at = app.indexOf("DunningManagerPage", app.indexOf("DunningManagerPage") + 1);
    const window = app.slice(at - 500, at);
    expect(window).toMatch(/dunning API is founder-only/i);
    // …and the thing it asserts is verified above, against server/routes.ts.
  });
});

describe("the service really is platform-wide (why the gate has to be the router)", () => {
  it("getActiveCases has no organization predicate", () => {
    // Not a defect to fix — it is what makes founder-only the right gate. A
    // per-org dunning view would be a different feature; this list is the
    // platform's, and if this method ever grows an org parameter, the verdict
    // should be revisited rather than the gate quietly kept.
    const at = service.indexOf("async getActiveCases(");
    expect(at, "getActiveCases is gone").toBeGreaterThan(-1);
    const body = service.slice(at, service.indexOf("\n  }", at));
    expect(body).toContain("dunningEvents");
    expect(
      /organizationId/.test(body),
      "getActiveCases now takes an organization — dunning may have become a " +
        "per-customer surface, in which case founder-only is the wrong gate " +
        "and this file needs rewriting rather than deleting",
    ).toBe(false);
  });

  it("retryPayment resolves by id and reaches Stripe", () => {
    // The reason the POST routes matter more than the GETs: this is a charge.
    const at = service.indexOf("async retryPayment(");
    expect(at, "retryPayment is gone").toBeGreaterThan(-1);
    const body = service.slice(at, at + 1600);
    expect(body).toContain("eq(dunningEvents.id, eventId)");
    expect(body.toLowerCase()).toContain("stripe");
  });
});
