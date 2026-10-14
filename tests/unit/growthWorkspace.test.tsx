// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ api: vi.fn(), publish: vi.fn(), refresh: vi.fn() }))
vi.mock("@/lib/queryClient", () => ({ apiRequest: h.api }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/components/prefetch-link", () => ({
  PrefetchLink: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}))
import { GrowthWorkspace } from "../../client/src/components/founder/growth-workspace"

let root: Root
let container: HTMLDivElement
let qc: QueryClient
const dashboard = {
  brandProfile: { id: 7, oneLiner: "AcreOS", audiencePrimary: "Land investors" },
  pending: [],
  budget: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  h.api.mockImplementation(async (method: string) => ({
    json: async () => (method === "GET" ? dashboard : { ok: true, outboxId: 42 }),
  }))
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount())
  qc.clear()
  container.remove()
})

it("a finished generation hands off to the actionable video reviewer", async () => {
  h.api.mockImplementation(async (_method: string, url: string) => ({ json: async () => url.endsWith("generation-jobs") ? { jobs: [{ id: 42, intent: "Research parcels", state: "review_created", receipt: null, renderJobs: { expected: 1, processed: 1, failed: 0 }, reviewIds: [8] }] } : dashboard }));
  await mount(); await flush();
  const link = Array.from(container.querySelectorAll("a")).find(a => a.textContent === "Review videos");
  expect(link?.getAttribute("href")).toBe("/founder/cmo");
});
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15))
  })
}
async function mount(
  conversions: {
    totalSignups: number
    byPlay: Array<{ playId: string; signups: number }>
  } | null = null
) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <GrowthWorkspace
          conversions={conversions}
          publishEnabled={false}
          isSettingPending={false}
          onPublishChange={h.publish}
          onRefresh={h.refresh}
          isRefreshing={false}
        />
      </QueryClientProvider>
    )
  )
  await flush()
}
async function tab(name: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (el) => el.textContent === name
  )!
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  })
}
async function change(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
async function submit(selector: string) {
  const form = container.querySelector(selector)!.closest("form")!
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  await flush()
}

describe("native growth workspace", () => {
  it("submits the founder brief to the real generation endpoint and reports only acceptance", async () => {
    await mount()
    await change("#growth-intent", "  Explain parcel due diligence  ")
    await submit("#growth-intent")
    expect(h.api).toHaveBeenCalledWith("POST", "/api/founder/cmo/generate", {
      intent: "Explain parcel due diligence",
      count: 1,
      funnelStage: "cold",
      notes: "",
    })
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "completion and delivery are not yet confirmed"
    )
    expect(h.publish).not.toHaveBeenCalled()
  })
  it("does not call a lost response a rejected request and reads the retained worker identity", async () => {
    let accepted = false;
    h.api.mockImplementation(async (method: string, url: string) => {
      if (method === "POST") { accepted = true; throw new Error("response lost"); }
      return { json: async () => url.endsWith("generation-jobs") ? { jobs: accepted ? [{ id: 42, intent: "Research parcels", state: "queued", receipt: null, renderJobs: { expected: null, processed: 0, failed: 0 }, reviewIds: [] }] : [] } : dashboard };
    });
    await mount(); await change("#growth-intent", "Research parcels"); await submit("#growth-intent");
    expect(container.textContent).toContain("Acceptance could not be confirmed");
    expect(container.textContent).not.toContain("The request was not accepted");
    await act(async () => { await qc.invalidateQueries({ queryKey: ["/api/founder/cmo/generation-jobs"] }); });
    await flush();
    expect(container.textContent).toContain("#42");
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("saves edited audience and positioning through the existing profile endpoint", async () => {
    await mount()
    await change("#growth-audience", "Texas land investors")
    await submit("#growth-audience")
    expect(h.api).toHaveBeenCalledWith("PATCH", "/api/founder/cmo/brand-profile", {
      id: 7,
      oneLiner: "AcreOS",
      audiencePrimary: "Texas land investors",
    })
  })
  it("shows failed review reads as unavailable rather than an empty queue", async () => {
    h.api.mockRejectedValue(new Error("503: database unavailable"))
    await mount()
    await tab("Review")
    expect(container.textContent).toContain("Review queue unavailable")
    expect(container.textContent).not.toContain("No recent video bundles awaiting review")
  })
  it("distinguishes missing attribution from a recorded zero and offers a real retry", async () => {
    await mount()
    await tab("Results")
    expect(container.textContent).toContain("Unavailable")
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Reload Controls"
    )!
    await act(async () => retry.click())
    expect(h.refresh).toHaveBeenCalledTimes(1)
    await mount({ totalSignups: 0, byPlay: [] })
    expect(container.textContent).not.toContain("Unavailable")
    expect(container.textContent).toContain("A lower bound")
  })
})
