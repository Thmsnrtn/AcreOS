// @vitest-environment jsdom
/**
 * DEFECT-0113 — a county request that failed is not a logged request.
 *
 * RequestCountyCTA's onError flipped to the "Coverage requested … We'll
 * prioritize it" confirmation, so when the POST failed nothing was recorded
 * and the user was told it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const API = vi.hoisted(() => ({ fail: true, calls: 0 }));
vi.mock("../../client/src/lib/queryClient", () => ({
  apiRequest: vi.fn(async () => {
    API.calls++;
    if (API.fail) throw new Error("503: service unavailable");
    return { json: async () => ({ status: "discovering", queueId: 1 }) };
  }),
}));
const TOASTS = vi.hoisted(() => ({ list: [] as Array<{ title?: string; variant?: string }> }));
vi.mock("../../client/src/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: { title?: string; variant?: string }) => TOASTS.list.push(t) }),
}));
vi.mock("../../client/src/lib/clientLogger", () => ({ clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { RequestCountyCTA } from "../../client/src/components/maps/RequestCountyCTA";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  API.fail = true;
  API.calls = 0;
  TOASTS.list.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function submit() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client }, React.createElement(RequestCountyCTA, { defaultState: "TX", defaultCounty: "Bastrop" })),
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

describe("RequestCountyCTA — failure is reported as failure (DEFECT-0113)", () => {
  it("a failed POST does NOT show the 'Coverage requested' confirmation", async () => {
    await submit();
    expect(API.calls).toBe(1);
    expect(container.querySelector('[data-testid="request-county-confirmed"]')).toBeNull();
    expect(container.querySelector('[data-testid="request-county-cta"]')).not.toBeNull();
    expect(TOASTS.list.at(-1)?.variant).toBe("destructive");
  });

  it("a successful POST does show it", async () => {
    API.fail = false;
    await submit();
    expect(container.querySelector('[data-testid="request-county-confirmed"]')).not.toBeNull();
  });
});

describe("coverage status — a resolved row with no live endpoint is not coverage (DEFECT-0113)", () => {
  it("the status resolver never reports `covered` from a queue row", async () => {
    // W10.3 moved the mapping into the shared county vocabulary
    // (shared/geo/countyStatus.ts); the invariant is unchanged: only a live
    // endpoint is coverage, and a queue row — resolved or not — never is.
    const { countyQueueStatusCopy } = await import("../../shared/geo/countyStatus");
    for (const status of ["pending", "in_progress", "failed", "resolved", "exhausted", "anything-else"]) {
      for (const attempts of [0, 3]) {
        expect(["covered", "view_only"], `${status}/${attempts}`).not.toContain(countyQueueStatusCopy({ status, attempts }).status);
      }
    }
    expect(countyQueueStatusCopy({ status: "resolved", attempts: 1 }).status).toBe("unavailable");
    // …and the route maps queue rows through the shared copy (which uses it),
    // not a local table.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-county-coverage.ts"), "utf8"));
    expect(src).toMatch(/countyQueueStatusCopy\(q\)/);
    expect(src).not.toMatch(/resolved:\s*\{\s*status:\s*"covered"/);
    expect(src).not.toMatch(/covered:\s*q\.status === "resolved"/);
  });
});
