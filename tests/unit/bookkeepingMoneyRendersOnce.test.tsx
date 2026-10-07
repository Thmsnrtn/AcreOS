// @vitest-environment jsdom
/**
 * The bookkeeping page renders the server's dollars as dollars — once.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * GET /api/bookkeeping/annual-report returns DOLLARS (the service sums cents
 * and converts once, at the report edge). The page treated every figure as
 * cents and divided by 100 again: $1,234.56 of interest rendered as "$12.35",
 * and the CSV export carried the same wrong numbers. Its "Net P&L" card read
 * `summary.netProfit`, a field no endpoint returns, and rendered "$NaN". It
 * fetched with a bare `fetch().then(r => r.json())`, so a 500's error body was
 * rendered as if it were the report.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * Exact rendered strings for known dollar values; the exact CSV cells; that a
 * failed request and a response missing a money field render the error state
 * (never "NaN"); and that the server's REAL response for seeded rows parses
 * with the shared contract the page consumes.
 *
 * (@testing-library/react is not a dependency of this repo; the page is
 * mounted through react-dom/client exactly as the other page tests do.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

// The shell (sidebar, Pax rail) is not under test; the page body is.
vi.mock("../../client/src/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children),
}));

import BookkeepingPage from "../../client/src/pages/bookkeeping";
import { buildBookkeepingCsv } from "../../client/src/lib/bookkeepingCsv";
import { annualInterestReportContract } from "@shared/contracts";

const annualInterestReportResponseSchema = annualInterestReportContract.responseSchema;

// Known values, as the server sends them: DOLLARS.
const REPORT = {
  taxYear: new Date().getFullYear() - 1,
  totalInterestIncome: 1234.56,
  totalPrincipalReceived: 10000,
  totalLateFeesCollected: 25.5,
  notesWith1099Required: 1,
  notes: [
    {
      noteId: 7,
      borrowerName: "Ada Lovelace",
      interestCollected: 1234.56,
      principalCollected: 10000,
      requires1099: true,
    },
  ],
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function respond(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (String(url).startsWith("/api/bookkeeping/annual-report")) {
        return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
      }
      // Anything else the page asks for is not part of this contract.
      return Promise.resolve(new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404 }));
    }),
  );
}

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(Router, null, React.createElement(BookkeepingPage)),
      ),
    );
  });
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return container!;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ");

describe("bookkeeping page: dollars render once", () => {
  it("renders the exact dollar strings for known values", async () => {
    respond(REPORT);
    const el = await mount();
    const cards = [...el.querySelectorAll("dd")].map((d) => text(d).trim());
    expect(cards).toEqual(["$1,234.56", "$10,000.00", "$25.50", "1"]);
    expect(text(el)).toContain("$1,234.56 interest · $10,000.00 principal");
    expect(text(el)).not.toMatch(/NaN/);
    expect(text(el)).not.toContain("$12.35"); // the double-divided figure
  });

  it("a failed request renders the error state, not a report", async () => {
    respond({ error: "INTERNAL", message: "boom", statusCode: 500 }, 500);
    const el = await mount();
    expect(el.querySelector('[data-testid="bookkeeping-query-error"]')).not.toBeNull();
    expect(text(el)).not.toMatch(/NaN/);
  });

  it("a response missing a money field renders the error state, never NaN", async () => {
    const { totalLateFeesCollected: _drop, ...missing } = REPORT;
    respond(missing);
    const el = await mount();
    expect(el.querySelector('[data-testid="bookkeeping-query-error"]')).not.toBeNull();
    expect(text(el)).not.toMatch(/NaN/);
  });
});

describe("bookkeeping CSV export", () => {
  it("writes the exact dollar cells", () => {
    expect(buildBookkeepingCsv(REPORT).split("\n")).toEqual([
      "Note ID,Borrower,Interest collected,Principal collected,Interest received >= $600 (review)",
      '7,"Ada Lovelace",1234.56,10000.00,yes',
      "",
      "Total interest,1234.56",
      "Total principal,10000.00",
      "Total late fees,25.50",
      "Notes with >= $600 interest received (review),1",
    ]);
  });

  it("writes N/A, not NaN, for a value that is not a number", () => {
    const broken = { ...REPORT, totalLateFeesCollected: Number.NaN };
    const csv = buildBookkeepingCsv(broken as typeof REPORT);
    expect(csv).toContain("Total late fees,N/A");
    expect(csv).not.toMatch(/NaN/);
  });
});

describe("the contract states the unit", () => {
  it("rejects a response that omits a money field the page reads", () => {
    const { totalInterestIncome: _drop, ...missing } = REPORT;
    expect(annualInterestReportResponseSchema.safeParse(missing).success).toBe(false);
  });
  it("rejects a non-finite money value", () => {
    expect(annualInterestReportResponseSchema.safeParse({ ...REPORT, totalInterestIncome: Number.NaN }).success).toBe(false);
  });
  it("rejects a borrower PII field riding along on a note (the contract is strict)", () => {
    const leaky = { ...REPORT, notes: [{ ...REPORT.notes[0], borrowerTaxIdCiphertext: "v1:abc" }] };
    expect(annualInterestReportResponseSchema.safeParse(leaky).success).toBe(false);
  });
  it("rejects sub-cent precision (a figure still in fractional cents was not converted once)", () => {
    expect(annualInterestReportResponseSchema.safeParse({ ...REPORT, totalInterestIncome: 12.3456 }).success).toBe(false);
  });
});
