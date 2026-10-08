// @vitest-environment jsdom
/**
 * A feature-flagged route that is switched off says "not available" — it
 * is not a 404.
 *
 * FlaggedRoute rendered the generic Not Found page when its flag was off. The
 * route exists, the feature exists, it is simply not on for this account; the
 * 404 told the customer the address was wrong or the page deleted, and gave
 * them no reason and no way back into their work. It now renders a neutral
 * EmptyState, inside the app shell, with a call to action back to Today —
 * neutral meaning it promises nothing ("yet") and claims nothing about the
 * account ("for your account") that the flag decision does not establish.
 *
 * Rendered for real (the component, EmptyState and the flag decision), with
 * the auth/flag hooks and the heavy app shell stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const H = vi.hoisted(() => ({
  user: { id: "u1" } as unknown,
  authLoading: false,
  flagsLoading: false,
  enabled: false,
}));

vi.mock("../../client/src/hooks/use-auth", () => ({
  useAuth: () => ({ user: H.user, isLoading: H.authLoading }),
}));
vi.mock("../../client/src/hooks/use-feature-flags", () => ({
  useFeatureFlags: () => ({ isRouteEnabled: () => H.enabled, isLoading: H.flagsLoading }),
}));
// The real shell pulls the sidebar, topbar and banners; the contract under
// test is what renders INSIDE it.
vi.mock("../../client/src/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "page-shell" }, children),
}));
vi.mock("../../client/src/pages/not-found", () => ({
  default: () => React.createElement("div", { "data-testid": "not-found-page" }, "Page not found"),
}));

import { FlaggedRoute } from "../../client/src/components/flagged-route";

const Page = () => React.createElement("div", { "data-testid": "the-real-page" }, "Market intelligence");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  H.user = { id: "u1" };
  H.authLoading = false;
  H.flagsLoading = false;
  H.enabled = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(React.createElement(FlaggedRoute, { route: "/market-intelligence", component: Page }));
  });
}

describe("FlaggedRoute", () => {
  it("flag off: a neutral EmptyState saying the feature isn't available — not Not Found, not the page", async () => {
    await render();
    const state = container.querySelector('[data-testid="flagged-route-unavailable"]');
    expect(state, "the not-available state did not render").not.toBeNull();
    expect(state!.textContent).toContain("This feature isn't available");
    // Read per element: textContent runs the headline into the subtitle
    // ("…availableEverything…"), which would defeat a word-boundary check.
    const parts = ["title", "description"].map(
      (k) => container.querySelector(`[data-testid="flagged-route-unavailable-${k}"]`)?.textContent ?? "",
    );
    expect(parts[0], "vacuity: no headline element").toContain("available");
    for (const text of parts) {
      expect(text, "promises a timeline").not.toMatch(/\byet\b/i);
      expect(text, "claims an account-specific reason").not.toMatch(/for your account/i);
    }
    expect(container.querySelector('[data-testid="not-found-page"]')).toBeNull();
    expect(container.textContent).not.toMatch(/not found/i);
    expect(container.querySelector('[data-testid="the-real-page"]')).toBeNull();
    // Inside the app shell, so the doors stay reachable.
    expect(container.querySelector('[data-testid="page-shell"]')).not.toBeNull();
  });

  it("flag off: the call to action goes back to Today", async () => {
    await render();
    const cta = container.querySelector('[data-testid="flagged-route-go-today"]') as HTMLAnchorElement | null;
    expect(cta, "no call to action").not.toBeNull();
    expect(cta!.getAttribute("href")).toBe("/today");
  });

  it("flag on: the page itself", async () => {
    H.enabled = true;
    await render();
    expect(container.querySelector('[data-testid="the-real-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flagged-route-unavailable"]')).toBeNull();
  });

  it("while flags load: neither the page nor the unavailable state", async () => {
    H.flagsLoading = true;
    await render();
    expect(container.querySelector('[data-testid="route-fallback"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flagged-route-unavailable"]')).toBeNull();
  });
});
