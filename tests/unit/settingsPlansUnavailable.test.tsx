// @vitest-environment jsdom
/**
 * Settings → Billing when Stripe is not configured.
 *
 * GET /api/stripe/products answers 503 SERVICE_UNAVAILABLE ("Plan catalog is
 * unavailable right now.") on a deployment with no Stripe key. Measured on this
 * tree before the change: the page did NOT crash — the plans section already
 * fell to a "Couldn't load plans" QueryErrorState — but the hook threw
 * "Failed to fetch products", which QueryErrorState classifies as a NETWORK
 * failure (WifiOff, "Offline"), the server's explanation was discarded, and a
 * 503 that no retry can fix was retried.
 *
 * Driven through the real hook (`useStripeProducts`) and the real component the
 * page renders (`AvailablePlansError`); the last test pins that settings.tsx
 * renders that component in its error branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useStripeProducts } from "../../client/src/hooks/use-organization";
import { AvailablePlansError } from "../../client/src/components/billing/AvailablePlansError";
import { stripComments } from "../helpers/stripComments";

const F = vi.hoisted(() => ({ status: 503, calls: 0 }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  F.calls = 0;
  globalThis.fetch = vi.fn(async () => {
    F.calls++;
    const body =
      F.status === 503
        ? { error: "SERVICE_UNAVAILABLE", message: "Plan catalog is unavailable right now.", statusCode: 503 }
        : { error: "INTERNAL_ERROR", message: "Something broke on our end.", statusCode: 500 };
    return { ok: false, status: F.status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Plans() {
  const q = useStripeProducts();
  if (q.isLoading) return React.createElement("div", { "data-testid": "loading" });
  if (q.isError) {
    return React.createElement(AvailablePlansError, { error: q.error, onRetry: () => void q.refetch(), isRetrying: q.isRefetching });
  }
  return React.createElement("div", { "data-testid": "plans" });
}

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Plans)));
  });
  for (let i = 0; i < 20 && container.querySelector('[data-testid="loading"]'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

describe("plans section with Stripe unconfigured (503)", () => {
  it("renders the unavailable panel in the server's words — not 'Offline', not a crash", async () => {
    F.status = 503;
    await render();
    const card = container.querySelector('[data-testid="error-available-plans"]');
    expect(card, "the error panel did not render").not.toBeNull();
    const text = card!.textContent ?? "";
    expect(text).toContain("Couldn't load plans");
    expect(text).toContain("Plan catalog is unavailable right now.");
    expect(text).toContain("Your current subscription is unaffected");
    expect(text).not.toMatch(/Offline|connection/i);
  });

  it("does not retry a 503 on its own, and the retry button re-asks", async () => {
    F.status = 503;
    await render();
    expect(F.calls).toBe(1);
    const retry = container.querySelector('[data-testid="error-available-plans-retry-button"]') as HTMLButtonElement;
    expect(retry, "retry affordance missing").not.toBeNull();
    await act(async () => {
      retry.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(F.calls).toBe(2);
    expect(container.querySelector('[data-testid="error-available-plans"]')).not.toBeNull();
  });

  it("a transient failure (500) keeps the display-issue copy", async () => {
    F.status = 500;
    await render();
    const text = container.querySelector('[data-testid="error-available-plans"]')?.textContent ?? "";
    expect(text).toContain("this is just a display issue");
  });

  it("settings.tsx renders AvailablePlansError in the plans error branch", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../client/src/pages/settings.tsx"), "utf8"));
    expect(src).toMatch(/productsError \? \(\s*<AvailablePlansError\b/);
  });
});
