// @vitest-environment jsdom
/**
 * The closing-cost surfaces render a refused transfer tax as "Not estimated —
 * <reason>", never "$0", and the page reads the fields the route really sends.
 *
 * ── THE DEFECTS ─────────────────────────────────────────────────────────────
 *  - closing-costs-card.tsx formatted every breakdown amount with fmt$, so a
 *    refused New Jersey transfer tax (served as 0) rendered "$0".
 *  - pages/closing-costs.tsx read `result.transferTax` and `result.total`;
 *    GET /api/recording-fees/closing sends `transferTaxTotal` and
 *    `totalCost`, so both cards rendered from undefined.
 *
 * The page test serves the REAL router's response (supertest against
 * server/routes-recording-fees.ts), so a renamed server field fails here
 * rather than drifting silently. (@testing-library/react is not a dependency;
 * components are mounted through react-dom/client as other page tests do.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express from "express";
import request from "supertest";

vi.mock("../../client/src/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children),
}));

import { TooltipProvider } from "../../client/src/components/ui/tooltip";
import { ClosingCostsCard } from "../../client/src/components/closing-costs-card";
import ClosingCostsPage from "../../client/src/pages/closing-costs";
import recordingFeesRouter from "../../server/routes-recording-fees";
import { estimateClosingCosts as estimateAllIn } from "../../server/services/closingCostEstimator";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(el: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(TooltipProvider, null, el)),
    );
  });
  await flush();
}

describe("ClosingCostsCard", () => {
  it("renders a refused transfer tax as 'Not estimated — <reason>' and never $0, and says the total excludes it", async () => {
    // The estimator's real output for a refused state.
    const body = estimateAllIn("NJ", "Morris", 100_000, undefined, new Date("2026-11-15T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(async () => json(body)));
    await mount(React.createElement(ClosingCostsCard, { state: "NJ", county: "Morris", salePrice: 100_000 }));

    const amounts = Array.from(container!.querySelectorAll('[data-testid="closing-cost-amount"]')).map((n) => n.textContent ?? "");
    expect(amounts.length).toBeGreaterThanOrEqual(3);
    const tt = amounts[1];
    expect(tt).toMatch(/^Not estimated — New Jersey/);
    expect(amounts).not.toContain("$0");
    expect(container!.querySelector('[data-testid="closing-cost-total-excludes"]')?.textContent).toMatch(/The total excludes: Transfer tax/);
  });

  it("renders a computed transfer tax as dollars", async () => {
    const body = estimateAllIn("FL", "Leon", 100_000, undefined, new Date("2026-11-15T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(async () => json(body)));
    await mount(React.createElement(ClosingCostsCard, { state: "FL", county: "Leon", salePrice: 100_000 }));
    const amounts = Array.from(container!.querySelectorAll('[data-testid="closing-cost-amount"]')).map((n) => n.textContent ?? "");
    expect(amounts[1]).toBe("$700");
  });
});

describe("closing-costs page reads the route's real field names", () => {
  const app = express();
  app.use("/api/recording-fees", recordingFeesRouter);

  function serveRealRouter() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const res = await request(app).get(String(url));
        return json(res.body, res.status);
      }),
    );
  }

  function setInput(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function calculate(state: string, county: string, price: string) {
    const inputs = Array.from(container!.querySelectorAll("input")) as HTMLInputElement[];
    await act(async () => {
      setInput(inputs[0], state);
      setInput(inputs[1], county);
      setInput(inputs[2], price);
    });
    const form = container!.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
  }

  it("FL $100,000: transfer tax $700 and total = recording fee + $700", async () => {
    serveRealRouter();
    await mount(React.createElement(ClosingCostsPage));
    await calculate("FL", "Leon", "100000");
    expect(container!.querySelector('[data-testid="closing-transfer-tax"]')?.textContent).toBe("$700.00");
    // FL recording $10/page × 3 pages = $30; total $730.
    expect(container!.querySelector('[data-testid="closing-total"]')?.textContent).toBe("$730.00");
  });

  it("NJ: 'Not estimated — <reason>', the total is the recording fee alone and says what it excludes", async () => {
    serveRealRouter();
    await mount(React.createElement(ClosingCostsPage));
    await calculate("NJ", "Morris", "100000");
    expect(container!.querySelector('[data-testid="closing-transfer-tax"]')?.textContent).toMatch(/^Not estimated — New Jersey/);
    // NJ recording $40/page × 3 pages = $120.
    expect(container!.querySelector('[data-testid="closing-total"]')?.textContent).toBe("$120.00");
    expect(container!.querySelector('[data-testid="closing-total-excludes"]')?.textContent).toMatch(/^Excludes Transfer tax — not estimated/);
  });
});
