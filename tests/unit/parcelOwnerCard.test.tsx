// @vitest-environment jsdom
/**
 * ParcelOwnerCard — the click-a-parcel owner lookup card (Gap Slice 6).
 *
 * Proves, through the real `useParcelLookup` hook (only the network edge,
 * `apiRequest`, is faked):
 *   - the lookup fires with the right identifier (APN + county path when the
 *     region is known; the tapped coordinate otherwise);
 *   - a 404 renders the honest "not covered" state — no owner, no guess;
 *   - a found parcel with no owner says so instead of inventing one;
 *   - a real failure (500) is NOT dressed up as "not covered".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(`${status}: ${message}`);
      this.status = status;
    }
  }
  return { apiRequest: vi.fn(), FakeApiError };
});

vi.mock("../../client/src/lib/queryClient", () => ({
  apiRequest: h.apiRequest,
  ApiError: h.FakeApiError,
}));

import {
  ParcelOwnerCard,
  parcelLookupRequestFor,
  type ParcelPick,
} from "../../client/src/components/maps/ParcelOwnerCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(pick: ParcelPick, onResolved?: (r: any) => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={qc}>
        <ParcelOwnerCard pick={pick} onClose={() => {}} onResolved={onResolved} />
      </QueryClientProvider>,
    );
  });
  await flush();
  return host;
}

const FOUND = (owner: string | null) => ({
  ok: true,
  json: async () => ({
    apn: "123-45-678",
    boundary: { type: "Polygon", coordinates: [] },
    centroid: { lat: 36.1, lng: -115.1 },
    data: {
      regridId: "r1",
      owner,
      ownerAddress: "1 Main St, Las Vegas NV",
      taxAmount: "$412",
      lastUpdated: "2026-01-01",
      acres: 2.5,
      county: "Clark",
      state: "NV",
    },
  }),
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  h.apiRequest.mockReset();
});

describe("parcelLookupRequestFor", () => {
  it("sends APN + state + county when all are known", () => {
    expect(
      parcelLookupRequestFor({ apn: "9-9", lat: 1, lng: 2, state: "NV", county: "Clark" }),
    ).toEqual({ apn: "9-9", state: "NV", county: "Clark" });
  });

  it("falls back to the tapped coordinate when the region is unknown", () => {
    expect(parcelLookupRequestFor({ apn: "9-9", lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2 });
    expect(parcelLookupRequestFor({ lat: 1, lng: 2, state: "NV" })).toEqual({ lat: 1, lng: 2 });
  });
});

describe("ParcelOwnerCard", () => {
  it("fires the lookup with the parcel's APN and county on mount", async () => {
    h.apiRequest.mockResolvedValue(FOUND("JANE Q DOE"));
    await mount({ apn: "123-45-678", lat: 36.1, lng: -115.1, state: "NV", county: "Clark" });
    expect(h.apiRequest).toHaveBeenCalledTimes(1);
    expect(h.apiRequest).toHaveBeenCalledWith("POST", "/api/parcels/lookup", {
      apn: "123-45-678",
      state: "NV",
      county: "Clark",
    });
  });

  it("fires by coordinate when no region is known", async () => {
    h.apiRequest.mockResolvedValue(FOUND("JANE Q DOE"));
    await mount({ lat: 36.1, lng: -115.1 });
    expect(h.apiRequest).toHaveBeenCalledWith("POST", "/api/parcels/lookup", {
      lat: 36.1,
      lng: -115.1,
    });
  });

  it("renders the owner and parcel facts when the chain returns them", async () => {
    h.apiRequest.mockResolvedValue(FOUND("JANE Q DOE"));
    const onResolved = vi.fn();
    const el = await mount({ lat: 36.1, lng: -115.1 }, onResolved);
    expect(el.querySelector('[data-testid="parcel-owner-name"]')?.textContent).toBe("JANE Q DOE");
    expect(el.textContent).toContain("123-45-678");
    expect(el.textContent).toContain("Clark, NV");
    expect(el.querySelector('[data-testid="parcel-owner-not-covered"]')).toBeNull();
    expect(onResolved).toHaveBeenCalledWith({ state: "NV", county: "Clark" });
  });

  it("says the source names no owner rather than inventing one", async () => {
    h.apiRequest.mockResolvedValue(FOUND(null));
    const el = await mount({ lat: 36.1, lng: -115.1 });
    expect(el.querySelector('[data-testid="parcel-owner-name"]')).toBeNull();
    expect(el.querySelector('[data-testid="parcel-owner-unnamed"]')?.textContent).toMatch(
      /doesn't name an owner/i,
    );
  });

  it("renders the honest not-covered state on a 404 — no owner shown", async () => {
    h.apiRequest.mockRejectedValue(new h.FakeApiError(404, "Parcel not found"));
    const el = await mount({ lat: 10, lng: 10 });
    const state = el.querySelector('[data-testid="parcel-owner-not-covered"]');
    expect(state?.textContent).toMatch(/isn't covered here/i);
    expect(el.querySelector('[data-testid="parcel-owner-name"]')).toBeNull();
    expect(el.querySelector('[data-testid="parcel-owner-error"]')).toBeNull();
  });

  it("does not present a server failure as 'not covered'", async () => {
    h.apiRequest.mockRejectedValue(new h.FakeApiError(500, "boom"));
    const el = await mount({ lat: 10, lng: 10 });
    expect(el.querySelector('[data-testid="parcel-owner-error"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="parcel-owner-not-covered"]')).toBeNull();
  });
});
