/**
 * W2-TODAY — every link the Today vertical-surfaces row can render resolves,
 * and neither Today piece carries an export nothing calls.
 *
 * 1. ROUTER. Each renderable link (every cluster not in TODAY_HELD_CLUSTERS)
 *    is walked through the parsed router (tests/helpers/clientRoutes.ts — a
 *    TypeScript parse of App.tsx, not a regex) and must land on a customer
 *    page: not a redirect, not missing, not public/founder/persona-gated, not
 *    frozen. A `flagged` page is allowed only because the component filters
 *    through isRouteEnabled at render time (pinned in the render test).
 *    The regex `<Route path=` checks the vertical gate tests used passed over
 *    two redirects (/buyer-blasts, /investor-analytics) — this one does not.
 * 2. NAV PARITY. The row exists because phones cannot open the sidebar. So
 *    every link must be one the desktop sidebar ALSO offers that fingerprint:
 *    a href/child/overflow of a NAV_MODULES module visible to it (parsed from
 *    layout-sidebar.tsx), and not hidden by sidebar-hidden-routes. Phone ⊆
 *    desktop — Today can never become a back door to a page the nav hides.
 * 3. CALL SITES. Every export of today-vertical-surfaces.ts has a production
 *    call site in client/src (a `_`-prefixed test-introspection export needs a
 *    test caller); VerticalSurfaces is rendered as JSX in today.tsx. The
 *    widgets file's exports are a FENCED register (retirement held for #467)
 *    that may only shrink, and each entry must still be uncalled.
 *
 * Vacuity floors on every population. MUTATION PROBES (each went RED, then
 * restored): restore href "/buyer-blasts" (router); restore "/investor-
 * analytics" (router); add a link the desktop nav does not offer that
 * vertical (e.g. /lead-scoring on the subdivider row) (parity); remove the <VerticalSurfaces /> mount from today.tsx (call site);
 * export an unused helper from the registry (call site).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { clientRoutes } from "../helpers/clientRoutes";
import {
  _VERTICAL_SURFACES_REGISTRY,
  TODAY_HELD_CLUSTERS,
} from "../../client/src/lib/today-vertical-surfaces";
import { resolveHiddenRoutes, type OrgInvestorType } from "../../client/src/lib/sidebar-hidden-routes";
import { isFrozenRoute } from "../../shared/feature-freeze";
import { BUSINESS_TYPE_TO_INVESTOR_TYPE } from "../../shared/models/persona-mapping";

const ROOT = path.resolve(__dirname, "../..");
const CLIENT = path.join(ROOT, "client/src");
const pathOf = (href: string) => href.split(/[?#]/)[0];

const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_TO_INVESTOR_TYPE);
const ORG_INVESTOR_TYPES: OrgInvestorType[] = ["land", "notes", "both"];

const renderable = _VERTICAL_SURFACES_REGISTRY.filter((e) => !(e.cluster.id in TODAY_HELD_CLUSTERS));

/** Every (businessType, orgInvestorType) a cluster renders for. */
function fingerprintsOf(entry: (typeof _VERTICAL_SURFACES_REGISTRY)[number]) {
  const out: Array<{ businessType: string; investorType: OrgInvestorType }> = [];
  for (const businessType of BUSINESS_TYPES)
    for (const investorType of ORG_INVESTOR_TYPES)
      if (entry.match({ businessType, investorType })) out.push({ businessType, investorType });
  return out;
}

describe("populations are real", () => {
  it("reads the whole registry, a real held register, and enough links", () => {
    expect(_VERTICAL_SURFACES_REGISTRY.length).toBeGreaterThanOrEqual(9);
    expect(renderable.length).toBeGreaterThanOrEqual(8);
    expect(renderable.flatMap((e) => e.cluster.links).length).toBeGreaterThanOrEqual(30);
    for (const id of Object.keys(TODAY_HELD_CLUSTERS)) {
      expect(_VERTICAL_SURFACES_REGISTRY.some((e) => e.cluster.id === id), `held id ${id} names no cluster`).toBe(true);
      expect(TODAY_HELD_CLUSTERS[id].length, `held ${id} needs a reason`).toBeGreaterThan(20);
    }
    for (const e of renderable) expect(fingerprintsOf(e).length, `${e.cluster.id} matches no fingerprint`).toBeGreaterThan(0);
  });

  it("no fingerprint gets more than two rows (Today is not a wall of cards)", () => {
    for (const businessType of BUSINESS_TYPES)
      for (const investorType of ORG_INVESTOR_TYPES) {
        const n = renderable.filter((e) => e.match({ businessType, investorType })).length;
        expect(n, `${businessType}/${investorType}`).toBeLessThanOrEqual(2);
      }
  });
});

