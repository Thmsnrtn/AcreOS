// @vitest-environment jsdom
/**
 * The rehab page renders timeline truth as the server computed it
 * (fix-and-flip package, Leg 3, §9.3).
 *
 *   - the original baseline is shown, with the number of revisions since, and
 *     the schedule reads plan vs recorded — "not recorded" when a phase was
 *     never entered, never a 0-day delta;
 *   - the three holding figures stay separate (MAO scenario, baseline plan,
 *     recorded actuals), with the scenario's provenance named;
 *   - a disagreement is stated as a fact about the forecast meeting the project;
 *   - with nothing recorded, each block teaches what to do rather than showing
 *     zeros.
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

const h = vi.hoisted(() => ({ full: true }));

const ITEMS = [
  {
    id: "k", rehabId: "r1", sequence: 0, category: "kitchen", scope: "Kitchen",
    contractorId: null, budgetCents: 1_500_000, committedCents: 0, spentCents: 0,
    startedAt: null, completedAt: null, notes: null,
  },
];

const FULL_TIMELINE = {
  baselines: [
    {
      id: "b1", supersedesId: null, plannedStartDate: "2026-09-01", plannedListingDate: "2026-12-01",
      plannedHoldMonths: 4, plannedHoldingMonthlyCents: 100_000,
      phasePlans: [{ phase: "demo", plannedDate: "2026-09-05" }],
      recordedBy: "u1", createdAt: "2026-09-01T00:00:00Z", isOriginal: true,
    },
    {
      id: "b2", supersedesId: "b1", plannedStartDate: "2026-09-10", plannedListingDate: "2026-12-20",
      plannedHoldMonths: 5, plannedHoldingMonthlyCents: 120_000,
      phasePlans: [], recordedBy: "u1", createdAt: "2026-09-10T00:00:00Z", isOriginal: false,
    },
  ],
  transitions: [{ id: "t1", fromStatus: "planning", toStatus: "demo", transitionedAt: "2026-09-08T10:00:00Z" }],
  holdingEntries: [
    { id: "e1", entryDate: "2026-10-01", category: "taxes", amountCents: 500_000, note: null, createdAt: "2026-10-01T00:00:00Z" },
    { id: "e2", entryDate: "2026-10-15", category: "hoa", amountCents: 250_000, note: "October", createdAt: "2026-10-15T00:00:00Z" },
  ],
  schedule: {
    phases: [
      { phase: "demo", plannedDate: "2026-09-05", actualDate: "2026-09-08", varianceDays: 3 },
      { phase: "framing", plannedDate: "2026-09-20", actualDate: null, varianceDays: null },
    ],
    listingVarianceDays: 10,
  },
  holding: {
    scenario: {
      holdMonths: 6, monthlyHoldingCostCents: 120_000, assumedTotalCents: 720_000,
      holdMonthsOrigin: "user", monthlyOrigin: "platform-default",
    },
    baselinePlan: { plannedHoldMonths: 4, plannedHoldingMonthlyCents: 100_000, plannedTotalCents: 400_000 },
    actuals: { entriesTotalCents: 750_000, elapsedDays: 70, meterAccruedCents: 233_333 },
    disagreement: { spendPastScenario: true, timePastScenario: false },
  },
};

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

function detail() {
  return {
    rehab: {
      id: "r1", propertyId: 1, name: "1 Elm", status: "demo", startedAt: null, plannedListingDate: null,
      purchasePriceCents: null, purchaseClosingCents: null, budgetTotalCents: null, spentTotalCents: 0,
      holdingCostMonthlyCents: null, arvCents: null, targetMarginCents: null,
    },
    items: ITEMS,
    variance: {
      lines: [{ id: "k", estimateCents: 1_500_000, committedCents: null, actualCents: 0, actualVsEstimateCents: -1_500_000, actualVsCommittedCents: null }],
      project: { estimateCents: 1_500_000, committedCents: 0, committedLineCount: 0, uncommittedLineCount: 1, actualCents: 0, actualVsEstimateCents: -1_500_000, actualVsCommittedCents: null },
      flags: [],
    },
    estimateLock: { locked: true, message: "This project has left planning, so its line estimates are locked — … change order …" },
    totals: { budgetCents: 1_500_000, committedCents: 0, spentCents: 0, varianceCents: -1_500_000, byCategory: {}, daysOnSite: 70, accruedHoldingCents: 233_333 },
    timeline: h.full ? FULL_TIMELINE : EMPTY_TIMELINE,
  };
}

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const realFetch = globalThis.fetch;

beforeEach(() => {
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

describe("rehab page — timeline & holding", () => {
  it("shows the original baseline, the revisions since, and plan vs recorded per phase", async () => {
    h.full = true;
    await renderPage();
    const card = q("rehab-timeline");
    expect(card).not.toBeNull();
    const text = card!.textContent ?? "";

    expect(text).toContain("Timeline & holding");
    expect(text).toContain("2026-09-01");            // original's planned start
    expect(text).toContain("Revised 1 time since");   // one revision, singular
    expect(text).toContain("+3 days");                // demo entered 3 days late
    expect(text).toContain("not recorded");           // framing never entered
    expect(text).toContain("Listing ran 10 days late");
  });

  it("keeps the MAO scenario, the baseline plan and recorded actuals separate, with the scenario's provenance", async () => {
    h.full = true;
    await renderPage();
    const text = q("rehab-timeline")!.textContent ?? "";

    expect(text).toContain("$7,200");                 // 6 × $1,200 assumed
    expect(text).toContain("your rule");              // hold length origin
    expect(text).toContain("platform default");       // monthly origin
    expect(text).toContain("$4,000");                 // 4 × $1,000 baseline plan
    expect(text).toContain("$7,500");                 // recorded entries
    expect(text).toContain("2 recorded entries");
    expect(text).toContain("70 days on site");
    expect(text).toContain("an accrual, not recorded spend");
  });

  it("states a disagreement as a fact and names recorded categories", async () => {
    h.full = true;
    await renderPage();
    const card = q("rehab-timeline")!;

    expect(card.textContent).toContain("Recorded holding spend has passed what the MAO scenario assumed");
    expect(card.textContent).toContain("HOA");
    expect(card.textContent).toContain("October");
    expect(card.querySelector('[data-testid="rehab-timeline-time-past-scenario"]')).toBeNull();
  });

  it("with nothing recorded, teaches each block instead of showing zeros", async () => {
    h.full = false;
    await renderPage();
    const text = q("rehab-timeline")!.textContent ?? "";

    expect(text).toContain("No kickoff baseline recorded yet");
    expect(text).toContain("No MAO decision recorded for this property yet");
    expect(text).toContain("No holding costs recorded yet");
  });
});
