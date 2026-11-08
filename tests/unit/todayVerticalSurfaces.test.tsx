// @vitest-environment jsdom
/**
 * W2-TODAY — the vertical-surfaces registry is rendered on Today, phones only.
 *
 * Which fingerprint sees which cluster, that nothing renders where nothing
 * honest can (land, held flipper, desktop, unknown org/flags), and that a link
 * the sidebar would hide or a flag disables is never offered. Rendered through
 * the real component with the shell hooks stubbed — not a source scan.
 *
 * MUTATION PROBES (each went RED, then restored):
 *   · drop the `!isMobile` gate          → "desktop renders nothing" fails;
 *   · drop the TODAY_HELD_CLUSTERS filter → "flipper is held" fails;
 *   · drop the isRouteHidden filter      → "hidden link is not offered" fails;
 *   · drop the isRouteEnabled filter     → "flag-disabled link" fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const state = vi.hoisted(() => ({
  isMobile: true,
  org: undefined as Record<string, unknown> | undefined,
  hidden: [] as string[],
  disabled: [] as string[],
  flagsLoading: false,
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => state.isMobile }));
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => ({ data: state.org }) }));
vi.mock("@/hooks/use-hidden-routes", () => ({ useHiddenRoutes: () => state.hidden }));
vi.mock("@/hooks/use-feature-flags", () => ({
  useFeatureFlags: () => ({
    isLoading: state.flagsLoading,
    isRouteEnabled: (r: string) => !state.disabled.includes(r),
  }),
}));

import { VerticalSurfaces } from "../../client/src/components/today/VerticalSurfaces";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.isMobile = true;
  state.org = undefined;
  state.hidden = [];
  state.disabled = [];
  state.flagsLoading = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function org(businessType: string, investorType = "land") {
  return { id: 1, investorType, onboardingData: { businessType } };
}
function renderFor(o: Record<string, unknown> | undefined) {
  state.org = o;
  act(() => root.render(<VerticalSurfaces />));
}
const sectionIds = () =>
  [...container.querySelectorAll("section[data-testid^='today-surfaces-']")].map((s) =>
    s.getAttribute("data-testid")!.replace("today-surfaces-", ""),
  );
const hrefs = () => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));

describe("which fingerprint sees which cluster (phone)", () => {
  const CASES: Array<[string, string, string[]]> = [
    ["tax_lien_deed", "land", ["tax-delinquent"]],
    ["creative_finance", "land", ["creative-finance"]],
    ["subdivider", "land", ["subdivider"]],
    ["residential_wholesaler", "land", ["wholesaler"]],
    ["buy_and_hold", "land", ["landlord"]],
    ["short_term_rental", "land", ["landlord"]],
    ["multifamily", "land", ["landlord"]],
    ["mobile_home", "land", ["landlord"]],
    ["commercial", "land", ["commercial"]],
    ["agent_investor", "land", ["agent-investor"]],
    ["note_investor", "notes", ["note-investor"]],
    ["hybrid", "both", ["note-investor"]],
    ["buy_and_hold", "both", ["landlord", "note-investor"]],
  ];
  for (const [bt, it_, want] of CASES) {
    it(`${bt} / ${it_} → ${want.join(" + ")}`, () => {
      renderFor(org(bt, it_));
      expect(sectionIds()).toEqual(want);
      expect(container.querySelector("[data-testid='today-vertical-surfaces']")).not.toBeNull();
    });
  }

  it("the tax row is the four tax pages, in order", () => {
    renderFor(org("tax_lien_deed"));
    expect(hrefs()).toEqual(["/redemption-clock", "/auction-worksheet", "/state-rules", "/quiet-title"]);
  });

  it("the landlord row offers no redirect and no analytics overclaim", () => {
    renderFor(org("buy_and_hold"));
    expect(hrefs()).toEqual(["/rent-roll", "/tenants", "/leases", "/maintenance"]);
  });
});

describe("renders nothing where nothing honest can be shown", () => {
  it("a land flipper has no vertical module — nothing", () => {
    renderFor(org("land_flipper"));
    expect(container.innerHTML).toBe("");
  });

  it("flipper is held for the Fix-and-flip lane (#467) — nothing", () => {
    renderFor(org("fix_and_flip"));
    expect(container.innerHTML).toBe("");
  });

  it("desktop/tablet renders nothing — the sidebar module carries the same links", () => {
    state.isMobile = false;
    for (const bt of ["tax_lien_deed", "buy_and_hold", "creative_finance"]) {
      renderFor(org(bt));
      expect(container.innerHTML, bt).toBe("");
    }
  });

  it("org not loaded yet — nothing (no flash)", () => {
    renderFor(undefined);
    expect(container.innerHTML).toBe("");
  });

  it("flags still loading — nothing (no flash of a link a flag may hide)", () => {
    state.flagsLoading = true;
    renderFor(org("tax_lien_deed"));
    expect(container.innerHTML).toBe("");
  });
});

describe("never offers a page the nav would not", () => {
  it("a persona-hidden link is not offered", () => {
    state.hidden = ["/finance"];
    renderFor(org("creative_finance"));
    expect(hrefs()).toEqual(["/deals", "/dodd-frank", "/regulatory-intel"]);
  });

  it("a flag-disabled link is not offered", () => {
    state.disabled = ["/dodd-frank"];
    renderFor(org("creative_finance"));
    expect(hrefs()).not.toContain("/dodd-frank");
    expect(hrefs()).toHaveLength(3);
  });

  it("a query-string link is filtered on its path", () => {
    state.disabled = ["/campaigns"];
    renderFor(org("residential_wholesaler"));
    expect(hrefs()).not.toContain("/campaigns?channel=buyer-blasts");
  });

  it("a cluster whose links are all filtered renders nothing", () => {
    state.hidden = ["/redemption-clock", "/auction-worksheet", "/state-rules", "/quiet-title"];
    renderFor(org("tax_lien_deed"));
    expect(container.innerHTML).toBe("");
  });
});
