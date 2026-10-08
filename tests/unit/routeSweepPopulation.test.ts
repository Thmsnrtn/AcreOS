/**
 * The broken-interaction sweep (tests/e2e/route-sweep.spec.ts) visits the
 * pages App.tsx declares — not a list someone typed.
 *
 * The sweep used to carry 58 hand-curated paths. Measured 2026-10-07 against
 * App.tsx: ten of them had become redirects and one had no route at all, so a
 * twelfth of the sweep visited aliases and a NotFound; and 120 authenticated
 * pages were never visited. A green sweep said nothing about any page added
 * after the list was written.
 *
 * The population is now tests/helpers/clientRoutes.ts, which parses App.tsx
 * with TypeScript. This file holds the three things that make that honest:
 *
 *   1. FLOORS per kind (customer / founder / flagged), so a parser that stops
 *      matching one wrapper fails rather than emptying that kind;
 *   2. SPANS: the parser finds as many `<Route path=…>` elements as a
 *      comment-stripped count of the source does, so an element the AST walk
 *      skips (a new nesting shape) is a count mismatch, not a silent gap;
 *   3. ADOPTION: the spec consumes the derived population and holds no
 *      hand-typed route list of its own.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { stripComments } from "../helpers/stripComments";
import {
  APP_TSX,
  SWEEP_EXCLUDED,
  SWEEP_FLOORS,
  clientRoutes,
  routesInSource,
  sweepPopulation,
} from "../helpers/clientRoutes";

const SPEC = path.resolve(__dirname, "../e2e/route-sweep.spec.ts");

describe("route sweep population", () => {
  const routes = clientRoutes();
  const pop = sweepPopulation(routes);

  it("is floored per kind", () => {
    expect(pop.customer.length, "customer pages").toBeGreaterThanOrEqual(SWEEP_FLOORS.customer);
    expect(pop.founder.length, "founder pages").toBeGreaterThanOrEqual(SWEEP_FLOORS.founder);
    expect(pop.flagged.length, "flagged pages").toBeGreaterThanOrEqual(SWEEP_FLOORS.flagged);
  });

  it("reads every <Route path=…> element App.tsx declares", () => {
    // The span check: a comment-stripped count of the opening tags against the
    // parser's. If the AST walk stops reaching a nesting shape, this differs.
    const stripped = stripComments(fs.readFileSync(APP_TSX, "utf8"));
    const textual = (stripped.match(/<Route\s+path=/g) ?? []).length;
    expect(textual, "no <Route path=…> found in App.tsx at all").toBeGreaterThan(200);
    expect(routes.length).toBe(textual);
  });

  it("every exclusion names a real, concrete route", () => {
    const declared = new Set(routes.map((r) => r.path));
    for (const p of Object.keys(SWEEP_EXCLUDED)) {
      expect(declared.has(p), `SWEEP_EXCLUDED names ${p}, which App.tsx does not declare`).toBe(true);
    }
  });

  it("the spec consumes the derived population and types no route list of its own", () => {
    const raw = fs.readFileSync(SPEC, "utf8");
    const sf = ts.createSourceFile(SPEC, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imports = sf.statements.filter(ts.isImportDeclaration).filter((d) =>
      (d.moduleSpecifier as ts.StringLiteral).text.endsWith("/helpers/clientRoutes"),
    );
    expect(imports.length, "route-sweep.spec.ts no longer imports tests/helpers/clientRoutes").toBe(1);
    const code = stripComments(raw);
    expect(code).toMatch(/\bsweepPopulation\s*\(\s*\)/);
    for (const name of ["CUSTOMER_ROUTES", "FOUNDER_ROUTES", "FLAGGED_ROUTES"]) {
      expect(code, `${name} is not swept`).toMatch(new RegExp(`for\\s*\\(\\s*const\\s+\\w+\\s+of\\s+${name}\\s*\\)`));
    }
    // A hand-typed list is an array literal of path strings. The parser never
    // visits a comment, so a list quoted in prose is not one.
    const lists: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isArrayLiteralExpression(n)) {
        const paths = n.elements.filter((e) => ts.isStringLiteralLike(e) && /^\/[a-z]/.test(e.text));
        if (paths.length >= 3) lists.push(n.getText(sf).slice(0, 80));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(lists, "route-sweep.spec.ts holds a hand-typed route list again").toEqual([]);
  });
});

describe("App.tsx route parser canaries", () => {
  const app = `
    function Router() {
      return (
        <Switch>
          <Route path="/public" component={PublicPage} />
          {/* <Route path="/commented" component={Gone} /> */}
          <Route path="/alias">{() => <Redirect to="/today" />}</Route>
          <Route path="/today">
            {() => <ProtectedRoute component={() => <OnboardingGate><TodayPage /></OnboardingGate>} />}
          </Route>
          <Route path="/leads/:id">{() => <ProtectedRoute component={LeadDetail} />}</Route>
          <Route path="/founder/x">
            {() => <FounderProtectedRoute component={() => (ok ? <X /> : <Redirect to="/founder" />)} />}
          </Route>
          <Route path="/flag">{() => <FlaggedRoute route="/flag" component={FlagPage} />}</Route>
          <>
            <Route path="/nested">{() => <ProtectedRoute component={Nested} />}</Route>
          </>
          <Route component={NotFound} />
        </Switch>
      );
    }`;
  const parsed = routesInSource(app);
  const kindOf = (p: string) => parsed.find((r) => r.path === p)?.kind;

  it("classifies each wrapper shape", () => {
    expect(kindOf("/public")).toBe("public");
    expect(kindOf("/alias")).toBe("redirect");
    expect(kindOf("/today")).toBe("customer");
    expect(kindOf("/founder/x"), "a founder page with a Redirect fallback is still a founder page").toBe("founder");
    expect(kindOf("/flag")).toBe("flagged");
    expect(kindOf("/nested"), "a Route inside a fragment was not reached").toBe("customer");
  });

  it("never reads a commented-out route, and skips the path-less catch-all", () => {
    expect(kindOf("/commented")).toBeUndefined();
    expect(parsed.map((r) => r.path).sort()).toEqual(
      ["/alias", "/flag", "/founder/x", "/leads/:id", "/nested", "/public", "/today"],
    );
  });

  it("sweeps concrete authenticated pages only, and says what it skipped", () => {
    const p = sweepPopulation(parsed);
    expect(p.customer.sort()).toEqual(["/nested", "/today"]);
    expect(p.founder).toEqual(["/founder/x"]);
    expect(p.flagged).toEqual(["/flag"]);
    expect(p.skipped.map((s) => s.path)).toEqual(["/leads/:id"]);
  });
});
