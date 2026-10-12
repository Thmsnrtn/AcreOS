// @vitest-environment jsdom
/**
 * "Make this a deal" on the lead detail (MakeDealAction).
 *
 * Pins what a customer meets, through the rendered component with a fetch
 * mock (repo pattern: react-dom/client + QueryClientProvider, no
 * @testing-library):
 *   - loading is a Skeleton, a failed read is QueryErrorState (with retry);
 *   - a lead missing parcel facts shows WHICH ones to add (the shared rule's
 *     own wording) with an "Edit lead" CTA — and no convert button;
 *   - a ready lead's button POSTs the conversion and lands on the new deal;
 *   - a parcel that already has an open deal opens it instead — no POST.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const navigate = vi.fn();
vi.mock("wouter", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => React.createElement("a", { href: "#" }, children),
  useLocation: () => ["/leads/7", navigate],
}));

import { MakeDealAction } from "../../client/src/components/leads/MakeDealAction";

type Route = { status: number; body: unknown } | "pending";
const routes: { state: Route; convert: Route } = {
  state: { status: 200, body: {} },
  convert: { status: 200, body: {} },
};
const calls: Array<{ method: string; url: string }> = [];

function reply(r: Route): Promise<Response> {
  if (r === "pending") return new Promise(() => {});
  return Promise.resolve(
    new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } }),
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calls.length = 0;
  navigate.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url.endsWith("/deal-state")) return reply(routes.state);
      if (url.endsWith("/convert-to-deal") && method === "POST") return reply(routes.convert);
      return reply({ status: 200, body: [] });
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

async function flush() {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(onEdit?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client }, React.createElement(MakeDealAction, { leadId: 7, onEdit })),
    );
  });
  await flush();
}

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe("MakeDealAction", () => {
  it("shows a Skeleton while the lead's deal state loads", async () => {
    routes.state = "pending";
    await mount();
    expect(q("make-deal-loading")).not.toBeNull();
    expect(q("button-make-deal")).toBeNull();
  });

  it("shows QueryErrorState when the read fails", async () => {
    routes.state = { status: 500, body: { message: "boom" } };
    await mount();
    expect(q("make-deal-error")).not.toBeNull();
    expect(q("button-make-deal")).toBeNull();
  });

  it("names the missing parcel facts and offers the edit form — no convert button", async () => {
    routes.state = { status: 200, body: { ready: false, reason: "missing", missing: ["county", "acreage"], existingDealId: null } };
    const onEdit = vi.fn();
    await mount(onEdit);
    expect(q("make-deal-missing")?.textContent).toContain("Add the county and the acreage to this lead before making it a deal.");
    expect(q("button-make-deal")).toBeNull();
    await act(async () => q("button-make-deal-edit-lead")!.click());
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("converts a ready lead and lands on the new deal", async () => {
    routes.state = { status: 200, body: { ready: true, reason: null, missing: [], existingDealId: null } };
    routes.convert = { status: 200, body: { deal: { id: 42 }, property: { id: 9 }, createdDeal: true, createdProperty: true } };
    await mount();
    const button = q("button-make-deal")!;
    expect(button.textContent).toContain("Make this a deal");
    await act(async () => button.click());
    await flush();
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["/api/leads/7/convert-to-deal"]);
    expect(navigate).toHaveBeenCalledWith("/deals/42");
  });

  it("a refused conversion stays on the lead and does not navigate", async () => {
    routes.state = { status: 200, body: { ready: true, reason: null, missing: [], existingDealId: null } };
    routes.convert = { status: 400, body: { message: "Add the county to this lead before making it a deal. Nothing was created." } };
    await mount();
    await act(async () => q("button-make-deal")!.click());
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the existing open deal for the parcel instead of converting again", async () => {
    routes.state = { status: 200, body: { ready: true, reason: null, missing: [], existingDealId: 31 } };
    await mount();
    expect(q("button-make-deal")).toBeNull();
    await act(async () => q("button-open-lead-deal")!.click());
    expect(navigate).toHaveBeenCalledWith("/deals/31");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("MakeDealAction is mounted where a customer meets it", () => {
  it("the lead detail renders it (comments stripped, so a mention is not a mount)", () => {
    const src = stripComments(
      fs.readFileSync(path.resolve(__dirname, "../../client/src/components/lead-detail-content.tsx"), "utf8"),
    );
    expect(src).toMatch(/<MakeDealAction\s+leadId=\{lead\.id\}/);
  });
});
