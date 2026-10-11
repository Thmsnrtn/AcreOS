// @vitest-environment jsdom
/**
 * W3 independent audit (2026-10-11) — public truth on the parcel report.
 *
 * For a parcel AcreOS keeps, /p/... opens with "Verified land facts" (only
 * facts that passed the accuracy gate). Below it the page still renders the
 * older free federal-data report and its PARTIAL Land Credit Score, none of
 * which went through that gate. Without a boundary, the verified framing
 * reads as covering the score too — a claim the page does not back.
 *
 * Pinned on the RENDERED page: when gated land facts are present, the
 * outside-the-accuracy-check notice renders and comes BEFORE the score; when
 * there are none (a parcel AcreOS does not keep), the page makes no
 * verified claim and the notice does not render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useParams: () => ({ state: "TN", county: "dekalb", apn: "001-002.00" }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../client/src/lib/marketing-touch", () => ({ emitMarketingTouch: vi.fn(), getAnonymousId: () => "anon-test-1234" }));
vi.mock("../../client/src/lib/acquisition-utm", () => ({ capturePendingParcel: vi.fn() }));
vi.mock("../../client/src/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../client/src/hooks/use-document-title", () => ({ usePageMeta: vi.fn() }));
vi.mock("../../client/src/components/seo/OpenGraph", () => ({ OpenGraph: () => null }));

import PublicParcelReportPage from "../../client/src/pages/public-parcel-report";

const report = {
  id: 1,
  state: "TN",
  countySlug: "dekalb",
  countyLabel: "DeKalb",
  apn: "001-002.00",
  facts: {
    parcel: { apn: "001-002.00", state: "TN", county: "DeKalb", acres: 5, centroid: { lat: 36, lng: -85.8 }, countyAttributes: "not-redistributable", attribution: null, assessorData: null },
    categories: [],
  },
  lcs: {
    kind: "partial",
    basis: "government-data-only",
    scoredDimensions: 1,
    totalDimensions: 6,
    weightCoveredPct: 20,
    partialScore: 700,
    partialGrade: "B",
    dimensions: [],
    modelVersion: "t",
    computedAt: "2026-10-01T00:00:00Z",
  },
  viewCount: 1,
  createdAt: "2026-10-01T00:00:00Z",
  refreshedAt: "2026-10-01T00:00:00Z",
};

const land = {
  parcelKey: "TN-47041-x",
  state: "TN",
  countySlug: "dekalb",
  countyLabel: "DeKalb",
  apn: "001-002.00",
  centroid: { lat: 36, lng: -85.8 },
  gisAcres: 5,
  deededAcres: null,
  source: { name: "County parcel layer", retrievedOn: "2026-10-01" },
  rows: [],
  truths: [],
  taxSaleSources: [],
  countyCoverage: null,
  countyCoverageLabel: null,
  indexable: false,
};

const RESPONSE = vi.hoisted(() => ({ body: null as unknown }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => RESPONSE.body })),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <PublicParcelReportPage />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && !container.querySelector('[data-testid="land-facts"], h1'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

describe("the public report marks what the accuracy gate did not check", () => {
  it("with verified land facts, the federal snapshot is labelled as outside the check, ahead of the score", async () => {
    RESPONSE.body = { found: true, generated: false, path: "/p/tn/dekalb/001-002.00", report, land };
    await renderPage();
    expect(container.querySelector('[data-testid="land-facts"]')).not.toBeNull();
    const notice = container.querySelector('[data-testid="report-outside-accuracy-check"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toMatch(/not covered by AcreOS's accuracy check/);
    // It precedes the partial score in document order.
    const html = container.innerHTML;
    const at = html.indexOf('data-testid="report-outside-accuracy-check"');
    const score = html.indexOf("700");
    expect(score).toBeGreaterThan(-1);
    expect(at).toBeLessThan(score);
  });

  it("without verified land facts the page claims nothing verified, so no notice", async () => {
    RESPONSE.body = { found: true, generated: false, path: "/p/tn/dekalb/001-002.00", report, land: null };
    await renderPage();
    expect(container.querySelector('[data-testid="land-facts"]')).toBeNull();
    expect(container.querySelector('[data-testid="report-outside-accuracy-check"]')).toBeNull();
  });
});
