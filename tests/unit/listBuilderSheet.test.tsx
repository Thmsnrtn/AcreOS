// @vitest-environment jsdom
/**
 * W10.3 — the list builder inside the Map door renders the server's numbers,
 * never its own, and never lets a list be saved against a count, a filter, or
 * a licence the customer was not shown.
 *
 * Mounted through react-dom/client (no @testing-library in deps, same pattern
 * as requestCountyCtaFailure.test.tsx). `fetch` is the only mock: the real
 * apiRequest / ApiError path runs, so a status the component mis-reads is a
 * status the test sees mis-read.
 *
 * Every number in a fixture is distinctive. The contract's identity holds in
 * the fixture (count = alreadyLeads + newLeads + suppressedDeleted +
 * skippedNoApn + skippedDuplicateApn, W10.3 audit fix 4), but no two parts are
 * equal and no part is derivable from a pair of others, so a component that
 * computed one instead of rendering the server's prints a different string.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../client/src/lib/clientLogger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ListBuilderPanel, ListBuilderSheet, FILTER_UNAVAILABLE_REASON } from "../../client/src/components/maps/ListBuilderSheet";
import type {
  CountyListStatus,
  ListBuilderCounty,
  ListBuilderPreview,
} from "../../client/src/hooks/use-list-builder";
import { CHOOSABLE_COUNTY_STATUSES } from "../../client/src/hooks/use-list-builder";
import {
  COUNTY_LIST_STATUSES,
  COUNTY_SOURCE_WENT_DARK_MESSAGE,
  type CountyListStatus as SharedCountyListStatus,
} from "../../shared/geo/countyStatus";

// The client mirrors the server's status vocabulary rather than importing it;
// this pins the mirror to the source at type-check time (check:tests), so a
// status added on the server cannot silently fall outside the client's union.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _statusMirrorIsExact: Same<CountyListStatus, SharedCountyListStatus> = true;
void _statusMirrorIsExact;

// ── fetch router ────────────────────────────────────────────────────

type Reply = { status: number; body: unknown } | "network";
type Call = { method: string; url: string; body: any; headers: Record<string, string> };

const NET = {
  calls: [] as Call[],
  counties: { status: 200, body: { counties: [] } } as { status: number; body: unknown },
  lists: { status: 200, body: { lists: [] } } as { status: number; body: unknown } | "hang",
  preview: [] as Reply[],
  commit: [] as Reply[],
};

/** A reply, or — for "network" — the fetch rejecting with no HTTP status at all (timeout, dropped connection). */
function reply(r: Reply): Response {
  if (r === "network") throw new TypeError("Failed to fetch");
  return json(r.status, r.body);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function installFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    NET.calls.push({ method, url, body, headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
    if (url.startsWith("/api/list-builder/counties")) return json(NET.counties.status, NET.counties.body);
    if (url.startsWith("/api/list-builder/lists")) {
      if (NET.lists === "hang") return new Promise<Response>(() => {});
      return json(NET.lists.status, NET.lists.body);
    }
    if (url.startsWith("/api/list-builder/preview")) {
      const r = NET.preview.shift();
      if (!r) throw new Error("unexpected preview call");
      return reply(r);
    }
    if (url.startsWith("/api/list-builder/commit")) {
      const r = NET.commit.shift();
      if (!r) throw new Error("unexpected commit call");
      return reply(r);
    }
    throw new Error(`unrouted fetch ${method} ${url}`);
  }) as typeof fetch;
}

// ── fixtures ────────────────────────────────────────────────────────

const ALL_FILTERS = { acreage: true, ownerType: true, yearsOwned: true };

function county(over: Partial<ListBuilderCounty> & Pick<ListBuilderCounty, "county" | "status">): ListBuilderCounty {
  return {
    state: "AZ",
    label: `label-${over.status}`,
    message: `message for ${over.county}`,
    filters: ALL_FILTERS,
    ...over,
  };
}

const COUNTIES: ListBuilderCounty[] = [
  county({ county: "Coconino", status: "covered", label: "Covered", message: "Lists can be counted and saved." }),
  county({ county: "Mohave", status: "view_only", label: "View only", message: "Count and preview only — licence not reviewed." }),
  county({ county: "Navajo", status: "discovering", label: "Finding a source", message: "We're finding a source now." }),
  county({ county: "Apache", status: "queued", label: "Requested", message: "Requested; not yet searched." }),
  county({ county: "Gila", status: "unavailable", label: "No public source", message: "Searched; no usable public source." }),
  county({ county: "Greenlee", status: "none", label: "Not requested", message: "Nobody has asked for this one yet." }),
];

