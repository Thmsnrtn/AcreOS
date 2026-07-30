// @vitest-environment jsdom
/**
 * Wave D client surface — /flip-analyzer (the comps → ARV → MAO chain).
 *
 * What these tests exist to prevent
 * ────────────────────────────────
 * The MAO page is a valuation surface, so the two ways it can lie are:
 *
 *   1. printing a number that isn't the 70%-rule math, and
 *   2. printing ANY number when the inputs behind it don't exist (no ATTOM
 *      key, no coverage, no saved ARV).
 *
 * So the MAO fixture here is not hand-written JSON — the fetch mock runs the
 * REAL server arithmetic (`computeMao` from server/services/flipUnderwriting,
 * a pure module with no database import) over the request body the page sends.
 * The test then asserts that arithmetic against a hand-computed figure AND
 * asserts the page prints exactly that. If either drifts, this fails.
 *
 * No DATABASE_URL: flipUnderwriting imports nothing.
 *
 * Mounted via react-dom/client + QueryClientProvider with a global fetch mock
 * (repo pattern — see assignmentPanel.test.tsx / statementsPanel.test.tsx).
 * PageShell is stubbed so the test doesn't drag in the sidebar, topbar and
 * PaxRail provider — the page's own logic is what's under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";

import {
  computeMao,
  PLATFORM_FLIP_DEFAULTS,
  resolveFlipDefaults,
} from "../../server/services/flipUnderwriting";

vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "page-shell-stub" }, children),
}));

import FlipAnalyzerPage from "../../client/src/pages/flip-analyzer";

// ── the subject fixture (real records, real cents) ─────────────────────────

const SUBJECT_ARV_CENTS = 28_500_000; // $285,000 saved ARV
const SUBJECT_REHAB_CENTS = 4_500_000; // $45,000 rehab budget

const state = {
  /** null models "this property has no saved ARV" — the honest-gap path. */
  arv: {
    arvCents: SUBJECT_ARV_CENTS,
    source: "saved_arv" as const,
    confidence: "medium",
    compCount: 3,
    calculatedAt: "2026-07-01T12:00:00.000Z",
  } as null | {
    arvCents: number;
    source: "saved_arv";
    confidence: string | null;
    compCount: number;
    calculatedAt: string;
  },
  rehabEstimate: { cents: SUBJECT_REHAB_CENTS, source: "rehab_budget", rehabId: "r1" } as
    | null
    | { cents: number; source: string; rehabId: string | null },
  comps: {
    status: "unavailable",
    reason: "provider_not_configured",
    message:
      "No ATTOM connection is configured for your organization, so sold residential comparables cannot be pulled. Connect ATTOM under Settings → Data sources, or enter comps by hand below.",
    comps: [],
    subjectSqft: 1_650,
  } as Record<string, unknown>,
};

/** Every POST the page makes, so "nothing fires unasked" is checkable. */
let calls: Array<{ method: string; url: string; body: unknown }> = [];

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function fetchMock(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method, url, body });

  if (url.startsWith("/api/properties")) {
    return json([
      { id: 7, address: "1247 Cherokee Pl", city: "Atlanta", state: "GA", apn: "17-0123-0001" },
    ]);
  }
  if (url === "/api/flip-analyzer/defaults") {
    const resolved = resolveFlipDefaults(null);
    return json({
      values: resolved.values,
      sources: resolved.sources,
      isCustomised: resolved.isCustomised,
      platformDefaults: PLATFORM_FLIP_DEFAULTS,
    });
  }
  if (url.startsWith("/api/flip-analyzer/subject/")) {
    return json({
      property: {
        id: 7,
        apn: "17-0123-0001",
        address: "1247 Cherokee Pl",
        city: "Atlanta",
        state: "GA",
        zip: "30315",
        squareFeet: 1_650,
        locatable: true,
      },
      arv: state.arv,
      rehabEstimate: state.rehabEstimate,
      monthlyHoldingCostCents: null,
      priceCandidates: { purchasePriceCents: null, listPriceCents: null },
    });
  }
  if (url === "/api/flip-analyzer/comps") {
    return json(state.comps);
  }
  if (url === "/api/flip-analyzer/mao") {
    // The REAL server math over the page's own request body.
    const resolved = resolveFlipDefaults(null);
    const result = computeMao({
      arvCents: body.arvCents,
      rehabEstimateCents: body.rehabEstimateCents ?? 0,
      purchasePriceCents: body.purchasePriceCents ?? null,
      feeCents: body.feeCents ?? 0,
      defaults: resolved.values,
    });
    return json({
      ...result,
      arvSource: body.arvCents ? "operator_input" : "saved_arv",
      arvBasis: null,
      rulesAreCustomised: resolved.isCustomised,
    });
  }
  return json([]);
}

/**
 * Mounted the way App.tsx mounts it — inside the `/flip-analyzer/:propertyId`
 * Route — so the page's `useParams()` deep link is exercised, not bypassed.
 */
function wrap(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(
      Router,
      null,
      React.createElement(Route, { path: "/flip-analyzer/:propertyId" }, node),
    ),
  );
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calls = [];
  state.arv = {
    arvCents: SUBJECT_ARV_CENTS,
    source: "saved_arv",
    confidence: "medium",
    compCount: 3,
    calculatedAt: "2026-07-01T12:00:00.000Z",
  };
  state.rehabEstimate = { cents: SUBJECT_REHAB_CENTS, source: "rehab_budget", rehabId: "r1" };
  state.comps = {
    status: "unavailable",
    reason: "provider_not_configured",
    message:
      "No ATTOM connection is configured for your organization, so sold residential comparables cannot be pulled. Connect ATTOM under Settings → Data sources, or enter comps by hand below.",
    comps: [],
    subjectSqft: 1_650,
  };
  window.history.pushState({}, "", "/flip-analyzer/7");
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetchMock(String(input), init)),
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

