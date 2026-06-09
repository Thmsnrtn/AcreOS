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
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { MOBILE_DOORS, NAV_ITEM_MAP } from "@/lib/nav-items";

const CLIENT = path.resolve(__dirname, "../../client/src");

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
