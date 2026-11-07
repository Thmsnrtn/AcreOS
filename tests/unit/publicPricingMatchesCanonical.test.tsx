// @vitest-environment jsdom
/**
 * Public pricing, as a visitor actually sees it, equals the decided tiers.
 *
 * Decided tiers (shared/billing/tier-pricing.ts, the canonical file):
 *   Free $0 · Starter $49 · Pro $99 · Scale $199 per month,
 *   yearly $490 · $990 · $1,990.
 *
 * WHY THIS EXISTS (G12 public-copy truth fixes, 2026-11-03): the public-claims
 * audit carried "Pro at $41/mo" — the pre-repricing Pro annual figure — and
 * its hand-written source paragraph agreed with it, so CI certified a stale
 * Pro price for weeks. tierPricing.test.ts pins the registry's cents, but
 * nothing pinned what the public surfaces RENDER. This renders the real
 * React and reads the DOM:
 *
 *   - the landing Pricing section (both cadences),
 *   - the /pricing page (both cadences),
 *   - the /pricing JSON-LD offers a crawler indexes.
 *
 * THE ANCHOR THAT IS NOT THE MAP: expected values are written here from the
 * decision, not read back from TIER_PRICES_CENTS. Deriving the expectation
 * from the registry would move it in lockstep with any registry drift and
 * prove only that the projection is a function. A deliberate pricing change
 * (founder-only) updates this file in the same commit, by hand.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "../../client/src/contexts/theme-context";
import { TIER_PRICES_CENTS } from "../../shared/billing/tier-pricing";
import { Pricing } from "../../client/src/pages/landing/Pricing";
import PricingPage from "../../client/src/pages/pricing";
import { pricingProductSchema } from "../../client/src/lib/jsonld-schemas";

/** The decided tiers, in display order. Dollars. */
const DECIDED = [
  { name: "Free", monthly: 0, yearly: 0 },
  { name: "Starter", monthly: 49, yearly: 490 },
  { name: "Pro", monthly: 99, yearly: 990 },
  { name: "Scale", monthly: 199, yearly: 1990 },
] as const;

const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;
/**
 * The "Save N%" badge is a literal on both surfaces; N must be what the
 * decided yearly prices actually save, and the same for every paid tier.
 */
const DECIDED_SAVE_PCT = (() => {
  const pcts = new Set(
    DECIDED.filter((t) => t.monthly > 0).map((t) => Math.round((1 - t.yearly / (12 * t.monthly)) * 100)),
  );
  expect(pcts.size, "paid tiers save different percentages — one badge cannot be true").toBe(1);
  return [...pcts][0];
})();

/** Annual cadence shows the monthly equivalent of the yearly price. */
const annualMonthly = (t: (typeof DECIDED)[number]) => (t.monthly === 0 ? 0 : Math.round(t.yearly / 12));

beforeAll(() => {
  // jsdom has no matchMedia; ThemeProvider reads prefers-color-scheme.
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(node: React.ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  act(() =>
    root!.render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>{node}</ThemeProvider>
      </QueryClientProvider>,
    ),
  );
  return container;
}

const texts = (el: ParentNode, sel: string) =>
  Array.from(el.querySelectorAll(sel)).map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim());

describe("the canonical registry holds the decided tiers", () => {
  it("TIER_PRICES_CENTS equals the decision", () => {
    for (const t of DECIDED.filter((d) => d.monthly > 0)) {
      const key = t.name.toLowerCase() as keyof typeof TIER_PRICES_CENTS;
      expect(TIER_PRICES_CENTS[key].priceMonthlyCents, `${t.name} monthly`).toBe(t.monthly * 100);
      expect(TIER_PRICES_CENTS[key].priceYearlyCents, `${t.name} yearly`).toBe(t.yearly * 100);
      expect(TIER_PRICES_CENTS[key].displayName).toBe(t.name);
    }
  });
});

describe("landing Pricing section renders the decided tiers", () => {
  it("annual cadence (the default): monthly-equivalent and the yearly bill", () => {
    const el = mount(<Pricing />);
    expect(texts(el, ".lp-tier-name")).toEqual(DECIDED.map((t) => t.name));
    expect(texts(el, ".lp-tier-amt")).toEqual(DECIDED.map((t) => fmt(annualMonthly(t))));
    expect(texts(el, ".lp-tier-billed")).toEqual(
      DECIDED.map((t) => (t.monthly === 0 ? "Free forever" : `Billed ${fmt(t.yearly)} annually`)),
    );
    expect(texts(el, ".lp-pricing-save")).toEqual([`Save ${DECIDED_SAVE_PCT}%`]);
  });

  it("monthly cadence", () => {
    const el = mount(<Pricing />);
    const monthlyTab = Array.from(el.querySelectorAll('button[role="tab"]')).find((b) => b.textContent?.trim() === "Monthly");
    expect(monthlyTab, "the Monthly toggle was not found — the read below would be vacuous").toBeTruthy();
    act(() => (monthlyTab as HTMLButtonElement).click());
    expect(texts(el, ".lp-tier-amt")).toEqual(DECIDED.map((t) => fmt(t.monthly)));
  });
});

describe("/pricing page renders the decided tiers", () => {
  const priceSpans = (el: HTMLElement) => texts(el, "span.text-4xl");

  it("annual cadence (the default)", () => {
    const el = mount(<PricingPage />);
    expect(priceSpans(el)).toEqual(DECIDED.map((t) => fmt(annualMonthly(t))));
    const yearLines = texts(el, "p").filter((s) => /\/year$/.test(s));
    expect(yearLines).toEqual(DECIDED.filter((t) => t.yearly > 0).map((t) => `${fmt(t.yearly)}/year`));
    const saveBadges = texts(el, "div, span").filter((s) => /^Save \d+%$/.test(s));
    expect(saveBadges.length, "no Save-% badge rendered — the check below would be vacuous").toBeGreaterThan(0);
    expect([...new Set(saveBadges)]).toEqual([`Save ${DECIDED_SAVE_PCT}%`]);
  });

  it("monthly cadence", () => {
    const el = mount(<PricingPage />);
    const toggle = el.querySelector('[role="switch"][aria-label="Annual billing"]') as HTMLButtonElement | null;
    expect(toggle, "the billing toggle was not found — the read below would be vacuous").toBeTruthy();
    act(() => toggle!.click());
    expect(priceSpans(el)).toEqual(DECIDED.map((t) => fmt(t.monthly)));
  });
});

describe("/pricing JSON-LD offers equal the decided monthly tiers", () => {
  it("every offer, name and price", () => {
    const offers = pricingProductSchema().offers.map((o) => [o.name, o.price, o.priceSpecification.price]);
    expect(offers).toEqual(DECIDED.map((t) => [t.name, t.monthly.toFixed(2), t.monthly.toFixed(2)]));
  });
});
