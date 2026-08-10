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

const APP = fs.readFileSync(path.resolve(__dirname, "../../client/src/App.tsx"), "utf-8");

/** Current count — the ratchet baseline. Consolidation may only LOWER this.
 *  2026-06-23: 88→82 — the 7 cost/economics routes (cost, ai-costs,
 *  observability-cost, cost-optimizer, unit-economics, paid-data-eval,
 *  providers) merged into the single /founder/admin/costs tabbed hub.
 *  2026-08-10: 82→58 (F1 slice 1) — the 24 redirect-only registrations
 *  collapsed into FOUNDER_LEGACY_REDIRECTS + one catch-all <Route>. The
 *  catch-all takes a RegExp path (wouter string patterns can't express
 *  "/founder-dashboard OR /founder/<anything>"), so this counter — which
 *  counts string-literal registrations, i.e. actual founder surfaces —
 *  does not see it, and rightly so: it registers no new surface.
 *  founderLegacyRedirects.test.ts guards the catch-all itself.
 *  2026-08-10: 58→53 (F1 slice 2) — the 6 observability routes
 *  (ai-observatory, telemetry, traces, pax-traces, pax-calibration,
 *  event-log) merged into the single /founder/admin/telemetry tabbed hub,
 *  mirroring the costs hub; the old paths redirect with their tab pinned.
 *  2026-08-10: 53→48 (F1 slice 3) — the P6 Controls-absorption cluster:
 *  keys, readiness, legal-readiness, recovery-console and autopilot/voice
 *  became tabs of the Controls door (/founder/autopilot/control); the old
 *  paths redirect with their tab pinned.
 *  2026-08-10: 48→44 (F1 slice 4) — the agent-instrument cluster: the five
 *  routes that inspect the agents themselves (agent-queue, governance,
 *  trust-graduation, memory, scenarios) became tabs of the single
 *  /founder/admin/agents hub, mirroring the costs and telemetry hubs; five
 *  routes out, one in. The old paths redirect with their tab pinned.
 *  (/founder/dispatches belongs in that hub too but stayed put this slice —
 *  server/services/autopilot/stepAwayReadiness.ts emits it as an href and
 *  that file was outside the slice's file set.) */
const FOUNDER_ROUTE_BASELINE = 44;

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
  it("the /founder/* route count never exceeds the baseline (it may only shrink)", () => {
    const count = founderRouteCount();
    expect(
      count,
      `founder routes (${count}) exceed the baseline (${FOUNDER_ROUTE_BASELINE}). New founder ` +
        `surfaces must live behind one of the four doors as a child/section/tab, not a new ` +
        `top-level route. If you are CONSOLIDATING, lower FOUNDER_ROUTE_BASELINE to the new count.`,
    ).toBeLessThanOrEqual(FOUNDER_ROUTE_BASELINE);
  });
});
