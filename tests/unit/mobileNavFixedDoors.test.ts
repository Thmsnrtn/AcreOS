/**
 * Mobile five-door doctrine lock (Krieger, 2026-06-08).
 *
 * CLAUDE.md mandates the customer nav is EXACTLY five fixed doors
 * (Today · Map · Deals · Finance · Pax) — identical for every persona on
 * every device. The mobile bottom bar must render those doors from
 * MOBILE_DOORS and nothing else.
 *
 * Before this change, Settings → Appearance had a "Mobile Bottom Bar"
 * customizer and a per-persona `mobileItemsForPersona()` layer that the
 * actual <MobileBottomNav> never consumed — a control that LIED. This
 * suite locks in the resolution:
 *   1. MOBILE_DOORS is exactly the five canonical doors, in order.
 *   2. Every door id resolves to a real nav item + href.
 *   3. <MobileBottomNav> renders from MOBILE_DOORS and does NOT read any
 *      persona/preferences override.
 *   4. The dead persona-divergent layer is gone (function + per-device
 *      customizer + the orphaned hook/customizer files).
 *
 * Tests run in the node env (no DOM), so we assert against the real
 * MOBILE_DOORS/NAV_ITEM_MAP exports plus source-shape contracts — the
 * same pattern as critical-path-render.test.ts and uiSnapshots.test.ts.
 *
 * 2026-08-16 — extended past nav-items.ts: the last block parses
 * NAV_MODULES out of layout-sidebar.tsx (the file that renders the desktop
 * rail) and holds the top-level entries to the same door model, because
 * every existing door gate read nav-items.ts only.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { MOBILE_DOORS, NAV_ITEM_MAP, DEFAULT_SIDEBAR_ITEMS } from "@/lib/nav-items";
import { resolveHiddenRoutes } from "@/lib/sidebar-hidden-routes";

const CLIENT = path.resolve(__dirname, "../../client/src");
const LAYOUT_SIDEBAR = path.join(CLIENT, "components/layout-sidebar.tsx");

describe("Mobile nav — five fixed doors doctrine", () => {
  it("MOBILE_DOORS is exactly the five canonical doors, in order", () => {
    expect(MOBILE_DOORS).toEqual(["today", "map", "deals", "money", "ai-hub"]);
  });

  it("every door id resolves to a real nav item with an href", () => {
    for (const id of MOBILE_DOORS) {
      const item = NAV_ITEM_MAP.get(id);
      expect(item, `door "${id}" must resolve in NAV_ITEM_MAP`).toBeTruthy();
      expect(item!.href).toMatch(/^\//);
    }
  });

  it("the five doors map to Today / Map / Deals / Finance / Pax surfaces", () => {
    const hrefs = MOBILE_DOORS.map((id) => NAV_ITEM_MAP.get(id)!.href);
    expect(hrefs).toEqual(["/today", "/maps", "/deals", "/money", "/ai"]);
  });
});

describe("Mobile nav — dead persona-divergent layer is gone", () => {
  it("nav-items.ts no longer exports the per-persona mobile layer", () => {
    const src = fs.readFileSync(path.join(CLIENT, "lib/nav-items.ts"), "utf-8");
    expect(src).not.toContain("mobileItemsForPersona");
    expect(src).not.toContain("DEFAULT_MOBILE_ITEMS");
  });

  it("the orphaned mobile nav-preferences hook + customizer are deleted", () => {
    expect(fs.existsSync(path.join(CLIENT, "hooks/use-nav-preferences.ts"))).toBe(false);
    expect(fs.existsSync(path.join(CLIENT, "components/nav-customizer.tsx"))).toBe(false);
  });

  it("Settings → Appearance no longer renders a nav customizer that lies", () => {
    const src = fs.readFileSync(path.join(CLIENT, "components/settings/appearance-panel.tsx"), "utf-8");
    expect(src).not.toContain("useNavPreferences");
    expect(src).not.toContain("NavCustomizer");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Desktop rail — NAV_MODULES in layout-sidebar.tsx  (gap closed 2026-08-16)
//
// The doors doctrine used to be enforced ONLY on nav-items.ts: the checks
// above read MOBILE_DOORS / DEFAULT_SIDEBAR_ITEMS, and nothing read the
// file that actually renders the desktop rail. So the SAME product
// decision — "add a sixth top-level entry" — failed two tests when it was
// written into nav-items.ts and passed the entire suite when it was
// written into NAV_MODULES in layout-sidebar.tsx. An agent told "add the
// Syndication surface" picked whichever file it opened first; only one of
// those coin flips was caught.
//
// NAV_MODULES is parsed out of the .tsx by brace depth rather than
// imported: these tests run in the node env, and importing
// layout-sidebar.tsx would pull wouter/framer-motion/Clerk hooks and the
// whole component graph. Same source-shape pattern as the MobileBottomNav
// contracts above and landlordFamilyGates.test.ts.
//
// MEASURED against the real source (not pasted from a review note): 15
// top-level modules, of which 8 — not 7 — carry neither `founderOnly` nor
// `businessTypeOnly`. The 8th is "notes" (Mortgage Notes), gated on the
// THIRD axis instead: byOrgInvestorType.land hides /notes and a new org
// defaults to investorType "land". Keying this gate on "which gate keyword
// is present" would therefore have been wrong. It is keyed on what a
// persona actually SEES instead.
// ─────────────────────────────────────────────────────────────────────

/** Char stream that skips string literals and comments, so brace/bracket
 *  depth is counted over CODE only (module descriptions contain braces,
 *  apostrophes and URLs). */
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

