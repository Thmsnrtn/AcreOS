// @vitest-environment jsdom
/**
 * Landing copy served as data — the wrong-shape regression suite
 * (the #716 D-2 shape-guard mandate, applied to the landing-copy diet).
 *
 * The landing page loads /landing-copy.json once through the shared
 * static-data loader and validates the shape at the boundary
 * (client/src/lib/landing-copy.ts: isLandingCopy). This suite proves:
 *   1. a 200 with the WRONG shape (truncated / stale / hand-edited
 *      asset) renders the page shell plus the VISIBLE load error —
 *      never a section crash, never silently-empty sections;
 *   2. a failed fetch takes the same visible error path;
 *   3. the real asset renders the sections with the module's copy
 *      (fidelity: the served page says what copy.ts says).
 *
 * Only the network edge is faked; the page, the loader, the shape
 * guard and every section are real.
 *
 * ORDERING: the shared loader promise-caches per URL for the page
 * session, so within this file the FAILED fetch runs first (a
 * rejection clears the cache), then the wrong-shape 200 is fetched
 * fresh. The happy-path render lives in its own file
 * (landingCopyServedRender.test.tsx) with a fresh module registry.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { LANDING_COPY } from "../../client/src/pages/landing/copy"

import LandingPage from "../../client/src/pages/landing"

let root: Root | null = null
let container: HTMLDivElement

// jsdom has no matchMedia; the support modal's ResponsiveModal needs
// one. Stub the standard inert implementation.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

function stubFetch(handler: (url: string) => Promise<Response>) {
  vi.stubGlobal("fetch", (url: string) => handler(url))
}

async function render() {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  // The App shell supplies the QueryClient in production (the landing
  // Footer's support modal uses a mutation); mirror that here.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <LandingPage />
      </QueryClientProvider>
    )
  })
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  }
  return container
}

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  vi.unstubAllGlobals()
})

describe("landing page with a wrong-shape /landing-copy.json", () => {
  it("a failed fetch renders the shell plus a VISIBLE load error", async () => {
    stubFetch(async (url) =>
      url.includes("landing-copy.json")
        ? new Response("nope", { status: 503 })
        : new Response("{}", { status: 200 })
    )
    const el = await render()
    expect(el.querySelector('[data-testid="landing-load-error"]')).not.toBeNull()
    expect(el.textContent).not.toContain(LANDING_COPY.hero.wedge)
  })

  it("renders the shell plus a VISIBLE load error, never a crash or empty sections", async () => {
    stubFetch(async (url) =>
      url.includes("landing-copy.json")
        ? new Response(JSON.stringify({ hero: { eyebrow: 42 } }), {
            status: 200,
          })
        : new Response("{}", { status: 200 })
    )
    const el = await render()
    const alert = el.querySelector('[data-testid="landing-load-error"]')
    expect(alert).not.toBeNull()
    expect(alert!.getAttribute("role")).toBe("alert")
    // The hero copy did NOT render from the malformed asset.
    expect(el.textContent).not.toContain(LANDING_COPY.hero.wedge)
  })
})
