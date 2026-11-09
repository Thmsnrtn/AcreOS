/**
 * Rentals no longer advertises an "Analytics" surface that is not there.
 *
 * The Rentals module (sidebar), the Today "Landlord surfaces" card, the
 * landlord-family spotlight lists and the persona catalog all named
 * /investor-analytics ("NOI / cap rate / DSCR / vacancy"). Since the 2026-06-01
 * page cut that route only redirects to the generic /analytics page, which
 * shows none of those. The entries were removed everywhere together (the
 * spotlight lists are pinned equal to the Rentals children by
 * tailVerticalGates.test.ts, so a partial removal fails there too).
 *
 * Here: for every landlord-family surface, each link must land on a declared
 * route that is a page, not a redirect alias, and none may claim analytics.
 * Source is read through the TypeScript AST (comments are never visited) and
 * App.tsx through the same route parser the route sweep uses.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { clientRoutes, routesInSource, type ClientRoute } from "../helpers/clientRoutes";
import { BUSINESS_TYPES } from "../../shared/business-types";
import { resolveVerticalSurfaces } from "../../client/src/lib/today-vertical-surfaces";
import { CUSTOMER_PERSONAS } from "../personas/customer-personas";

const ROOT = path.resolve(__dirname, "../..");
const FAMILY = ["buy_and_hold", "short_term_rental", "multifamily", "mobile_home", "commercial"] as const;

interface NavEntry { label: string; href: string; description: string }
interface NavModule { id: string; description: string; children: NavEntry[] }

function literal(n: ts.Expression | undefined): string {
  return n && ts.isStringLiteralLike(n) ? n.text : "";
}

function rentalsModule(): NavModule {
  const file = path.join(ROOT, "client/src/components/layout-sidebar.tsx");
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: NavModule | null = null;
  const prop = (o: ts.ObjectLiteralExpression, k: string) =>
    o.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === k)?.initializer;
  const visit = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n) && literal(prop(n, "id")) === "landlord" && prop(n, "children")) {
      const kids = prop(n, "children");
      found = {
        id: "landlord",
        description: literal(prop(n, "description")),
        children: ts.isArrayLiteralExpression(kids!)
          ? kids.elements.filter(ts.isObjectLiteralExpression).map((c) => ({
              label: literal(prop(c, "label")),
              href: literal(prop(c, "href")),
              description: literal(prop(c, "description")),
            }))
          : [],
      };
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found) throw new Error("Rentals module not found in NAV_MODULES");
  return found;
}

/** Exact-declaration lookup: a parameterised route must not swallow a concrete path. */
function declared(routes: ClientRoute[], href: string): ClientRoute | undefined {
  const p = href.split(/[?#]/)[0];
  return routes.find((r) => r.path === p);
}

describe("Rentals sidebar module", () => {
  const mod = rentalsModule();

  it("is parsed (vacuity)", () => {
    expect(mod.children.length).toBeGreaterThanOrEqual(4);
    expect(mod.children.map((c) => c.href)).toContain("/rent-roll");
  });

  it("every child lands on a declared page, not a redirect alias", () => {
    const routes = clientRoutes();
    for (const c of mod.children) {
      const r = declared(routes, c.href);
      expect(r, `${c.label} -> ${c.href} is not a declared route`).toBeDefined();
      expect(r!.kind, `${c.label} -> ${c.href} only redirects`).not.toBe("redirect");
    }
  });

  it("claims no analytics it does not have", () => {
    const text = [mod.description, ...mod.children.flatMap((c) => [c.label, c.description])].join(" | ");
    expect(text).not.toMatch(/analytics|cap rate|DSCR/i);
    expect(mod.children.map((c) => c.href)).not.toContain("/investor-analytics");
  });
});

describe("Today landlord card and landlord-family catalog", () => {
  it("the Today card (every landlord-family type) links only real pages and claims no analytics", () => {
    const routes = clientRoutes();
    for (const bt of FAMILY.filter((b) => b !== "commercial")) {
      const clusters = resolveVerticalSurfaces({ businessType: bt, investorType: null }).filter((c) => c.id === "landlord");
      expect(clusters.length, `vacuity: ${bt} gets the landlord card`).toBe(1);
      const c = clusters[0];
      expect(c.links.length).toBeGreaterThanOrEqual(3);
      expect(`${c.description} ${c.links.map((l) => l.label).join(" ")}`).not.toMatch(/analytics/i);
      for (const l of c.links) {
        const r = declared(routes, l.href);
        expect(r, `${l.label} -> ${l.href}`).toBeDefined();
        expect(r!.kind, `${l.label} -> ${l.href} only redirects`).not.toBe("redirect");
      }
    }
  });

  it("no landlord-family spotlight names the unmounted analytics page", () => {
    for (const bt of FAMILY) {
      const sp = BUSINESS_TYPES[bt].spotlightModules;
      expect(sp.length, bt).toBeGreaterThan(0);
      expect(sp, bt).not.toContain("investor-analytics");
    }
  });

  it("the rental-landlord persona expects no analytics route", () => {
    const lena = CUSTOMER_PERSONAS.find((p) => p.slug === "rental-landlord");
    expect(lena, "vacuity: persona exists").toBeDefined();
    expect(lena!.expect.modulesVisible).not.toContain("/investor-analytics");
  });
});

describe("the resolver cannot be fooled by a parameterised sibling", () => {
  it("a redirect-only /investor-analytics is detected, and /portal/v2-style concrete paths are not declared", () => {
    const src = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");
    const routes = routesInSource(src);
    expect(declared(routes, "/investor-analytics")?.kind).toBe("redirect");
    // A concrete path that only param-matches another route is not declared.
    expect(declared(routes, "/portal/v2")).toBeUndefined();
    expect(declared(routes, "/portal")).toBeDefined();
  });
});
