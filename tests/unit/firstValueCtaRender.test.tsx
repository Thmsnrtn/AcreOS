// @vitest-environment jsdom
/**
 * Today's first-value CTA, rendered: the land "Make your first offer" button
 * is shown for a land flipper / hybrid with no offer, is gone once the server
 * says an offer exists, is absent for other business types, and links to the
 * blind-offer wizard. Only the network and auth edges are faked; the hooks and
 * the component are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let persona = "land_investor";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { persona } }) }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

import { FirstValueCta } from "../../client/src/components/today/FirstValueCta";

let root: Root | null = null;
let container: HTMLDivElement;
let fetched: string[] = [];

function mockApi(businessType: string | undefined, madeAnOffer: boolean) {
  fetched = [];
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url);
    const body = url.startsWith("/api/organization")
      ? { id: 1, onboardingData: businessType ? { businessType } : {}, investorType: null }
      : url.startsWith("/api/today/first-offer")
        ? { madeAnOffer }
        : url.startsWith("/api/notes/acquired")
          ? { total: 0 }
          : {};
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false,
    gcTime: 0,
    // mirrors the production default queryFn: key segments joined into the URL
    queryFn: async ({ queryKey }) => {
      const res = await fetch((queryKey as string[]).join("/"), { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
  } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<QueryClientProvider client={client}><FirstValueCta /></QueryClientProvider>);
  });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

beforeEach(() => { persona = "land_investor"; });
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

const cta = () => container.querySelector('[data-testid="button-first-value-cta"]') as HTMLAnchorElement | null;

describe("land first-offer CTA, rendered", () => {
  it("shows for a land flipper with no offer, and links to the wizard", async () => {
    mockApi("land_flipper", false);
    await render();
    expect(cta()?.textContent).toBe("Make your first offer");
    expect(cta()?.getAttribute("href")).toBe("/blind-offer-wizard");
  });
  it("shows for the land side of hybrid", async () => {
    mockApi("hybrid", false);
    await render();
    expect(cta()?.textContent).toBe("Make your first offer");
  });
  it("is hidden once an offer exists", async () => {
    mockApi("land_flipper", true);
    await render();
    expect(cta()).toBeNull();
  });
  it("is hidden for a non-land business type and does not even ask", async () => {
    mockApi("commercial", false);
    await render();
    expect(cta()).toBeNull();
    expect(fetched.some((u) => u.startsWith("/api/today/first-offer"))).toBe(false);
  });
  it("is hidden for a note investor persona (the tape CTA is theirs)", async () => {
    persona = "note_investor";
    mockApi("land_flipper", false);
    await render();
    expect(cta()?.textContent).toBe("Import your first tape");
  });
  it("is hidden when the offer lookup fails", async () => {
    mockApi("land_flipper", false);
    vi.stubGlobal("fetch", async (url: string) =>
      url.startsWith("/api/today/first-offer")
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify({ id: 1, onboardingData: { businessType: "land_flipper" } }), { status: 200 }));
    await render();
    expect(cta()).toBeNull();
  });
});