function preview(over: Partial<ListBuilderPreview> = {}): ListBuilderPreview {
  return {
    count: 4817,
    sample: [
      { apn: "201-33-017A", owner: "QUILLFEATHER RANCH LLC", acres: 38.72, address: "9 Cinder Rd" },
      { apn: "201-33-018", owner: "ODALYS VANTERPOOL", acres: 5.13, address: null },
      { apn: "201-34-002", owner: null, acres: 160.04, address: "Unit 4 Hwy 89" },
      { apn: null, owner: "MARGIT OSTRANDER TRUST", acres: null, address: "77 Juniper Wy" },
      { apn: "201-35-090", owner: "ESTATE OF LUCIUS PELL", acres: 2.61, address: "1 Mesa Ln" },
    ],
    // 263 + 4011 + 17 + 498 + 28 = 4817 — the contract's identity, with every
    // part distinct.
    alreadyLeads: 263,
    newLeads: 4011,
    suppressedDeleted: 17,
    skippedNoApn: 498,
    skippedDuplicateApn: 28,
    attribution: null,
    cost: {
      pullCredits: 0,
      source: "Coconino County GIS (parcels layer)",
      mailEstimate: { pieceType: "postcard", perPieceCents: 73, totalCents: 4817 * 73 },
    },
    saveable: true,
    saveRefusal: null,
    maxPerList: 25000,
    tooLarge: false,
    status: "covered",
    ...over,
  };
}

// ── harness ─────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  NET.calls = [];
  NET.counties = { status: 200, body: { counties: COUNTIES } };
  NET.lists = { status: 200, body: { lists: [] } };
  NET.preview = [];
  NET.commit = [];
  installFetch();
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

async function mount(el: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, el));
  });
  await flush();
}

const $ = (testId: string, scope: ParentNode = document.body) =>
  scope.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

function text(testId: string): string {
  const el = $(testId);
  expect(el, `vacuity: [data-testid="${testId}"] did not render`).not.toBeNull();
  return (el!.textContent ?? "").replace(/\s+/g, " ").trim();
}

