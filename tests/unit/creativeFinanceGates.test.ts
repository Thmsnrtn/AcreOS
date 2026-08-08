/**
 * Creative-finance surface activation (wave V2, founder ruling #11).
 *
 * V1 honestly demoted creative_finance beta → roadmap because it had ZERO
 * dedicated surface. V2 assembled the surface from seller-finance rails that
 * already shipped — the /deals pipeline (Close & Carry on the closed deal →
 * POST /api/notes/from-deal/:dealId), the carried-note book behind the
 * Finance door (/finance: Loan Portfolio + Book + ATR/Reg-Z gate +
 * amortization), the Dodd-Frank exemption checker (/dodd-frank), and the
 * per-state seller-financing rules library (/regulatory-intel) — and flipped
 * the registry back to beta WITH that evidence.
 *
 * This suite pins the activation across every resolution layer:
 *   1. the businessTypeOnly sidebar module + its children,
 *   2. every child href is a REAL route in App.tsx (no dead links),
 *   3. no child is stranded by the nav-hiding registry for the exact
 *      creative_finance org fingerprint (the reason the module deliberately
 *      has no "/notes" child: creative_finance derives orgInvestorType
 *      "land", and byOrgInvestorType.land hides /notes),
 *   4. the /today "Your surfaces" cluster,
 *   5. the registry entry (maturity, template ids that actually exist in
 *      workflow-engine.ts, spotlightModules = the module children),
 *   6. the onboarding wizard still offers creative_finance.
 *
 * Component files (.tsx) are asserted via source-shape contracts — the same
 * pattern as landlordFamilyGates.test.ts — because these tests run in the
 * node env with no DOM.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { resolveVerticalSurfaces } from "../../client/src/lib/today-vertical-surfaces";
import { resolveHiddenRoutes } from "../../client/src/lib/sidebar-hidden-routes";
import { isFrozenRoute } from "../../shared/feature-freeze";
import {
  BUSINESS_TYPE_TO_PERSONA,
  BUSINESS_TYPE_TO_INVESTOR_TYPE,
} from "../../shared/models/persona-mapping";
import { BUSINESS_TYPES, getBusinessType } from "../../shared/business-types";

// workflow-engine imports server/storage (→ db) at module top; mock the heavy
// edges exactly like personaSampleData.test.ts so the template list loads pure.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CLIENT = path.resolve(__dirname, "../../client/src");

/** The module's children — the single expectation the suite pins against. */
const EXPECTED_CHILD_HREFS = ["/deals", "/finance", "/dodd-frank", "/regulatory-intel"];

function sidebarSource(): string {
  return fs.readFileSync(path.join(CLIENT, "components/layout-sidebar.tsx"), "utf-8");
}

/** Extract the creative-finance module block from the sidebar source. */
function moduleBlock(src: string): string {
  const match = src.match(/id:\s*"creative-finance"[\s\S]*?children:\s*\[[\s\S]*?\],\s*\n\s*\}/);
  expect(match, "creative-finance module with children must exist in layout-sidebar.tsx").toBeTruthy();
  return match![0];
}

/** Every href literal inside the module block (module href + children). */
function moduleHrefs(block: string): string[] {
  return [...block.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** The exact hidden-route union a freshly onboarded creative_finance org gets. */
function creativeFinanceHiddenRoutes(): string[] {
  return resolveHiddenRoutes({
    businessType: "creative_finance",
    // server/services/contextProfile.ts maps creative_finance → 'note_investor'.
    detectedInvestorType: "note_investor",
    // persona-mapping BUSINESS_TYPE_TO_INVESTOR_TYPE.creative_finance === "land"
    // (asserted below) — the value /onboarding/complete persists.
    orgInvestorType: "land",
  });
}

describe("creative finance — persona model (the premise of the build)", () => {
  it("collapses to the land_investor persona and the 'land' org investorType", () => {
    expect(BUSINESS_TYPE_TO_PERSONA.creative_finance).toBe("land_investor");
    // This is WHY the module must not lean on "/notes": the land
    // orgInvestorType hides it (see the stranding test below).
    expect(BUSINESS_TYPE_TO_INVESTOR_TYPE.creative_finance).toBe("land");
  });
});

describe("Creative finance nav module (layout-sidebar.tsx)", () => {
  const src = sidebarSource();
  const block = moduleBlock(src);

  it("gates on exactly the creative_finance businessType", () => {
    const gate = block.match(/businessTypeOnly:\s*\[([^\]]*)\]/);
    expect(gate, "module must carry a businessTypeOnly gate").toBeTruthy();
    expect(gate![1]).toContain('"creative_finance"');
    // Single-vertical gate — no other businessType rides along.
    expect([...gate![1].matchAll(/"([^"]+)"/g)]).toHaveLength(1);
  });

  it("links exactly the four shipped seller-finance surfaces as children", () => {
    const children = block.match(/children:\s*\[([\s\S]*?)\],\s*\n\s*\}/);
    expect(children).toBeTruthy();
    const childHrefs = [...children![1].matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(childHrefs).toEqual(EXPECTED_CHILD_HREFS);
  });

  it("every module href is a REAL route registered in App.tsx (no dead links)", () => {
    const appSrc = fs.readFileSync(path.join(CLIENT, "App.tsx"), "utf-8");
    const routePaths = new Set(
      [...appSrc.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]),
    );
    for (const href of moduleHrefs(block)) {
      const routePath = href.split("?")[0];
      expect(routePaths.has(routePath), `${href} must be a registered <Route> in App.tsx`).toBe(true);
    }
  });

  it("no module href is frozen (feature-freeze would blank the page)", () => {
    for (const href of moduleHrefs(block)) {
      expect(isFrozenRoute(href.split("?")[0]), href).toBe(false);
    }
  });

  it("no child is stranded by the nav-hiding registry for a creative_finance org", () => {
    // The union a real creative_finance org resolves: businessType profile
    // (/land-credit) + detected note_investor ([]) + orgInvestorType land
    // (/notes). The sidebar filters children with hiddenForType.includes(),
    // so any child href in this set would be gated INVISIBLE for exactly
    // the operators the module exists for.
    const hidden = new Set(creativeFinanceHiddenRoutes());
    for (const href of moduleHrefs(block)) {
      expect(hidden.has(href), `${href} is nav-hidden for creative_finance orgs — stranded child`).toBe(false);
    }
  });

  it("documents WHY /notes is absent (the land-investorType hide) — the gap stays stated", () => {
    // Pin the premise itself so a future sidebar-hidden-routes change is
    // noticed: today "/notes" IS hidden for this fingerprint, which is why
    // the module reaches the carried book via /finance.
    expect(creativeFinanceHiddenRoutes()).toContain("/notes");
    const children = block.match(/children:\s*\[([\s\S]*?)\],\s*\n\s*\}/)![1];
    expect(children).not.toContain('href: "/notes"');
  });
});

