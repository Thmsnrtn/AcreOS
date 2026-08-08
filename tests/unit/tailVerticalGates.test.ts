/**
 * Roadmap-tail honest experience (wave V3, founder ruling #11).
 *
 * These five verticals share one coherence contract: a signup choosing any of
 * them must land in a truthful app built from surfaces that already shipped,
 * not a land-shaped default. Their MATURITY, however, is no longer uniform.
 * agent_investor and short_term_rental STAY roadmap (the honesty bar for beta
 * is not met — agent_investor needs the agent-specific surface, STR needs a
 * nightly-booking model). multifamily and mobile_home were promoted roadmap →
 * beta in the 2026-08 audit (Wave 2), and commercial was promoted roadmap →
 * beta in Wave 2 pass B once entity/company tenants shipped and the
 * residential-statute late-fee fabrication was gated out for commercial orgs —
 * base-rent term-lease operations now pass the honest beta bar (CAM/NNN,
 * percentage rent, escalations and per-sqft stay roadmap-for-core). All three
 * betas' templates fire and their gaps are disclosed rather than fabricated
 * (see business-types.ts + investorAnalyticsUnitAware / padInventory). The
 * coherence assertions below hold for beta just as they did for roadmap; only
 * the maturity expectation moved, to a per-vertical map.
 *
 * What this suite pins:
 *   1. commercial — the rentals-stack verdict: the Rentals nav module gate
 *      includes commercial (the shared lease/rent-ledger/maintenance loop
 *      genuinely serves commercial base rent; the dashboard already routes
 *      commercial to the real landlord dashboard), the /today cluster links
 *      real routed surfaces, and the hidden-routes profile matches the
 *      choice (landlord-family profile).
 *   2. agent_investor — the land default is DELIBERATE: /today cluster of
 *      real land sourcing surfaces, and the businessType axis hides
 *      nothing (full land surface, like land_flipper).
 *   3. registry truth for all five entries — maturity matches each entry's
 *      honest tier (two roadmap, commercial + multifamily + mobile_home beta),
 *      every workflowTemplateId names a template that exists in
 *      workflow-engine.ts RIGHT NOW, and every spotlightModules slug
 *      resolves to a real routed surface.
 *
 * Component files (.tsx) are asserted via source-shape contracts — the same
 * pattern as landlordFamilyGates.test.ts / creativeFinanceGates.test.ts —
 * because these tests run in the node env with no DOM.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { resolveVerticalSurfaces } from "../../client/src/lib/today-vertical-surfaces";
import {
  resolveHiddenRoutes,
  _SIDEBAR_HIDDEN_ROUTES_REGISTRY,
} from "../../client/src/lib/sidebar-hidden-routes";
import { isFrozenRoute } from "../../shared/feature-freeze";
import {
  BUSINESS_TYPE_TO_PERSONA,
  BUSINESS_TYPE_TO_INVESTOR_TYPE,
} from "../../shared/models/persona-mapping";
import {
  getBusinessType,
  type BusinessTypeId,
  type VerticalMaturity,
} from "../../shared/business-types";

// workflow-engine imports server/storage (→ db) at module top; mock the heavy
// edges exactly like creativeFinanceGates.test.ts so the template list loads pure.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CLIENT = path.resolve(__dirname, "../../client/src");

const TAIL_VERTICALS: BusinessTypeId[] = [
  "commercial",
  "agent_investor",
  "short_term_rental",
  "multifamily",
  "mobile_home",
];

/** The commercial /today cluster's links — the single expectation pinned here. */
const COMMERCIAL_CLUSTER_HREFS = ["/rent-roll", "/leases", "/maintenance", "/deals", "/properties"];
/** The agent-investor /today cluster's links. */
const AGENT_INVESTOR_CLUSTER_HREFS = ["/maps", "/leads", "/deals", "/skip-tracing"];

function sidebarSource(): string {
  return fs.readFileSync(path.join(CLIENT, "components/layout-sidebar.tsx"), "utf-8");
}

function appRoutePaths(): Set<string> {
  const appSrc = fs.readFileSync(path.join(CLIENT, "App.tsx"), "utf-8");
  return new Set([...appSrc.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));
}

