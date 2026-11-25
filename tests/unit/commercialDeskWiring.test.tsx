// @vitest-environment jsdom
/**
 * The commercial decision desk (Step 0 gap sheet commercial.md, work
 * item 2, bar (b)) — the client half that makes the decision route
 * REACHABLE, which is what the readiness measurement credits.
 * FALSIFYING: on pre-slice main the page does not exist, App.tsx has no
 * /commercial/underwrite route, and the Commercial panel carries no
 * desk link.
 *
 *   - /commercial/underwrite renders the real workbench on
 *     commercial_underwrite, with a deep-linked property preselected;
 *   - recording stays DISABLED until the numbers, the call, the
 *     rationale and the review date are all answered — and enables once
 *     they are;
 *   - the as-of month crosses the wire as the validated YYYY-MM string
 *     (the field kit's `month` unit), never as a number, and a malformed
 *     month keeps recording disabled;
 *   - the recorded POST goes to /api/commercial/underwrite carrying the
 *     operator's review date; the only non-GET requests are the preview
 *     and the decision (nothing is sent to anyone, nothing is bought);
 *   - the desk is reached from the Commercial panel on /leases, not a
 *     new door.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({ search: "" }));

vi.mock("wouter", () => ({
  useSearch: () => h.search,
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}));
vi.mock("../../client/src/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children),
}));
vi.mock("../../client/src/hooks/use-document-title", () => ({ useDocumentTitle: () => undefined }));
vi.mock("../../client/src/components/property-combobox", () => ({
  PropertyCombobox: (p: { value: number | null; onChange: (id: number) => void; "data-testid"?: string }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": p["data-testid"], "data-value": String(p.value), onClick: () => p.onChange(p.value ?? 7) },
      "pick",
    ),
}));

const requests: Array<{ method: string; url: string; body: any }> = [];
vi.mock("../../client/src/lib/queryClient", () => ({
  apiRequest: vi.fn(async (method: string, url: string, body: any) => {
    requests.push({ method, url, body });
    const json =
      url === "/api/scenarios/preview"
        ? {
            engineId: "commercial_underwrite",
            engineVersion: "v",
            metrics: [
              { id: "annual_noi", value: 12_720_000, unit: "cents" },
              { id: "cap_rate", value: 0.1496, unit: "ratio" },
            ],
            assumptions: [],
            inputs: body.inputs,
          }
        : { decisionId: 901, scenarioId: 501 };
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
}));

import CommercialUnderwritePage from "../../client/src/pages/commercial/underwrite";

const ROOT = path.resolve(__dirname, "../..");
let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(CommercialUnderwritePage)));
  });
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const recordBtn = () => q("underwrite-commercial-record") as HTMLButtonElement;
const field = (key: string) => q(`underwrite-commercial-field-${key}`) as HTMLInputElement;

/** The recorded-figures fixture, typed as the operator types it. */
function typeFixture(asOfMonth: string) {
  setValue(field("purchasePriceCents"), "850000");
  setValue(field("leaseCount"), "3");
  setValue(field("baseMonthlyRentCents"), "12000");
  setValue(field("escalatedMonthlyRentCents"), "12600");
  setValue(field("expiringWithin12MonthsMonthlyRentCents"), "4000");
  setValue(field("camRecoveriesMonthlyCents"), "1500");
  setValue(field("rentableSqft"), "20000");
  setValue(field("measuredOpExMonthlyCents"), "3500");
  setValue(field("measuredOpExRowCount"), "12");
  setValue(field("measuredOpExMonthsCovered"), "12");
  setValue(field("asOfMonth"), asOfMonth);
}

beforeEach(() => {
  requests.length = 0;
  h.search = "propertyId=7";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the desk", () => {
  it("renders the real workbench on commercial_underwrite with the deep-linked property", async () => {
    await render();
    expect(q("underwrite-commercial-workbench")).not.toBeNull();
    expect(q("underwrite-commercial-property")?.getAttribute("data-value")).toBe("7");
  });

  it("a malformed as-of month keeps recording disabled", async () => {
    await render();
    typeFixture("Nov 2026");
    await settle();
    act(() => q("underwrite-commercial-kind-acquire")!.click());
    setValue(q("underwrite-commercial-rationale") as HTMLTextAreaElement, "The recorded leases carry the income.");
    act(() => q("underwrite-commercial-review-in-14")!.click());
    expect(recordBtn().disabled, "a month that is not YYYY-MM is not an input").toBe(true);
  });

  it("recording waits for the call, the rationale and the review date — then records", async () => {
    await render();
    typeFixture("2026-11");
    await settle();
    // Numbers previewed, but no call / rationale / review date yet.
    expect(recordBtn().disabled).toBe(true);

    act(() => q("underwrite-commercial-kind-acquire")!.click());
    setValue(q("underwrite-commercial-rationale") as HTMLTextAreaElement, "The recorded leases carry the income; expenses are measured from a full year of records.");
    expect(recordBtn().disabled, "review date still unanswered").toBe(true);
    act(() => q("underwrite-commercial-review-in-14")!.click());
    expect(recordBtn().disabled).toBe(false);

    await act(async () => {
      recordBtn().click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(q("underwrite-commercial-recorded")).not.toBeNull();

    const decide = requests.find((r) => r.url === "/api/commercial/underwrite");
    expect(decide?.method).toBe("POST");
    expect(decide?.body).toMatchObject({ propertyId: 7, kind: "acquire" });
    expect(typeof decide?.body.reviewDueAt).toBe("string");
    expect(decide?.body.inputs).toMatchObject({
      purchasePriceCents: 85_000_000,
      escalatedMonthlyRentCents: 1_260_000,
      measuredOpExRowCount: 12,
    });
    // The month-unit wire pin: the as-of month crosses as the string itself.
    expect(decide?.body.inputs.asOfMonth).toBe("2026-11");
    expect(typeof decide?.body.inputs.asOfMonth).toBe("string");
    // The flow writes nothing else and sends nothing to anyone.
    expect(requests.filter((r) => r.method !== "GET").map((r) => r.url).filter((u) => u !== "/api/scenarios/preview")).toEqual(["/api/commercial/underwrite"]);
  });
});

describe("placement — reached from the Commercial panel, not a new door", () => {
  const app = stripComments(fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8"));
  const panel = stripComments(fs.readFileSync(path.join(ROOT, "client/src/components/rentals/commercial-panel.tsx"), "utf8"));

  it("App.tsx routes /commercial/underwrite to the desk behind ProtectedRoute", () => {
    expect(app).toMatch(/<Route path="\/commercial\/underwrite">\s*\{\(\) => <ProtectedRoute component=\{CommercialUnderwritePage\} \/>\}/);
    expect(app).toContain('import("@/pages/commercial/underwrite")');
  });

  it("the Commercial panel links to the desk", () => {
    expect(panel).toContain('"/commercial/underwrite"');
    expect(panel).toContain('data-testid="commercial-underwrite-link"');
  });
});
