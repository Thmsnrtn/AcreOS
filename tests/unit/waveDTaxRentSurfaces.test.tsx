// @vitest-environment jsdom
/**
 * Wave D customer surfaces — the honesty + arithmetic claims, pinned.
 *
 * Wave D shipped working, mounted APIs with no client surface: the tax-sale CSV
 * lot-list import, the won-bid → certificate handoff with its session budget,
 * the 51-jurisdiction rule library, and the rent ledger's allocation /
 * deposit-clock / late-fee-proposal chain. These tests mount the three real
 * pages against a fetch mock and assert the six claims that would be
 * catastrophic to get wrong — each one a way a surface could LIE:
 *
 *   1. A bad CSV row is reported as an error, with the offending value quoted,
 *      and is NOT counted among the rows that will be imported.
 *   2. One "Won" tap produces exactly ONE certificate and the session budget's
 *      remaining capital decrements by the amount actually bid.
 *   3. A jurisdiction with no encoded rule renders "not encoded" — never a
 *      default rate, never a median-state fallback.
 *   4. The not-attorney-reviewed caveat is on the rule surfaces, and a
 *      reference-only state's absent interest rate renders as words, not 0.00%.
 *   5. A payment spanning two charges renders its allocation TO THE CENT, and
 *      posts one ledger line per charge with those exact amounts.
 *   6. A late fee is a PROPOSAL: nothing is charged until the operator confirms
 *      the exact figure.
 *
 * Mounted via react-dom/client + QueryClientProvider with a global fetch mock
 * (repo pattern — see teamChatPanel.test.tsx / assignmentPanel.test.tsx; no
 * @testing-library). No DATABASE_URL is required: nothing here imports server
 * code, and the rent-roll page's arithmetic comes from the pure shared modules.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "../../client/src/lib/queryClient";

// PageShell drags in the sidebar, topbar and the Pax rail context — none of
// which these assertions are about.
vi.mock("@/components/page-shell", async () => {
  const react = await import("react");
  return {
    PageShell: ({ children }: { children: React.ReactNode }) =>
      react.createElement("div", { "data-testid": "page-shell" }, children),
  };
});
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => ({ isMobile: false }),
  useIsTablet: () => ({ isTablet: false }),
}));
vi.mock("@/components/mobile/CourthouseMode", async () => {
  const react = await import("react");
  return { CourthouseMode: () => react.createElement("div", null, "courthouse-mode") };
});

import AuctionWorksheetPage from "../../client/src/pages/auction-worksheet";
import StateRulesPage from "../../client/src/pages/state-rules";
import RentRollPage from "../../client/src/pages/rent-roll";

const CAVEAT =
  "Preliminary — not attorney-reviewed. Confirm against the state code and the county clerk before relying on this.";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

let calls: FetchCall[] = [];

type Handler = (call: FetchCall) => { status?: number; body: unknown } | undefined;

function installFetch(handler: Handler) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
    const call: FetchCall = { url, method, body };
    calls.push(call);
    const res = handler(call);
    if (!res) {
      return Promise.resolve(
        new Response(JSON.stringify({ message: `unhandled ${method} ${url}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(res.body), {
        status: res.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function wrap(node: React.ReactNode) {
  return React.createElement(QueryClientProvider, { client: queryClient }, node);
}

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(node: React.ReactNode) {
  await act(async () => {
    root!.render(wrap(node));
  });
  await flush();
}

function text(): string {
  return container?.textContent ?? "";
}

function byTestId(id: string): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? null;
}

/** Radix portals render outside the container — search the whole document. */
function docTestId(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function docText(): string {
  return document.body.textContent ?? "";
}

async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

async function typeInto(el: Element | null, value: string) {
  expect(el).not.toBeNull();
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  calls = [];
  Element.prototype.scrollIntoView = vi.fn();
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  queryClient.clear();
  queryClient.setDefaultOptions({
    queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnMount: true },
    mutations: { retry: false },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  queryClient.clear();
  vi.restoreAllMocks();
});

// ===========================================================================
// 1 + 2 — the 51-jurisdiction rule library: "not encoded" is never a number
// ===========================================================================

describe("state-rules — an unencoded jurisdiction says so, and nothing is attorney-reviewed", () => {
  const REFERENCE_ONLY = {
    state: "AL",
    source: "reference_only",
    coverage: "reference_only",
    redemptionMathEncoded: false,
    saleType: "tax_lien_certificate",
    interestModel: null,
    redemptionPeriodMonths: 36,
    redemptionPeriodMonthsOwnerOccupied: null,
    defaultRateBps: null,
    firstPeriodMonths: null,
    firstPeriodRateBps: null,
    secondPeriodRateBps: null,
    yearlyAddOnBps: null,
    deadlineAnchor: null,
    citation: "Ala. Code §40-10-120",
    noticeRequirements: null,
    quietTitleProcedure: null,
    foreclosureProcedure: null,
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    attorneyReviewed: false,
    notes: "Research indicates a statutory yield near 12.00%; it is NOT encoded for computation.",
    updatedAt: null,
    caveat: CAVEAT,
  };
  const COMPUTATIONAL = {
    ...REFERENCE_ONLY,
    state: "FL",
    source: "db",
    coverage: "computational",
    redemptionMathEncoded: true,
    saleType: "lien",
    interestModel: "simple_annual",
    redemptionPeriodMonths: 24,
    defaultRateBps: 1800,
    deadlineAnchor: "sale_date",
    citation: "Fla. Stat. §197.472",
    notes: null,
  };

  it("renders a reference-only state's absent rate as words, never 0.00%, and carries the caveat", async () => {
    window.history.pushState({}, "", "/state-rules");
    installFetch(({ url }) => {
      if (url.startsWith("/api/tax-rules")) {
        return {
          body: {
            rules: [REFERENCE_ONLY, COMPUTATIONAL],
            totalStates: 2,
            reviewedCount: 0,
            computationalCount: 1,
            referenceOnlyCount: 1,
            jurisdictionsNotEncoded: 49,
            attorneyReviewed: false,
            caveat: CAVEAT,
          },
        };
      }
      return undefined;
    });

    await mount(React.createElement(StateRulesPage));

    // The AL card must say the rate is not encoded...
    const alCard = byTestId("card-state-AL");
    expect(alCard).not.toBeNull();
    expect(alCard!.textContent).toContain("Not encoded");
    // ...and must NOT render a zero rate. 0 bps would have printed "0.00%".
    expect(alCard!.textContent).not.toContain("0.00%");
    // The computational neighbour still shows its real rate, so the absence
    // above is a real distinction and not a blanket blanking.
    expect(byTestId("card-state-FL")!.textContent).toContain("18.00%");

    // The caveat is rendered verbatim, both in the sticky banner and the
    // all-preliminary callout.
    expect(byTestId("state-rules-caveat")!.textContent).toContain("not attorney-reviewed");
    expect(byTestId("state-rules-preliminary-banner")!.textContent).toContain(CAVEAT);
    expect(text()).toContain("0 / 2");
  });

  it("a jurisdiction absent from the library is reported as not encoded, with no rule fields", async () => {
    window.history.pushState({}, "", "/state-rules");
    installFetch(({ url }) => {
      if (url.startsWith("/api/tax-rules")) {
        return {
          body: {
            rules: [COMPUTATIONAL],
            totalStates: 1,
            reviewedCount: 0,
            computationalCount: 1,
            referenceOnlyCount: 0,
            jurisdictionsNotEncoded: 50,
            attorneyReviewed: false,
            caveat: CAVEAT,
          },
        };
      }
      return undefined;
    });

    await mount(React.createElement(StateRulesPage));
    await typeInto(byTestId("input-state-lookup"), "PR");

    const refusal = byTestId("text-state-not-encoded");
    expect(refusal).not.toBeNull();
    expect(refusal!.textContent).toContain("Not encoded");
    expect(refusal!.textContent).toContain("no tax-sale rule encoded for 'PR'");
    expect(refusal!.textContent).toContain("Nothing is assumed on your behalf");
  });

  it("the detail route renders the server's refusal for an unencoded state, not a default rule", async () => {
    window.history.pushState({}, "", "/state-rules/PR");
    const serverMessage =
      "Tax-sale rules for 'PR' — not encoded in AcreOS. Nothing is assumed on your behalf";
    installFetch(({ url }) => {
      if (url === "/api/tax-rules/PR") {
        return { status: 404, body: { error: "not_found", message: serverMessage, statusCode: 404 } };
      }
      return undefined;
    });

    await mount(React.createElement(StateRulesPage));

    expect(byTestId("card-state-not-encoded")).not.toBeNull();
    expect(byTestId("text-not-encoded-message")!.textContent).toContain(serverMessage);
    // No redemption math, no derived deadline, no percentage anywhere: the
    // refusal must not be decorated with a median-state fallback.
    expect(byTestId("text-deadline-derivation")).toBeNull();
    expect(text()).not.toContain("Redemption period");
    expect(text()).not.toMatch(/\d+\.\d\d%/);
  });

  it("a computational state labels its derived deadline preliminary, with the basis", async () => {
    window.history.pushState({}, "", "/state-rules/FL");
    installFetch(({ url }) => {
      if (url === "/api/tax-rules/FL") {
        return {
          body: { source: "db", coverage: "computational", rule: COMPUTATIONAL, caveat: CAVEAT },
        };
      }
      return undefined;
    });

    await mount(React.createElement(StateRulesPage));

    const derivation = byTestId("text-deadline-derivation");
    expect(derivation).not.toBeNull();
    expect(derivation!.textContent).toContain("Preliminary");
    expect(derivation!.textContent).toContain("sale date + 24 months");
    expect(byTestId("text-detail-caveat")!.textContent).toContain("not attorney-reviewed");
  });
});

// ===========================================================================
// 3 — CSV import: a bad row is reported, quoted, and not imported
// ===========================================================================

describe("auction worksheet — CSV lot-list import reports bad rows instead of dropping them", () => {
  const BAD_ROW_MESSAGE = '"call clerk" is not a dollar amount AcreOS can read.';

  const PREVIEW = {
    committed: false,
    headers: ["Parcel", "County", "State", "Type", "Total Due"],
    fields: [
      { key: "apn", label: "Parcel number (APN)", required: true, kind: "text" },
      { key: "county", label: "County", required: true, kind: "text" },
      { key: "state", label: "State", required: true, kind: "state" },
      { key: "saleType", label: "Sale type", required: true, kind: "sale_type" },
      { key: "totalTaxOwed", label: "Total tax owed", required: true, kind: "money" },
    ],
    mapping: { apn: 0, county: 1, state: 2, saleType: 3, totalTaxOwed: 4 },
    suggestedMapping: { apn: 0, county: 1, state: 2, saleType: 3, totalTaxOwed: 4 },
    ignoredColumns: [],
    unmappedRequired: [],
    summary: {
      totalRows: 2,
      validCount: 1,
      rejectedCount: 1,
      jurisdictions: [{ state: "TN", county: "Shelby", count: 1 }],
      totalTaxOwedCents: 123_456,
      minimumBidTotalCents: 50_000,
    },
    sampleValid: [
      {
        fileRow: 2,
        apn: "111-22-333",
        county: "Shelby",
        state: "TN",
        saleType: "lien",
        totalTaxOwedCents: 123_456,
        minimumBidCents: 50_000,
      },
    ],
    rejected: [
      {
        fileRow: 3,
        raw: ["444-55-666", "Shelby", "TN", "lien", "call clerk"],
        errors: [
          {
            field: "totalTaxOwed",
            column: "Total Due",
            value: "call clerk",
            message: BAD_ROW_MESSAGE,
          },
        ],
      },
    ],
    rejectedTruncated: false,
    caveat: CAVEAT,
  };

  function worksheetHandler(): Handler {
    return ({ url, method }) => {
      if (url.startsWith("/api/tax-researcher/auction-worksheet")) return { body: { listings: [] } };
      if (url === "/api/tax-researcher/auctions") return { body: { auctions: [], isEmpty: true } };
      if (url.endsWith("/imports/lot-list/preview") && method === "POST") return { body: PREVIEW };
      if (url.endsWith("/imports/lot-list/commit") && method === "POST") {
        return {
          status: 201,
          body: {
            committed: true,
            summary: { ...PREVIEW.summary, insertedCount: 1 },
            insertedIds: [901],
            rejected: PREVIEW.rejected,
            rejectedTruncated: false,
            caveat: CAVEAT,
          },
        };
      }
      return undefined;
    };
  }

  /** A File stand-in: the import only reads `name` and `text()`. */
  function fakeCsvFile(csv: string): File {
    return {
      name: "shelby-lots.csv",
      text: () => Promise.resolve(csv),
    } as unknown as File;
  }

  async function chooseFile(csv: string) {
    const input = byTestId("input-lot-csv");
    expect(input).not.toBeNull();
    Object.defineProperty(input as HTMLInputElement, "files", {
      value: [fakeCsvFile(csv)],
      configurable: true,
    });
    await act(async () => {
      (input as HTMLInputElement).dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
  }

  it("shows the rejected row with the offending value quoted, and excludes it from the import", async () => {
    window.history.pushState({}, "", "/auction-worksheet");
    installFetch(worksheetHandler());

    await mount(React.createElement(AuctionWorksheetPage));
    await click(byTestId("button-toggle-import"));
    await chooseFile(
      "Parcel,County,State,Type,Total Due\n111-22-333,Shelby,TN,lien,1234.56\n444-55-666,Shelby,TN,lien,call clerk\n",
    );

    // Counts reconcile on screen: 2 in the file, 1 importable, 1 rejected.
    expect(byTestId("text-rows-in-file")!.textContent).toBe("2");
    expect(byTestId("text-rows-valid")!.textContent).toBe("1");
    expect(byTestId("text-rows-rejected")!.textContent).toBe("1");

    // The bad row is named, with its column and its value quoted back.
    const rejected = byTestId("rejected-row-3");
    expect(rejected).not.toBeNull();
    expect(rejected!.textContent).toContain("File row 3");
    expect(rejected!.textContent).toContain("Total Due");
    expect(rejected!.textContent).toContain("call clerk");
    expect(rejected!.textContent).toContain("is not a dollar amount");
    expect(byTestId("list-rejected-rows")).not.toBeNull();
    expect(text()).toContain("1 row will not be imported");

    // The commit button offers ONE lot, not two — the rejected row is excluded.
    expect(byTestId("button-commit-import")!.textContent).toContain("Import 1 lot");

    // Preview wrote nothing.
    expect(calls.some((c) => c.url.includes("/imports/lot-list/commit"))).toBe(false);

    await click(byTestId("button-commit-import"));

    // After the commit, the rejected row survives (so it can be fixed and
    // re-imported) and the accounting is stated: 1 imported + 1 rejected = 2.
    const result = byTestId("import-result");
    expect(result).not.toBeNull();
    expect(result!.textContent).toContain("1 of 2 rows imported");
    expect(result!.textContent).toContain("2 of 2 rows accounted for");
    expect(result!.textContent).toContain("1 row rejected — not imported");
    expect(byTestId("rejected-row-3")!.textContent).toContain("call clerk");
  });
});

// ===========================================================================
// 4 — Won → exactly one certificate, and the budget decrements
// ===========================================================================

describe("auction worksheet — a Won tap yields one certificate and decrements the session budget", () => {
  it("records the win, creates a single certificate, and drops remaining capital by the bid", async () => {
    window.history.pushState({}, "", "/auction-worksheet?auctionId=7");

    const BUDGET_CENTS = 1_000_000; // $10,000.00
    const BID_CENTS = 250_000; //      $2,500.00
    let committedCents = 0;
    let wonCount = 0;
    let certificatesCreated = 0;

    installFetch(({ url, method, body }) => {
      if (url.startsWith("/api/tax-researcher/auction-worksheet")) {
        return {
          body: {
            listings: [
              {
                id: 11,
                apn: "111-22-333",
                county: "Shelby",
                state: "TN",
                address: "12 Elm St",
                minimumBid: "500.00",
                assessedValue: "40000.00",
                marketValue: null,
                acreage: null,
                status: wonCount > 0 ? "won" : "available",
                maxBidCents: BID_CENTS,
                walkAwayAboveCents: null,
                walkAwayCondition: null,
                partnerSplit: null,
                acquisitionSource: "auction",
                notes: null,
              },
            ],
          },
        };
      }
      if (url === "/api/tax-researcher/auctions") {
        return {
          body: {
            auctions: [
              {
                id: 7,
                county: "Shelby",
                state: "TN",
                auctionType: "lien",
                auctionDate: "2026-08-04T00:00:00.000Z",
                auctionFormat: "in_person",
                status: "scheduled",
                venueName: null,
                depositRequiredCents: null,
                sessionBudgetCents: BUDGET_CENTS,
                lotCount: 1,
                ruleCoverage: "computational",
                redemptionMathEncoded: true,
                attorneyReviewed: false,
                citation: "T.C.A. §67-5-2701",
                caveat: CAVEAT,
              },
            ],
            isEmpty: false,
          },
        };
      }
      if (url === "/api/tax-researcher/auctions/7/session-budget") {
        return {
          body: {
            auctionId: 7,
            budgetCents: BUDGET_CENTS,
            committedCents,
            winsWithUnknownAmount: 0,
            wonCount,
            remainingCents: BUDGET_CENTS - committedCents,
            overBudget: false,
            remainingIsUpperBound: false,
            moneyCustody: "none — AcreOS tracks this figure; the funds move on your own rails",
          },
        };
      }
      if (url === "/api/tax-researcher/listings/11/bid-log" && method === "POST") {
        if (body?.action === "won") {
          wonCount += 1;
          committedCents += Number(body.amountCents ?? 0);
          certificatesCreated += 1;
          return {
            status: 201,
            body: {
              entry: { id: "bid-1", listingId: 11, action: "won", amountCents: body.amountCents },
              certificate: {
                status: "created",
                certificateId: "cert-0001",
                redemptionDeadline: "2027-08-04",
                deadlineSource: "derived_preliminary",
                deadlineBasis: "sale date 2026-08-04 + 12 months, per AcreOS's encoded TN rule.",
                citation: "T.C.A. §67-5-2701",
                attorneyReviewed: false,
                caveat: CAVEAT,
              },
            },
          };
        }
        return { status: 201, body: { entry: { id: "bid-x" }, certificate: null } };
      }
      if (url.includes("/bid-log")) return { body: { entries: [] } };
      return undefined;
    });

    await mount(React.createElement(AuctionWorksheetPage));

    // Day-of mode is live (the ?auctionId= is read from the query string) and
    // the full budget is showing before any win.
    expect(byTestId("session-budget")).not.toBeNull();
    expect(byTestId("text-budget-remaining")!.textContent).toBe("$10,000.00");
    expect(byTestId("text-budget-committed")!.textContent).toBe("$0.00");
    expect(text()).toContain("AcreOS tracks this figure");

    await click(byTestId("button-won-11"));
    // The dialog pre-fills the walk-away max; the operator confirms the figure.
    expect(docTestId("input-won-amount-11")).not.toBeNull();
    await click(docTestId("button-confirm-won-11"));

    // Exactly one certificate, from one win POST.
    const wonPosts = calls.filter(
      (c) => c.url.endsWith("/listings/11/bid-log") && c.method === "POST" && c.body?.action === "won",
    );
    expect(wonPosts).toHaveLength(1);
    expect(wonPosts[0].body?.amountCents).toBe(BID_CENTS);
    expect(certificatesCreated).toBe(1);

    // The handoff is reported with its deadline, basis and caveat — never a
    // bare date.
    const created = docTestId("cert-created-11");
    expect(created).not.toBeNull();
    expect(docText()).toContain("2027-08-04");
    expect(docText()).toContain("sale date 2026-08-04 + 12 months");
    expect(docText()).toContain("not attorney-reviewed");

    // And the budget decremented by exactly the bid: $10,000.00 − $2,500.00.
    expect(committedCents).toBe(BID_CENTS);
    expect(byTestId("text-budget-remaining")!.textContent).toBe("$7,500.00");
    expect(byTestId("text-budget-committed")!.textContent).toBe("$2,500.00");
  });
});

// ===========================================================================
// 5 + 6 — rent ledger: allocation to the cent, deposit clock, fee proposal
// ===========================================================================

describe("rent roll — allocation, deposit clock and late-fee proposal", () => {
  const JUNE_ID = "charge-june";
  const JULY_ID = "charge-july";
  const LEASE_ID = "lease-0001";

  const LEASE_ACTIVE = {
    id: LEASE_ID,
    propertyId: 5,
    unitLabel: "3B",
    status: "active",
    startDate: "2026-01-01",
    endDate: null,
    monthlyRentCents: 140_000,
    rentDueDayOfMonth: 1,
    securityDepositCents: 140_000,
    isSection8: false,
    state: "TX",
  };
  const LEASE_ENDED_UNKNOWN_STATE = {
    ...LEASE_ACTIVE,
    id: "lease-ky",
    unitLabel: null,
    status: "ended",
    endDate: "2026-07-01",
    securityDepositCents: 100_000,
    state: "KY",
  };
  const LEASE_ENDED_TX = {
    ...LEASE_ACTIVE,
    id: "lease-tx-ended",
    unitLabel: null,
    status: "ended",
    endDate: "2026-07-01",
    securityDepositCents: 90_000,
    state: "TX",
  };

  /**
   * June: $1,400.00 rent + $50.00 late fee, $749.50 already received →
   * $650.50 rent + $50.00 fee outstanding ($700.50).
   * July: $1,400.00 rent, nothing received.
   * A $2,100.50 payment therefore covers June entirely and all of July.
   */
  const JUNE = {
    id: JUNE_ID,
    leaseId: LEASE_ID,
    chargedForMonth: "2026-06-01",
    dueDate: "2026-06-01",
    amountCents: 140_000,
    lateFeeCents: 5_000,
    paidCents: 74_950,
    balanceCents: 70_050,
    legalPosture: "late",
    payments: [],
  };
  const JULY = {
    id: JULY_ID,
    leaseId: LEASE_ID,
    chargedForMonth: "2026-07-01",
    dueDate: "2026-07-01",
    amountCents: 140_000,
    lateFeeCents: 0,
    paidCents: 0,
    balanceCents: 140_000,
    legalPosture: "ok",
    payments: [],
  };

  function rentHandler(extra?: Handler): Handler {
    return (call) => {
      const fromExtra = extra?.(call);
      if (fromExtra) return fromExtra;
      const { url, method } = call;
      if (url === "/api/rent/aging") {
        return {
          body: {
            asOf: "2026-07-11",
            totalsByBucket: {
              current: { count: 0, totalCents: 0 },
              d1_30: { count: 1, totalCents: 140_000 },
              d31_60: { count: 1, totalCents: 70_050 },
              d61_90: { count: 0, totalCents: 0 },
              d90_plus: { count: 0, totalCents: 0 },
            },
            charges: [
              {
                id: JUNE_ID,
                lease_id: LEASE_ID,
                charged_for_month: "2026-06-01",
                due_date: "2026-06-01",
                amount_cents: 140_000,
                balance_cents: 70_050,
                late_fee_cents: 5_000,
                legal_posture: "late",
                days_overdue: 40,
              },
              {
                id: JULY_ID,
                lease_id: LEASE_ID,
                charged_for_month: "2026-07-01",
                due_date: "2026-07-01",
                amount_cents: 140_000,
                balance_cents: 140_000,
                late_fee_cents: 0,
                legal_posture: "ok",
                days_overdue: 10,
              },
            ],
          },
        };
      }
      if (url === "/api/leases") {
        return {
          body: { leases: [LEASE_ACTIVE, LEASE_ENDED_UNKNOWN_STATE, LEASE_ENDED_TX] },
        };
      }
      if (url === "/api/late-fee-rules") {
        return {
          body: {
            rules: [
              {
                state: "TX",
                capPctSmallProperty: "0.05",
                capPctLargeProperty: "0.10",
                capFlatCents: null,
                graceDays: 2,
                initialFeeCents: null,
                perDayCents: null,
                citation: "Tex. Prop. Code §92.019",
                summary: null,
              },
            ],
          },
        };
      }
      if (url === `/api/leases/${LEASE_ID}/ledger`) {
        return {
          body: {
            lease: LEASE_ACTIVE,
            charges: [JUNE, JULY],
            unappliedPayments: [],
            totals: {
              totalDueCents: 280_000,
              totalPaidCents: 74_950,
              totalBalanceCents: 210_050,
              totalLateFeesCents: 5_000,
            },
          },
        };
      }
      if (url === `/api/leases/${LEASE_ID}/payments` && method === "POST") {
        return { status: 201, body: { payment: { id: `pay-${calls.length}` }, isPartial: false } };
      }
      return undefined;
    };
  }

  it("renders a multi-charge allocation to the cent and posts one ledger line per charge", async () => {
    window.history.pushState({}, "", "/rent-roll");
    installFetch(rentHandler());

    await mount(React.createElement(RentRollPage));
    await click(byTestId(`button-open-ledger-${JUNE_ID}`));
    await typeInto(byTestId("input-payment-amount"), "2100.50");

    const preview = byTestId("allocation-preview");
    expect(preview).not.toBeNull();

    // Line 1 — June: $650.50 to rent, $50.00 to the late fee, $700.50 applied,
    // nothing left on the charge.
    const line1 = byTestId("allocation-line-1")!;
    expect(line1.textContent).toContain("2026-06");
    expect(line1.textContent).toContain("$650.50");
    expect(line1.textContent).toContain("$50.00");
    expect(line1.textContent).toContain("$700.50");

    // Line 2 — July: the remaining $1,400.00, all of it rent.
    const line2 = byTestId("allocation-line-2")!;
    expect(line2.textContent).toContain("2026-07");
    expect(line2.textContent).toContain("$1,400.00");

    // The plain-language explanation is the audit line, and it balances.
    const explanation = byTestId("allocation-explanation")!.textContent ?? "";
    expect(explanation).toContain("$2,100.50 applied oldest-charge-first, rent before late fees");
    expect(explanation).toContain("2026-06");
    expect(explanation).toContain("2026-07");
    expect(explanation).not.toContain("unapplied credit");

    await click(byTestId("button-record-payment"));

    // One POST per charge, in oldest-first order, each for the exact allocated
    // cents — so neither month's balance is mis-stated.
    const posts = calls.filter(
      (c) => c.url === `/api/leases/${LEASE_ID}/payments` && c.method === "POST",
    );
    expect(posts).toHaveLength(2);
    expect(posts[0].body?.amountCents).toBe(70_050);
    expect(posts[1].body?.amountCents).toBe(140_000);
    expect(Number(posts[0].body?.amountCents) + Number(posts[1].body?.amountCents)).toBe(210_050);
    // Each line carries its own explanation into the ledger row's notes.
    expect(String(posts[0].body?.notes)).toContain("$650.50 rent + $50.00 late fee");
  });

  it("shows the deposit clock for an encoded state and refuses to guess an unencoded one", async () => {
    window.history.pushState({}, "", "/rent-roll");
    installFetch(rentHandler());

    await mount(React.createElement(RentRollPage));

    // TX is encoded: 30 calendar days from the 2026-07-01 move-out.
    expect(byTestId("deposit-deadline-lease-tx-ended")!.textContent).toBe("2026-07-31");
    expect(byTestId("deposit-clock-lease-tx-ended")!.textContent).toContain("Tex. Prop. Code §92.103");
    expect(byTestId("deposit-clock-lease-tx-ended")!.textContent).toContain("not attorney-reviewed");

    // KY is deliberately absent from the registry: no date, and the registry's
    // own sentence is rendered instead of a 30-day default.
    expect(byTestId("deposit-unknown-lease-ky")!.textContent).toBe("Unknown");
    const reason = byTestId("deposit-unknown-reason-lease-ky")!.textContent ?? "";
    expect(reason).toContain("No security-deposit return deadline is encoded for KY");
    expect(reason).toContain("will not guess");
    expect(byTestId("deposit-clock-lease-ky")!.textContent).not.toMatch(/2026-0[78]-\d\d/);
  });

  it("proposes a late fee and charges nothing until the operator confirms the exact figure", async () => {
    window.history.pushState({}, "", "/rent-roll");
    installFetch(
      rentHandler(({ url, method }) => {
        if (url === `/api/rent-charges/${JULY_ID}/apply-late-fee` && method === "POST") {
          return {
            body: {
              feeCents: 7_000,
              explanation: "TX rule: cap 5%, 2d grace; 10d late → $70.00 fee.",
              rule: { state: "TX" },
              daysLate: 10,
            },
          };
        }
        return undefined;
      }),
    );

    await mount(React.createElement(RentRollPage));
    await click(byTestId(`button-propose-fee-${JULY_ID}`));

    // 10 days late, 2-day grace, 5% small-property cap on $1,400.00 rent. The
    // unit count is unknown, so the LOWER cap branch is proposed: $70.00.
    expect(docTestId("text-proposed-fee")!.textContent).toBe("$70.00");
    expect(docTestId("text-fee-explanation")!.textContent).toContain("proposed fee $70.00");
    expect(docText()).toContain("Requires operator confirmation");
    expect(docText()).toContain("Tex. Prop. Code §92.019");

    // Nothing has been charged, and the charge button is refused until the
    // operator confirms the figure they were shown.
    const chargeBtn = docTestId("button-charge-fee") as HTMLButtonElement;
    expect(chargeBtn.disabled).toBe(true);
    await click(chargeBtn);
    expect(calls.some((c) => c.url.includes("apply-late-fee"))).toBe(false);

    await click(docTestId("checkbox-confirm-fee"));
    expect((docTestId("button-charge-fee") as HTMLButtonElement).disabled).toBe(false);
    await click(docTestId("button-charge-fee"));

    const feePosts = calls.filter((c) => c.url.includes("apply-late-fee") && c.method === "POST");
    expect(feePosts).toHaveLength(1);
    expect(docTestId("late-fee-applied")!.textContent).toContain("$70.00 charged");
  });
});
