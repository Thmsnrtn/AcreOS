// @vitest-environment jsdom
/**
 * The rehab page renders Leg 4 truth as the server computed it
 * (fix-and-flip package, Leg 4).
 *
 *   - Change orders: the totals line (original / approved / effective), one row
 *     per order with its status, and — on a line with an approved amount — the
 *     "approved change orders → effective" line under the locked estimate.
 *   - Exit: before listing the page says when the decision is recorded and
 *     offers no form; a recorded hold exit links to rental underwriting.
 *   - Closing panel: realized net with the sale-vs-ARV delta; a missing
 *     component is named and no net is shown; no scenario teaches instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useRoute: () => [true, { id: "r1" }],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children),
}));
vi.mock("../../client/src/components/page-shell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children) }));
vi.mock("../../client/src/hooks/use-document-title", () => ({ useDocumentTitle: () => undefined }));
vi.mock("../../client/src/components/rehabs/draws-section", () => ({ DrawsSection: () => null }));
vi.mock("../../client/src/components/parcels/arv-calculator", () => ({ ArvCalculator: () => null }));
vi.mock("../../client/src/components/rehabs/rehab-photo-gallery", () => ({ RehabPhotoGallery: () => null }));
vi.mock("../../client/src/components/rehabs/bids-section", () => ({ BidsSection: () => null }));

type Grading = {
  holdDays: number | null;
  investedCents: number | null;
  investedParts: { purchaseCents: number | null; rehabSpentCents: number | null; holdingRecordedCents: number | null };
  realizedNetCents: number | null;
  netMissing: string[];
  realizedRoiRatio: number | null;
  deltas: {
    saleVsArvCents: number | null;
    holdDaysVsScenarioDays: number | null;
    netVsScenarioProfitCents: number | null;
    roiVsScenarioRatio: number | null;
  };
};

const SCENARIO = { arvCents: 32_000_000, profitCents: 8_000_000, roiRatio: 0.4, holdMonths: 5 };

const FULL_GRADING: Grading = {
  holdDays: 181,
  investedCents: 18_900_000,
  investedParts: { purchaseCents: 12_000_000, rehabSpentCents: 6_000_000, holdingRecordedCents: 900_000 },
  realizedNetCents: 9_600_000,
  netMissing: [],
  realizedRoiRatio: 9_600_000 / 18_900_000,
  deltas: {
    saleVsArvCents: -2_000_000,
    holdDaysVsScenarioDays: 31,
    netVsScenarioProfitCents: 1_600_000,
    roiVsScenarioRatio: 9_600_000 / 18_900_000 - 0.4,
  },
};

const NULL_DELTAS = { saleVsArvCents: null, holdDaysVsScenarioDays: null, netVsScenarioProfitCents: null, roiVsScenarioRatio: null };

const h = vi.hoisted(() => ({
  status: "demo",
  orders: [] as any[],
  approvedOnLine: 0,
  exitDecisions: [] as any[],
  realized: { facts: null, grading: null, scenario: null } as any,
}));

const ITEMS = [
  {
    id: "k", rehabId: "r1", sequence: 0, category: "kitchen", scope: "Kitchen",
    contractorId: null, budgetCents: 1_500_000, committedCents: 0, spentCents: 0,
    startedAt: null, completedAt: null, notes: null,
  },
];

const EMPTY_TIMELINE = {
  baselines: [],
  transitions: [],
  holdingEntries: [],
  schedule: { phases: [], listingVarianceDays: null },
  holding: {
    scenario: null,
    baselinePlan: null,
    actuals: { entriesTotalCents: 0, elapsedDays: null, meterAccruedCents: null },
    disagreement: { spendPastScenario: false, timePastScenario: false },
  },
};

const ORDER_APPROVED = {
  id: "co1", lineItemId: "k", description: "Move the sink wall", amountCents: 250_000, scheduleImpactDays: 6,
  status: "approved", decidedBy: "u1", decidedAt: "2026-10-02T10:00:00Z", recordedBy: "u1", createdAt: "2026-10-01T10:00:00Z",
};
const ORDER_PROPOSED = {
  id: "co2", lineItemId: "k", description: "Pot filler", amountCents: 75_000, scheduleImpactDays: 0,
  status: "proposed", decidedBy: null, decidedAt: null, recordedBy: "u1", createdAt: "2026-10-03T10:00:00Z",
};

function detail() {
  const approved = h.approvedOnLine;
  const orderTotals = {
    originalEstimateCents: 1_500_000,
    approvedChangeOrderCents: approved,
    effectiveEstimateCents: 1_500_000 + approved,
    approvedCount: h.orders.filter((o) => o.status === "approved").length,
    proposedCount: h.orders.filter((o) => o.status === "proposed").length,
    rejectedCount: h.orders.filter((o) => o.status === "rejected").length,
  };
  return {
    rehab: {
      id: "r1", propertyId: 7, name: "1 Elm", status: h.status, startedAt: "2025-10-01", plannedListingDate: null,
      purchasePriceCents: 12_000_000, purchaseClosingCents: null, budgetTotalCents: null, spentTotalCents: 0,
      holdingCostMonthlyCents: null, arvCents: null, targetMarginCents: null,
    },
    items: ITEMS,
    variance: {
      lines: [{
        id: "k", estimateCents: 1_500_000, committedCents: null, actualCents: 0, actualVsEstimateCents: -1_500_000, actualVsCommittedCents: null,
        approvedChangeOrderCents: approved, effectiveEstimateCents: 1_500_000 + approved,
      }],
      project: {
        estimateCents: 1_500_000, committedCents: 0, committedLineCount: 0, uncommittedLineCount: 1, actualCents: 0,
        actualVsEstimateCents: -1_500_000, actualVsCommittedCents: null,
        approvedChangeOrderCents: approved, effectiveEstimateCents: 1_500_000 + approved,
      },
      flags: [],
    },
    estimateLock: { locked: true, message: "This project has left planning, so its line estimates are locked — … change order …" },
    totals: { budgetCents: 1_500_000, committedCents: 0, spentCents: 0, varianceCents: -1_500_000, byCategory: {}, daysOnSite: null, accruedHoldingCents: null },
    timeline: EMPTY_TIMELINE,
    changeOrders: { orders: h.orders, totals: orderTotals },
    exit: { decisions: h.exitDecisions },
    realized: h.realized,
  };
}

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const realFetch = globalThis.fetch;

beforeEach(() => {
  h.status = "demo";
  h.orders = [];
  h.approvedOnLine = 0;
  h.exitDecisions = [];
  h.realized = { facts: null, grading: null, scenario: null };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    const body = u.includes("/api/rehabs/r1") ? detail() : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = realFetch;
});

async function renderPage() {
  const { default: Page } = await import("../../client/src/pages/rehab-detail");
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: async ({ queryKey }) => (await fetch(String(queryKey.join("/").replace("//", "/")))).json() },
    },
  });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Page)));
  });
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

const FACTS = {
  salePriceCents: 30_000_000, sellingCostsCents: 1_500_000, closingDate: "2026-03-31",
  recordedBy: "u1", recordedAt: "2026-04-01T09:00:00Z",
};

describe("rehab page — change orders", () => {
  it("shows the totals line and an order row with its status", async () => {
    h.orders = [ORDER_APPROVED, ORDER_PROPOSED];
    h.approvedOnLine = 250_000;
    await renderPage();

    const totals = q("rehab-change-orders-totals")!.textContent ?? "";
    expect(totals).toContain("Original estimate $15,000");
    expect(totals).toContain("approved change orders +$2,500");
    expect(totals).toContain("effective estimate $17,500");

    const row = q("change-order-co1")!;
    expect(row.textContent).toContain("Move the sink wall");
    expect(row.textContent).toContain("Approved");
    expect(row.textContent).toContain("+$2,500");
    expect(q("change-order-co2")!.textContent).toContain("Proposed");
  });

  it("a line with an approved amount shows the effective line; a line with none does not", async () => {
    h.orders = [ORDER_APPROVED];
    h.approvedOnLine = 250_000;
    await renderPage();
    const line = q("estimate-change-orders-k");
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain("+$2,500 approved change orders → $17,500 effective");
  });

  it("with only a proposed order, no line is adjusted", async () => {
    h.orders = [ORDER_PROPOSED];
    h.approvedOnLine = 0;
    await renderPage();
    expect(q("estimate-change-orders-k")).toBeNull();
    expect(q("rehab-change-orders-totals")!.textContent).toContain("effective estimate $15,000");
  });
});

describe("rehab page — exit decision", () => {
  it("before listing, says when the decision is recorded and offers no form", async () => {
    h.status = "demo";
    await renderPage();
    const card = q("rehab-exit-outcome")!;
    expect(card.textContent).toContain("The exit decision is recorded once the project is listed.");
    expect(card.querySelector("form")).toBeNull();
    expect(card.querySelector("#exit-kind")).toBeNull();
  });

  it("a recorded hold exit links to rental underwriting for this property, and creates nothing", async () => {
    h.status = "listed";
    h.exitDecisions = [{
      id: 11, decidedAt: "2026-10-05T10:00:00Z", kind: "hold", exitKind: "hold", choice: "Hold as a rental",
      rationale: "Rent covers carry; hold for the refi.", expectedPriceCents: null, reviewDueAt: null,
    }];
    await renderPage();
    const link = q("rehab-exit-rentals-link") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/rentals/underwrite?propertyId=7");
    expect(q("rehab-exit-latest")!.textContent).toContain("Hold as a rental");
    expect(q("rehab-exit-outcome")!.textContent).toContain("no unit, lease, or tenant is made");
  });

  it("a sell exit shows no rentals link", async () => {
    h.status = "listed";
    h.exitDecisions = [{
      id: 12, decidedAt: "2026-10-05T10:00:00Z", kind: "dispose", exitKind: "sell", choice: "Sell — asking $310,000",
      rationale: "Retail buyers dominate this zip.", expectedPriceCents: 31_000_000, reviewDueAt: null,
    }];
    await renderPage();
    expect(q("rehab-exit-rentals-link")).toBeNull();
    expect(q("rehab-exit-latest")!.textContent).toContain("expected price $310,000");
  });
});

describe("rehab page — closing panel", () => {
  it("shows the realized net and the sale-vs-ARV delta against the recorded scenario", async () => {
    h.status = "closed";
    h.realized = { facts: FACTS, grading: FULL_GRADING, scenario: SCENARIO };
    await renderPage();

    expect(q("rehab-realized-facts")!.textContent).toContain("closed 2026-03-31");
    const text = q("rehab-realized-grading")!.textContent ?? "";
    expect(text).toContain("Realized net $96,000");
    expect(text).toContain("Sold $300,000 vs $320,000 ARV in the recorded scenario");
    expect(text).toContain("−$20,000");
    expect(text).toContain("Held 181 days");
    expect(text).toContain("+31 days");
    expect(text).not.toContain("not computed");
    expect(text).not.toContain("No recorded flip scenario");
  });

  it("a missing purchase price is named and no net figure is shown", async () => {
    h.status = "closed";
    h.realized = {
      facts: FACTS,
      grading: {
        ...FULL_GRADING,
        investedCents: null,
        investedParts: { ...FULL_GRADING.investedParts, purchaseCents: null },
        realizedNetCents: null,
        netMissing: ["purchase price"],
        realizedRoiRatio: null,
        deltas: { ...FULL_GRADING.deltas, netVsScenarioProfitCents: null, roiVsScenarioRatio: null },
      },
      scenario: SCENARIO,
    };
    await renderPage();

    const text = q("rehab-realized-grading")!.textContent ?? "";
    expect(text).toContain("A realized net is not computed — purchase price not recorded");
    expect(text).not.toContain("Realized net");
    expect(text).not.toContain("Net vs the scenario's profit");
    // The deltas that did not need a purchase price are still stated.
    expect(text).toContain("−$20,000");
  });

  it("with no recorded scenario, teaches where the forecast side comes from", async () => {
    h.status = "closed";
    h.realized = { facts: FACTS, grading: { ...FULL_GRADING, deltas: NULL_DELTAS }, scenario: null };
    await renderPage();

    const text = q("rehab-realized-grading")!.textContent ?? "";
    expect(text).toContain("No recorded flip scenario to grade against");
    // The net is still a fact of the close.
    expect(text).toContain("Realized net $96,000");
    expect(text).not.toContain("Sold $300,000 vs");
  });
});