/** A slug resolves when "/slug" is a registered route (exact or as a prefix, e.g. /parcels/:id). */
function slugResolves(slug: string, routePaths: Set<string>): boolean {
  const route = `/${slug}`;
  if (routePaths.has(route)) return true;
  for (const p of routePaths) {
    if (p.startsWith(`${route}/`)) return true;
  }
  return false;
}

/**
 * The exact hidden-route union a freshly onboarded org of each tail
 * businessType gets. Detected axis per server/services/contextProfile.ts
 * (commercial / STR / multifamily / mobile_home → 'portfolio_builder';
 * agent_investor → 'wholesaler'); org axis per persona-mapping
 * BUSINESS_TYPE_TO_INVESTOR_TYPE (all five → "land", asserted below).
 */
function hiddenFor(businessType: BusinessTypeId): string[] {
  return resolveHiddenRoutes({
    businessType,
    detectedInvestorType: businessType === "agent_investor" ? "wholesaler" : "portfolio_builder",
    orgInvestorType: "land",
  });
}

describe("tail verticals — persona-model premises", () => {
  it("all five derive the 'land' org investorType (the fingerprint the hide-tests use)", () => {
    for (const bt of TAIL_VERTICALS) {
      expect(BUSINESS_TYPE_TO_INVESTOR_TYPE[bt], bt).toBe("land");
    }
  });

  it("agent_investor deliberately maps to the land_investor persona (the premise of the land default)", () => {
    expect(BUSINESS_TYPE_TO_PERSONA.agent_investor).toBe("land_investor");
  });
});

describe("commercial — the rentals-stack decision (wave V3)", () => {
  const src = sidebarSource();

  it("the Rentals module gate includes commercial alongside the landlord family", () => {
    const match = src.match(/id:\s*"landlord"[\s\S]*?businessTypeOnly:\s*\[([^\]]*)\]/);
    expect(match, "landlord module with a businessTypeOnly gate must exist").toBeTruthy();
    expect(match![1]).toContain('"commercial"');
  });

  it("the dashboard routes commercial to the real landlord dashboard (the V2 premise this extends)", () => {
    const widgetsSrc = fs.readFileSync(
      path.join(CLIENT, "components/dashboard/type-specific-widgets.tsx"),
      "utf-8",
    );
    expect(widgetsSrc).toContain('{category === "commercial" && <BuyAndHoldWidgets />}');
  });

  it("hidden-routes: commercial shares the landlord-family businessType profile", () => {
    // Same constant, not a drifting copy — the coherent-nav decision is
    // "commercial nav = landlord-family nav" (Rentals in, note-investor
    // surfaces out).
    expect(_SIDEBAR_HIDDEN_ROUTES_REGISTRY.byBusinessType.commercial).toBe(
      _SIDEBAR_HIDDEN_ROUTES_REGISTRY.byBusinessType.buy_and_hold,
    );
    const hidden = hiddenFor("commercial");
    for (const r of ["/notes", "/notes/pipeline", "/borrower-portal", "/land-credit"]) {
      expect(hidden, r).toContain(r);
    }
    // Doors stay unhideable (protected set).
    for (const door of ["/today", "/maps", "/deals", "/money", "/finance"]) {
      expect(hidden, door).not.toContain(door);
    }
  });

  it("no Rentals module child is nav-hidden for the commercial fingerprint (no stranded children)", () => {
    const block = src.match(/id:\s*"landlord"[\s\S]*?children:\s*\[([\s\S]*?)\],\s*\n\s*\}/);
    expect(block, "landlord module children must exist").toBeTruthy();
    const childHrefs = [...block![1].matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(childHrefs.length).toBeGreaterThan(0);
    const hidden = new Set(hiddenFor("commercial"));
    for (const href of childHrefs) {
      expect(hidden.has(href), `${href} is nav-hidden for commercial orgs — stranded child`).toBe(false);
    }
  });

  it("/today resolves the commercial cluster with exactly the rentals+deals+properties links", () => {
    const clusters = resolveVerticalSurfaces({ businessType: "commercial", investorType: "land" });
    const cluster = clusters.find((c) => c.id === "commercial");
    expect(cluster, "commercial cluster must resolve").toBeTruthy();
    expect(cluster!.links.map((l) => l.href)).toEqual(COMMERCIAL_CLUSTER_HREFS);
    // It gets its OWN cluster, not the landlord one (commercial derives the
    // land_investor persona, not landlord — only the businessType-gated
    // surfaces are shared).
    expect(clusters.map((c) => c.id)).not.toContain("landlord");
  });

  it("every commercial cluster link is a real, unfrozen, un-hidden route", () => {
    const routePaths = appRoutePaths();
    const hidden = new Set(hiddenFor("commercial"));
    for (const href of COMMERCIAL_CLUSTER_HREFS) {
      expect(routePaths.has(href), `${href} must be a registered <Route> in App.tsx`).toBe(true);
      expect(isFrozenRoute(href), href).toBe(false);
      expect(hidden.has(href), `${href} is nav-hidden for commercial orgs`).toBe(false);
    }
  });
});

