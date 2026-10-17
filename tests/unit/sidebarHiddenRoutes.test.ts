/**
 * Doors doctrine ratchet (CLAUDE.md): "Persona changes only the CONTENT
 * behind each door … never the doors themselves."
 *
 * The 2026-07 design panel found the five-doors doctrine breached in
 * production: sidebar-hidden-routes hid /maps (the Map door) for six
 * business types and /money+/finance for detected wholesalers, while the
 * mobile bottom nav (deliberately unfiltered) kept all five — the same
 * account saw four doors on desktop and five on the phone. This suite
 * pins the cure: no combination of persona axes may ever hide a door,
 * while secondary-route gating keeps working.
 *
 * 2026-08-16 — the first block asks a question about a LIST ("is this
 * href hidden?"), which a door can be destroyed without answering: hide a
 * door's whole CONTENTS and layout-sidebar.tsx drops the module as an
 * empty container. The third block therefore runs the real visibility
 * predicate over parsed NAV_MODULES and asserts each door still RENDERS.
 */
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  resolveHiddenRoutes,
  isRouteHidden,
  _SIDEBAR_HIDDEN_ROUTES_REGISTRY,
  type InvestorType,
  type OrgInvestorType,
} from "../../client/src/lib/sidebar-hidden-routes";
import { MOBILE_DOORS } from "../../client/src/lib/nav-items";
import { BUSINESS_TYPE_IDS } from "../../shared/business-types";
// The Today-queue block walks the whole server tree; its cost scales with the
// repo, so the budget is declared, not inherited (repoSweepsDeclareTheirBudget).
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const DOORS = ["/today", "/maps", "/deals", "/pipeline", "/money", "/finance", "/ai", "/inbox", "/settings"];

const ALL_BUSINESS_TYPES = Object.keys(_SIDEBAR_HIDDEN_ROUTES_REGISTRY.byBusinessType);
const ALL_DETECTED = Object.keys(
  _SIDEBAR_HIDDEN_ROUTES_REGISTRY.byDetectedInvestorType,
) as InvestorType[];
const ALL_ORG = Object.keys(
  _SIDEBAR_HIDDEN_ROUTES_REGISTRY.byOrgInvestorType,
) as OrgInvestorType[];

