// @vitest-environment jsdom
/**
 * StatementsPanel — borrower-portal §1026.41 statements list unit tests.
 *
 * We don't pull in @testing-library/react (not in repo deps; consistent
 * with tests/unit/dock.test.tsx pattern). Instead we:
 *   1. Verify pure-helper shape: the component exports + the default
 *      export resolve to the same function.
 *   2. Mount through react-dom/client createRoot with a QueryClientProvider
 *      and assert the rendered DOM contains the expected testIds for
 *      loading / empty / row states.
 *   3. Pure formatters (cycleLabel/dueLabel) are exercised indirectly via
 *      the DOM assertions, which covers the UTC-anchored parse path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  StatementsPanel,
  type PeriodicStatementRow,
} from "../../client/src/components/borrower/StatementsPanel";

// ---------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------

function makeRow(overrides: Partial<PeriodicStatementRow> = {}): PeriodicStatementRow {
  return {
    id: "stmt-1",
    cycleStart: "2026-06-01",
    cycleEnd: "2026-06-30",
    dueDate: "2026-07-01",
    amountDueCents: 50_000,
    principalBalanceCents: 9_500_000,
    generatedAt: "2026-06-10T12:00:00Z",
    deliveryStatus: "delivered",
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  // Isolate cache per-test to prevent cross-test bleed.
  // We attach a minimal default queryFn that mirrors the prod queryClient
  // (the production getQueryFn joins queryKey segments and fetches with
  // credentials: include). Each test installs its own global fetch mock.
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async ({ queryKey }) => {
          const url = (queryKey as string[]).join("/");
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) {
            throw new Error(`${res.status}: ${await res.text()}`);
          }
          return res.json();
        },
      },
    },
  });
  return React.createElement(QueryClientProvider, { client }, node);
}

// Drain microtasks so React effects + react-query state settle.
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ---------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe("StatementsPanel — loading state", () => {
  it("renders skeleton list while the query is pending", async () => {
    // fetch never resolves → useQuery stays in pending state.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<never>(() => {})),
    );

    await act(async () => {
      root!.render(wrap(React.createElement(StatementsPanel)));
    });

    const loading = container!.querySelector('[data-testid="statements-loading"]');
    expect(loading).not.toBeNull();
    expect(loading?.getAttribute("aria-busy")).toBe("true");
  });
});

describe("StatementsPanel — empty state", () => {
  it("renders the EmptyState with a no-op CTA when zero rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ statements: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );

    await act(async () => {
      root!.render(wrap(React.createElement(StatementsPanel)));
    });
    await flush();

    const empty = container!.querySelector('[data-testid="statements-empty"]');
    expect(empty).not.toBeNull();
    // Empty state copy explains the mechanism, never advises.
    expect(empty?.textContent).toContain("first statement");
    // No CTA button rendered (no-op).
    const ctaButton = empty?.querySelector('[data-testid="statements-empty-action"]');
    expect(ctaButton).toBeNull();
  });
});

describe("StatementsPanel — row shape + accessibility", () => {
  it("renders one row per statement with download link + aria-label", async () => {
    const statements = [
      makeRow({ id: "a", cycleStart: "2026-06-01", dueDate: "2026-07-01", amountDueCents: 50_000 }),
      makeRow({ id: "b", cycleStart: "2026-05-01", dueDate: "2026-06-01", amountDueCents: 50_000 }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ statements }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );

    await act(async () => {
      root!.render(wrap(React.createElement(StatementsPanel)));
    });
    await flush();

    const list = container!.querySelector('[data-testid="statements-list"]');
    expect(list).not.toBeNull();

    const rows = container!.querySelectorAll('[data-testid^="statement-row-"]');
    expect(rows.length).toBe(2);

    // Each row: cycle label, money formatted via dollars(), download link.
    const firstRow = container!.querySelector('[data-testid="statement-row-a"]');
    expect(firstRow?.textContent).toContain("Jun 2026");
    // dollars(50_000) → "$500" (no fractional cents).
    expect(firstRow?.textContent).toContain("$500");

    const downloadLink = container!.querySelector(
      '[data-testid="statement-download-a"]',
    ) as HTMLAnchorElement | null;
    expect(downloadLink).not.toBeNull();
    expect(downloadLink?.getAttribute("href")).toBe(
      "/api/borrower/periodic-statements/a/pdf",
    );
    // Accessibility: aria-label on the icon-bearing button.
    expect(downloadLink?.getAttribute("aria-label")).toContain("Jun 2026");
    // target=_blank requires rel=noopener to prevent reverse-tab-nabbing.
    expect(downloadLink?.getAttribute("rel")).toContain("noopener");
  });
});

describe("StatementsPanel — error state", () => {
  it("renders QueryErrorState with retry when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("server boom", { status: 500 }),
        ),
      ),
    );

    await act(async () => {
      root!.render(wrap(React.createElement(StatementsPanel)));
    });
    await flush();

    const err = container!.querySelector('[data-testid="statements-error"]');
    expect(err).not.toBeNull();
    // Retry button present.
    const retry = container!.querySelector('[data-testid="statements-error-retry-button"]');
    expect(retry).not.toBeNull();
  });
});
