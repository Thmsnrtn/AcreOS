// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ api: vi.fn(), list: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/queryClient", async (original) => ({ ...await original<object>(), apiRequest: h.api, fetchJsonArray: h.list }));
vi.mock("@/components/page-shell", () => ({ PageShell: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock("@/components/required-disclaimer", () => ({ RequiredDisclaimer: () => null }));
vi.mock("@/components/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/offer-preflight-checklist", () => ({ OfferPreflightChecklist: ({ selectedLeadIds }: { selectedLeadIds: number[] }) => <output data-testid="selected-lead-ids">{selectedLeadIds.join(",")}</output> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-properties", () => ({ usePropertiesByIds: () => ({ data: new Map() }), usePropertiesBySellerIds: () => ({ data: new Map() }) }));
import OffersPage from "../../client/src/pages/offers";
let root: Root; let container: HTMLDivElement; let qc: QueryClient;
const lead = (id: number, firstName = `Lead ${id}`) => ({ id, firstName, lastName: "Fixture", status: "new" });
beforeEach(() => {
  vi.resetAllMocks();
  h.list.mockResolvedValue([]);
  h.api.mockImplementation(async (_method: string, url: string) => new Response(JSON.stringify(lead(Number(url.split("/").pop())))));
  h.fetch.mockImplementation(async (url: string) => {
    const params = new URL(url, "http://localhost").searchParams;
    if (params.get("q") === "unavailable") throw new Error("Network unavailable");
    const page = Number(params.get("page") ?? 1);
    const data = params.get("q") ? [lead(5001, "Older seller")] : [lead(page === 1 ? 1 : 101)];
    return new Response(JSON.stringify({ data, total: params.get("q") ? 1 : 5001, page, pageSize: 100, totalPages: params.get("q") ? 1 : 51 }));
  });
  vi.stubGlobal("fetch", h.fetch);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); container.remove(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function mount() {
  await act(async () => root.render(<QueryClientProvider client={qc}><OffersPage /></QueryClientProvider>)); await flush();
  await act(async () => container.querySelector('[data-testid="tab-calculator"]')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))); await flush();
}
async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>("#offer-lead-search")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); await flush();
}
describe("offer lead identity and candidate population", () => {
  it("searches beyond the first page and names the bounded page and complete matching count", async () => {
    await mount(); expect(container.textContent).toContain("5001 matching leads");
    await search("Older"); expect(container.textContent).toContain("Older seller");
    expect(h.fetch.mock.calls.some(([url]) => new URL(url, "http://localhost").searchParams.get("q") === "Older")).toBe(true);
    expect(container.textContent).toContain("1 matching leads");
  });
  it("retains selected identities across pages and resolves them by id", async () => {
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="checkbox-lead-1"]')!.click()); await flush();
    const next = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Next leads")!;
    await act(async () => next.click()); await flush();
    expect(container.textContent).toContain("Page 2 of 51");
    expect(container.querySelector('[data-testid="selected-lead-ids"]')!.textContent).toBe("1");
    expect(h.api).toHaveBeenCalledWith("GET", "/api/leads/1");
  });
  it("shows a failed search as unavailable, retaining the selection", async () => {
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="checkbox-lead-1"]')!.click()); await flush();
    await search("unavailable");
    expect(container.textContent).toContain("Couldn't load candidate leads");
    expect(container.querySelector('[data-testid="selected-lead-ids"]')!.textContent).toBe("1");
    expect(container.textContent).not.toContain("No leads available.");
  });
});
