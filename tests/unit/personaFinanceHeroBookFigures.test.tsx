// @vitest-environment jsdom
/**
 * W10.2b audit (P1) — the Finance hero renders the whole book, not the
 * capped note list.
 *
 * finance.tsx handed PersonaFinanceHero `enrichedNotes` — GET /api/notes,
 * the newest-5,000 table payload — and the hero summed it (through
 * personaFinanceMetrics) into capital deployed, weighted rate/term, notes
 * written, the 12-month origination strip, serviced UPB, fee income, escrow,
 * outstanding principal, book yield and forecast inflow. Past 5,000 notes the
 * page's own headline cards (whole book, SQL) and its hero disagreed.
 *
 * Here GET /api/notes serves a two-note list with small, distinctive sums,
 * and the hero is even handed that list the way the page used to; every
 * figure it shows must be GET /api/notes/book-figures', and it must never
 * read /api/notes. A failed figures read is an error with a retry, never
 * zeros; a pending one is a skeleton, never an empty book.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, type QueryFunction } from "@tanstack/react-query";

const P = vi.hoisted(() => ({ persona: "note_investor" as string }));
vi.mock("@/hooks/use-persona", () => ({
  usePersona: () => P.persona,
  useTerm: () => "Properties",
}));

import { PersonaFinanceHero } from "../../client/src/components/finance/PersonaFinanceHero";
import { usd } from "../../client/src/lib/format";

const VOLUME = Array.from({ length: 12 }, (_, i) => ({
  month: `${i < 2 ? 2025 : 2026}-${String(((i + 10) % 12) + 1).padStart(2, "0")}`,
  amount: i === 7 ? 777_000 : 0,
}));
const BOOK = {
  activeCount: 6200,
  totalOutstanding: 12_500_000,
  totalMonthly: 310_000,
  totalFinanced: 15_000_000,
  weightedRate: 9.25,
  averageRate: 8.5,
  averageTermMonths: 119.6,
  delinquentCount: 41,
  totalServiceFees: 1234,
  taxEscrowCount: 300,
  mostDelinquent: null,
  bookYield: 9.37,
  feeScheduledCount: 40,
  notesWritten: 7001,
  capitalDeployed: 15_900_000,
  principalWeightedRate: 7.77,
  principalWeightedTermMonths: 143.4,
  escrowAccounts: 321,
  escrowUnderManagement: 654_321,
  originationVolume: VOLUME,
  originationsInWindow: 55,
  originationTimeZone: "UTC",
};
const SUMMARY = {
  totalNotes: 2,
  activeNotes: 2,
  totalPortfolioValue: 2222,
  totalMonthlyPayment: 66,
  monthlyCashFlow: [],
  monthlyBreakdownByType: [],
  delinquentCount: 41,
  delinquencyRate: 0.66,
};
// The capped list: if anything summed it, these would show instead.
const note = (id: number) => ({
  id, status: "active", createdAt: new Date().toISOString(),
  currentBalance: "1111", originalPrincipal: "2222", monthlyPayment: "33", interestRate: "4",
  termMonths: 12, serviceFee: "5", taxEscrowEnabled: true, taxEscrowBalance: "17",
});
const LIST = [note(1), note(2)];

let figures: unknown = BOOK; // a number = HTTP error status; "hang" = never answers
const urls: URL[] = [];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  figures = BOOK;
  urls.length = 0;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      urls.push(url);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.pathname === "/api/notes/book-figures") {
        if (figures === "hang") return new Promise<Response>(() => {});
        return typeof figures === "number" ? json({ error: "boom", message: "boom" }, figures) : json(figures);
      }
      if (url.pathname === "/api/finance/portfolio-summary") return json(SUMMARY);
      if (url.pathname === "/api/notes") return json(LIST);
      return json({}, 404);
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// The app's default queryFn fetches queryKey[0]; the hero's summary query relies on it.
const defaultQueryFn: QueryFunction = async ({ queryKey }) => {
  const res = await fetch(String(queryKey[0]), { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

async function show(until: () => boolean, ticks = 200) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: defaultQueryFn } } });
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        // Handed the capped list exactly as finance.tsx used to hand it.
        React.createElement(PersonaFinanceHero as unknown as React.FC<{ notes: unknown }>, { notes: LIST }),
      ),
    );
  });
  for (let i = 0; i < ticks && !until(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  return container.textContent ?? "";
}
const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
const shown = (id: string) => () => byTestId(id) !== null;
const figuresUrl = () => urls.find((u) => u.pathname === "/api/notes/book-figures");

describe("PersonaFinanceHero renders the whole book's figures", () => {
  it("note_originator: capital deployed, notes written, weighted rate/term and the 12-month strip", async () => {
    P.persona = "note_originator";
    await show(shown("text-orig-capital"));
    expect(byTestId("text-orig-capital")).toBe(usd(15_900_000, { noCents: true }));
    expect(byTestId("text-orig-count")).toBe("7001");
    expect(byTestId("text-orig-rate")).toBe("7.77%");
    expect(byTestId("text-orig-term")).toBe("143 mo");
    const strip = container.querySelector('[role="img"]');
    expect(strip?.getAttribute("aria-label")).toContain(usd(777_000, { noCents: true }));
    expect(container.textContent).not.toContain(usd(4444, { noCents: true }));
  });

  it("note_originator: no originations inside the window is the honest empty strip", async () => {
    P.persona = "note_originator";
    figures = { ...BOOK, originationsInWindow: 0, originationVolume: VOLUME.map((v) => ({ ...v, amount: 0 })) };
    const text = await show(shown("text-orig-capital"));
    expect(text).toContain("No origination dates on file yet");
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it("note_servicer: fee income, escrow under management, serviced book", async () => {
    P.persona = "note_servicer";
    await show(shown("text-svc-book"));
    expect(byTestId("text-svc-fee-income")).toBe(usd(1234, { noCents: true }));
    expect(byTestId("text-svc-escrow")).toBe(usd(654_321, { noCents: true }));
    expect(container.textContent).toContain("321 accounts");
    expect(byTestId("text-svc-book")).toBe(usd(12_500_000, { noCents: true }));
    expect(container.textContent).toContain("6200 notes");
    expect(byTestId("text-svc-delinquency")).toBe("0.7%");
  });

  it("note_servicer: no fee on any active note is 'Not tracked yet', not $0", async () => {
    P.persona = "note_servicer";
    figures = { ...BOOK, feeScheduledCount: 0, totalServiceFees: 0 };
    await show(shown("text-svc-fee-income"));
    expect(byTestId("text-svc-fee-income")).toBe("Not tracked yet");
  });

  it("note_investor: outstanding principal, performing, book yield, forecast inflow", async () => {
    P.persona = "note_investor";
    await show(shown("text-inv-upb"));
    expect(byTestId("text-inv-upb")).toBe(usd(12_500_000, { noCents: true }));
    expect(byTestId("text-inv-performing")).toBe("6159/ 6200");
    expect(container.textContent).toContain("41 delinquent");
    // The UPB-weighted coupon over every active note — not the widgets' filtered weightedRate.
    expect(byTestId("text-inv-yield")).toBe("9.37%");
    expect(byTestId("text-inv-inflow")).toBe(usd(310_000, { noCents: true }));
    expect(container.textContent).not.toContain(usd(2222, { noCents: true }));
  });

  it("asks for the viewer's zone so the origination months are the viewer's", async () => {
    P.persona = "note_originator";
    await show(shown("text-orig-capital"));
    expect(figuresUrl()?.searchParams.get("tz")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  for (const persona of ["note_originator", "note_servicer", "note_investor"]) {
    it(`${persona}: a failed figures read is an error with a retry, never zeros`, async () => {
      P.persona = persona;
      figures = 500;
      await show(shown("note-hero-error"));
      expect(container.querySelector('[data-testid="note-hero-error"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="note-hero-error-retry-button"]')).not.toBeNull();
      expect(container.textContent).not.toContain("$0");
      expect(container.querySelector('[data-testid^="text-orig-"],[data-testid^="text-svc-"],[data-testid^="text-inv-"]')).toBeNull();
    });

    it(`${persona}: a pending figures read is a skeleton, not an empty book`, async () => {
      P.persona = persona;
      figures = "hang";
      await show(() => false, 20);
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(container.textContent).not.toContain("$0");
      expect(container.textContent).not.toContain("No origination dates");
      expect(container.querySelector('[data-testid^="text-orig-"],[data-testid^="text-svc-"],[data-testid^="text-inv-"]')).toBeNull();
    });
  }
});

afterEach(() => {
  // The hero never reads the capped list, and always reads the book.
  expect(urls.map((u) => u.pathname)).not.toContain("/api/notes");
  expect(figuresUrl()).toBeDefined();
});