describe("five-doors doctrine — doors are unhideable", () => {
  it("no persona-axis combination hides any door", () => {
    for (const businessType of [undefined, ...ALL_BUSINESS_TYPES]) {
      for (const detectedInvestorType of ALL_DETECTED) {
        for (const orgInvestorType of ALL_ORG) {
          const hidden = resolveHiddenRoutes({ businessType, detectedInvestorType, orgInvestorType });
          for (const door of DOORS) {
            expect(hidden, `${businessType}/${detectedInvestorType}/${orgInvestorType} hides door ${door}`).not.toContain(door);
          }
        }
      }
    }
  });

  it("secondary-route gating still works (wholesaler loses portfolio surfaces, not doors)", () => {
    const hidden = resolveHiddenRoutes({
      businessType: "residential_wholesaler",
      detectedInvestorType: "residential_wholesaler",
      orgInvestorType: "both",
    });
    expect(hidden).toContain("/portfolio");
    expect(hidden).toContain("/land-credit");
    expect(hidden).not.toContain("/maps");
    expect(hidden).not.toContain("/money");
    expect(hidden).not.toContain("/finance");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Doors must RENDER, not merely be absent from the hidden list
// (gap closed 2026-08-16)
//
// The suite above asks a question about a LIST: "is this href in
// resolveHiddenRoutes()?" A door can be destroyed without ever appearing
// in that list. layout-sidebar.tsx drops any module whose children AND
// overflow were all filtered away ("purely a container"), so hiding a
// door's CONTENTS deletes the door itself:
//
//   byBusinessType.residential_wholesaler += ["/properties", "/listings",
//   "/documents"]
//
// names no protected door — and those three ARE the Map door's entire
// contents (children ["/properties"], overflow ["/listings",
// "/documents"]). Every assertion above stays green while residential
// wholesalers lose the Map door on desktop and keep it on their phone —
// the exact desktop/mobile disagreement the 2026-07 design panel found.
//
// So this block runs the REAL visibility predicate — NAV_MODULES parsed
// out of layout-sidebar.tsx, filtered by the same rules the component
// applies — over every persona-axis combination, and asserts each door
// still renders. The replica is pinned to the component source below, so
// a change to the real filter can't leave this test asserting yesterday's
// logic.
// ─────────────────────────────────────────────────────────────────────

const LAYOUT_SIDEBAR = path.resolve(__dirname, "../../client/src/components/layout-sidebar.tsx");
const LAYOUT_SIDEBAR_SRC = fs.readFileSync(LAYOUT_SIDEBAR, "utf-8");

/** Char stream that skips string literals and comments, so brace/bracket
 *  depth is counted over CODE only. */
function* codeChars(s: string, from = 0): Generator<[number, string]> {
  let i = from;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === "/" && n === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < s.length) { if (s[i] === "\\") { i += 2; continue; } if (s[i] === q) { i++; break; } i++; }
      continue;
    }
    yield [i, c];
    i++;
  }
}

/** Source text of every object literal that is a direct element of the
 *  array whose opening `[` is at `openBracketIdx`. */
function arrayElementObjects(s: string, openBracketIdx: number): string[] {
  const spans: [number, number][] = [];
  let depth = 0;
  let objStart = -1;
  for (const [i, c] of codeChars(s, openBracketIdx)) {
    if (c === "[" || c === "{" || c === "(") {
      depth++;
      if (c === "{" && depth === 2 && objStart === -1) objStart = i;
    } else if (c === "]" || c === "}" || c === ")") {
      if (c === "}" && objStart !== -1 && depth === 2) { spans.push([objStart, i + 1]); objStart = -1; }
      depth--;
      if (depth === 0) return spans.map(([a, b]) => s.slice(a, b));
    }
  }
  throw new Error("unterminated array literal while parsing NAV_MODULES");
}

/** Top-level `key: value` pairs of one object literal, values raw. */
function objectProps(objSrc: string): Record<string, string> {
  const chars = [...codeChars(objSrc)];
  const out: Record<string, string> = {};
  let depth = 0;
  for (let k = 0; k < chars.length; k++) {
    const [i, c] = chars[k];
    if (c === "{" || c === "[" || c === "(") { depth++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; continue; }
    if (depth !== 1 || c !== ":") continue;
    const key = objSrc.slice(0, i).match(/([A-Za-z0-9_$]+)\s*$/);
    if (!key) continue;
    let d = 0;
    let end = objSrc.length;
    for (let j = k + 1; j < chars.length; j++) {
      const [ii, cc] = chars[j];
      if (cc === "{" || cc === "[" || cc === "(") d++;
      else if (cc === "}" || cc === "]" || cc === ")") { if (d === 0) { end = ii; break; } d--; }
      else if (cc === "," && d === 0) { end = ii; break; }
    }
    out[key[1]] = objSrc.slice(i + 1, end).trim();
  }
  return out;
}

const unquote = (v?: string) => (v && /^"/.test(v) ? v.slice(1, -1) : undefined);
const quotedList = (v?: string) =>
  v === undefined ? undefined : [...v.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

interface ParsedNavChild {
  href: string;
  businessTypeOnly?: string[];
}
interface ParsedNavModule {
  id: string;
  href: string;
  founderOnly: boolean;
  businessTypeOnly?: string[];
  children?: ParsedNavChild[];
  overflow?: ParsedNavChild[];
}

const NAV_MODULES_DECL = "const NAV_MODULES: NavModule[] = [";

function parseNavModules(): ParsedNavModule[] {
  const decl = LAYOUT_SIDEBAR_SRC.indexOf(NAV_MODULES_DECL);
  expect(decl, "NAV_MODULES declaration must exist in layout-sidebar.tsx").toBeGreaterThan(-1);
  // The array's own "[" is the last char of the declaration — NOT
  // indexOf("[", decl), which would land on the "[]" of the type.
  const open = decl + NAV_MODULES_DECL.length - 1;
  return arrayElementObjects(LAYOUT_SIDEBAR_SRC, open).map((objSrc) => {
    const p = objectProps(objSrc);
    const list = (key: string): ParsedNavChild[] | undefined =>
      p[key] === undefined
        ? undefined
        : arrayElementObjects(p[key], 0).map((childSrc) => {
            const cp = objectProps(childSrc);
            return { href: unquote(cp.href)!, businessTypeOnly: quotedList(cp.businessTypeOnly) };
          });
    return {
      id: unquote(p.id)!,
      href: unquote(p.href)!,
      founderOnly: p.founderOnly === "true",
      businessTypeOnly: quotedList(p.businessTypeOnly),
      children: list("children"),
      overflow: list("overflow"),
    };
  });
}

/** Replica of layout-sidebar.tsx's `childBusinessTypeAllows`. */
function childAllowed(child: ParsedNavChild, businessType?: string): boolean {
  if (!child.businessTypeOnly || child.businessTypeOnly.length === 0) return true;
  return !!businessType && child.businessTypeOnly.includes(businessType);
}

/** Replica of the child/overflow filter in layout-sidebar.tsx (flags on). */
function renderedEntries(
  module: ParsedNavModule,
  opts: { businessType?: string; hidden: string[] },
): { children?: ParsedNavChild[]; overflow?: ParsedNavChild[] } {
  const keep = (c: ParsedNavChild) => !isRouteHidden(c.href, opts.hidden) && childAllowed(c, opts.businessType);
  return { children: module.children?.filter(keep), overflow: module.overflow?.filter(keep) };
}

/**
 * Replica of the `visibleModules` filter in layout-sidebar.tsx (feature
 * flags assumed on — this suite is about persona gating). Returns true when
 * the module actually renders in the desktop rail.
 */
function moduleRenders(
  module: ParsedNavModule,
  opts: { businessType?: string; hidden: string[]; isFounder: boolean },
): boolean {
  const { businessType, hidden, isFounder } = opts;
  const { children, overflow } = renderedEntries(module, { businessType, hidden });
  if (module.founderOnly && !isFounder) return false;
  if (module.businessTypeOnly && module.businessTypeOnly.length > 0) {
    if (!businessType || !module.businessTypeOnly.includes(businessType)) return false;
  }
  if (isRouteHidden(module.href, hidden)) return false;
  if (children !== undefined) {
    const hasPrimary = children.length > 0;
    const hasOverflow = (overflow?.length ?? 0) > 0;
    if (!hasPrimary && !hasOverflow) return false;
  }
  return true;
}

describe("five-doors doctrine — doors are unhideable BY ANY MEANS", () => {
  const modules = parseNavModules();
  const byId = new Map(modules.map((m) => [m.id, m]));
  // The five doors (+ Inbox/Settings, reachable from the top bar). Door ids
  // come from nav-items.ts so this can't drift from the mobile bar.
  const DOOR_IDS = [...MOBILE_DOORS, "inbox", "settings"];
  // Every businessType the app can actually hold, not just the ones that
  // happen to have a hidden-routes entry today.
  const ALL_BT: (string | undefined)[] = [
    undefined,
    ...new Set<string>([...BUSINESS_TYPE_IDS, ...ALL_BUSINESS_TYPES]),
  ];

  it("the NAV_MODULES parse sees the real doors and their real contents", () => {
    // Vacuity guard: if the parse degrades (renamed const, restructured
    // literal) the door-collapse rule below can never fire and the suite
    // would go green by seeing nothing.
    expect(modules.length).toBeGreaterThanOrEqual(10);
    for (const id of DOOR_IDS) {
      expect(byId.get(id), `door "${id}" must exist as a NAV_MODULES entry`).toBeTruthy();
      expect(byId.get(id)!.href).toMatch(/^\//);
    }
    const map = byId.get("map")!;
    expect(map.children?.map((c) => c.href)).toContain("/properties");
    expect(map.overflow?.map((c) => c.href)).toEqual(
      expect.arrayContaining(["/listings", "/documents"]),
    );
    const deals = byId.get("deals")!;
    expect(deals.children!.length).toBeGreaterThanOrEqual(2);
    expect(deals.overflow!.length).toBeGreaterThanOrEqual(5);
  });

  it("no persona-axis combination collapses a door (contents hidden ⇒ door gone)", () => {
    let checked = 0;
    for (const businessType of ALL_BT) {
      for (const detectedInvestorType of ALL_DETECTED) {
        for (const orgInvestorType of ALL_ORG) {
          const hidden = resolveHiddenRoutes({ businessType, detectedInvestorType, orgInvestorType });
          for (const id of DOOR_IDS) {
            const door = byId.get(id)!;
            const renders = moduleRenders(door, { businessType, hidden, isFounder: false });
            expect(
              renders,
              `${businessType}/${detectedInvestorType}/${orgInvestorType} loses the "${id}" door (${door.href}) — ` +
                `its href survives resolveHiddenRoutes but its children+overflow were all hidden, ` +
                `so layout-sidebar.tsx drops the module as an empty container`,
            ).toBe(true);
            checked++;
          }
        }
      }
    }
    // Non-vacuous: 16 businessTypes × 8 detected × 3 org × 7 doors.
    expect(checked).toBeGreaterThan(1000);
  });

  it("the replica above still matches the real filter in layout-sidebar.tsx", () => {
    // moduleRenders() is a copy of logic that lives inside the Sidebar
    // component (it can't be imported — these tests run in the node env).
    // These anchors fail if the real filter is edited, forcing the replica
    // to be re-derived instead of silently asserting yesterday's rules.
    for (const anchor of [
      "!isRouteHidden(child.href, hiddenForType) &&",
      "childBusinessTypeAllows(child, businessType)",
      "if (module.founderOnly && !isFounder) return false;",
      "if (isRouteHidden(module.href, hiddenForType)) return false;",
      "if (module.children !== undefined) {",
      "const hasPrimary = module.children.length > 0;",
      "const hasOverflow = (module.overflow?.length ?? 0) > 0;",
      "if (!hasPrimary && !hasOverflow) return false;",
    ]) {
      expect(
        LAYOUT_SIDEBAR_SRC,
        `visibility rule "${anchor}" changed — update moduleRenders() in this file to match`,
      ).toContain(anchor);
    }
  });
});

describe("landlord family (V1, founder ruling #11) — siblings share buy_and_hold's profile", () => {
  const SIBLINGS = ["short_term_rental", "multifamily", "mobile_home"] as const;

  it("STR / multifamily / mobile-home resolve to the exact same hidden set as buy_and_hold", () => {
    const base = resolveHiddenRoutes({
      businessType: "buy_and_hold",
      detectedInvestorType: "new_investor",
      orgInvestorType: "both",
    });
    for (const sibling of SIBLINGS) {
      const hidden = resolveHiddenRoutes({
        businessType: sibling,
        detectedInvestorType: "new_investor",
        orgInvestorType: "both",
      });
      expect([...hidden].sort(), `${sibling} must match buy_and_hold`).toEqual([...base].sort());
    }
  });

  it("siblings hide note-investor surfaces like buy_and_hold (not the old /maps-only profile)", () => {
    for (const sibling of SIBLINGS) {
      const hidden = resolveHiddenRoutes({
        businessType: sibling,
        detectedInvestorType: "new_investor",
        orgInvestorType: "both",
      });
      expect(hidden, sibling).toContain("/notes");
      expect(hidden, sibling).toContain("/notes/pipeline");
      expect(hidden, sibling).toContain("/borrower-portal");
      expect(hidden, sibling).toContain("/land-credit");
      // /maps is in the registry entry but is a protected door — stays visible.
      expect(hidden, sibling).not.toContain("/maps");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// The catalog and the rail agree (2026-10-12).
//
// The persona walk found /campaigns in a note-investor's rail although the
// notes hidden set names it. Two shapes, both fixed here and pinned below:
//   1. Direct Mail and Sequences became channel tabs of /campaigns
//      (`/campaigns?channel=…`); the rail compared hrefs by exact string, so
//      a hidden /campaigns did not hide links INTO /campaigns.
//   2. While feature flags loaded, the rail skipped the persona filter
//      entirely — land Outreach and every businessTypeOnly vertical showed
//      for that window.
// ─────────────────────────────────────────────────────────────────────
describe("persona gating — what the catalog hides, the rail does not render", () => {
  const modules = parseNavModules();
  const pathOf = (href: string) => href.split(/[?#]/)[0];

  it("no rendered entry links into a route its persona hides (every axis combination)", () => {
    let checked = 0;
    for (const businessType of [undefined, ...ALL_BUSINESS_TYPES]) {
      for (const detectedInvestorType of ALL_DETECTED) {
        for (const orgInvestorType of ALL_ORG) {
          const hidden = resolveHiddenRoutes({ businessType, detectedInvestorType, orgInvestorType });
          for (const m of modules) {
            if (!moduleRenders(m, { businessType, hidden, isFounder: false })) continue;
            const { children, overflow } = renderedEntries(m, { businessType, hidden });
            for (const c of [...(children ?? []), ...(overflow ?? [])]) {
              expect(
                hidden.includes(pathOf(c.href)),
                `${businessType}/${detectedInvestorType}/${orgInvestorType}: "${m.id}" renders ${c.href}, a route the persona hides`,
              ).toBe(false);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("a note-investor org's Deals door offers no land outreach (the walk's /campaigns finding)", () => {
    const hidden = resolveHiddenRoutes({ businessType: "note_investor", detectedInvestorType: "note_investor", orgInvestorType: "notes" });
    const deals = modules.find((m) => m.id === "deals")!;
    const { children, overflow } = renderedEntries(deals, { businessType: "note_investor", hidden });
    const hrefs = [...(children ?? []), ...(overflow ?? [])].map((c) => c.href);
    // Vacuity: the Deals module really does carry /campaigns entries to hide.
    expect([...(deals.children ?? []), ...(deals.overflow ?? [])].map((c) => c.href).filter((h) => pathOf(h) === "/campaigns").length).toBeGreaterThanOrEqual(2);
    expect(hrefs.filter((h) => ["/campaigns", "/outreach/mail"].includes(pathOf(h)))).toEqual([]);
    // …and the door itself still renders (contents, not doors).
    expect(moduleRenders(deals, { businessType: "note_investor", hidden, isFounder: false })).toBe(true);
  });

  it("isRouteHidden hides links into a hidden route, never a different route", () => {
    expect(isRouteHidden("/campaigns?channel=direct-mail", ["/campaigns"])).toBe(true);
    expect(isRouteHidden("/campaigns#ab-tests", ["/campaigns"])).toBe(true);
    expect(isRouteHidden("/campaigns", ["/campaigns"])).toBe(true);
    expect(isRouteHidden("/campaigns-archive", ["/campaigns"])).toBe(false);
    expect(isRouteHidden("/deals", ["/campaigns"])).toBe(false);
  });

  it("the rail applies persona gating while feature flags load (no bypass branch)", () => {
    const sf = ts.createSourceFile("layout-sidebar.tsx", LAYOUT_SIDEBAR_SRC, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let init: ts.Expression | undefined;
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "visibleModules") init = n.initializer;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(init, "visibleModules must be declared in layout-sidebar.tsx").toBeTruthy();
    // ONE filter expression: not a `flagsLoading ? <unfiltered> : <filtered>` fork.
    let e: ts.Expression = init!;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    expect(ts.isConditionalExpression(e), "visibleModules forks on a condition — a branch may skip persona gating").toBe(false);
    const text = init!.getText(sf);
    expect(text).toContain("isRouteHidden(child.href, hiddenForType)");
    expect(text).toContain("childBusinessTypeAllows(child, businessType)");
    expect(text).toContain("module.businessTypeOnly");
  });
});

// ─────────────────────────────────────────────────────────────────────
// The Today door must not send a persona into a route it hides (2026-10-12).
//
// After the rail was fixed, the persona walk still found /campaigns on a
// note-investor's Today: the server's priority builder emitted "Send a direct
// mail campaign" → /campaigns for every org. Population: every server file
// that emits an `actionUrl` literal into a route the notes set hides.
// ─────────────────────────────────────────────────────────────────────
describe("Today's queue never links a persona into a route it hides", () => {
  const NOTES_HIDDEN = resolveHiddenRoutes({ detectedInvestorType: "note_investor", orgInvestorType: "notes" });
  const SERVER = path.resolve(__dirname, "../../server");
  /** Emitters that gate the suggestion on the org's investor type. */
  const GATED = ["routes-today.ts", "routes-dashboard.ts"];
  /** Emitters deliberately left as-is, with the reason. */
  const EXEMPT: Record<string, string> = {
    "routes-organization.ts": "opt-in land playbook templates — the user picks a land playbook; not a persona suggestion",
  };

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(dir, e.name)))
        : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []);
  }

  /** actionUrl string literals whose route the notes set hides, with their nearest enclosing if-condition. */
  function hiddenActionUrls(file: string): Array<{ url: string; condition: string | null }> {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("actionUrl")) return [];
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const out: Array<{ url: string; condition: string | null }> = [];
    const visit = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "actionUrl" && ts.isStringLiteral(n.initializer)
          && isRouteHidden(n.initializer.text, NOTES_HIDDEN)) {
        let p: ts.Node | undefined = n.parent;
        while (p && !ts.isIfStatement(p) && !ts.isFunctionLike(p)) p = p.parent;
        out.push({ url: n.initializer.text, condition: p && ts.isIfStatement(p) ? p.expression.getText(sf) : null });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  it("every emitter is classified, and the gated ones condition on the org's investor type", () => {
    const found = new Map<string, Array<{ url: string; condition: string | null }>>();
    for (const f of walk(SERVER)) {
      const hits = hiddenActionUrls(f);
      if (hits.length) found.set(path.basename(f), hits);
    }
    // Vacuity: both queue builders are read.
    for (const g of GATED) expect(found.has(g), `${g} must emit the campaign suggestion this gate reads`).toBe(true);
    const unclassified = [...found.keys()].filter((f) => !GATED.includes(f) && !(f in EXEMPT));
    expect(unclassified, "a server file suggests a route the notes persona hides — gate it or classify it").toEqual([]);
    for (const g of GATED) {
      for (const h of found.get(g)!) {
        expect(h.condition ?? "", `${g}: ${h.url} must be suggested only to orgs that run land mail`).toMatch(/investorType|runsLandMail/);
      }
    }
    const today = fs.readFileSync(path.join(SERVER, "routes-today.ts"), "utf8");
    expect(today).toMatch(/const runsLandMail = [^;]*investorType !== "notes"/);
  });

  it("the queue card filters rows whose action the persona hides (client guard)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../client/src/components/today/DecisionQueue.tsx"), "utf8");
    const sf = ts.createSourceFile("DecisionQueue.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let init = "";
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && n.name.getText(sf) === "visible" && n.initializer) init = n.initializer.getText(sf);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(init).toContain("isRouteHidden(it.actionUrl, hiddenRoutes)");
    // …and the Today page actually supplies the persona's hidden set.
    const today = fs.readFileSync(path.resolve(__dirname, "../../client/src/pages/today.tsx"), "utf8");
    const tsf = ts.createSourceFile("today.tsx", today, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let passes = false;
    const v2 = (n: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(tsf) === "DecisionQueue") {
        passes ||= n.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText(tsf) === "hiddenRoutes");
      }
      ts.forEachChild(n, v2);
    };
    v2(tsf);
    expect(passes, "TodayPage must pass hiddenRoutes to DecisionQueue").toBe(true);
    expect(today).toMatch(/const hiddenRoutes = useHiddenRoutes\(\)/);
  });
});