describe("1. every renderable link lands on a customer page (parsed router)", () => {
  const routes = clientRoutes();
  const firstMatch = new Map<string, (typeof routes)[number]>();
  for (const r of routes) if (!firstMatch.has(r.path)) firstMatch.set(r.path, r); // Switch: first wins

  it("router population floor", () => {
    expect(routes.length).toBeGreaterThan(250);
  });

  for (const e of renderable) {
    for (const l of e.cluster.links) {
      it(`${e.cluster.id}: ${l.label} → ${l.href}`, () => {
        const r = firstMatch.get(pathOf(l.href));
        expect(r, `${l.href} is not a route`).toBeTruthy();
        expect(["customer", "flagged"], `${l.href} is a ${r!.kind} route`).toContain(r!.kind);
        expect(isFrozenRoute(pathOf(l.href)), `${l.href} is frozen`).toBe(false);
      });
    }
  }
});

// ── NAV_MODULES, parsed (not scanned) from layout-sidebar.tsx ──────────────
interface NavEntry { href: string; businessTypeOnly?: string[] }
interface ParsedModule extends NavEntry { id: string; founderOnly: boolean; children: NavEntry[] }

function parseNavModules(): ParsedModule[] {
  const file = path.join(CLIENT, "components/layout-sidebar.tsx");
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let arr: ts.ArrayLiteralExpression | undefined;
  const find = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === "NAV_MODULES" && n.initializer && ts.isArrayLiteralExpression(n.initializer)) arr = n.initializer;
    ts.forEachChild(n, find);
  };
  find(sf);
  if (!arr) throw new Error("NAV_MODULES array not found in layout-sidebar.tsx");
  const prop = (o: ts.ObjectLiteralExpression, name: string) =>
    o.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === name)?.initializer;
  const str = (e?: ts.Expression) => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined);
  const strs = (e?: ts.Expression) => (e && ts.isArrayLiteralExpression(e) ? e.elements.map((x) => str(x as ts.Expression)!).filter(Boolean) : undefined);
  const entries = (e?: ts.Expression): NavEntry[] =>
    e && ts.isArrayLiteralExpression(e)
      ? e.elements.filter(ts.isObjectLiteralExpression).map((c) => ({ href: str(prop(c, "href"))!, businessTypeOnly: strs(prop(c, "businessTypeOnly")) }))
      : [];
  return arr.elements.filter(ts.isObjectLiteralExpression).map((o) => ({
    id: str(prop(o, "id"))!,
    href: str(prop(o, "href"))!,
    businessTypeOnly: strs(prop(o, "businessTypeOnly")),
    founderOnly: prop(o, "founderOnly")?.kind === ts.SyntaxKind.TrueKeyword,
    children: [...entries(prop(o, "children")), ...entries(prop(o, "overflow"))],
  }));
}

describe("2. phone row ⊆ what the desktop sidebar offers the same fingerprint", () => {
  const modules = parseNavModules();

  it("parses the real nav model", () => {
    expect(modules.length).toBeGreaterThanOrEqual(12);
    expect(modules.every((m) => m.id && m.href)).toBe(true);
    expect(modules.filter((m) => m.businessTypeOnly?.length).length).toBeGreaterThanOrEqual(5);
    expect(modules.flatMap((m) => m.children).length).toBeGreaterThanOrEqual(40);
  });

  for (const e of renderable) {
    it(`${e.cluster.id}: every link is in that fingerprint's desktop nav`, () => {
      const fps = fingerprintsOf(e);
      let checkedCanonical = 0;
      for (const { businessType, investorType } of fps) {
        // The neutral detected axis: hides nothing on its own, so only the
        // businessType + org axes decide (the runtime filter applies all three).
        const hidden = new Set(resolveHiddenRoutes({ businessType, detectedInvestorType: "new_investor", orgInvestorType: investorType }));
        const allows = (gate?: string[]) => !gate || gate.length === 0 || gate.includes(businessType);
        const offered = new Set<string>();
        for (const m of modules) {
          if (m.founderOnly || !allows(m.businessTypeOnly)) continue;
          offered.add(m.href);
          for (const c of m.children) if (allows(c.businessTypeOnly)) offered.add(c.href);
        }
        const canonical = BUSINESS_TYPE_TO_INVESTOR_TYPE[businessType as keyof typeof BUSINESS_TYPE_TO_INVESTOR_TYPE] === investorType;
        for (const l of e.cluster.links) {
          const isHidden = hidden.has(l.href) || hidden.has(pathOf(l.href));
          // What the row would render (hidden links are dropped at runtime)
          // must be something the desktop nav offers this fingerprint.
          if (!isHidden) expect(offered.has(l.href), `${l.href} is not in the desktop nav for ${businessType}/${investorType}`).toBe(true);
          // For the vertical's own fingerprint, no link may be silently dropped.
          if (canonical) expect(isHidden, `${l.href} is nav-hidden for ${businessType}'s own fingerprint`).toBe(false);
        }
        checkedCanonical += canonical ? 1 : 0;
      }
      expect(checkedCanonical, `${e.cluster.id} matched no canonical fingerprint`).toBeGreaterThan(0);
    });
  }
});

