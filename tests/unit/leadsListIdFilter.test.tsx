// @vitest-environment jsdom
/**
 * W10.3 — `/leads?listId=<id>` shows the members of one saved county list.
 *
 * The contract puts the `listId` filter on GET /api/leads/paginated (the cursor
 * endpoint), so a list view walks that endpoint and pages it client-side. The
 * failure this pins is the quiet one: a list link that renders the WHOLE book
 * because the filter never reached the request — every lead looks like a list
 * member and nothing on screen says otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../client/src/lib/clientLogger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// The app chrome (PageShell → Pax rail, nav) is not the subject; render the
// page body bare.
vi.mock("../../client/src/components/page-shell", async () => {
  const R = await import("react");
  return { PageShell: ({ children }: { children?: React.ReactNode }) => R.createElement("div", null, children) };
});
const VIEWPORT = vi.hoisted(() => ({ isMobile: false }));
vi.mock("../../client/src/hooks/use-mobile", () => ({
  useIsMobile: () => ({ isMobile: VIEWPORT.isMobile }),
}));
// The page reads the signed-in user for persona vocabulary; Clerk is not the
// subject here.
// The mobile card list is its own surface (and walks the whole book); here it
// only needs to be recognisable when the page switches to it.
vi.mock("../../client/src/components/mobile/MobileLeadList", async () => {
  const R = await import("react");
  return { MobileLeadList: () => R.createElement("div", { "data-testid": "mobile-lead-list" }) };
});
vi.mock("../../client/src/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1", persona: "land_investor" }, isLoading: false, isAuthenticated: true, isFounder: false, authFailCount: 0, logout: () => {} }),
}));

import { useLeadsPaginated, type PaginatedLeadsResponse } from "../../client/src/hooks/use-leads";
import { listIdFromSearch } from "../../client/src/hooks/use-list-builder";

type Call = { url: string };
const NET = { calls: [] as Call[], pages: [] as unknown[], alwaysMore: false };

function lead(id: number, firstName = `F${id}`, over: Record<string, unknown> = {}) {
  return {
    id, firstName, lastName: `L${id}`, email: null, address: null, city: null, state: null, zip: null, phoneNormalized: null,
    propertyAddress: null, apn: null, ...over,
  };
}

beforeEach(() => {
  NET.calls = [];
  NET.pages = [];
  NET.alwaysMore = false;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    NET.calls.push({ url });
    const u = new URL(url, "http://localhost");
    if (u.pathname === "/api/leads/paginated") {
      if (NET.alwaysMore) {
        return new Response(JSON.stringify({ data: [lead(1)], nextCursor: "1", hasMore: true, total: 999999 }), { status: 200 });
      }
      const page = NET.pages.shift();
      return new Response(JSON.stringify(page), { status: 200 });
    }
    if (u.pathname === "/api/leads") {
      return new Response(JSON.stringify({ data: [lead(500)], total: 1, page: 1, pageSize: 2, totalPages: 1 }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function flush(n = 8) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const OUT: { data?: PaginatedLeadsResponse; error?: Error | null } = {};
function Probe(props: Parameters<typeof useLeadsPaginated>[0]) {
  const q = useLeadsPaginated(props);
  OUT.data = q.data;
  OUT.error = q.error;
  return null;
}

async function run(props: Parameters<typeof useLeadsPaginated>[0]) {
  OUT.data = undefined;
  OUT.error = undefined;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe, props)));
  });
  await flush();
}

describe("useLeadsPaginated with a listId", () => {
  it("reads the list's members from the contract endpoint with the listId, walking every cursor page", async () => {
    NET.pages = [
      { data: [lead(9), lead(8), lead(7)], nextCursor: "7", hasMore: true, total: 4 },
      { data: [lead(6)], nextCursor: null, hasMore: false, total: 4 },
    ];
    await run({ page: 2, pageSize: 2, listId: 9137 });
    const urls = NET.calls.map((c) => new URL(c.url, "http://localhost"));
    expect(urls.every((u) => u.pathname === "/api/leads/paginated")).toBe(true);
    expect(urls.map((u) => u.searchParams.get("listId"))).toEqual(["9137", "9137"]);
    expect(urls.map((u) => u.searchParams.get("cursor"))).toEqual([null, "7"]);
    // Page 2 of 2-per-page over the four members.
    expect(OUT.data?.data.map((l: { id: number }) => l.id)).toEqual([7, 6]);
    expect(OUT.data?.total).toBe(4);
    expect(OUT.data?.totalPages).toBe(2);
  });

  it("without a listId the whole-book read is unchanged", async () => {
    await run({ page: 1, pageSize: 2 });
    const u = new URL(NET.calls[0].url, "http://localhost");
    expect(u.pathname).toBe("/api/leads");
    expect(u.searchParams.has("listId")).toBe(false);
    expect(OUT.data?.data.map((l: { id: number }) => l.id)).toEqual([500]);
  });

  it("a list larger than the walk is an error, never a truncated prefix shown as the list", async () => {
    NET.alwaysMore = true;
    await run({ page: 1, pageSize: 25, listId: 3 });
    expect(OUT.error).toBeInstanceOf(Error);
    expect(OUT.data).toBeUndefined();
  });

  it("search inside a list narrows the members and the total", async () => {
    NET.pages = [{ data: [lead(3, "Odalys"), lead(2, "Margit"), lead(1, "Odalys")], nextCursor: null, hasMore: false, total: 3 }];
    await run({ page: 1, pageSize: 25, listId: 12, q: "odalys" });
    expect(OUT.data?.data.map((l: { id: number }) => l.id)).toEqual([3, 1]);
    expect(OUT.data?.total).toBe(2);
  });
});

describe("search inside a list matches what a county list's leads actually carry", () => {
  // A county-records lead has the PARCEL's address (propertyAddress) and its
  // APN — usually no email, phone, or mailing address. A search that ignored
  // those would find nothing in exactly the list it is for.
  const members = () => [
    lead(3, "Odalys", { propertyAddress: "9 Cinder Rd, Flagstaff" }),
    lead(2, "Margit", { apn: "201-33-017A" }),
    lead(1, "Lucius", { propertyAddress: "1 Mesa Ln", apn: "405-11-002" }),
  ];

  it("matches propertyAddress", async () => {
    NET.pages = [{ data: members(), nextCursor: null, hasMore: false, total: 3 }];
    await run({ page: 1, pageSize: 25, listId: 12, q: "cinder" });
    expect(OUT.data?.data.map((l: { id: number }) => l.id)).toEqual([3]);
    expect(OUT.data?.total).toBe(1);
  });

  it("matches apn", async () => {
    NET.pages = [{ data: members(), nextCursor: null, hasMore: false, total: 3 }];
    await run({ page: 1, pageSize: 25, listId: 12, q: "201-33" });
    expect(OUT.data?.data.map((l: { id: number }) => l.id)).toEqual([2]);
    expect(OUT.data?.total).toBe(1);
  });
});

describe("listIdFromSearch", () => {
  it("accepts only a positive integer", () => {
    expect(listIdFromSearch("?listId=9137")).toBe(9137);
    expect(listIdFromSearch("?stage=hot&listId=4")).toBe(4);
    expect(listIdFromSearch("?listId=0")).toBeNull();
    expect(listIdFromSearch("?listId=-2")).toBeNull();
    expect(listIdFromSearch("?listId=4abc")).toBeNull();
    expect(listIdFromSearch("?listId=1e3")).toBeNull();
    expect(listIdFromSearch("?listId=7.0")).toBeNull();
    expect(listIdFromSearch("?listId=")).toBeNull();
    expect(listIdFromSearch("")).toBeNull();
  });
});

describe("the leads page honours ?listId=", () => {
  afterEach(() => {
    VIEWPORT.isMobile = false;
  });

  it.each([
    ["desktop", false, "/leads?listId=9137"],
    // The mobile card list walks the whole book; a list link must not land there.
    ["mobile", true, "/leads?listId=9137"],
  ])("%s: passes the URL's listId to the leads read and says the view is one list", async (_label, mobile, path) => {
    VIEWPORT.isMobile = mobile;
    window.history.pushState({}, "", path);
    NET.pages = [{ data: [lead(41)], nextCursor: null, hasMore: false, total: 1 }];
    const { default: LeadsPage } = await import("../../client/src/pages/leads");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(React.createElement(QueryClientProvider, { client }, React.createElement(LeadsPage)));
    });
    await flush(12);
    const leadReads = NET.calls
      .map((c) => new URL(c.url, "http://localhost"))
      .filter((u) => u.pathname === "/api/leads/paginated" || u.pathname === "/api/leads");
    expect(leadReads.length, "vacuity: the page made no leads read").toBeGreaterThan(0);
    expect(leadReads.some((u) => u.pathname === "/api/leads/paginated" && u.searchParams.get("listId") === "9137")).toBe(true);
    // No whole-book page read stands in for the list.
    expect(leadReads.some((u) => u.pathname === "/api/leads" && u.searchParams.has("page"))).toBe(false);
    expect(container.querySelector('[data-testid="leads-list-scope"]')).not.toBeNull();
  });

  it("mobile: 'Show all leads' switches back to the mobile list (the page follows the router, not a one-off read of the URL)", async () => {
    VIEWPORT.isMobile = true;
    window.history.pushState({}, "", "/leads?listId=9137");
    NET.pages = [{ data: [lead(41)], nextCursor: null, hasMore: false, total: 1 }];
    const { default: LeadsPage } = await import("../../client/src/pages/leads");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(React.createElement(QueryClientProvider, { client }, React.createElement(LeadsPage)));
    });
    await flush(12);
    expect(container.querySelector('[data-testid="mobile-lead-list"]')).toBeNull();
    const clear = container.querySelector('[data-testid="button-clear-list-scope"]') as HTMLButtonElement | null;
    expect(clear, "vacuity: the list banner's clear button did not render").not.toBeNull();
    await act(async () => {
      clear!.click();
    });
    await flush(6);
    expect(window.location.search).not.toContain("listId");
    expect(container.querySelector('[data-testid="leads-list-scope"]')).toBeNull();
    expect(container.querySelector('[data-testid="mobile-lead-list"]')).not.toBeNull();
  });
});