async function click(el: Element | null) {
  expect(el, "vacuity: nothing to click").not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

async function type(el: Element | null, value: string) {
  expect(el, "vacuity: nothing to type into").not.toBeNull();
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush(2);
}

async function pickCoconinoAndCount(reply: Reply) {
  await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
  await click($("county-option-Coconino"));
  NET.preview.push(reply);
  await click($("button-list-count"));
}

const previewCalls = () => NET.calls.filter((c) => c.url.startsWith("/api/list-builder/preview"));
const commitCalls = () => NET.calls.filter((c) => c.url.startsWith("/api/list-builder/commit"));

// ── tests ───────────────────────────────────────────────────────────

describe("status vocabulary", () => {
  it("the choosable statuses are real statuses of the shared vocabulary", () => {
    for (const s of CHOOSABLE_COUNTY_STATUSES) expect(COUNTY_LIST_STATUSES).toContain(s);
    expect([...CHOOSABLE_COUNTY_STATUSES].sort()).toEqual(["covered", "view_only"]);
  });
});

describe("county picker", () => {
  it("asks the server for the state's counties and shows each one's own status label and message", async () => {
    await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
    expect(NET.calls.some((c) => c.method === "GET" && c.url === "/api/list-builder/counties?state=AZ")).toBe(true);
    for (const c of COUNTIES) {
      expect(text(`county-status-${c.county}`)).toBe(c.label);
      expect(text(`county-message-${c.county}`)).toBe(c.message);
    }
  });

  it("only covered and view_only counties can be chosen", async () => {
    await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
    const choosable = COUNTIES.filter((c) => !($(`county-option-${c.county}`) as HTMLButtonElement).disabled).map(
      (c) => c.county,
    );
    expect(choosable.sort()).toEqual(["Coconino", "Mohave"]);

    // A disabled county does not advance to filters; a choosable one does.
    await click($("county-option-Gila"));
    expect($("list-filters")).toBeNull();
    await click($("county-option-Mohave"));
    expect($("list-filters")).not.toBeNull();
    expect($("county-option-Mohave")!.getAttribute("aria-checked")).toBe("true");
  });

  it("a never-requested county offers the existing request-county flow, prefilled", async () => {
    await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
    expect($("button-request-county-Gila")).toBeNull();
    await click($("button-request-county-Greenlee"));
    const form = $("request-county-cta");
    expect(form).not.toBeNull();
    expect((form!.querySelector("#request-county-county") as HTMLInputElement).value).toBe("Greenlee");
    expect((form!.querySelector("#request-county-state") as HTMLInputElement).value).toBe("AZ");
  });

  it("an unavailable county whose source stopped responding offers 'Request it again' — read from the server's message", async () => {
    // The server's own sentence for a source that went dark — the same one the coverage route sends.
    const dark = COUNTY_SOURCE_WENT_DARK_MESSAGE;
    NET.counties = {
      status: 200,
      body: {
        counties: [
          county({ county: "Yavapai", status: "unavailable", label: "Unavailable", message: dark }),
          county({ county: "Gila", status: "unavailable", label: "Unavailable", message: "We searched and found no usable free parcel source for this county." }),
        ],
      },
    };
    await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
    // Still not choosable — a dark source is not a source.
    expect(($("county-option-Yavapai") as HTMLButtonElement).disabled).toBe(true);
    expect(text("button-request-county-Yavapai")).toBe("Request it again");
    // Searched and nothing found: the server says nothing about re-requesting, so neither does the sheet.
    expect($("button-request-county-Gila")).toBeNull();
    await click($("button-request-county-Yavapai"));
    const form = $("request-county-cta");
    expect(form).not.toBeNull();
    expect((form!.querySelector("#request-county-county") as HTMLInputElement).value).toBe("Yavapai");
  });

  it("a counties read that fails is an error with retry, not an empty state", async () => {
    NET.counties = { status: 500, body: { error: "INTERNAL", message: "boom", statusCode: 500 } };
    await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
    expect($("counties-error")).not.toBeNull();
    expect($("counties-empty")).toBeNull();
    expect($("counties-error-retry-button")).not.toBeNull();
  });
});

describe("filters the county cannot answer", () => {
  it("are disabled with their reason, and never sent", async () => {
    NET.counties = {
      status: 200,
      body: { counties: [county({ county: "Coconino", status: "covered", filters: { acreage: false, ownerType: true, yearsOwned: false } })] },
    };
    await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
    await click($("county-option-Coconino"));

    expect(($("input-acreage-min") as HTMLInputElement).disabled).toBe(true);
    expect(($("input-acreage-max") as HTMLInputElement).disabled).toBe(true);
    expect(text("filter-reason-acreage")).toBe(FILTER_UNAVAILABLE_REASON.acreage);
    expect(($("input-years-owned-min") as HTMLInputElement).disabled).toBe(true);
    expect(text("filter-reason-yearsOwned")).toBe(FILTER_UNAVAILABLE_REASON.yearsOwned);

    // The answerable one is live, with no reason printed (non-vacuity).
    expect(($("checkbox-owner-trust") as HTMLButtonElement).disabled).toBe(false);
    expect($("filter-reason-ownerType")).toBeNull();

    await click($("checkbox-owner-trust"));
    NET.preview.push({ status: 200, body: preview() });
    await click($("button-list-count"));
    const sent = previewCalls()[0]?.body;
    expect(sent).toEqual({ state: "AZ", county: "Coconino", ownerTypes: ["trust"] });
    expect(sent).not.toHaveProperty("acreageMin");
    expect(sent).not.toHaveProperty("yearsOwnedMin");
  });

  it("years owned takes whole years from 1 up", async () => {
    await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
    await click($("county-option-Coconino"));
    const years = $("input-years-owned-min") as HTMLInputElement;
    expect(years.getAttribute("min")).toBe("1");
    expect(years.getAttribute("step")).toBe("1");
  });

  it("answerable filters are sent as entered", async () => {
    await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
    await click($("county-option-Coconino"));
    await type($("input-acreage-min"), "4.5");
    await type($("input-acreage-max"), "41");
    await type($("input-years-owned-min"), "12");
    await click($("checkbox-owner-entity"));
    await click($("checkbox-owner-estate"));
    NET.preview.push({ status: 200, body: preview() });
    await click($("button-list-count"));
    expect(previewCalls()[0].body).toEqual({
      state: "AZ",
      county: "Coconino",
      acreageMin: 4.5,
      acreageMax: 41,
      yearsOwnedMin: 12,
      ownerTypes: ["entity", "estate"],
    });
  });
});

describe("preview", () => {
  it("renders the server's exact numbers, sample and cost — computing none of them", async () => {
    await pickCoconinoAndCount({ status: 200, body: preview() });
    expect(text("preview-count")).toBe("4,817 parcels match");
    expect(text("preview-already-leads")).toBe("263");
    expect(text("preview-new-leads")).toBe("4,011");

    const rows = Array.from(document.querySelectorAll('[data-testid="preview-sample-row"]'));
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain("201-33-017A");
    expect(rows[0].textContent).toContain("QUILLFEATHER RANCH LLC");
    expect(rows[0].textContent).toContain("38.72");
    expect(rows[0].textContent).toContain("9 Cinder Rd");
    expect(rows[2].textContent).toContain("160.04");

    expect(text("preview-pull-cost")).toBe("Pull: free, from Coconino County GIS (parcels layer)");
    expect(text("preview-mail-cost")).toBe("Mail estimate (postcard): 4,817 × $0.73 = $3,516.41");
    // Save says what will be SAVED — the server's new / already-yours split —
    // not the raw match count, which includes parcels that will not be.
    expect(text("button-list-save")).toBe("Save list (4,011 new, 263 already yours)");
    expect(text("button-list-save")).not.toContain("4,817");
  });

  it("renders all five parts of the count, each the server's own figure", async () => {
    await pickCoconinoAndCount({ status: 200, body: preview() });
    expect(text("preview-already-leads")).toBe("263");
    expect(text("preview-new-leads")).toBe("4,011");
    expect(text("preview-suppressed-deleted")).toBe("17");
    expect(text("preview-skipped-no-apn")).toBe("498");
    expect(text("preview-skipped-duplicate-apn")).toBe("28");
    expect(text("preview-breakdown")).toContain("Match a lead you deleted — not re-added");
    expect(text("preview-breakdown")).toContain("No parcel number (APN) — not saved");
    expect(text("preview-breakdown")).toContain("Repeat a parcel number in this pull — saved once");
  });

  it("renders the source's attribution line when the server sends one, and none when it doesn't", async () => {
    await pickCoconinoAndCount({ status: 200, body: preview({ attribution: "Parcel data courtesy of Coconino County GIS." }) });
    expect(text("preview-attribution")).toBe("Parcel data courtesy of Coconino County GIS.");
    act(() => root.unmount());
    root = createRoot(container);
    await pickCoconinoAndCount({ status: 200, body: preview() });
    expect($("list-preview")).not.toBeNull();
    expect($("preview-attribution")).toBeNull();
  });

  it("says county leads need a mailing address before mail — the parcel's address is not the owner's", async () => {
    await pickCoconinoAndCount({ status: 200, body: preview() });
    const note = text("preview-mailing-address-note");
    expect(note).toMatch(/parcel's address, not the owner's mailing address/);
    expect(note).toMatch(/skip trac/i);
    expect(note).toMatch(/before (they|it) can be mailed/);
  });

  it("announces the count to screen readers through a polite live region", async () => {
    await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
    await click($("county-option-Coconino"));
    const live = $("preview-live");
    expect(live, "vacuity: the live region must exist BEFORE the count, or its first update is not announced").not.toBeNull();
    expect(live!.getAttribute("role")).toBe("status");
    expect(live!.getAttribute("aria-live")).toBe("polite");
    expect((live!.textContent ?? "").trim()).toBe("");
    NET.preview.push({ status: 200, body: preview() });
    await click($("button-list-count"));
    expect(text("preview-live")).toBe("4,817 parcels match: 4,011 new, 263 already yours.");
  });

  it("with no mail estimate it says the cost is shown at send time — and invents none", async () => {
    await pickCoconinoAndCount({
      status: 200,
      body: preview({ cost: { pullCredits: 0, source: "Coconino County GIS", mailEstimate: null } }),
    });
    expect(text("preview-mail-cost")).toMatch(/shown at send time/);
    expect(text("preview-mail-cost")).not.toMatch(/\$/);
  });

  it("an estimate that is not count × per-piece names no N", async () => {
    await pickCoconinoAndCount({
      status: 200,
      body: preview({ cost: { pullCredits: 0, source: "Coconino County GIS", mailEstimate: { pieceType: "letter", perPieceCents: 91, totalCents: 365001 } } }),
    });
    expect(text("preview-mail-cost")).toBe("Mail estimate (letter): $0.91 per piece, $3,650.01 total");
  });

  it("tooLarge disables Save and says how far over", async () => {
    // Too large to read: the server gives no already/new split (null), and the
    // sheet shows none rather than a zero.
    await pickCoconinoAndCount({
      status: 200,
      body: preview({
        count: 31337,
        tooLarge: true,
        maxPerList: 25000,
        alreadyLeads: null,
        newLeads: null,
        suppressedDeleted: null,
        skippedNoApn: null,
        skippedDuplicateApn: null,
      }),
    });
    expect(text("preview-too-large")).toBe("31,337 parcels match; a list holds up to 25,000 — narrow the filters.");
    expect(text("preview-already-leads")).toBe("—");
    expect(text("preview-new-leads")).toBe("—");
    expect(text("preview-suppressed-deleted")).toBe("—");
    expect(text("preview-skipped-no-apn")).toBe("—");
    expect(text("preview-skipped-duplicate-apn")).toBe("—");
    await type($("input-list-name"), "Too big");
    expect(($("button-list-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("!saveable disables Save and shows the server's refusal", async () => {
    const refusal = "Mohave County's records are view-only until their licence is reviewed; you can count them but not save them.";
    await pickCoconinoAndCount({ status: 200, body: preview({ saveable: false, saveRefusal: refusal, status: "view_only" }) });
    expect(text("preview-save-refusal")).toBe(refusal);
    // Named, in bounds — the refusal alone must hold Save shut.
    await type($("input-list-name"), "Mohave view-only");
    expect(($("button-list-save") as HTMLButtonElement).disabled).toBe(true);
    expect(($("input-list-name") as HTMLInputElement).disabled).toBe(true);
  });

  it("a saveable, in-bounds preview with a name enables Save (non-vacuity for the two above)", async () => {
    await pickCoconinoAndCount({ status: 200, body: preview() });
    expect(($("button-list-save") as HTMLButtonElement).disabled).toBe(true); // no name yet
    await type($("input-list-name"), "Coconino 5-40ac");
    expect(($("button-list-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a 400 shows the server's message inline", async () => {
    const msg = "Coconino County's source has no owner-type field, so ownerTypes can't be answered.";
    await pickCoconinoAndCount({ status: 400, body: { error: "BAD_REQUEST", message: msg, statusCode: 400 } });
    expect(text("preview-bad-request")).toContain(msg);
    expect($("list-preview")).toBeNull();
  });

  it("a 422 refusal is the server's words inline too, not 'try again'", async () => {
    const msg = "Mohave County's records are view-only until their licence is reviewed.";
    await pickCoconinoAndCount({ status: 422, body: { error: "VALIDATION_FAILED", message: msg, statusCode: 422 } });
    expect(text("preview-bad-request")).toContain(msg);
    expect($("preview-error")).toBeNull();
  });

  it("a source failure is an error with retry, never a count", async () => {
    await pickCoconinoAndCount({ status: 502, body: { error: "HTTP_502", message: "county source timed out", statusCode: 502 } });
    expect($("preview-error")).not.toBeNull();
    expect($("list-preview")).toBeNull();
    NET.preview.push({ status: 200, body: preview() });
    await click($("preview-error-retry-button"));
    expect(previewCalls()).toHaveLength(2);
    expect(text("preview-count")).toBe("4,817 parcels match");
  });

  it("only a source failure (502) or no answer at all says 'try again'; a 500 does not promise a retry fixes it", async () => {
    await pickCoconinoAndCount({
      status: 502,
      body: { error: "COUNTY_SOURCE_FAILED", message: "Coconino County's parcel service didn't answer.", statusCode: 502 },
    });
    expect(text("preview-error")).toMatch(/try again/i);

    act(() => root.unmount());
    root = createRoot(container);
    await pickCoconinoAndCount("network");
    expect(text("preview-error")).toMatch(/try again/i);

    act(() => root.unmount());
    root = createRoot(container);
    await pickCoconinoAndCount({ status: 500, body: { error: "INTERNAL", message: "boom", statusCode: 500 } });
    expect($("list-preview")).toBeNull();
    expect(text("preview-error")).not.toMatch(/try again/i);
  });

  it("changing a filter after counting clears the preview, so Save can't use a stale count", async () => {
    await pickCoconinoAndCount({ status: 200, body: preview() });
    expect($("list-preview")).not.toBeNull();
    await type($("input-acreage-min"), "10");
    expect($("list-preview")).toBeNull();
    expect($("button-list-save")).toBeNull();
  });
});

describe("commit", () => {
  async function previewAndName() {
    await mount(React.createElement(ListBuilderPanel, { initialState: "AZ" }));
    await click($("county-option-Coconino"));
    await type($("input-acreage-min"), "5");
    NET.preview.push({ status: 200, body: preview() });
    await click($("button-list-count"));
    await type($("input-list-name"), "Coconino 5ac+");
  }

  it("sends expectedCount = the previewed count, with the previewed filters, and reports the server's totals", async () => {
    await previewAndName();
    // total ≠ created + linkedExisting on purpose: each figure must be the
    // server's own, so no client arithmetic can reproduce this string.
    NET.commit.push({ status: 201, body: { listId: 9137, created: 3989, linkedExisting: 277, total: 4270 } });
    await click($("button-list-save"));
    expect(commitCalls()).toHaveLength(1);
    expect(commitCalls()[0].method).toBe("POST");
    expect(commitCalls()[0].body).toEqual({
      state: "AZ",
      county: "Coconino",
      acreageMin: 5,
      name: "Coconino 5ac+",
      expectedCount: 4817,
    });
    expect(text("commit-success")).toContain("Saved 4,270 leads (3,989 new, 277 already yours).");
    expect(($("link-saved-list-leads") as HTMLAnchorElement).getAttribute("href")).toBe("/leads?listId=9137");
  });

  it("a 409 shows the new count, saves nothing, and asks for a review", async () => {
    await previewAndName();
    NET.commit.push({
      status: 409,
      body: { error: "CONFLICT", message: "the county's records changed; review the new count", details: { count: 4822 }, statusCode: 409 },
    });
    await click($("button-list-save"));
    expect(text("commit-conflict-count")).toBe("4,822");
    expect(text("commit-conflict")).toContain("not the 4,817 you counted");
    expect($("commit-success")).toBeNull();
    expect(($("button-list-save") as HTMLButtonElement).disabled).toBe(true);

    NET.preview.push({ status: 200, body: preview({ count: 4822 }) });
    await click($("button-review-new-count"));
    expect(text("preview-count")).toBe("4,822 parcels match");
    expect($("commit-conflict")).toBeNull();
  });

  it("reads a bare `409 { count }` body too", async () => {
    await previewAndName();
    NET.commit.push({ status: 409, body: { count: 4790 } });
    await click($("button-list-save"));
    expect(text("commit-conflict-count")).toBe("4,790");
  });

  it("sends a STABLE Idempotency-Key: a retry of the same save is the same key; a different save is not", async () => {
    await previewAndName();
    NET.commit.push("network");
    await click($("button-list-save"));
    NET.commit.push({ status: 201, body: { listId: 9137, created: 3989, linkedExisting: 277, total: 4270 } });
    await click($("button-list-save"));
    const [first, second] = commitCalls();
    const k1 = first.headers["Idempotency-Key"];
    expect(k1, "vacuity: the commit carried no Idempotency-Key").toBeTruthy();
    expect(second.headers["Idempotency-Key"]).toBe(k1);
    expect($("commit-success")).not.toBeNull();

    // A fresh mount that re-counts the identical filters (a reload, a second
    // tab) is a NEW preview, so a new save (W10.3 second audit, finding 1).
    // The middleware caches a finished save for 24h; were the key only the
    // request + name + count, a list saved and then DELETED would be
    // "re-saved" by replaying its cached 200 — "Saved 4,270 leads" over a 404
    // link, nothing written. The key carries a nonce minted when the preview
    // arrived, so only a retry of the SAME preview's save is the same save.
    act(() => root.unmount());
    root = createRoot(container);
    await previewAndName();
    NET.commit.push({ status: 201, body: { listId: 9140, created: 3989, linkedExisting: 277, total: 4270 } });
    await click($("button-list-save"));
    expect(commitCalls()[2].headers["Idempotency-Key"]).toBeTruthy();
    expect(commitCalls()[2].headers["Idempotency-Key"]).not.toBe(k1);

    // A different name is a different save.
    act(() => root.unmount());
    root = createRoot(container);
    await previewAndName();
    await type($("input-list-name"), "Coconino 5ac+ (copy)");
    NET.commit.push({ status: 201, body: { listId: 9138, created: 0, linkedExisting: 4266, total: 4266 } });
    await click($("button-list-save"));
    expect(commitCalls()[3].headers["Idempotency-Key"]).not.toBe(k1);
  });

  it("a retry of the same preview's save keeps its key; a NEW preview of identical filters and name gets a new one", async () => {
    await previewAndName();
    NET.commit.push("network");
    await click($("button-list-save"));
    NET.commit.push("network");
    await click($("button-list-save"));
    const [a, b] = commitCalls();
    expect(a.headers["Idempotency-Key"], "vacuity: the commit carried no Idempotency-Key").toBeTruthy();
    expect(b.headers["Idempotency-Key"]).toBe(a.headers["Idempotency-Key"]);

    // Re-count the very same filters (same count, same name): a new preview.
    NET.preview.push({ status: 200, body: preview() });
    await click($("button-list-count"));
    expect(text("preview-count")).toBe("4,817 parcels match");
    NET.commit.push({ status: 201, body: { listId: 9141, created: 3989, linkedExisting: 277, total: 4270 } });
    await click($("button-list-save"));
    const c = commitCalls()[2];
    expect(c.body).toEqual(a.body);
    expect(c.headers["Idempotency-Key"]).toBeTruthy();
    expect(c.headers["Idempotency-Key"]).not.toBe(a.headers["Idempotency-Key"]);
  });

  it("the saved list's required attribution is shown with the success", async () => {
    await previewAndName();
    NET.commit.push({
      status: 200,
      body: { listId: 9142, created: 3989, linkedExisting: 277, total: 4270, attribution: "Parcel data: Coconino County Assessor" },
    });
    await click($("button-list-save"));
    expect(text("commit-attribution")).toBe("Parcel data: Coconino County Assessor");
  });

  it("no attribution line when the source requires none", async () => {
    await previewAndName();
    NET.commit.push({ status: 200, body: { listId: 9143, created: 1, linkedExisting: 0, total: 1, attribution: null } });
    await click($("button-list-save"));
    expect($("commit-success")).not.toBeNull();
    expect($("commit-attribution")).toBeNull();
  });

  it("a different expectedCount is a different save (a re-previewed count never replays the old one)", async () => {
    await previewAndName();
    NET.commit.push({ status: 409, body: { error: "CONFLICT", message: "changed", details: { count: 4822 }, statusCode: 409 } });
    await click($("button-list-save"));
    NET.preview.push({ status: 200, body: preview({ count: 4822, newLeads: 4016 }) });
    await click($("button-review-new-count"));
    NET.commit.push({ status: 201, body: { listId: 9139, created: 3994, linkedExisting: 277, total: 4275 } });
    await click($("button-list-save"));
    const [a, b] = commitCalls();
    expect(b.body.expectedCount).toBe(4822);
    expect(b.headers["Idempotency-Key"]).toBeTruthy();
    expect(b.headers["Idempotency-Key"]).not.toBe(a.headers["Idempotency-Key"]);
  });

  it("no HTTP answer (timeout, dropped connection) does NOT say nothing was saved — it says check Your lists, and re-reads them", async () => {
    await previewAndName();
    const listReadsBefore = NET.calls.filter((c) => c.url.startsWith("/api/list-builder/lists")).length;
    NET.commit.push("network");
    await click($("button-list-save"));
    const msg = text("commit-unconfirmed");
    expect(msg).toMatch(/couldn't confirm/i);
    expect(msg).toMatch(/Your lists/);
    expect(msg).not.toMatch(/nothing was saved/i);
    expect($("commit-error")).toBeNull();
    const listReadsAfter = NET.calls.filter((c) => c.url.startsWith("/api/list-builder/lists")).length;
    expect(listReadsAfter).toBeGreaterThan(listReadsBefore);
    // Saving again is safe — same key — so it stays possible.
    expect(($("button-list-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a gateway 504 is also unconfirmed — the save may have landed behind it", async () => {
    await previewAndName();
    NET.commit.push({ status: 504, body: { error: "GATEWAY_TIMEOUT", message: "upstream timed out", statusCode: 504 } });
    await click($("button-list-save"));
    expect($("commit-unconfirmed")).not.toBeNull();
    expect($("commit-error")).toBeNull();
  });

  it("a 422 structural refusal is the server's words, with no 'try again'", async () => {
    await previewAndName();
    const msg = "No parcels match these filters, so there is nothing to save.";
    NET.commit.push({ status: 422, body: { error: "UNPROCESSABLE", message: msg, statusCode: 422 } });
    await click($("button-list-save"));
    expect(text("commit-error")).toContain(msg);
    expect(text("commit-error")).not.toMatch(/try again/i);
    expect($("commit-unconfirmed")).toBeNull();
  });

  it("a 502 source failure on save says nothing was saved and to try again", async () => {
    await previewAndName();
    NET.commit.push({
      status: 502,
      body: { error: "COUNTY_SOURCE_FAILED", message: "Coconino County's parcel service didn't answer.", statusCode: 502 },
    });
    await click($("button-list-save"));
    expect(text("commit-error")).toMatch(/Nothing was saved/);
    expect(text("commit-error")).toMatch(/try again/i);
    expect($("commit-unconfirmed")).toBeNull();
  });

  it("limitExceeded shows the server's message and no success", async () => {
    await previewAndName();
    const msg = "Saving 4,817 leads would put you over your plan's 1,000-lead limit. Nothing was saved.";
    NET.commit.push({ status: 429, body: { error: "LIMIT_EXCEEDED", message: msg, statusCode: 429, details: {} } });
    await click($("button-list-save"));
    expect(text("commit-error")).toContain(msg);
    expect($("commit-success")).toBeNull();
  });
});

describe("your lists", () => {
  it("renders the server's lists with links to the leads view", async () => {
    NET.lists = {
      status: 200,
      body: {
        lists: [
          { id: 71, name: "Coconino 5ac+", state: "AZ", county: "Coconino", total: 4266, createdAt: "2026-10-01T15:00:00Z" },
          { id: 70, name: "Mohave trusts", state: "AZ", county: "Mohave", total: 381, createdAt: "2026-09-28T15:00:00Z" },
        ],
        total: 14,
      },
    };
    await mount(React.createElement(ListBuilderPanel, {}));
    const rows = Array.from(document.querySelectorAll('[data-testid="list-row"]'));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Coconino 5ac+");
    expect(rows[0].textContent).toContain("Coconino, AZ");
    expect(rows[0].textContent).toContain("4,266");
    expect(rows[0].querySelector("a")!.getAttribute("href")).toBe("/leads?listId=71");
    expect(text("lists-bounded")).toBe("Showing the newest 2 of 14 lists.");
  });

  it("loading is skeleton rows", async () => {
    NET.lists = "hang";
    await mount(React.createElement(ListBuilderPanel, {}));
    expect($("lists-loading")).not.toBeNull();
  });

  it("empty is an EmptyState with a CTA", async () => {
    await mount(React.createElement(ListBuilderPanel, {}));
    expect($("lists-empty")).not.toBeNull();
    expect($("button-start-list")).not.toBeNull();
    // Not every matching parcel is saved (no APN, a deleted lead, a repeat) — the copy must not say it is.
    expect(text("lists-empty")).not.toMatch(/every parcel/i);
  });

  it("a failed read is an error with retry, not 'no lists'", async () => {
    NET.lists = { status: 500, body: { error: "INTERNAL", message: "boom", statusCode: 500 } };
    await mount(React.createElement(ListBuilderPanel, {}));
    expect($("lists-error")).not.toBeNull();
    expect($("lists-empty")).toBeNull();
  });
});

describe("sheet", () => {
  it("mounts the panel inside a titled sheet when open", async () => {
    await mount(React.createElement(ListBuilderSheet, { open: true, onOpenChange: () => {} }));
    const sheet = $("list-builder-sheet");
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("Build a list");
    expect($("list-builder-panel", sheet!)).not.toBeNull();
  });
});
