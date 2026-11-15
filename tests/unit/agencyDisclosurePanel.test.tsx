// @vitest-environment jsdom
/**
 * AgencyDisclosurePanel — the light-up of GET/PUT /api/deals/:id/dual-agency
 * (W2-AGENT, 2026-11-06). Both routes were mounted and had no client caller.
 *
 * Pinned:
 *   1. agent_investor only — any other persona gets nothing and fetches nothing;
 *   2. loading / error (with a working retry) / empty / data states;
 *   3. the save sends exactly what the operator entered to the real path;
 *   4. the path it calls is the one the server registers, and the panel is
 *      mounted on the deal detail — so "no client caller" cannot quietly return.
 *
 * Same harness as dealDeletionEndpoint.test.tsx: react-dom createRoot, a
 * per-test QueryClient, apiRequest / useToast / useOrganization mocked.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({
  request: vi.fn(),
  toast: vi.fn(),
  org: null as null | { onboardingData: { businessType: string } },
}));
vi.mock("../../client/src/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: h.request,
}));
vi.mock("../../client/src/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("../../client/src/hooks/use-organization", () => ({ useOrganization: () => ({ data: h.org }) }));

import { AgencyDisclosurePanel, type AgencyRecord } from "../../client/src/components/deals/AgencyDisclosurePanel";

const ROOT = path.resolve(__dirname, "../..");
const PATH = "/api/deals/42/dual-agency";
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.org = { onboardingData: { businessType: "agent_investor" } };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AgencyDisclosurePanel dealId={42} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("persona gate", () => {
  it("renders nothing and fetches nothing for any other persona", async () => {
    h.org = { onboardingData: { businessType: "land_flipper" } };
    await mount();
    expect(container.innerHTML).toBe("");
    expect(h.request).not.toHaveBeenCalled();
  });
});

describe("states", () => {
  it("loading shows a skeleton", async () => {
    h.request.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(byId("agency-disclosure-loading")).not.toBeNull();
    expect(h.request).toHaveBeenCalledWith("GET", PATH);
  });

  it("an error is an error state whose retry fetches again", async () => {
    h.request.mockRejectedValueOnce(new Error("500: boom"));
    await mount();
    expect(byId("agency-disclosure-error")).not.toBeNull();
    expect(byId("agency-disclosure-form")).toBeNull();
    h.request.mockResolvedValue(ok({ dealId: 42, dualAgencySide: null, disclosureAcknowledgedAt: null, disclosureDocRef: null }));
    await act(async () => byId("agency-disclosure-error-retry-button")!.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(byId("agency-disclosure-empty")).not.toBeNull();
  });

  it("nothing recorded is an empty state whose action opens the form", async () => {
    h.request.mockResolvedValue(ok({ dealId: 42, dualAgencySide: null, disclosureAcknowledgedAt: null, disclosureDocRef: null }));
    await mount();
    expect(byId("agency-disclosure-empty")).not.toBeNull();
    expect(byId("agency-disclosure-form")).toBeNull();
    await act(async () => byId("agency-disclosure-empty-action")!.click());
    expect(byId("agency-disclosure-form")).not.toBeNull();
  });

  it("a recorded deal shows its values, and Save sends exactly what was entered to the real path", async () => {
    const record: AgencyRecord = {
      dealId: 42,
      dualAgencySide: "buyer",
      disclosureAcknowledgedAt: "2026-10-01T00:00:00.000Z",
      disclosureDocRef: "https://files.example.com/disclosure.pdf",
    };
    h.request.mockImplementation(async (method: string, _url: string, body?: Record<string, unknown>) =>
      ok(method === "PUT" ? { ...record, ...body } : record),
    );
    await mount();
    const inputs = [...container.querySelectorAll("input")] as HTMLInputElement[];
    const date = inputs.find((i) => i.type === "date")!;
    const doc = inputs.find((i) => i.type !== "date")!;
    expect(date.value).toBe("2026-10-01");
    expect(doc.value).toBe(record.disclosureDocRef);

    await act(async () => {
      type(date, "2026-10-02");
      type(doc, "  https://files.example.com/v2.pdf  ");
    });
    await act(async () => {
      byId("agency-disclosure-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(h.request).toHaveBeenCalledWith("PUT", PATH, {
      dualAgencySide: "buyer",
      disclosureAcknowledgedAt: "2026-10-02T00:00:00.000Z",
      disclosureDocRef: "https://files.example.com/v2.pdf",
    });
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Agency record saved" }));
  });

  it("a failed save says so and does not claim success", async () => {
    h.request.mockImplementation(async (method: string) => {
      if (method === "PUT") throw new Error("422: invalid");
      return ok({ dealId: 42, dualAgencySide: "seller", disclosureAcknowledgedAt: null, disclosureDocRef: null });
    });
    await mount();
    await act(async () => {
      byId("agency-disclosure-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Agency record saved" }));
  });
});

describe("wired end to end", () => {
  it("the server registers GET and PUT on the path the panel calls", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-deals.ts"), "utf8"));
    expect(src).toMatch(/api\.get\(\s*"\/api\/deals\/:id\/dual-agency"/);
    expect(src).toMatch(/api\.put\(\s*"\/api\/deals\/:id\/dual-agency"/);
  });

  it("the deal detail renders the panel with the deal's id (parsed, not grepped)", () => {
    const file = path.join(ROOT, "client/src/components/deal-detail-content.tsx");
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];
    const visit = (n: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "AgencyDisclosurePanel") {
        const attr = n.attributes.properties.find(
          (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === "dealId",
        );
        found.push(attr?.initializer?.getText(sf) ?? "");
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(found).toEqual(["{deal.id}"]);
  });
});