// ── Call sites (parsed imports + identifier references) ───────────────────
function clientFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  walk(CLIENT);
  return out;
}

function exportedNames(file: string): string[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names: string[] = [];
  for (const s of sf.statements) {
    const exported = ts.canHaveModifiers(s) && ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) names.push(d.name.getText(sf));
    else if ((ts.isFunctionDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isClassDeclaration(s)) && s.name) names.push(s.name.text);
  }
  return names;
}

/** name → files (other than the target) that import it from the target AND reference it beyond the import. */
function callSites(target: string, files: string[]): Map<string, string[]> {
  const targetNoExt = target.replace(/\.tsx?$/, "");
  const alias = "@/" + path.relative(CLIENT, targetNoExt).split(path.sep).join("/");
  const out = new Map<string, string[]>();
  for (const f of files) {
    if (f === target) continue;
    const src = fs.readFileSync(f, "utf8");
    if (!src.includes(path.basename(targetNoExt))) continue;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const s of sf.statements) {
      if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
      const spec = s.moduleSpecifier.text;
      const resolved = spec.startsWith(".") ? path.resolve(path.dirname(f), spec) : spec;
      if (resolved !== alias && resolved !== targetNoExt) continue;
      const bindings = s.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const el of bindings.elements) {
        const imported = (el.propertyName ?? el.name).text;
        const local = el.name.text;
        let refs = 0;
        const visit = (n: ts.Node) => {
          if (ts.isIdentifier(n) && n.text === local && n !== el.name && !ts.isImportSpecifier(n.parent)) refs++;
          ts.forEachChild(n, visit);
        };
        visit(sf);
        if (refs > 0) out.set(imported, [...(out.get(imported) ?? []), path.relative(ROOT, f)]);
      }
    }
  }
  return out;
}

const REGISTRY_FILE = path.join(CLIENT, "lib/today-vertical-surfaces.ts");
const WIDGETS_FILE = path.join(CLIENT, "components/dashboard/type-specific-widgets.tsx");

/**
 * FENCED — exports of type-specific-widgets.tsx that nothing calls. The file
 * was never mounted (no mount in any sampled today.tsx or dashboard.tsx). Its
 * retirement is held for the live Fix-and-flip lane, whose #467 (merged
 * 2026-11-08) added a flag link inside FlipperWidgets. May only shrink: delete
 * the file and this register together (see reports/w2-today-surfaces.md).
 */
const FENCED_UNCALLED: Record<string, string> = {
  TypeSpecificWidgets: "retirement held for the Fix-and-flip lane (#467)",
  TypeSpecificWidgetsProps: "retirement held for the Fix-and-flip lane (#467)",
};
const FENCED_BASELINE = 2;

describe("3. no export without a call site (the two Today files)", () => {
  const files = clientFiles();

  it("reads the real client population", () => {
    expect(files.length).toBeGreaterThan(400);
  });

  it("every export of today-vertical-surfaces.ts has a caller", () => {
    const names = exportedNames(REGISTRY_FILE);
    expect(names.length).toBeGreaterThanOrEqual(4);
    const prod = callSites(REGISTRY_FILE, files);
    const tests = callSites(REGISTRY_FILE, [
      ...fs.readdirSync(path.join(ROOT, "tests/unit")).map((n) => path.join(ROOT, "tests/unit", n)).filter((p) => /\.tsx?$/.test(p)),
    ]);
    for (const n of names) {
      if (n.startsWith("_")) expect(tests.get(n)?.length ?? 0, `${n} (test-introspection export) has no test caller`).toBeGreaterThan(0);
      else expect(prod.get(n)?.length ?? 0, `${n} has no production call site in client/src`).toBeGreaterThan(0);
    }
  });

  it("VerticalSurfaces is rendered as JSX on the Today page", () => {
    const file = path.join(CLIENT, "pages/today.tsx");
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let rendered = 0;
    const visit = (n: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "VerticalSurfaces") rendered++;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(rendered).toBe(1);
  });

  it("type-specific-widgets.tsx: uncalled exports are exactly the fenced register, which only shrinks", () => {
    const names = exportedNames(WIDGETS_FILE);
    expect(names.length).toBeGreaterThan(0);
    const prod = callSites(WIDGETS_FILE, files);
    const uncalled = names.filter((n) => !(prod.get(n)?.length));
    expect(uncalled.sort()).toEqual(Object.keys(FENCED_UNCALLED).sort());
    expect(Object.keys(FENCED_UNCALLED).length).toBeLessThanOrEqual(FENCED_BASELINE);
  });
});