describe("agent_investor — the land default is deliberate (wave V3)", () => {
  it("the businessType axis hides NOTHING — full land surface, like land_flipper", () => {
    expect(_SIDEBAR_HIDDEN_ROUTES_REGISTRY.byBusinessType.agent_investor).toEqual([]);
  });

  it("/today resolves the agent-investor cluster with the real land sourcing links", () => {
    const clusters = resolveVerticalSurfaces({ businessType: "agent_investor", investorType: "land" });
    const cluster = clusters.find((c) => c.id === "agent-investor");
    expect(cluster, "agent-investor cluster must resolve").toBeTruthy();
    expect(cluster!.links.map((l) => l.href)).toEqual(AGENT_INVESTOR_CLUSTER_HREFS);
  });

  it("every agent-investor cluster link is a real, unfrozen, un-hidden route", () => {
    const routePaths = appRoutePaths();
    const hidden = new Set(hiddenFor("agent_investor"));
    for (const href of AGENT_INVESTOR_CLUSTER_HREFS) {
      expect(routePaths.has(href), `${href} must be a registered <Route> in App.tsx`).toBe(true);
      expect(isFrozenRoute(href), href).toBe(false);
      // /maps is hidden by the detected-'wholesaler' axis in the raw
      // registry but is a protected door — resolveHiddenRoutes must never
      // return it (or any other cluster link).
      expect(hidden.has(href), `${href} is nav-hidden for agent_investor orgs`).toBe(false);
    }
  });
});

describe("/today clusters do not leak to other businessTypes", () => {
  it("commercial + agent-investor clusters resolve only for their own businessType", () => {
    for (const bt of ["land_flipper", "buy_and_hold", "short_term_rental", "multifamily", "mobile_home", "residential_wholesaler", "fix_and_flip", "subdivider", "tax_lien_deed", "creative_finance"]) {
      const ids = resolveVerticalSurfaces({ businessType: bt, investorType: "land" }).map((c) => c.id);
      expect(ids, bt).not.toContain("commercial");
      expect(ids, bt).not.toContain("agent-investor");
    }
  });
});

