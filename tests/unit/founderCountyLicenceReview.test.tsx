// @vitest-environment jsdom
/**
 * W10.3 audit fix 3 — the founder's county licence review.
 *
 * Every county_gis_endpoints row defaults to `redistributable =
 * 'review-required'`, which makes its county VIEW-ONLY in the list builder:
 * customers can count it, never save it. Whether an org may save a county's
 * records is a founder licensing decision (Beatrice rule) — so until there is
 * a place to make that decision, no county list can be saved at all.
 *
 * The section lives INSIDE an existing instrument (the Data plane tab of
 * /founder/admin/costs) — no new route, no new nav entry. It lists
 * GET /api/founder/county-endpoints?status=review-required and records a
 * decision per row with PATCH /api/founder/county-endpoints/:id/licence
 * { redistributable, note } — the note required (min 10 chars), because a
 * licence decision without its reason is not reviewable later.
 *
 * Only `fetch` is faked; the real apiRequest/ApiError path runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../client/src/lib/clientLogger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { CountyLicenceReviewSection, COUNTY_ENDPOINTS_REVIEW_URL } from "../../client/src/pages/founder/admin/costs";

type Reply = { status: number; body: unknown } | "hang";
const NET = {
  calls: [] as Array<{ method: string; url: string; body: any }>,
  list: [] as Reply[],
  patch: [] as Reply[],
};

const ENDPOINTS = [
  { id: 311, state: "AZ", county: "Coconino", baseUrl: "https://gis.coconino.az.gov/arcgis/rest/services/Parcels/MapServer/0", redistributable: "review-required", isActive: true },
  { id: 312, state: "AZ", county: "Mohave", baseUrl: "https://mcgis.mohave.gov/arcgis/rest/services/Parcels/FeatureServer/2", redistributable: "review-required", isActive: false },
];

beforeEach(() => {
  NET.calls = [];
  NET.list = [];
  NET.patch = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    NET.calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const queue = method === "PATCH" ? NET.patch : NET.list;
    const r = queue.length > 1 ? queue.shift()! : queue[0];
    if (!r) throw new Error(`unrouted ${method} ${url}`);
    if (r === "hang") return new Promise<Response>(() => {});
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
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

async function flush(n = 6) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(CountyLicenceReviewSection)));
  });
  await flush();
}
const $ = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const text = (id: string) => {
  const el = $(id);
  expect(el, `vacuity: [data-testid="${id}"] did not render`).not.toBeNull();
  return (el!.textContent ?? "").replace(/\s+/g, " ").trim();
};
async function click(el: Element | null) {
  expect(el, "vacuity: nothing to click").not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}
async function typeInto(el: Element | null, value: string) {
  expect(el, "vacuity: nothing to type into").not.toBeNull();
  const ta = el as HTMLTextAreaElement;
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(ta, value);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush(2);
}
function labelFor(el: Element): string | null {
  const id = el.getAttribute("id");
  if (!id) return null;
  // useId() ids contain ":" — match by attribute value rather than a CSS selector.
  const label = Array.from(container.querySelectorAll("label")).find((l) => l.getAttribute("for") === id);
  return label ? (label.textContent ?? "").trim() : null;
}

describe("founder county licence review", () => {
  it("reads the review-required endpoints from the contract URL", async () => {
    NET.list = [{ status: 200, body: { endpoints: ENDPOINTS, total: 2 } }];
    await mount();
    expect(COUNTY_ENDPOINTS_REVIEW_URL).toBe("/api/founder/county-endpoints?status=review-required");
    expect(NET.calls[0]).toMatchObject({ method: "GET", url: "/api/founder/county-endpoints?status=review-required" });
    expect(text("licence-row-311")).toContain("Coconino, AZ");
    expect(text("licence-row-311")).toContain(ENDPOINTS[0].baseUrl);
    expect(text("licence-row-312")).toContain("Mohave, AZ");
    expect(text("licence-row-312")).toMatch(/inactive/i);
  });

  it("says when the list is bounded", async () => {
    NET.list = [{ status: 200, body: { endpoints: ENDPOINTS, total: 57 } }];
    await mount();
    expect(text("licence-review-bounded")).toBe("Showing the newest 2 of 57 awaiting review.");
  });

  it("loading is skeleton rows, empty is an EmptyState, a failed read is an error with retry", async () => {
    NET.list = ["hang"];
    await mount();
    expect($("licence-review-loading")).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    NET.list = [{ status: 200, body: { endpoints: [], total: 0 } }];
    await mount();
    expect($("licence-review-empty")).not.toBeNull();
    expect($("licence-review-error")).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    NET.list = [{ status: 500, body: { error: "INTERNAL", message: "boom", statusCode: 500 } }];
    await mount();
    expect($("licence-review-error")).not.toBeNull();
    expect($("licence-review-empty")).toBeNull();
    expect($("licence-review-error-retry-button")).not.toBeNull();
  });

  it("every control is labelled", async () => {
    NET.list = [{ status: 200, body: { endpoints: ENDPOINTS, total: 2 } }];
    await mount();
    const row = $("licence-row-311")!;
    for (const v of ["yes", "attribution", "no", "review-required"]) {
      const radio = row.querySelector(`[data-testid="licence-311-option-${v}"]`)!;
      expect(radio, `vacuity: option ${v}`).not.toBeNull();
      expect(labelFor(radio), `option ${v} has no label`).toBeTruthy();
    }
    const note = row.querySelector('[data-testid="licence-311-note"]')!;
    expect(labelFor(note)).toMatch(/note/i);
  });

  it("Record stays shut until a posture is chosen AND the note has at least 10 characters", async () => {
    NET.list = [{ status: 200, body: { endpoints: ENDPOINTS, total: 2 } }];
    await mount();
    const save = () => $("licence-311-save") as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    await click($("licence-311-option-attribution"));
    expect(save().disabled).toBe(true); // no note
    await typeInto($("licence-311-note"), "  too short ");
    expect(save().disabled).toBe(true); // 9 chars once trimmed
    await typeInto($("licence-311-note"), "ToS §4 allows reuse with credit line");
    // 'attribution' also needs the credit line itself — this row has none on record.
    expect(save().disabled).toBe(true);
    await typeInto($("licence-311-attribution"), "   ");
    expect(save().disabled).toBe(true);
    await typeInto($("licence-311-attribution"), "Parcel data: Coconino County Assessor");
    expect(save().disabled).toBe(false);
    // Any other posture needs no credit line, and shows no field for one.
    await click($("licence-311-option-yes"));
    expect($("licence-311-attribution")).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it("ATTRIBUTION: the field is labelled, and a row that already carries a credit line shows it and needs no typing", async () => {
    NET.list = [{ status: 200, body: { endpoints: [{ ...ENDPOINTS[0], attribution: "Source: Coconino County GIS" }], total: 1 } }];
    NET.patch = [{ status: 200, body: { id: 311, redistributable: "attribution" } }];
    await mount();
    await click($("licence-311-option-attribution"));
    const field = $("licence-311-attribution") as HTMLInputElement;
    expect(labelFor(field)).toMatch(/attribution|credit/i);
    expect(field.value).toBe("Source: Coconino County GIS");
    await typeInto($("licence-311-note"), "ToS §4 allows reuse with credit line");
    expect(($("licence-311-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("says the WHOLE effect of a decision: saving into customers' CRMs, publishing in public parcel reports — and none for inactive or statewide sources", async () => {
    NET.list = [{ status: 200, body: { endpoints: ENDPOINTS, total: 2 } }];
    await mount();
    const desc = text("licence-review-effect");
    expect(desc).toMatch(/CRM/);
    expect(desc).toMatch(/public parcel report/i);
    expect(desc).toMatch(/inactive/i);
    expect(desc).toMatch(/statewide/i);
    const yes = labelFor($("licence-311-option-yes")!)!;
    expect(yes).toMatch(/public parcel report/i);
  });

  it("records the decision with PATCH /:id/licence { redistributable, note } and re-reads the list", async () => {
    NET.list = [
      { status: 200, body: { endpoints: ENDPOINTS, total: 2 } },
      { status: 200, body: { endpoints: [ENDPOINTS[1]], total: 1 } },
    ];
    NET.patch = [{ status: 200, body: { id: 311, redistributable: "attribution" } }];
    await mount();
    await click($("licence-311-option-attribution"));
    await typeInto($("licence-311-note"), "  ToS §4 allows reuse with credit line  ");
    await typeInto($("licence-311-attribution"), "  Parcel data: Coconino County Assessor ");
    await click($("licence-311-save"));
    const patch = NET.calls.find((c) => c.method === "PATCH");
    expect(patch, "vacuity: no PATCH was sent").toBeTruthy();
    expect(patch!.url).toBe("/api/founder/county-endpoints/311/licence");
    expect(patch!.body).toEqual({
      redistributable: "attribution",
      note: "ToS §4 allows reuse with credit line",
      attribution: "Parcel data: Coconino County Assessor",
    });
    expect(NET.calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(2);
    expect($("licence-row-311")).toBeNull();
    expect($("licence-row-312")).not.toBeNull();
  });

  it("a refused PATCH shows the server's message on that row and records nothing", async () => {
    NET.list = [{ status: 200, body: { endpoints: ENDPOINTS, total: 2 } }];
    NET.patch = [{ status: 400, body: { error: "BAD_REQUEST", message: "note must be at least 10 characters", statusCode: 400 } }];
    await mount();
    await click($("licence-311-option-no"));
    await typeInto($("licence-311-note"), "Terms forbid commercial reuse.");
    await click($("licence-311-save"));
    expect(text("licence-311-error")).toContain("note must be at least 10 characters");
    expect($("licence-row-311")).not.toBeNull();
  });
});
