/**
 * The client router's routes, read from client/src/App.tsx — the source of
 * truth for which pages exist — rather than typed out by hand.
 *
 * tests/e2e/route-sweep.spec.ts used to carry a hand-curated list of 58 paths.
 * A list like that answers "do the pages someone remembered still render", not
 * "do the pages render": a page added to App.tsx after the list was written is
 * outside the sweep, and an entry whose route has since become a redirect is
 * swept as though it were a page. Both read as a green sweep.
 *
 * Parsed with TypeScript, not scanned, so a commented-out `<Route>` is never a
 * route and a `path="…"` string elsewhere in the file is never a path. Each
 * `<Route path="…">` is classified by the wrapper it renders:
 *
 *   founder   — <FounderProtectedRoute …>
 *   customer  — <ProtectedRoute …>
 *   flagged   — <FlaggedRoute …> (renders NotFound while its flag is off)
 *   persona   — <PersonaRoute …> (renders NotFound for other personas)
 *   redirect  — <Redirect …> and nothing else: an alias, not a page
 *   public    — none of the above (a bare `component={…}` or children)
 *
 * A route is classified by the FIRST of those wrappers found in its subtree,
 * in the order listed, so a founder route whose component happens to contain a
 * <Redirect> fallback is still a founder route.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// import.meta, not __dirname: Playwright loads this module as ESM (the
// package is "type": "module"), where __dirname does not exist.
export const APP_TSX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/src/App.tsx");

export type RouteKind = "founder" | "customer" | "flagged" | "persona" | "redirect" | "public";

export interface ClientRoute {
  path: string;
  kind: RouteKind;
  /** The path has a `:param` or wildcard, so it has no single URL to visit. */
  parameterised: boolean;
  line: number;
}

const WRAPPER_ORDER: Array<[string, RouteKind]> = [
  ["FounderProtectedRoute", "founder"],
  ["ProtectedRoute", "customer"],
  ["FlaggedRoute", "flagged"],
  ["PersonaRoute", "persona"],
  ["Redirect", "redirect"],
];

function tagName(node: ts.Node): string | null {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return null;
}

function attributesOf(node: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxAttributes {
  return ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
}

function stringAttr(node: ts.JsxElement | ts.JsxSelfClosingElement, name: string): string | null {
  for (const a of attributesOf(node).properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== name || !a.initializer) continue;
    if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
    if (ts.isJsxExpression(a.initializer) && a.initializer.expression) {
      const e = a.initializer.expression;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    }
  }
  return null;
}

/** Every JSX tag name rendered anywhere inside `node` (attributes included). */
function tagsWithin(node: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    const t = tagName(n);
    if (t) out.add(t);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return out;
}

/** Parse an App.tsx-shaped source. Exported for the canaries. */
export function routesInSource(source: string, fileName = "App.tsx"): ClientRoute[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: ClientRoute[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && tagName(node) === "Route") {
      const p = stringAttr(node, "path");
      if (p !== null) {
        const inner = tagsWithin(node);
        const kind = WRAPPER_ORDER.find(([tag]) => inner.has(tag))?.[1] ?? "public";
        out.push({
          path: p,
          kind,
          parameterised: /[:*]/.test(p),
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function clientRoutes(): ClientRoute[] {
  return routesInSource(fs.readFileSync(APP_TSX, "utf8"), APP_TSX);
}

/**
 * Routes the authenticated broken-interaction sweep cannot visit as a plain
 * URL, with the reason. A parameterised route is excluded automatically; this
 * list is for concrete paths only, and every entry must still be a route —
 * the population test fails on a stale entry.
 */
export const SWEEP_EXCLUDED: Record<string, string> = {};

export interface SweepPopulation {
  customer: string[];
  founder: string[];
  /** Feature-flagged pages: swept, but a NotFound there means "flag off", not a regression. */
  flagged: string[];
  /** Routes deliberately not swept, by reason — printed so coverage is never overstated. */
  skipped: Array<{ path: string; why: string }>;
}

/** The sweep's population: every concrete authenticated page App.tsx declares. */
export function sweepPopulation(routes: ClientRoute[] = clientRoutes()): SweepPopulation {
  const pop: SweepPopulation = { customer: [], founder: [], flagged: [], skipped: [] };
  const seen = new Set<string>();
  for (const r of routes) {
    if (seen.has(r.path)) continue; // wouter's Switch renders the first match only
    seen.add(r.path);
    if (r.kind === "redirect" || r.kind === "public") continue; // not an authenticated page
    if (r.parameterised) {
      pop.skipped.push({ path: r.path, why: "parameterised — no single URL to visit" });
      continue;
    }
    if (SWEEP_EXCLUDED[r.path]) {
      pop.skipped.push({ path: r.path, why: SWEEP_EXCLUDED[r.path] });
      continue;
    }
    if (r.kind === "persona") {
      pop.skipped.push({ path: r.path, why: "persona-gated — NotFound for the sweep user's persona is correct" });
      continue;
    }
    if (r.kind === "founder") pop.founder.push(r.path);
    else if (r.kind === "flagged") pop.flagged.push(r.path);
    else pop.customer.push(r.path);
  }
  return pop;
}

/**
 * Floors, measured 2026-10-07: customer 92, founder 62, flagged 13 (of 300
 * declared routes; 82 concrete redirects, 26 concrete public pages and 25
 * parameterised routes are outside the sweep). A parser that stops matching a
 * wrapper reads exactly like that wrapper's routes having been deleted, so
 * each kind is floored, not only the total. Lower a floor only when routes are
 * genuinely consolidated, in the same change.
 */
export const SWEEP_FLOORS = { customer: 85, founder: 55, flagged: 10 } as const;
