// @vitest-environment jsdom
/**
 * W2-STR (2026-11-06) — the Bookings tab reaches the three STR routes that had
 * no client caller, and each one through its REAL path:
 *
 *   - Record a stay → POST /api/properties/:id/reservations (the vertical's only
 *     writer; before this the list could only ever be empty). A blank amount is
 *     sent as null — unrecorded — never 0.
 *   - A stay's status → PATCH /api/reservations/:id/status.
 *   - Per-stay P&L → GET /api/reservations/:id/pnl, with loading / error / data
 *     states, and the net shown as "—" (refused) while any line is unrecorded.
 *
 * The real panel, the real apiRequest and the real query client run; only the
 * network (fetch), the server-searched property picker and Radix Select (which
 * jsdom cannot drive) are replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../client/src/components/property-combobox", () => ({
  PropertyCombobox: (p: { onChange: (id: number) => void }) =>
    React.createElement("button", { type: "button", "data-testid": "pick-property", onClick: () => p.onChange(7) }, "pick"),
}));

// Radix Select → a native <select> carrying the trigger's id / aria-label.
vi.mock("../../client/src/components/ui/select", () => {
  const SelectTrigger = (_p: unknown) => null;
  const Select = ({ value, onValueChange, disabled, children }: any) => {
    const kids = React.Children.toArray(children) as any[];
    const trigger = kids.find((c) => c?.type === SelectTrigger);
    return React.createElement(
      "select",
      {
        id: trigger?.props.id,
        "aria-label": trigger?.props["aria-label"],
        value: value ?? "",
        disabled,
        onChange: (e: any) => onValueChange(e.target.value),
      },
      React.createElement("option", { value: "" }, ""),
      ...kids.filter((c) => c?.type !== SelectTrigger),
    );
  };
  return {
    Select,
    SelectTrigger,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: any) => React.createElement("option", { value }, children),
  };
});

import { BookingsPanel } from "../../client/src/components/rentals/bookings-panel";
import { getQueryFn, queryClient } from "../../client/src/lib/queryClient";

const json = (status: number, b: unknown) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const ROW = {
  id: "r1", propertyId: 7, unitId: null, guestName: "Ana", channel: "airbnb",
  checkIn: "2026-10-01", checkOut: "2026-10-04", nights: 3,
  grossBookingCents: 45000, cleaningFeeCents: null, taxesCents: null, payoutCents: null, status: "booked",
};
const METRICS = {
  metrics: { bookedNights: 0, availableNights: null, occupancyBps: null, roomRevenueCents: 0, adrCents: null, revparCents: null },
  window: { start: "2026-10-01", end: "2026-10-31", nights: 30 }, activeUnitCount: 0, availableUnitNights: null, reservationCount: 0,
};
const line = (key: string, label: string, kind: string, amountCents: number | null) =>
  ({ key, label, kind, amountCents, available: amountCents !== null });

let calls: Array<{ method: string; url: string; body: any }>;
let respond: (method: string, url: string) => Response | Promise<Response>;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calls = [];
  Element.prototype.scrollIntoView = vi.fn();
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }) as any;
  }
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = String(input);
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return respond(method, url);
  }));
  queryClient.clear();
  queryClient.setDefaultOptions({
    queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false, gcTime: 0, staleTime: 0 },
    mutations: { retry: false },
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const $ = (sel: string) => host.querySelector(sel) as HTMLElement | null;
const byTestId = (id: string) => $(`[data-testid="${id}"]`);
async function click(el: HTMLElement | null) {
  expect(el).not.toBeNull();
  await act(async () => { el!.click(); });
  await flush();
}
async function setValue(el: HTMLElement | null, value: string) {
  expect(el).not.toBeNull();
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function mountWithProperty() {
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(BookingsPanel)));
  });
  await click(byTestId("pick-property"));
}
const listCalls = () => calls.filter((c) => c.method === "GET" && c.url === "/api/properties/7/reservations");

describe("Record a stay — POST /api/properties/:id/reservations", () => {
  it("the empty list offers the writer; the form posts the real path with blanks as null, and the list refreshes", async () => {
    let recorded = false;
    respond = (method, url) => {
      if (method === "POST" && url === "/api/properties/7/reservations") { recorded = true; return json(200, { reservation: ROW }); }
      if (url === "/api/properties/7/reservations") return json(200, recorded ? { reservations: [ROW], count: 1 } : { reservations: [], count: 0 });
      if (url.startsWith("/api/properties/7/str-metrics")) return json(200, METRICS);
      return json(404, { error: "not_found", message: url });
    };
    await mountWithProperty();

    expect(byTestId("bookings-empty")).not.toBeNull();
    await click(byTestId("bookings-empty-action"));
    expect(byTestId("record-stay-form")).not.toBeNull();

    const submit = byTestId("button-record-stay-submit") as HTMLButtonElement;
    expect(submit.disabled, "no dates yet").toBe(true);
    await setValue($("#stay-check-in"), "2026-10-01");
    await setValue($("#stay-check-out"), "2026-10-01");
    expect(submit.disabled, "check-out must be after check-in").toBe(true);
    await setValue($("#stay-check-out"), "2026-10-04");
    await setValue($("#stay-grossBookingCents"), "-5");
    expect(submit.disabled, "a negative amount is unreadable, not a refund").toBe(true);
    await setValue($("#stay-grossBookingCents"), "450.00");
    await setValue($("#stay-guest"), "  Ana ");
    await setValue($("#stay-channel"), "airbnb");
    expect(submit.disabled).toBe(false);
    const listsBefore = listCalls().length;

    await click(submit);

    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/properties/7/reservations");
    expect(post?.body).toEqual({
      checkIn: "2026-10-01", checkOut: "2026-10-04", guestName: "Ana", channel: "airbnb", status: "booked",
      grossBookingCents: 45000, channelFeeCents: null, cleaningFeeCents: null, taxesCents: null, payoutCents: null,
    });
    expect(listCalls().length).toBeGreaterThan(listsBefore);
    expect(byTestId("row-reservation-r1")).not.toBeNull();
    expect(byTestId("record-stay-form")).toBeNull();
  });
});

describe("a stay's status — PATCH /api/reservations/:id/status", () => {
  it("changing the status sends the real path and refreshes the list", async () => {
    respond = (method, url) => {
      if (method === "PATCH") return json(200, { reservation: { ...ROW, status: "checked_out" } });
      if (url === "/api/properties/7/reservations") return json(200, { reservations: [ROW], count: 1 });
      if (url.startsWith("/api/properties/7/str-metrics")) return json(200, METRICS);
      return json(404, { error: "not_found", message: url });
    };
    await mountWithProperty();
    const listsBefore = listCalls().length;

    await setValue($('select[aria-label="Status of the stay from 2026-10-01"]'), "checked_out");
    await flush();

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toEqual({ method: "PATCH", url: "/api/reservations/r1/status", body: { status: "checked_out" } });
    expect(listCalls().length).toBeGreaterThan(listsBefore);
  });
});

describe("per-stay P&L — GET /api/reservations/:id/pnl", () => {
  function rentalWith(pnl: () => Response | Promise<Response>) {
    respond = (_method, url) => {
      if (url === "/api/reservations/r1/pnl") return pnl();
      if (url === "/api/properties/7/reservations") return json(200, { reservations: [ROW], count: 1 });
      if (url.startsWith("/api/properties/7/str-metrics")) return json(200, METRICS);
      return json(404, { error: "not_found", message: url });
    };
  }

  it("shows a skeleton while loading, then refuses the net while a fee or the expenses are unrecorded", async () => {
    let release!: (r: Response) => void;
    rentalWith(() => new Promise<Response>((r) => { release = r; }));
    await mountWithProperty();
    await click(byTestId("button-stay-pnl-r1"));

    expect(calls.some((c) => c.method === "GET" && c.url === "/api/reservations/r1/pnl")).toBe(true);
    expect(byTestId("stay-pnl-loading-r1")).not.toBeNull();

    await act(async () => {
      release(json(200, {
        reservationId: "r1", stayNights: 3, allocation: null,
        pnl: {
          netCents: null,
          unavailableComponents: ["cleaning_fee", "taxes", "allocated_operating_expense"],
          lines: [
            line("gross_booking", "Gross booking", "income", 45000),
            line("channel_fee", "Channel fee", "deduction", 0),
            line("cleaning_fee", "Cleaning fee", "deduction", null),
            line("taxes", "Taxes", "deduction", null),
            line("allocated_operating_expense", "Allocated operating expense", "deduction", null),
          ],
        },
      }));
    });
    await flush();

    const text = byTestId("stay-pnl-r1")!.textContent!;
    expect(text).toMatch(/Gross booking\$450\.00/);
    expect(text).toMatch(/Channel fee\$0\.00/);
    expect(text).toMatch(/Cleaning feenot recorded/);
    expect(text).toMatch(/Allocated operating expenseno expenses recorded/);
    expect(byTestId("stay-pnl-net-r1")!.textContent).toBe("—");
    expect(text).toMatch(/Net shows once every line above is recorded/);
    expect(text).not.toMatch(/Net\$/);
  });

  it("a fully recorded stay shows its net and how the expense share was spread", async () => {
    rentalWith(() => json(200, {
      reservationId: "r1", stayNights: 3,
      allocation: { allocatedOperatingExpenseCents: 3000, operatingSumCents: 31000, operatingRowCount: 1, windowNights: 31, stayNights: 3 },
      pnl: {
        netCents: 34000, unavailableComponents: [],
        lines: [
          line("gross_booking", "Gross booking", "income", 45000),
          line("channel_fee", "Channel fee", "deduction", 1500),
          line("cleaning_fee", "Cleaning fee", "deduction", 5000),
          line("taxes", "Taxes", "deduction", 1500),
          line("allocated_operating_expense", "Allocated operating expense", "deduction", 3000),
        ],
      },
    }));
    await mountWithProperty();
    await click(byTestId("button-stay-pnl-r1"));

    expect(byTestId("stay-pnl-net-r1")!.textContent).toBe("$340.00");
    const text = byTestId("stay-pnl-r1")!.textContent!;
    expect(text).toMatch(/Channel fee−\$15\.00/);
    expect(text).toMatch(/\$310\.00 of operating expenses recorded on this property over their 31 nights/);
  });

  it("a failed read is a retryable error, never a $0 statement", async () => {
    rentalWith(() => json(500, { error: "internal", message: "boom", statusCode: 500 }));
    await mountWithProperty();
    await click(byTestId("button-stay-pnl-r1"));

    expect(byTestId("stay-pnl-error-r1")).not.toBeNull();
    expect(byTestId("stay-pnl-r1")).toBeNull();
    expect(byTestId("stay-pnl-net-r1")).toBeNull();
  });
});