describe("registry truth (shared/business-types.ts) — the five tail entries", () => {
  it("each entry sits at its honest tier — two roadmap, commercial + multifamily + mobile_home beta (2026-08 audits Wave 2 + pass B)", () => {
    // 2026-08 audits promoted three of the five roadmap → beta on the honest
    // tier definition (templates all fire, gaps disclosed not fabricated), so
    // the old blanket "all five stay roadmap" assertion is a per-vertical map:
    //   - multifamily → beta (Wave 2): 0219's real `rental_units` inventory
    //     closed the unit-model gap and occupancy is computed over it; the two
    //     remaining gaps (building-level roll-ups, the T-12 workspace) are
    //     DISCLOSED and the assumed 40% op-ex is labelled an estimate everywhere
    //     it surfaces, so beta is honest and core still waits on the real
    //     expense axis.
    //   - mobile_home → beta (Wave 2): three write paths now populate
    //     `rental_units.kind='pad'`, so pad inventory is real and lot-lease
    //     operations are honest; the home side (chattel titles, home-vs-lot
    //     rent split, utilities pass-through) is out of beta scope and stays
    //     DISCLOSED in the persona voice — a lot-lease-only beta.
    //   - commercial → beta (Wave 2 pass B): entity/company tenants shipped
    //     (is_entity + company_name, migration 0220) and the residential-statute
    //     late-fee FABRICATION was gated out for commercial orgs (front + back),
    //     so base-rent term-lease operations pass the honest bar; CAM/NNN,
    //     percentage rent, escalations and per-sqft metrics stay
    //     roadmap-for-core.
    //   - agent_investor, short_term_rental → still roadmap: their beta bars
    //     (the agent-specific surface, a nightly-booking model) are genuinely
    //     unmet.
    const EXPECTED_MATURITY: Partial<Record<BusinessTypeId, VerticalMaturity>> = {
      commercial: "beta",
      agent_investor: "roadmap",
      short_term_rental: "roadmap",
      multifamily: "beta",
      mobile_home: "beta",
    };
    for (const bt of TAIL_VERTICALS) {
      expect(getBusinessType(bt)?.maturity, bt).toBe(EXPECTED_MATURITY[bt]);
    }
  });

  it("every workflowTemplateId names a template that actually exists in workflow-engine.ts", async () => {
    const { LAND_INVESTING_WORKFLOW_TEMPLATES } = await import("../../server/services/workflow-engine");
    const realIds = new Set(LAND_INVESTING_WORKFLOW_TEMPLATES.map((t) => t.id));
    for (const bt of TAIL_VERTICALS) {
      const meta = getBusinessType(bt)!;
      expect(meta.workflowTemplateIds.length, `${bt} should declare its applicable templates`).toBeGreaterThan(0);
      for (const id of meta.workflowTemplateIds) {
        expect(realIds.has(id), `${bt}: ${id} must exist in LAND_INVESTING_WORKFLOW_TEMPLATES`).toBe(true);
      }
    }
  });

  it("STR deliberately EXCLUDES the lease-renewal templates (nightly bookings have no renewal moment)", () => {
    const str = getBusinessType("short_term_rental")!;
    expect(str.workflowTemplateIds).not.toContain("tpl_landlord_lease_renewal_countdown");
    expect(str.workflowTemplateIds).not.toContain("tpl_lease_expiring");
  });

  it("commercial deliberately EXCLUDES the renewal-countdown template (its rent-review math cites residential/land comps)", () => {
    const commercial = getBusinessType("commercial")!;
    expect(commercial.workflowTemplateIds).not.toContain("tpl_landlord_lease_renewal_countdown");
  });

  it("landlord-family siblings' spotlightModules are exactly the Rentals module children (real slugs)", () => {
    const block = sidebarSource().match(/id:\s*"landlord"[\s\S]*?children:\s*\[([\s\S]*?)\],\s*\n\s*\}/);
    expect(block).toBeTruthy();
    const childSlugs = [...block![1].matchAll(/href:\s*"\/([^"]+)"/g)].map((m) => m[1]);
    for (const bt of ["short_term_rental", "multifamily", "mobile_home"] as const) {
      expect(getBusinessType(bt)!.spotlightModules, bt).toEqual(childSlugs);
    }
    // commercial = the same Rentals children plus the pipeline + inventory
    // surfaces its /today cluster leans on.
    expect(getBusinessType("commercial")!.spotlightModules).toEqual([...childSlugs, "deals", "properties"]);
  });

  it("every spotlightModules slug across all five entries resolves to a real routed surface", () => {
    const routePaths = appRoutePaths();
    for (const bt of TAIL_VERTICALS) {
      const meta = getBusinessType(bt)!;
      expect(meta.spotlightModules.length, `${bt} should spotlight its real surfaces`).toBeGreaterThan(0);
      for (const slug of meta.spotlightModules) {
        expect(slugResolves(slug, routePaths), `${bt}: spotlight "${slug}" must resolve to a registered route`).toBe(true);
      }
    }
  });

  it("no spotlighted surface is nav-hidden for its own vertical's fingerprint", () => {
    for (const bt of TAIL_VERTICALS) {
      const hidden = new Set(hiddenFor(bt));
      for (const slug of getBusinessType(bt)!.spotlightModules) {
        expect(hidden.has(`/${slug}`), `${bt}: /${slug} is nav-hidden for its own vertical`).toBe(false);
      }
    }
  });
});
