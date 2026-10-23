// @vitest-environment jsdom
/**
 * Title pre-screen — refuse-not-fabricate (P1-C item 1).
 *
 * Two defects, one surface:
 *   1. The service asserted `titleClearStatus: "clear"`, `hasOpenLiens: false`
 *      and `hasHoa: false` from SILENCE — ATTOM returning no mortgage, or no
 *      provider at all. Absence of a reported lien is not evidence of none.
 *      It also queried ATTOM with the APN as `attomId` (ATTOM's own internal
 *      id), which can resolve to an unrelated property.
 *   2. The page declared a shape the server never sends (issues[] /
 *      titleClear / chainOfTitle), so `result.issues.filter` threw on every
 *      response. Here the page view is rendered with the service's OWN output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { titleSearchService, type TitleSearchResult as ServerResult } from "../../server/services/titleSearchService";
import {
  TitleSearchResultView,
  type TitleSearchResult as PageResult,
} from "../../client/src/pages/title-search";

const ENV_KEYS = ["PROPSTREAM_EMAIL", "PROPSTREAM_PASSWORD", "ATTOM_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function attomNoMortgage() {
  return {
    ok: true,
    json: async () => ({
      property: [
        {
          address: { oneLine: "1 County Rd, Somewhere TN" },
          owner: { owner1: { fullName: "Jane Doe" } },
          sale: { saleTransDate: "2019-04-01", saleAmt: 40000, deedType: "WARRANTY DEED" },
          // no `mortgage` — ATTOM is silent about liens
        },
      ],
    }),
  };
}

describe("titleSearchService — never asserts clear / false from silence", () => {
  it("no provider configured → unverified, nulls, never 'clear'", async () => {
    const r = await titleSearchService.search("123-456", "TN");
    expect(r.titleClearStatus).not.toBe("clear");
    expect(r.titleClearStatus).toBe("unverified");
    expect(r.hasOpenLiens).toBeNull();
    expect(r.hasHoa).toBeNull();
    expect(r.currentOwner).toBeNull();
  });

  it("ATTOM returns a record with no mortgage → unverified, not 'clear'; HOA unknown", async () => {
    process.env.ATTOM_API_KEY = "k";
    const fetchMock = vi.fn(async () => attomNoMortgage());
    vi.stubGlobal("fetch", fetchMock);
    const r = await titleSearchService.search("123456", "TN", "47187");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.source).toBe("attom");
    expect(r.titleClearStatus).toBe("unverified");
    expect(r.hasOpenLiens).toBeNull();
    expect(r.hasHoa).toBeNull();
  });

  it("ATTOM is queried by apn+fips, never with the APN passed as attomId", async () => {
    process.env.ATTOM_API_KEY = "k";
    const fetchMock = vi.fn(async (_url: string) => attomNoMortgage());
    vi.stubGlobal("fetch", fetchMock);

    // No FIPS → there is no correct ATTOM query for an APN, so none is made.
    await titleSearchService.search("123456", "TN");
    expect(fetchMock).not.toHaveBeenCalled();

    await titleSearchService.search("123456", "TN", "47187");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toMatch(/attomId=/);
    expect(url).toMatch(/[?&]apn=123456/);
    expect(url).toMatch(/[?&]fips=47187/);
  });

  it("an open mortgage is reported as encumbered", async () => {
    process.env.ATTOM_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ property: [{ mortgage: { lenderName: "Bank", amount: 1000 } }] }),
    })));
    const r = await titleSearchService.search("1", "TN", "47187");
    expect(r.titleClearStatus).toBe("encumbered");
    expect(r.hasOpenLiens).toBe(true);
  });
});

describe("title-search page renders the server's real response shape", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderServer(r: ServerResult) {
    // Type-level: the server's result must be assignable to the page's type.
    const asPage: PageResult = r;
    await act(async () => {
      root.render(<TitleSearchResultView result={asPage} />);
    });
    return container.textContent ?? "";
  }

  it("renders the no-provider refusal without crashing and without 'Clear'", async () => {
    const r = await titleSearchService.search("123-456", "TN");
    const text = await renderServer(r);
    expect(container.querySelector('[data-testid="title-search-result"]')).not.toBeNull();
    expect(text).toContain("Not verified");
    expect(text).not.toMatch(/\bClear\b/);
    expect(container.querySelector('[data-testid="text-hoa"]')?.textContent).toBe("Not reported");
    expect(container.querySelector('[data-testid="text-current-owner"]')?.textContent).toBe("Not reported");
    expect(text).toContain("Title data unavailable");
  });

  it("renders a live ATTOM result (deed + no mortgage) as unverified", async () => {
    process.env.ATTOM_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => attomNoMortgage()));
    const r = await titleSearchService.search("123456", "TN", "47187");
    const text = await renderServer(r);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Not verified");
    expect(text).not.toMatch(/\bClear\b/);
    expect(container.querySelector('[data-testid="text-open-lien-count"]')?.textContent).toBe("None reported");
  });
});
