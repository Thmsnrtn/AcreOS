// @vitest-environment jsdom
/**
 * The wholesale decision desk (Leg 1) — the client half that makes the
 * decision route REACHABLE, which is what the readiness measurement credits.
 * FALSIFYING: on pre-leg main the page, the field set and the nav child do not
 * exist.
 *
 *   - /wholesale/underwrite renders the real workbench on wholesale_mao, with
 *     a deep-linked property preselected;
 *   - recording stays DISABLED until the evidence (a comp, the ARV basis, the
 *     fee basis) is complete — and enables once it is (both directions);
 *   - the recorded POST carries the evidence beside the standard fields, which
 *     the evidence cannot overwrite; the only non-GET requests are the preview
 *     and the decision (nothing is sent to anyone);
 *   - the desk sits behind the Wholesale module (businessTypeOnly
 *     residential_wholesaler), not a new door, and is routed in App.tsx.
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
        ? { engineId: "wholesale_mao", engineVersion: "v", metrics: [{ id: "max_allowable_offer", value: 15_600_000, unit: "cents" }], assumptions: [], inputs: body.inputs }
        : { decisionId: 901, scenarioId: 501 };
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
}));

import UnderwriteWholesaleOfferPage from "../../client/src/pages/wholesale/underwrite-offer";
import { WHOLESALE_MAO_FIELDS } from "../../shared/economics/fields/wholesaleMao";

const ROOT = path.resolve(__dirname, "../..");
let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const byId = (id: string) => container.querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement;

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(UnderwriteWholesaleOfferPage)));
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
async function answerEverythingButEvidence() {
  for (const f of WHOLESALE_MAO_FIELDS) setValue(q(`underwrite-wholesale-field-${f.key}`) as HTMLInputElement, "70");
  await settle();
  act(() => q("underwrite-wholesale-kind-offer")!.click());
  setValue(q("underwrite-wholesale-rationale") as HTMLTextAreaElement, "The buyer's number binds and the fee holds.");
  act(() => q("underwrite-wholesale-review-in-14")!.click());
}
const recordBtn = () => q("underwrite-wholesale-record") as HTMLButtonElement;

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
  it("renders the real workbench on wholesale_mao with the deep-linked property", async () => {
    await render();
    expect(q("underwrite-wholesale-workbench")).not.toBeNull();
    expect(q("underwrite-wholesale-property")?.getAttribute("data-value")).toBe("7");
    expect(q("underwrite-wholesale-evidence")).not.toBeNull();
  });

  it("recording waits for the evidence, then records it beside the standard fields", async () => {
    await render();
    await answerEverythingButEvidence();
    // Direction 1: everything but the evidence is answered — still disabled.
    expect(recordBtn().disabled).toBe(true);

    setValue(byId("comp-address-0"), "12 Oak St");
    setValue(byId("comp-price-0"), "295,000");
    setValue(byId("comp-date-0"), "2026-09-14");
    setValue(byId("arv-basis"), "Two renovated 3/2 sales within half a mile.");
    expect(recordBtn().disabled, "fee basis still empty").toBe(true);
    setValue(byId("fee-basis"), "My floor for a full-kitchen rehab.");
    // Direction 2: evidence complete — recordable.
    expect(recordBtn().disabled).toBe(false);

    await act(async () => {
      recordBtn().click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(q("underwrite-wholesale-recorded")).not.toBeNull();

    const decide = requests.find((r) => r.url === "/api/wholesale/underwrite");
    expect(decide?.method).toBe("POST");
    expect(decide?.body.evidence).toEqual({
      comps: [{ address: "12 Oak St", soldPriceCents: 29_500_000, soldOn: "2026-09-14" }],
      arvBasis: "Two renovated 3/2 sales within half a mile.",
      feeBasis: "My floor for a full-kitchen rehab.",
    });
    expect(decide?.body).toMatchObject({ propertyId: 7, kind: "offer" });
    // The flow writes nothing else and sends nothing to anyone.
    expect(requests.filter((r) => r.method !== "GET").map((r) => r.url).filter((u) => u !== "/api/scenarios/preview")).toEqual(["/api/wholesale/underwrite"]);
  });
});

describe("placement — behind the Wholesale module, not a new door", () => {
  const sidebar = stripComments(fs.readFileSync(path.join(ROOT, "client/src/components/layout-sidebar.tsx"), "utf8"));
  const app = stripComments(fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8"));

  it("the nav child lives inside the wholesaler module, which is gated to residential_wholesaler", () => {
    const start = sidebar.indexOf('id: "wholesaler"');
    expect(start).toBeGreaterThan(-1);
    const end = sidebar.indexOf("\n  },", start);
    const module = sidebar.slice(start, end);
    expect(module).toContain('businessTypeOnly: ["residential_wholesaler"]');
    expect(module).toContain('href: "/wholesale/underwrite"');
    expect(sidebar.split('href: "/wholesale/underwrite"').length - 1).toBe(1);
  });

  it("App.tsx routes /wholesale/underwrite to the desk behind ProtectedRoute", () => {
    expect(app).toMatch(/<Route path="\/wholesale\/underwrite">\s*\{\(\) => <ProtectedRoute component=\{UnderwriteWholesaleOfferPage\} \/>\}/);
    expect(app).toContain('import("@/pages/wholesale/underwrite-offer")');
  });
});
