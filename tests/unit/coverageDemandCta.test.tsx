// @vitest-environment jsdom
/**
 * P1-7 / A-2 — the request CTA attributes its demand.
 *
 * The CTA is the explicit-request surface: when a product surface renders it
 * AT a refusal (passing the affordance's surface + reason), the POST must
 * carry that attribution so the request lands in county_coverage_requests
 * as refusal-sourced demand, not anonymous demand. Rendered bare (the
 * long-standing Maps usage), it still attributes itself to "maps".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const API = vi.hoisted(() => ({ bodies: [] as Array<Record<string, unknown>> }));
vi.mock("../../client/src/lib/queryClient", () => ({
  apiRequest: vi.fn(async (_method: string, _url: string, body: Record<string, unknown>) => {
    API.bodies.push(body);
    return { json: async () => ({ status: "discovering", queueId: 1 }) };
  }),
}));
vi.mock("../../client/src/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
}));
vi.mock("../../client/src/lib/clientLogger", () => ({ clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { RequestCountyCTA } from "../../client/src/components/maps/RequestCountyCTA";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  API.bodies = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function submit(props: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client }, React.createElement(RequestCountyCTA, props as never)),
    );
  });
  const form = container.querySelector('[data-testid="request-county-cta"]') as HTMLFormElement;
  expect(form, "vacuity: the request form did not render").not.toBeNull();
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("RequestCountyCTA — demand attribution (P1-7)", () => {
  it("a refusal-rendered CTA posts its surface + refusal reason", async () => {
    await submit({ defaultState: "WI", defaultCounty: "Dane", surface: "parcel_lookup", reason: "gated" });
    expect(API.bodies).toHaveLength(1);
    expect(API.bodies[0]).toEqual({ state: "WI", county: "Dane", surface: "parcel_lookup", reason: "gated" });
    expect(container.querySelector('[data-testid="request-county-confirmed"]')).not.toBeNull();
  });

  it("the bare Maps usage attributes itself to maps and sends no reason", async () => {
    await submit({ defaultState: "TX", defaultCounty: "Bastrop" });
    expect(API.bodies[0]).toEqual({ state: "TX", county: "Bastrop", surface: "maps" });
  });
});
