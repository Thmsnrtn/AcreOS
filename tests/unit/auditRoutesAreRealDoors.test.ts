/**
 * An audit route that no router serves audits the 404 page — and reports it clean.
 *
 * mobile-feel-contracts.spec.ts listed "/map" as the Map door. The canonical
 * href is "/maps" (nav-items.ts). "/map" has no <Route>, so it fell through to
 * the catch-all and the suite spent every Map-door run measuring the not-found
 * page. It reported a healthy Map door for as long as that list existed, and
 * customer-surface-journeys.spec.ts's J1 had made the identical mistake
 * independently — two suites, same wrong premise, neither able to notice.
 *
 * Nothing about a 404 looks like a failure to a touch-target or contrast scan:
 * the not-found page has few controls and they are all fine. That is what makes
 * this class of error survive. So the audit route list is pinned here, in three
 * directions at once:
 *
 *   1. every audited customer route is the href of a door the CLIENT declares
 *      (MOBILE_DOORS / DEFAULT_SIDEBAR_ITEMS via NAV_ITEM_MAP) — so renaming a
 *      door's href in nav-items.ts fails HERE rather than silently redirecting
 *      an audit to the catch-all;
 *   2. every audited founder route is a declared founder door (FOUNDER_DOORS);
 *   3. every audited route is REGISTERED in App.tsx and is not one of the
 *      redirect-only aliases — a <Redirect> would make the audit measure a
 *      different page than the one it names, which is the same defect wearing
 *      a nicer hat.
 *
 * Mutation probes (each must go RED): change "/maps" to "/map" in
 * door-routes.ts; change the Map door's href in nav-items.ts without updating
 * door-routes.ts; add "/founder/asks" (a redirect) to the founder list.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import {
  CUSTOMER_AUDIT_ROUTES,
  CUSTOMER_DOOR_ROUTES,
  FOUNDER_DOOR_ROUTES,
} from "../e2e-mobile/door-routes";
import { NAV_ITEM_MAP, MOBILE_DOORS, DEFAULT_SIDEBAR_ITEMS } from "../../client/src/lib/nav-items";
import { FOUNDER_DOORS } from "../../client/src/lib/founder-doors";
import { ROUTE_REDIRECTS } from "../../client/src/lib/route-redirects";

const ROOT = path.resolve(__dirname, "../..");
const APP = stripComments(fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8"));

/** Every path App.tsx registers a <Route> for. */
function registeredRoutes(): Set<string> {
  return new Set([...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
}

/** Paths whose <Route> body is nothing but a <Redirect>. */
function redirectOnlyRoutes(): Set<string> {
  const out = new Set<string>();
  for (const m of APP.matchAll(/<Route\s+path="([^"]+)"\s*>([\s\S]*?)<\/Route>/g)) {
    if (/<Redirect\b/.test(m[2]) && !/component=/.test(m[2])) out.add(m[1]);
  }
  return out;
}

describe("every audited route is a door the product actually serves", () => {
  const registered = registeredRoutes();
  const redirects = redirectOnlyRoutes();

  it("reads a real App.tsx — the extractors found routes", () => {
    // Both sets are assumptions as much as the assertions are. A regex that
    // stops matching turns every check below green.
    expect(registered.size, "no <Route path=...> found; the extractor has stopped matching")
      .toBeGreaterThan(150);
    expect(redirects.size, "no redirect-only routes found, though route-redirects.ts lists many")
      .toBeGreaterThanOrEqual(ROUTE_REDIRECTS.length - 2);
    expect(CUSTOMER_AUDIT_ROUTES.length).toBeGreaterThanOrEqual(7);
    expect(FOUNDER_DOOR_ROUTES.length).toBe(4);
  });

  it.each(CUSTOMER_AUDIT_ROUTES)("%s is the href of a declared customer door", (route) => {
    const declared = DEFAULT_SIDEBAR_ITEMS.map((id) => NAV_ITEM_MAP.get(id)?.href).filter(Boolean);
    expect(
      declared,
      `${route} is audited but is not any door's href in nav-items.ts. Either the ` +
        "door was renamed and this list was not, or the audit is measuring a page " +
        "no navigation reaches.",
    ).toContain(route);
  });

  it("the five doors in the audit are the five doors in MOBILE_DOORS, in order", () => {
    const doorHrefs = MOBILE_DOORS.map((id) => NAV_ITEM_MAP.get(id)?.href);
    expect(doorHrefs).toEqual([...CUSTOMER_DOOR_ROUTES]);
  });

  it.each(FOUNDER_DOOR_ROUTES)("%s is a declared founder door", (route) => {
    expect(FOUNDER_DOORS.map((d) => d.href)).toContain(route);
  });

  it.each([...CUSTOMER_AUDIT_ROUTES, ...FOUNDER_DOOR_ROUTES])(
    "%s is registered in App.tsx and is not redirect-only",
    (route) => {
      expect(
        registered.has(route),
        `${route} has no <Route> in App.tsx — it falls through to the catch-all, so ` +
          "any suite auditing it is auditing the not-found page and calling it clean",
      ).toBe(true);
      expect(
        redirects.has(route),
        `${route} only redirects; the audit would measure a different page than the ` +
          "one it names in its own test title",
      ).toBe(false);
    },
  );

  it("no audited route is a retired path from the redirect register", () => {
    const legacy = new Set(ROUTE_REDIRECTS.map((r) => r.legacy));
    for (const route of [...CUSTOMER_AUDIT_ROUTES, ...FOUNDER_DOOR_ROUTES]) {
      expect(legacy.has(route), `${route} is a retired path`).toBe(false);
    }
  });
});
