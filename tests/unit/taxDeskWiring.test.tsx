// @vitest-environment jsdom
/**
 * The tax decision desk (Step 0 item T5) — the client half that makes the
 * decision route REACHABLE, which is what the readiness measurement credits.
 * FALSIFYING: on pre-slice main the page does not exist, App.tsx has no
 * /tax/bid-desk route, and the tax-delinquent pipeline carries no desk link.
 *
 *   - /tax/bid-desk renders the real workbench on tax_max_bid, with
 *     a deep-linked property preselected;
 *   - recording stays DISABLED until the numbers, the call, the rationale and
 *     the review date are all answered — and enables once they are;
 *   - the recorded POST goes to /api/tax-lien/underwrite carrying the
 *     operator's review date; the only non-GET requests are the preview and
 *     the decision (nothing is sent to anyone, no bid is placed);
 *   - the desk is reached from the tax-delinquent pipeline, not a new door.
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
        ? { engineId: "tax_max_bid", engineVersion: "v", metrics: [{ id: "max_allowable_offer", value: 3_000_000, unit: "cents" }], assumptions: [], inputs: body.inputs }
        : { decisionId: 901, scenarioId: 501 };
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
}));

import TaxBidDeskPage from "../../client/src/pages/tax/bid-desk";

const ROOT = path.resolve(__dirname, "../..");
let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(TaxBidDeskPage)));
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
const recordBtn = () => q("underwrite-tax-bid-record") as HTMLButtonElement;

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
  it("renders the real workbench on tax_max_bid with the deep-linked property", async () => {
    await render();
    expect(q("underwrite-tax-bid-workbench")).not.toBeNull();
    expect(q("underwrite-tax-bid-property")?.getAttribute("data-value")).toBe("7");
  });

  it("recording waits for the call, the rationale and the review date — then records", async () => {
    await render();
    // The $50,000 stack fixture from the engine suite, typed as the operator types it.
    setValue(q("underwrite-tax-bid-field-lotValueCents") as HTMLInputElement, "50000");
    setValue(q("underwrite-tax-bid-field-survivingLiensCents") as HTMLInputElement, "5000");
    setValue(q("underwrite-tax-bid-field-otherTaxesCents") as HTMLInputElement, "2000");
    setValue(q("underwrite-tax-bid-field-clearAndHoldCostsCents") as HTMLInputElement, "3000");
    setValue(q("underwrite-tax-bid-field-requiredReturnCents") as HTMLInputElement, "10000");
    await settle();
    // Numbers previewed, but no call / rationale / review date yet.
    expect(recordBtn().disabled).toBe(true);

    act(() => q("underwrite-tax-bid-kind-offer")!.click());
    setValue(q("underwrite-tax-bid-rationale") as HTMLTextAreaElement, "The stack leaves my full return at $30,000.");
    expect(recordBtn().disabled, "review date still unanswered").toBe(true);
    act(() => q("underwrite-tax-bid-review-in-14")!.click());
    expect(recordBtn().disabled).toBe(false);

    await act(async () => {
      recordBtn().click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(q("underwrite-tax-bid-recorded")).not.toBeNull();

    const decide = requests.find((r) => r.url === "/api/tax-lien/underwrite");
    expect(decide?.method).toBe("POST");
    expect(decide?.body).toMatchObject({ propertyId: 7, kind: "offer" });
    expect(typeof decide?.body.reviewDueAt).toBe("string");
    expect(decide?.body.inputs).toMatchObject({ lotValueCents: 5_000_000, requiredReturnCents: 1_000_000 });
    // The flow writes nothing else and sends nothing to anyone.
    expect(requests.filter((r) => r.method !== "GET").map((r) => r.url).filter((u) => u !== "/api/scenarios/preview")).toEqual(["/api/tax-lien/underwrite"]);
  });
});

describe("placement — reached from the tax-delinquent pipeline, not a new door", () => {
  const app = stripComments(fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8"));
  const pipeline = stripComments(fs.readFileSync(path.join(ROOT, "client/src/pages/tax-delinquent.tsx"), "utf8"));

  it("App.tsx routes /tax/bid-desk to the desk behind ProtectedRoute", () => {
    expect(app).toMatch(/<Route path="\/tax\/bid-desk">\s*\{\(\) => <ProtectedRoute component=\{TaxBidDeskPage\} \/>\}/);
    expect(app).toContain('import("@/pages/tax/bid-desk")');
  });

  it("the tax-delinquent pipeline links to the desk", () => {
    expect(pipeline).toContain('"/tax/bid-desk"');
    expect(pipeline).toContain('data-testid="tax-bid-desk-link"');
  });
});