describe("/today creative-finance surfaces cluster", () => {
  it("resolves the cluster for creative_finance", () => {
    const clusters = resolveVerticalSurfaces({ businessType: "creative_finance", investorType: "land" });
    expect(clusters.map((c) => c.id)).toContain("creative-finance");
  });

  it("cluster links are the same four real routes as the nav module", () => {
    const clusters = resolveVerticalSurfaces({ businessType: "creative_finance", investorType: "land" });
    const cluster = clusters.find((c) => c.id === "creative-finance")!;
    expect(cluster.links.map((l) => l.href)).toEqual(EXPECTED_CHILD_HREFS);
  });

  it("does not leak the cluster to other businessTypes", () => {
    for (const bt of ["land_flipper", "residential_wholesaler", "fix_and_flip", "buy_and_hold", "subdivider", "tax_lien_deed", "note_investor"]) {
      const clusters = resolveVerticalSurfaces({ businessType: bt, investorType: "land" });
      expect(clusters.map((c) => c.id), bt).not.toContain("creative-finance");
    }
  });
});

describe("registry entry (shared/business-types.ts)", () => {
  const meta = getBusinessType("creative_finance")!;

  it("is core — the audit-Wave-1 flip (balloon lane now live), still backed by the surfaces pinned above", () => {
    // 2026-07-29 wave V2 flipped roadmap → beta on the assembled seller-finance
    // surface. 2026-08 audit Wave 1 flips beta → core: the vertical's ONLY
    // genuinely-dead template lane (note.balloon_approaching, driving
    // tpl_balloon_approaching + tpl_note_balloon_approaching_extended) is now
    // emitted from the daily notePaymentDueDetector scan (noteEvents.ts →
    // emitNoteEvent, folded in — no new job), with the fabricated {{balloonAmount}}
    // corrected to the honest, approximate {{outstandingBalance}}. The deal→note
    // bridge and payment.missed dunning already fired, so the vertical now clears
    // the honesty bar for core. A silent re-demotion should fail loudly here.
    expect(meta.maturity).toBe("core");
  });

  it("every workflowTemplateId names a template that actually exists in workflow-engine.ts", async () => {
    const { LAND_INVESTING_WORKFLOW_TEMPLATES } = await import("../../server/services/workflow-engine");
    const realIds = new Set(LAND_INVESTING_WORKFLOW_TEMPLATES.map((t) => t.id));
    expect(meta.workflowTemplateIds.length).toBeGreaterThan(0);
    for (const id of meta.workflowTemplateIds) {
      expect(realIds.has(id), `${id} must exist in LAND_INVESTING_WORKFLOW_TEMPLATES`).toBe(true);
    }
  });

  it("spotlightModules mirror the nav module's children (real routed slugs)", () => {
    expect(meta.spotlightModules).toEqual(
      EXPECTED_CHILD_HREFS.map((href) => href.replace(/^\//, "")),
    );
  });

  it("registry object identity: BUSINESS_TYPES.creative_finance is the same entry", () => {
    expect(BUSINESS_TYPES.creative_finance).toBe(meta);
  });
});

describe("onboarding wizard (onboarding-v2.tsx)", () => {
  it("creative_finance stays selectable with its strategy description", () => {
    const src = fs.readFileSync(path.join(CLIENT, "pages/onboarding-v2.tsx"), "utf-8");
    expect(src).toContain('value: "creative_finance"');
    expect(src).toContain("Subject-to, seller financing, wraps, and lease options.");
  });
});
