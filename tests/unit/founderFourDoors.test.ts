/**
 * Founder four-door doctrine ratchet (Hands roadmap P6).
 *
 * Mirrors the customer five-door lock (mobileNavFixedDoors.test.ts). The founder
 * surface should SHRINK as autonomy grows, never grow. This locks the canonical
 * four doors to real routes and ratchets the total /founder/* route count so the
 * 88-door sprawl can only go DOWN — a new top-level founder route trips the test.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { FOUNDER_DOORS, FOUNDER_ADMIN_NAMESPACE, founderDoorByHref } from "@/lib/founder-doors";
import { FOUNDER_ROUTES_TSX, routeTreeSource } from "../helpers/clientRoutes";

// The UNION of both route trees (customer App.tsx + founder-routes.tsx — the
// P1-9 / X-2 build split). Reading App.tsx alone would count 1 founder route
// and let the ratchet below pass over a population the split had hidden.
const APP = routeTreeSource();

/** Current count — the ratchet baseline. Consolidation may only LOWER this.
 *  2026-06-23: 88→82 — the 7 cost/economics routes (cost, ai-costs,
 *  observability-cost, cost-optimizer, unit-economics, paid-data-eval,
 *  providers) merged into the single /founder/admin/costs tabbed hub. */
const FOUNDER_ROUTE_BASELINE = 81;

function founderRouteCount(): number {
  return (APP.match(/path="\/founder/g) ?? []).length;
}

describe("founder four-door doctrine", () => {
  it("FOUNDER_DOORS is exactly the four canonical doors, in order", () => {
    expect(FOUNDER_DOORS.map((d) => d.id)).toEqual(["letter", "decisions", "controls", "story"]);
  });

  it("every door resolves to a real /founder route that exists in App.tsx", () => {
    for (const door of FOUNDER_DOORS) {
      expect(door.href).toMatch(/^\/founder/);
      expect(APP.includes(`path="${door.href}"`), `route ${door.href} must exist`).toBe(true);
    }
  });

  it("founderDoorByHref resolves a door and null otherwise", () => {
    expect(founderDoorByHref("/founder")?.id).toBe("letter");
    expect(founderDoorByHref("/founder/nope")).toBeNull();
  });

  it("reserves /founder/admin for the deliberate instrument namespace", () => {
    expect(FOUNDER_ADMIN_NAMESPACE).toBe("/founder/admin");
  });
});

describe("desktop sidebar teaches the same four doors", () => {
  // 2026-07-03: the sidebar's founder module still taught the RETIRED
  // 3-screen Pulse/Cost/Customers model — Decisions was buried in a ~30-item
  // overflow and Controls wasn't listed at all, while the mobile bottom nav
  // followed the doctrine. Desktop and mobile must teach the identical
  // mental map. This locks the sidebar's primary founder children to the
  // four canonical door hrefs, in order.
  it("the founder module's primary children are exactly the four door hrefs, in order", () => {
    const SIDEBAR = fs.readFileSync(
      path.resolve(__dirname, "../../client/src/components/layout-sidebar.tsx"),
      "utf-8",
    );
    const moduleStart = SIDEBAR.indexOf('id: "founder-business"');
    expect(moduleStart, "founder-business module must exist in the sidebar").toBeGreaterThan(-1);
    const childrenStart = SIDEBAR.indexOf("children: [", moduleStart);
    const overflowStart = SIDEBAR.indexOf("overflow: [", moduleStart);
    expect(childrenStart).toBeGreaterThan(-1);
    expect(overflowStart).toBeGreaterThan(childrenStart);
    const childrenBlock = SIDEBAR.slice(childrenStart, overflowStart);
    const hrefs = [...childrenBlock.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(FOUNDER_DOORS.map((d) => d.href));
  });
});

describe("founder route-sprawl ratchet", () => {
  /**
   * BIDIRECTIONAL, and it was not until 2026-08-19.
   *
   * The assertion was `toBeLessThanOrEqual`, and the count equals the baseline —
   * zero headroom. That combination is the worst case for a one-way ratchet: a
   * consolidation from 82 to 78 passed silently and left FOUR unclaimed slots
   * for new top-level founder routes, which is precisely the sprawl the
   * four-door doctrine exists to prevent. The comment above the baseline told a
   * consolidator to lower it and nothing made them.
   *
   * A count BELOW the baseline now fails as stale-high, so the reduction gets
   * locked into the commit that earned it — the same discipline every
   * `scripts/ratchets/*.json` register already enforces.
   *
   * The vacuity guard is not decoration: `founderRouteCount()` matches a string
   * in App.tsx, so a refactor that renamed the prop or moved the routes would
   * take the count to 0 and satisfy any upper bound.
   */
  it("counts a real population — a zero here means the matcher broke, not that sprawl ended", () => {
    expect(founderRouteCount()).toBeGreaterThan(40);
  });

  it("the founder route tree holds the founder routes — the union is not satisfied by App.tsx alone", () => {
    // Per-file vacuity: the founder file must carry the bulk of the population,
    // so a founder-routes.tsx that stopped being read (or was emptied) fails
    // here instead of hiding behind the baseline arithmetic.
    const founderOnly = (fs.readFileSync(FOUNDER_ROUTES_TSX, "utf-8").match(/path="\/founder/g) ?? []).length;
    expect(founderOnly, "founder-routes.tsx must carry the /founder* routes").toBeGreaterThanOrEqual(75);
    expect(FOUNDER_ROUTE_BASELINE - founderOnly, "App.tsx keeps only /founder-dashboard").toBe(1);
  });

  it("the /founder/* route count never exceeds the baseline", () => {
    const count = founderRouteCount();
    expect(
      count,
      `founder routes (${count}) exceed the baseline (${FOUNDER_ROUTE_BASELINE}). New founder ` +
        `surfaces must live behind one of the four doors as a child/section/tab, not a new ` +
        `top-level route.`,
    ).toBeLessThanOrEqual(FOUNDER_ROUTE_BASELINE);
  });

  it("and never sits below it — a consolidation must be locked in", () => {
    const count = founderRouteCount();
    expect(
      count,
      `founder routes (${count}) are BELOW the baseline (${FOUNDER_ROUTE_BASELINE}). ` +
        `Good — a consolidation landed. Lower FOUNDER_ROUTE_BASELINE to ${count} in this same ` +
        `commit, or the headroom you just created becomes free slots for the next session.`,
    ).toBeGreaterThanOrEqual(FOUNDER_ROUTE_BASELINE);
  });
});