interface ParsedNavModule {
  id: string;
  href: string;
  founderOnly: boolean;
  businessTypeOnly?: string[];
}

const NAV_MODULES_DECL = "const NAV_MODULES: NavModule[] = [";

function parseNavModules(): ParsedNavModule[] {
  const src = fs.readFileSync(LAYOUT_SIDEBAR, "utf-8");
  const decl = src.indexOf(NAV_MODULES_DECL);
  expect(decl, "NAV_MODULES declaration must exist in layout-sidebar.tsx").toBeGreaterThan(-1);
  // The array's own "[" is the last char of the declaration — NOT
  // src.indexOf("[", decl), which would land on the "[]" of the type.
  const open = decl + NAV_MODULES_DECL.length - 1;
  return arrayElementObjects(src, open).map((objSrc) => {
    const p = objectProps(objSrc);
    return {
      id: unquote(p.id)!,
      href: unquote(p.href)!,
      founderOnly: p.founderOnly === "true",
      businessTypeOnly: quotedList(p.businessTypeOnly),
    };
  });
}

// A brand-new org: no businessType selected, behaviour not yet detected,
// organizations.investorType defaults to "land" (layout-sidebar.tsx).
const DEFAULT_PROFILE = {
  businessType: undefined,
  detectedInvestorType: "new_investor",
  orgInvestorType: "land",
} as const;

// The frozen top-level set. CLAUDE.md: "No new persona verticals, and no
// new top-level nav entries EVER — customer or founder side." This list may
// only SHRINK (same ratchet discipline as FOUNDER_ROUTE_BASELINE); a new id
// here is a doctrine change only the founder can make.
const TOP_LEVEL_MODULE_BASELINE = [
  // the five doors + Inbox + Settings
  "today", "map", "deals", "money", "ai-hub", "inbox", "settings",
  // persona verticals — each gated, asserted below
  "notes", "tax-delinquent", "wholesaler", "landlord", "flipper",
  "subdivider", "creative-finance",
  // founder-only
  "founder-business",
];

