// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: h.api }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/use-document-title", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/components/page-shell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
import FounderCmoPage from "../../client/src/pages/founder/cmo";
let root: Root; let container: HTMLDivElement; let qc: QueryClient;
function pending(id = 1, ratio: "9:16" | "1:1" = "9:16") {
  const render = { id: `render-${id}`, aspectRatio: ratio, storagePath: `local:review-${id}.mp4`, durationSec: 15, status: "ready" };
  return { inboxItem: { id, sophieAnalysis: "Review", sophieConfidenceScore: 70, contextBundle: { scriptHook: `Hook ${id}`, scriptBody: `Body ${id}`, scriptCta: `CTA ${id}`, hookArchetype: "research", funnelStage: "cold", costBreakdown: { totalCents: 0 } } }, renders: [render], approvalAvailable: true, reviewRevision: String(id).repeat(64), destinations: [{ renderId: render.id, platform: "meta" }, ...(ratio === "9:16" ? [{ renderId: render.id, platform: "tiktok" }] : [])] };
}
const dashboard = (items = [pending()]) => ({ pending: items, live: [], archetypes: [], brandProfile: null, budget: null });
beforeEach(() => {
  vi.resetAllMocks(); h.api.mockResolvedValue({ ok: true });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["/api/founder/cmo/dashboard"], dashboard());
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); container.remove(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={qc}><FounderCmoPage /></QueryClientProvider>)); await flush(); }
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click()); await flush();
}
async function key(value: string) { await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }))); }
it("keeps the reviewed revision and videos after polling and ignores dialog retargeting shortcuts", async () => {
  qc.setQueryData(["/api/founder/cmo/dashboard"], dashboard([pending(1), pending(2)]));
  await mount(); await key("j"); await key("a");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Hook 1");
  const changed = { ...pending(1), reviewRevision: "f".repeat(64), renders: [{ ...pending(1).renders[0], storagePath: "local:replacement.mp4" }] };
  await act(async () => { qc.setQueryData(["/api/founder/cmo/dashboard"], dashboard([changed, pending(2)])); });
  await key("j"); await key("a"); await key("r");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Hook 1"); expect(dialog.textContent).not.toContain("Hook 2");
  expect(dialog.querySelector("video")?.getAttribute("src")).toContain("review-1.mp4");
  await click("Confirm broadcast");
  expect(h.api).toHaveBeenCalledWith("POST", "/api/founder/cmo/approve", { inboxItemId: 1, reviewRevision: "1".repeat(64), platforms: ["meta", "tiktok"] });
});
it("shows available ratios and disables TikTok when the reviewed bundle has no portrait render", async () => {
  qc.setQueryData(["/api/founder/cmo/dashboard"], dashboard([pending(1, "1:1")]));
  await mount(); await key("j"); await key("a");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("No eligible portrait render");
  expect(dialog.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1].disabled).toBe(true);
  await click("Confirm broadcast");
  expect(h.api.mock.calls[0][2].platforms).toEqual(["meta"]);
});
it("a stale approval error retains the witnessed token until the founder closes and reviews again", async () => {
  h.api.mockRejectedValue(new Error("409: Review changed; refresh and review again"));
  await mount(); await key("j"); await key("a");
  await click("Confirm broadcast");
  expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Approval failed" }));
  await act(async () => { qc.setQueryData(["/api/founder/cmo/dashboard"], dashboard([{ ...pending(), reviewRevision: "f".repeat(64) }])); });
  await click("Confirm broadcast");
  expect(h.api.mock.calls.map(call => call[2].reviewRevision)).toEqual(["1".repeat(64), "1".repeat(64)]);
});

it("keeps the original dialog open through Escape while its approval is in flight", async () => {
  let complete!: (value: unknown) => void;
  h.api.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  qc.setQueryData(["/api/founder/cmo/dashboard"], dashboard([pending(1), pending(2)]));
  await mount(); await key("j"); await key("a"); await click("Confirm broadcast");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await key("j"); await key("a");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Hook 1");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Hook 2");
  await act(async () => complete({ ok: true })); await flush();
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(h.api).toHaveBeenCalledOnce();
});
