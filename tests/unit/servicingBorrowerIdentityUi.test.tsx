// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ book: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ fetchJsonArray: h.book }));
vi.mock("@/hooks/use-persona", () => ({ usePersona: () => "note_servicer", useTerm: () => "Collateral" }));
import { PersonaMapStrip } from "../../client/src/components/maps/PersonaMapStrip";
let root: Root; let container: HTMLDivElement; let qc: QueryClient;
const lead = { id: 9001, firstName: "Older", lastName: "Borrower" };
const note = { id: 77, status: "active", borrowerId: 9001, nextPaymentDate: "2026-01-01" };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", h.fetch);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["/api/notes"], [note]);
  h.book.mockResolvedValue([{ id: 1, firstName: "First", lastName: "Page" }]);
  h.fetch.mockResolvedValue(new Response(JSON.stringify(lead), { headers: { "Content-Type": "application/json" } }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); container.remove(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={qc}><PersonaMapStrip properties={[]} hasAnyProperties={false} /></QueryClientProvider>)); await flush(); }
it("resolves the overdue borrower's exact ID beyond the first lead page", async () => {
  await mount(); expect(container.textContent).toContain("Older Borrower");
  expect(h.book).not.toHaveBeenCalled();
  expect(h.fetch).toHaveBeenCalledWith("/api/leads/9001", { credentials: "include" });
});
it("offers retry for a failed lookup and then shows the verified borrower", async () => {
  h.fetch.mockResolvedValue(new Response("unavailable", { status: 503 }));
  await mount(); expect(container.textContent).toContain("Borrower details unavailable");
  expect(container.textContent).not.toContain("Older Borrower");
  h.fetch.mockResolvedValue(new Response(JSON.stringify(lead)));
  const retry = container.querySelector('[data-testid="servicing-borrower-error"]')?.querySelector<HTMLButtonElement>("button");
  expect(retry).toBeDefined(); await act(async () => retry!.click()); await flush();
  expect(container.textContent).toContain("Older Borrower");
});
it("does not show a mismatched returned borrower identity", async () => {
  h.fetch.mockResolvedValue(new Response(JSON.stringify({ ...lead, id: 123 })));
  await mount(); expect(container.textContent).toContain("Borrower details unavailable");
  expect(container.textContent).not.toContain("Older Borrower");
  expect(container.textContent?.toLowerCase()).not.toContain("deleted");
});
it("does not fetch a lead book or borrower when all loaded notes are current", async () => {
  qc.setQueryData(["/api/notes"], [{ ...note, nextPaymentDate: "2099-01-01" }]);
  await mount(); expect(container.textContent).toContain("All current");
  expect(h.fetch).not.toHaveBeenCalled(); expect(h.book).not.toHaveBeenCalled();
});

it("keeps an inaccessible borrower unavailable without implying deletion", async () => {
  h.fetch.mockResolvedValue(new Response(JSON.stringify({ message: "Lead not found" }), { status: 404 }));
  await mount(); expect(container.textContent).toContain("Borrower details unavailable");
  expect(container.textContent).toContain("Note #77"); expect(container.textContent?.toLowerCase()).not.toContain("deleted");
});
it("stops displaying a cached borrower identity when a refetch fails", async () => {
  const key = ["/api/leads", "by-id", 9001]; qc.setQueryData(key, lead);
  await mount(); expect(container.textContent).toContain("Older Borrower");
  h.fetch.mockRejectedValue(new Error("503: unavailable"));
  await act(async () => { await qc.refetchQueries({ queryKey: key }); }); await flush();
  expect(qc.getQueryData(key)).toEqual(lead);
  expect(container.textContent).not.toContain("Older Borrower");
  expect(container.textContent).toContain("Borrower details unavailable");
});