async function mount() {
  await act(async () => {
    root.render(wrap(React.createElement(FlipAnalyzerPage)));
  });
  await flush();
}

function click(selector: string) {
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  return act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function submitForm(inputSelector: string) {
  const input = container.querySelector<HTMLInputElement>(inputSelector);
  if (!input) throw new Error(`missing input: ${inputSelector}`);
  const form = input.closest("form");
  if (!form) throw new Error(`no form around ${inputSelector}`);
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

describe("flip analyzer — the MAO is the real 70%-rule math", () => {
  it("hand-computed check: $285k ARV, $45k rehab, platform rules ⇒ $150,000 MAO", () => {
    // contingency = 10% of 45,000 = 4,500 → rehab with contingency 49,500
    // MAO = 285,000 × 70% − 49,500 = 199,500 − 49,500 = 150,000
    const result = computeMao({
      arvCents: SUBJECT_ARV_CENTS,
      rehabEstimateCents: SUBJECT_REHAB_CENTS,
      purchasePriceCents: null,
      feeCents: 0,
      defaults: PLATFORM_FLIP_DEFAULTS,
    });
    expect(result.contingencyCents).toBe(450_000);
    expect(result.rehabWithContingencyCents).toBe(4_950_000);
    expect(result.maoCents).toBe(15_000_000);
    // Carry is unknown at the platform defaults, so net profit is null — not 0.
    expect(result.holdingCostCents).toBeNull();
    expect(result.netProfitCents).toBeNull();
  });

  it("renders that exact MAO, and only after the operator asks for it", async () => {
    await mount();

    // Nothing is computed on mount — the MAO POST has not been made.
    expect(calls.some((c) => c.url === "/api/flip-analyzer/mao")).toBe(false);
    expect(container.querySelector('[data-testid="flip-mao-result"]')).toBeNull();

    // The ARV pre-filled from the property's SAVED calculation, badged as such.
    const arvInput = container.querySelector<HTMLInputElement>('[data-testid="input-flip-arv"]');
    expect(arvInput?.value).toBe("285000.00");
    expect(container.textContent).toContain("From your saved ARV");

    await submitForm('[data-testid="input-flip-arv"]');

    const maoCall = calls.find((c) => c.url === "/api/flip-analyzer/mao");
    expect(maoCall).toBeDefined();
    expect(maoCall?.method).toBe("POST");
    expect(maoCall?.body).toMatchObject({
      arvCents: SUBJECT_ARV_CENTS,
      rehabEstimateCents: SUBJECT_REHAB_CENTS,
    });

    const value = container.querySelector('[data-testid="text-mao-value"]')?.textContent;
    expect(value).toBe("$150,000");
  });

  it("shows net profit as not computed — never an optimistic zero — when carry is unset", async () => {
    await mount();
    await submitForm('[data-testid="input-flip-arv"]');
    const result = container.querySelector('[data-testid="flip-mao-result"]');
    expect(result).not.toBeNull();
    expect(result?.textContent).toContain("Not computed");
    expect(result?.textContent).toContain("Not set — excluded");
    // And the reason is stated verbatim from the server's `missing` list.
    expect(container.querySelector('[data-testid="flip-mao-missing"]')?.textContent).toContain(
      "Monthly holding cost is not set",
    );
  });
});

describe("flip analyzer — unavailable comps stay unavailable", () => {
  it("renders the provider's own refusal message and fabricates no ARV", async () => {
    state.arv = null;
    state.rehabEstimate = null;
    await mount();

    // No saved ARV ⇒ the field is EMPTY, and the page says so.
    const arvInput = container.querySelector<HTMLInputElement>('[data-testid="input-flip-arv"]');
    expect(arvInput?.value).toBe("");
    expect(container.querySelector('[data-testid="flip-no-arv-notice"]')).not.toBeNull();

    // Comps are pulled only on the explicit action.
    expect(calls.some((c) => c.url === "/api/flip-analyzer/comps")).toBe(false);
    await click('[data-testid="button-pull-comps"]');
    await flush();

    const notice = container.querySelector('[data-testid="flip-comps-unavailable"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("No ATTOM connection is configured");
    expect(notice?.textContent).toContain("enter comps by hand");

    // Still no ARV, still no MAO, and no median-$/sqft derivation offered.
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="input-flip-arv"]')?.value,
    ).toBe("");
    expect(container.querySelector('[data-testid="flip-mao-result"]')).toBeNull();
    expect(container.querySelector('[data-testid="button-use-comp-median"]')).toBeNull();
    // Manual entry stays open — the input is present and enabled.
    expect(arvInput?.disabled).toBe(false);
  });

  it("with no ARV the compute action stays disabled — the MAO cannot be guessed", async () => {
    state.arv = null;
    await mount();
    const button = container.querySelector<HTMLButtonElement>('[data-testid="button-compute-mao"]');
    expect(button?.disabled).toBe(true);
    expect(container.textContent).toContain("the MAO cannot be estimated without one");
  });
});
