// @vitest-environment jsdom
/**
 * Rent roll: an empty open-balances list is not "paid in full" (P1-C item 6).
 *
 * /api/rent/aging returns ONLY charges with balance_cents > 0, and nothing
 * posts rent charges on its own — so the empty state rendered over an empty
 * ledger and told the operator, celebratorily, "Every recorded charge is paid
 * in full." This renders the REAL page with an empty aging response and
 * asserts it does not claim payment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The page chrome needs the app's Pax-rail provider; the content under test
// does not. Render children directly.
vi.mock("../../client/src/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import RentRollPage, { RENT_ROLL_EMPTY_COPY } from "../../client/src/pages/rent-roll";

let container: HTMLDivElement;
let root: Root;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/rent/aging")) {
      return json({
        asOf: "2026-10-20",
        totalsByBucket: { current: { count: 0, totalCents: 0 } },
        charges: [],
      });
    }
    if (url.includes("/api/leases")) return json({ leases: [] });
    if (url.includes("/api/late-fee-rules")) return json({ rules: [] });
    return json({});
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

describe("rent roll empty state", () => {
  it("over an empty aging response, never says 'paid in full'", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json(),
        },
      },
    });
    await act(async () => {
      root.render(<QueryClientProvider client={client}><RentRollPage /></QueryClientProvider>);
    });
    await flush();
    const empty = container.querySelector('[data-testid="rent-roll-empty"]');
    expect(empty, "empty state rendered").not.toBeNull();
    const text = empty!.textContent ?? "";
    expect(text).not.toMatch(/paid in full/i);
    expect(text).not.toMatch(/every recorded charge is paid/i);
    expect(text).toContain(RENT_ROLL_EMPTY_COPY.headline);
    expect(text).toMatch(/not confirmation that rent was paid/i);
  });

  it("the copy itself never claims payment", () => {
    const all = `${RENT_ROLL_EMPTY_COPY.headline} ${RENT_ROLL_EMPTY_COPY.subtitle}`;
    expect(all).not.toMatch(/paid in full|all paid|fully paid|caught up/i);
  });
});
