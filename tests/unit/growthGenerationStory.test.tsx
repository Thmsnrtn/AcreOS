// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const h = vi.hoisted(() => ({ api: vi.fn(), search: "generationJobId=1" }))
vi.mock("@/lib/queryClient", () => ({ apiRequest: h.api }))
vi.mock("wouter", async importOriginal => ({ ...await importOriginal<typeof import("wouter")>(), useSearch: () => h.search }))
vi.mock("@/components/page-shell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock("@/components/founder/FounderAuthError", () => ({ FounderAuthError: () => <p>General timeline unavailable</p> }))
vi.mock("@/components/founder/PulseStrip", () => ({ FounderPulseStrip: () => null }))
vi.mock("@/components/founder/GlassEngine", () => ({ GlassEngine: () => null }))
vi.mock("@/components/prefetch-link", () => ({ PrefetchLink: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }))
import Story from "../../client/src/pages/founder/autopilot-story"
let root: Root, container: HTMLDivElement, qc: QueryClient
const job = { id: 1, createdAt: "2026-10-13T12:00:00Z", intent: "Original Texas brief", state: "failed", receipt: null, renderJobs: { expected: null, processed: 0, failed: 0 }, reviewIds: [] }
beforeEach(() => {
  vi.resetAllMocks()
  h.search = "generationJobId=1"
  h.api.mockResolvedValue({ json: async () => ({ job }) })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(["/api/founder/autopilot/board-report"], { markdown: "", generatedAt: "" })
  // The selected receipt must remain accessible even if the unrelated timeline fails.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeline unavailable") }))
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); container.remove(); vi.unstubAllGlobals() })
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
async function mount() { await act(async () => root.render(<QueryClientProvider client={qc}><Story /></QueryClientProvider>)); await flush() }
it("reads the exact older job in Story despite a failed general timeline, without inventing cost or cause", async () => {
  await mount()
  expect(h.api).toHaveBeenCalledWith("GET", "/api/founder/cmo/generation-jobs/1")
  expect(container.textContent).toContain("Original Texas brief")
  expect(container.textContent).toContain("cost: Unavailable")
  expect(container.textContent).toContain("did not record a failure explanation")
  expect(container.textContent).toContain("Missing cost information does not mean zero cost")
  expect(container.textContent).not.toContain("$0.00")
})
it("shows recorded cost and a review handoff without claiming delivery", async () => {
  h.api.mockResolvedValue({ json: async () => ({ job: { ...job, state: "review_created", receipt: { totalCostCents: 123 }, reviewIds: [8] } }) })
  await mount()
  expect(container.textContent).toContain("$1.23")
  expect(container.textContent).toContain("does not verify delivery")
  expect(container.querySelector('a[href="/founder/cmo"]')?.textContent).toBe("Review videos")
})
it("surfaces a failed read and retries the same identity", async () => {
  h.api.mockRejectedValueOnce(new Error("503: record unavailable"))
  await mount()
  expect(container.textContent).toContain("Generation record unavailable")
  expect(container.textContent).not.toContain("Original Texas brief")
  const retry = Array.from(container.querySelectorAll("button")).find(b => /try again|retry/i.test(b.textContent ?? ""))!
  await act(async () => retry.click()); await flush()
  expect(container.textContent).toContain("Original Texas brief")
  expect(h.api.mock.calls.every(call => call[1] === "/api/founder/cmo/generation-jobs/1")).toBe(true)
})
it("refuses a record returned for a different request", async () => {
  h.api.mockResolvedValue({ json: async () => ({ job: { ...job, id: 2 } }) })
  await mount()
  expect(container.textContent).toContain("Generation record unavailable")
  expect(container.textContent).not.toContain("Original Texas brief")
})
it("does not read a noncanonical request identity", async () => {
  h.search = "generationJobId=01"
  await mount()
  expect(container.textContent).toContain("Invalid generation request identity")
  expect(h.api).not.toHaveBeenCalled()
})
