// @vitest-environment jsdom
/**
 * UnderwritingWorkbench — the decision desk every vertical reuses.
 *
 * Pins the promises that make a recorded decision honest and gradeable:
 *   - the numbers shown are the server engine's (POST /api/scenarios/preview),
 *     and an uncomputable metric renders "—", never 0;
 *   - nothing is recorded until the operator has picked a property, filled the
 *     required inputs, chosen their call, written a reason, and ANSWERED "when
 *     will you know?" — neither the call nor the date is pre-selected;
 *   - what is recorded is what was shown: while an edit is inside the debounce,
 *     recording is disabled (V0 audit P1-5);
 *   - a coverage multiple (DSCR) reads as 1.06×, not 106% (V0 audit P1-3);
 *   - what is recorded carries their answer, converted, to the vertical's route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../client/src/components/property-combobox", () => ({
  PropertyCombobox: (p: { onChange: (id: number) => void; "data-testid"?: string }) =>
    React.createElement("button", { type: "button", "data-testid": p["data-testid"], onClick: () => p.onChange(7) }, "pick"),
}));

const posted: Array<{ url: string; body: any }> = [];
vi.mock("../../client/src/lib/queryClient", () => ({
  apiRequest: vi.fn(async (_m: string, url: string, body: any) => {
    posted.push({ url, body });
    const json =
      url === "/api/scenarios/preview"
        ? {
            engineId: "rental_acquisition",
            engineVersion: "rental-acquisition-1",
            metrics: [
              { id: "monthly_cash_flow", value: 6005, unit: "cents" },
              { id: "dscr", value: null, unit: "multiple" },
            ],
            assumptions: [{ key: "financing", value: "all cash", origin: "platform-default", basis: "All cash" }],
            inputs: body.inputs,
          }
        : { decisionId: 901, scenarioId: 501 };
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
}));

import { UnderwritingWorkbench, formatMetric } from "../../client/src/components/underwriting/UnderwritingWorkbench";

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/** Past the 350 ms debounce, then let the preview query resolve and render. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function type(id: string, value: string) {
  const el = q(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  posted.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(UnderwritingWorkbench, {
          engineId: "rental_acquisition",
          fields: [
            { key: "purchasePriceCents", label: "Price", unit: "cents" },
            { key: "closingCostsCents", label: "Closing", unit: "cents", optional: true },
          ],
          decideEndpoint: "/api/buy-and-hold/underwrite",
          kinds: ["acquire", "pass"],
          headlineMetrics: ["monthly_cash_flow"],
          describeChoice: () => "Buy and hold at $200,000",
          testIdPrefix: "wb",
        }),
      ),
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("UnderwritingWorkbench", () => {
  it("shows the engine's numbers, and an uncomputable one as —, never 0", async () => {
    type("wb-field-purchasePriceCents", "200000");
    await settle();
    expect(posted.find((p) => p.url === "/api/scenarios/preview")?.body).toEqual({
      engineId: "rental_acquisition",
      inputs: { purchasePriceCents: 20_000_000 },
    });
    expect(q("wb-metric-monthly_cash_flow")?.textContent).toContain("$60");
    expect(q("wb-metric-dscr")?.textContent).toContain("—");
    expect(container.textContent).toContain("Platform default");
  });

  it("will not record until property, reason and the review answer are all given", async () => {
    type("wb-field-purchasePriceCents", "200000");
    await settle();
    const record = () => q("wb-record") as HTMLButtonElement;
    expect(record().disabled).toBe(true);

    act(() => q("wb-property")!.click());
    const rationale = q("wb-rationale") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(rationale, "Cash flow clears our floor.");
      rationale.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Still unanswered: nothing is pre-selected.
    expect(record().disabled).toBe(true);
    expect(q("wb-kind-acquire")?.getAttribute("aria-pressed")).toBe("false");

    act(() => q("wb-review-in-30")!.click());
    // The call itself is not pre-selected either.
    expect(record().disabled).toBe(true);
    act(() => q("wb-kind-acquire")!.click());
    expect(record().disabled).toBe(false);

    await act(async () => {
      record().click();
      await new Promise((r) => setTimeout(r, 0));
    });
    const sent = posted.find((p) => p.url === "/api/buy-and-hold/underwrite")!.body;
    expect(sent).toMatchObject({ propertyId: 7, kind: "acquire", inputs: { purchasePriceCents: 20_000_000 }, choice: "Buy and hold at $200,000" });
    expect(typeof sent.reviewDueAt).toBe("string");
    expect(new Date(sent.reviewDueAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(q("wb-recorded")?.textContent).toContain("#901");
  });

  it("'No set date' is an answer and is sent as null", async () => {
    type("wb-field-purchasePriceCents", "200000");
    await settle();
    act(() => q("wb-property")!.click());
    const rationale = q("wb-rationale") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(rationale, "Not worth it at this price.");
      rationale.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => q("wb-review-in-none")!.click());
    act(() => q("wb-kind-pass")!.click());
    await act(async () => {
      (q("wb-record") as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(posted.find((p) => p.url === "/api/buy-and-hold/underwrite")!.body.reviewDueAt).toBeNull();
  });

  it("an edit not yet previewed cannot be recorded — the frozen numbers are the shown numbers", async () => {
    type("wb-field-purchasePriceCents", "200000");
    await settle();
    act(() => q("wb-property")!.click());
    const rationale = q("wb-rationale") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(rationale, "Cash flow clears our floor.");
      rationale.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => q("wb-review-in-30")!.click());
    act(() => q("wb-kind-acquire")!.click());
    const record = () => q("wb-record") as HTMLButtonElement;
    expect(record().disabled).toBe(false);

    // The operator changes the price; the shown metrics are still the old ones.
    type("wb-field-purchasePriceCents", "250000");
    expect(record().disabled, "a stale preview was recordable").toBe(true);

    await settle();
    expect(record().disabled).toBe(false);
    await act(async () => {
      record().click();
      await new Promise((r) => setTimeout(r, 0));
    });
    const sent = posted.find((p) => p.url === "/api/buy-and-hold/underwrite")!.body;
    const lastPreview = posted.filter((p) => p.url === "/api/scenarios/preview").at(-1)!.body;
    expect(sent.inputs).toEqual(lastPreview.inputs);
    expect(sent.inputs).toEqual({ purchasePriceCents: 25_000_000 });
  });
});

describe("an edited description written for other numbers", () => {
  it("blocks recording until the operator regenerates it or keeps their wording", async () => {
    type("wb-field-purchasePriceCents", "200000");
    await settle();
    act(() => q("wb-property")!.click());
    const rationale = q("wb-rationale") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(rationale, "Cash flow clears our floor.");
      rationale.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => q("wb-review-in-30")!.click());
    act(() => q("wb-kind-acquire")!.click());
    type("wb-choice", "Buy at $200,000 — my words");
    const record = () => q("wb-record") as HTMLButtonElement;
    expect(record().disabled).toBe(false);
    expect(q("wb-choice-stale")).toBeNull();

    type("wb-field-purchasePriceCents", "250000");
    await settle();
    expect(q("wb-choice-stale"), "no warning that the wording quotes other numbers").not.toBeNull();
    expect(record().disabled).toBe(true);

    act(() => q("wb-choice-keep")!.click());
    expect(q("wb-choice-stale")).toBeNull();
    expect(record().disabled).toBe(false);
    expect((q("wb-choice") as HTMLInputElement).value).toBe("Buy at $200,000 — my words");
  });
});

describe("formatMetric", () => {
  it("a multiple is a times-figure, a ratio is a percentage, null is a dash", () => {
    expect(formatMetric({ value: 1.0602, unit: "multiple" })).toBe("1.06×");
    expect(formatMetric({ value: 8.3333, unit: "multiple" })).toBe("8.33×");
    expect(formatMetric({ value: 0.06348, unit: "ratio" })).toBe("6.3%");
    expect(formatMetric({ value: -12_345, unit: "cents" })).toBe("−$123");
    expect(formatMetric({ value: null, unit: "multiple" })).toBe("—");
  });
});
