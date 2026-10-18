// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));
vi.mock("../../client/src/lib/queryClient", async importOriginal => ({ ...(await importOriginal<any>()), apiRequest: h.request }));
vi.mock("../../client/src/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
import { useDeleteDeal } from "../../client/src/hooks/use-deals";
let root: Root; let container: HTMLDivElement; let client: QueryClient;
let result: ReturnType<typeof useDeleteDeal>;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); });
async function mount() {
  const invalidate = vi.spyOn(client, "invalidateQueries"); const remove = vi.spyOn(client, "removeQueries");
  function Probe() { result = useDeleteDeal(); return null; }
  await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
  return { invalidate, remove };
}
it("deletes through the mounted, scoped bulk endpoint and clears the affected views", async () => {
  h.request.mockResolvedValue({ ok: true }); const { invalidate, remove } = await mount();
  await act(async () => { await result.mutateAsync(42); });
  expect(h.request).toHaveBeenCalledWith("POST", "/api/deals/bulk-delete", { ids: [42] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/today"] });
  expect(remove).toHaveBeenCalledWith({ queryKey: ["/api/deals", 42] });
  expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Deal deleted successfully." }));
});
it("does not clear caches or claim success when the permission-scoped endpoint refuses", async () => {
  h.request.mockResolvedValue({ ok: false, status: 403 }); const { invalidate, remove } = await mount();
  await act(async () => { await expect(result.mutateAsync(42)).rejects.toThrow("403"); });
  expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  expect(invalidate).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});
