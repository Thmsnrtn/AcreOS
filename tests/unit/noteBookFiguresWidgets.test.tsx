// @vitest-environment jsdom
/**
 * W10.2b audit — the note widgets render the server's whole-book figures,
 * not a sum over the note list.
 *
 * GET /api/notes is the capped newest-5,000 table payload. Here it answers
 * a two-note list whose sums are small and distinctive, while
 * GET /api/notes/book-figures answers the whole book. Every note widget —
 * the map strips and the dashboard sets, for each note persona — must show
 * the book's figures, never the list's, and must never read the list at all.
 * A failed figures read is an error, not an empty book.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";

const P = vi.hoisted(() => ({ persona: "note_investor" as string }));
vi.mock("@/hooks/use-persona", () => ({
  usePersona: () => P.persona,
  useTerm: (key: string) => (key === "entity.property" ? "Property" : "Lead"),
}));

import { PersonaMapStrip } from "../../client/src/components/maps/PersonaMapStrip";
import { TypeSpecificWidgets } from "../../client/src/components/dashboard/type-specific-widgets";
import { usd } from "../../client/src/lib/format";

const BOOK = {
  activeCount: 6200,
  totalOutstanding: 12_500_000,
  totalMonthly: 310_000,
  totalFinanced: 15_000_000,
  weightedRate: 9.25,
  averageRate: 8.5,
  averageTermMonths: 119.6,
  delinquentCount: 41,
  totalServiceFees: 1200,
  taxEscrowCount: 300,
  mostDelinquent: { id: 42, borrowerId: 5, borrowerName: "Ada Lovelace", nextPaymentDate: "2026-09-26T11:00:00.000Z", daysLate: 9 },
};
// The capped list: if anything summed it, these would show instead.
const LIST = [
  { id: 1, status: "active", currentBalance: "1111", originalPrincipal: "2222", monthlyPayment: "33", interestRate: "4", termMonths: 12, serviceFee: "5", taxEscrowEnabled: false, nextPaymentDate: null, delinquencyStatus: "current" },
  { id: 2, status: "active", currentBalance: "1111", originalPrincipal: "2222", monthlyPayment: "33", interestRate: "4", termMonths: 12, serviceFee: "5", taxEscrowEnabled: false, nextPaymentDate: null, delinquencyStatus: "current" },
];

let figures: unknown | number = BOOK; // a number = HTTP error status
const paths: string[] = [];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  figures = BOOK;
  paths.length = 0;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      paths.push(url.pathname);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.pathname === "/api/notes/book-figures") {
        return typeof figures === "number" ? json({ error: "boom", message: "boom" }, figures) : json(figures);
      }
      if (url.pathname === "/api/notes") return json(LIST);
      return json({ data: [], total: 0 });
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

async function show(el: React.ReactElement, until: () => boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, el));
  });
  for (let i = 0; i < 200 && !until(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  return container.textContent ?? "";
}
const strip = () => React.createElement(PersonaMapStrip, { properties: [], hasAnyProperties: false });
const widgets = () => React.createElement(TypeSpecificWidgets, { businessType: "note_investor", organizationId: 1 } as never);
const has = (s: string) => () => (container.textContent ?? "").includes(s);
const listSum = usd(2222, { noCents: true }); // what the old code showed for either list sum

describe("the map strips show the book's figures", () => {
  it("note_investor: notes, outstanding and weighted yield are the server's", async () => {
    P.persona = "note_investor";
    const text = await show(strip(), has("6200"));
    expect(text).toContain("6200");
    expect(text).toContain(usd(12_500_000, { noCents: true }));
    expect(text).toContain("9.25%");
    expect(text).not.toContain(listSum);
  });

  it("note_originator: originated and financed are the server's", async () => {
    P.persona = "note_originator";
    const text = await show(strip(), has("originated"));
    expect(text).toContain("6200");
    expect(text).toContain(usd(15_000_000, { noCents: true }));
    expect(text).not.toContain(usd(4444, { noCents: true }));
  });

  it("note_servicer: the most delinquent note and its borrower come from the whole book", async () => {
    P.persona = "note_servicer";
    const text = await show(strip(), has("Ada Lovelace"));
    expect(text).toContain("6200");
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("9d");
  });

  it("a failed figures read is an error with a retry, not an empty book", async () => {
    P.persona = "note_investor";
    figures = 500;
    await show(strip(), () => !!container.querySelector('[data-testid="persona-map-notes-error"]'));
    expect(container.querySelector('[data-testid="persona-map-notes-error"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Import your note portfolio");
  });

  // A query paused offline is pending but NOT loading (isLoading needs a
  // fetch in flight). Branching on `isError || !data` showed the paused
  // strip as a failed read; it is a pending one — render as loading, then
  // the figures once the browser is back online.
  for (const persona of ["note_investor", "note_originator", "note_servicer"]) {
    it(`${persona}: paused offline is pending, not an error — and not an empty book`, async () => {
      P.persona = persona;
      onlineManager.setOnline(false);
      try {
        await show(strip(), () => false);
        expect(container.querySelector('[data-testid="persona-map-notes-error"]')).toBeNull();
        expect(container.textContent).not.toMatch(/Import your note portfolio|Import the book you service|originated/);
      } finally {
        onlineManager.setOnline(true);
      }
      for (let i = 0; i < 200 && !has("6200")(); i++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 5));
        });
      }
      expect(container.textContent).toContain("6200");
    });
  }

  it("an empty book (activeCount 0) is the honest empty state", async () => {
    P.persona = "note_investor";
    figures = { ...BOOK, activeCount: 0, totalOutstanding: 0, weightedRate: null, mostDelinquent: null };
    const text = await show(strip(), has("Import your note portfolio"));
    expect(text).toContain("Import your note portfolio");
  });
});

describe("the dashboard note widgets show the book's figures", () => {
  it("note_investor: outstanding, monthly income, weighted yield", async () => {
    P.persona = "note_investor";
    const text = await show(widgets(), has("Weighted yield"));
    expect(text).toContain(usd(12_500_000, { noCents: true }));
    expect(text).toContain(usd(310_000, { noCents: true }));
    expect(text).toContain("9.25%");
    expect(text).toContain("6200 active notes");
    expect(text).not.toContain(usd(66, { noCents: true }));
  });

  it("note_originator: count, financed, average rate and term", async () => {
    P.persona = "note_originator";
    const text = await show(widgets(), has("Avg term"));
    expect(text).toContain("6200");
    expect(text).toContain(`${usd(15_000_000, { noCents: true })} financed`);
    expect(text).toContain("8.50%");
    expect(text).toContain("120 mo");
  });

  it("note_servicer: delinquent, fees and escrow over the whole book", async () => {
    P.persona = "note_servicer";
    const text = await show(widgets(), has("Tax escrow"));
    expect(text).toContain("41");
    expect(text).toContain(usd(1200, { noCents: true }));
    expect(text).toContain("300/6200");
  });

  it("note_servicer: a failed read is an error, not an empty serviced book", async () => {
    P.persona = "note_servicer";
    figures = 500;
    await show(widgets(), () => !!container.querySelector('[data-testid="note-serv-error"]'));
    expect(container.querySelector('[data-testid="note-serv-error"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Import the book you service");
  });
});

afterEach(() => {
  // No note widget reads the capped list for a figure.
  expect(paths).not.toContain("/api/notes");
  expect(paths).toContain("/api/notes/book-figures");
});