describe("Desktop sidebar — NAV_MODULES top-level entries are the same doors", () => {
  const modules = parseNavModules();
  const hiddenForDefault = resolveHiddenRoutes(DEFAULT_PROFILE);

  it("the parse actually found the modules (no vacuous pass)", () => {
    expect(modules.length).toBeGreaterThanOrEqual(10);
    for (const m of modules) {
      expect(m.id, `module ${JSON.stringify(m)} must have an id`).toBeTruthy();
      expect(m.href, `module ${m.id} must have an href`).toMatch(/^\//);
    }
    // Spot-anchor: the parse resolves real, known modules with their real
    // gates — if the shape of NAV_MODULES changes so the parse silently
    // degrades, this fails rather than reporting an empty/garbage set.
    const byId = new Map(modules.map((m) => [m.id, m]));
    expect(byId.get("today")?.href).toBe("/today");
    expect(byId.get("map")?.href).toBe("/maps");
    expect(byId.get("founder-business")?.founderOnly).toBe(true);
    expect(byId.get("landlord")?.businessTypeOnly).toContain("buy_and_hold");
  });

  it("the top-level module set is frozen (no new top-level nav entries EVER)", () => {
    expect([...modules.map((m) => m.id)].sort()).toEqual([...TOP_LEVEL_MODULE_BASELINE].sort());
  });

  it("a default customer sees exactly the canonical doors — nothing else", () => {
    // Whatever the desktop rail shows a fresh signup must equal the door
    // model nav-items.ts declares. This is the cross-file coupling the gap
    // was missing: a sixth top-level module added HERE now fails, exactly
    // as adding it to DEFAULT_SIDEBAR_ITEMS already did.
    // (Door COLLAPSE — a door whose children are all persona-hidden — is
    // covered by sidebarHiddenRoutes.test.ts, which runs the full
    // visibility predicate over every persona combination.)
    const visibleToDefault = modules
      .filter((m) => !m.founderOnly)
      .filter((m) => !m.businessTypeOnly || m.businessTypeOnly.length === 0)
      .filter((m) => !hiddenForDefault.includes(m.href))
      .map((m) => m.id);
    expect(visibleToDefault).toEqual(DEFAULT_SIDEBAR_ITEMS);
  });

  it("every non-door top-level module is really persona-gated", () => {
    // Keeps the baseline above honest: an entry can only sit in the frozen
    // list as a vertical if it is actually gated. Adding "syndication" to
    // the baseline to quiet the previous test fails here.
    const nonDoors = modules.filter((m) => !DEFAULT_SIDEBAR_ITEMS.includes(m.id));
    expect(nonDoors.length).toBeGreaterThanOrEqual(7);
    for (const m of nonDoors) {
      const gated =
        m.founderOnly ||
        (m.businessTypeOnly?.length ?? 0) > 0 ||
        hiddenForDefault.includes(m.href);
      expect(gated, `top-level module "${m.id}" (${m.href}) is not a door and is not gated`).toBe(true);
    }
  });

  it("the five mobile doors are the same five desktop doors, same order, same hrefs", () => {
    const desktopDoors = modules.filter((m) => MOBILE_DOORS.includes(m.id));
    expect(desktopDoors.map((m) => m.id)).toEqual([...MOBILE_DOORS]);
    expect(desktopDoors.map((m) => m.href)).toEqual(
      MOBILE_DOORS.map((id) => NAV_ITEM_MAP.get(id)!.href),
    );
  });
});

describe("MobileBottomNav renders the fixed doors", () => {
  const src = fs.readFileSync(path.join(CLIENT, "components/mobile/MobileBottomNav.tsx"), "utf-8");

  it("maps directly over MOBILE_DOORS", () => {
    expect(src).toContain("MOBILE_DOORS");
    expect(src).toMatch(/MOBILE_DOORS[\s\S]*\.map\(/);
  });

  it("does NOT consume a persona/preferences override for its doors", () => {
    expect(src).not.toContain("useNavPreferences");
    expect(src).not.toContain("mobileItemsForPersona");
    expect(src).not.toContain("effectiveMobileItems");
  });
});
