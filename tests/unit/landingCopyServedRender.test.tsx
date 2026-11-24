// @vitest-environment jsdom
/**
 * Landing copy served as data — the happy-path fidelity render.
 *
 * The landing page loads the REAL /landing-copy.json asset (read from
 * disk, served through a fetch stub) and renders the sections with
 * exactly the source module's copy — the served page says what
 * client/src/pages/landing/copy.ts says, with no load error.
 *
 * This lives in its own file (fresh module registry) because the
 * shared static-data loader promise-caches per URL for the session:
 * the wrong-shape suite's malformed asset must not leak into this
 * render through the cache (see landingCopyWrongShapeAsset.test.tsx).
 *
 * Only the network edge is faked; the page, the loader, the shape
 * guard and every section are real.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import fs from "node:fs"
import path from "node:path"
import { LANDING_COPY } from "../../client/src/pages/landing/copy"

import LandingPage from "../../client/src/pages/landing"

const REAL_ASSET = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../client/public/landing-copy.json"), "utf8")
) as unknown

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

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  vi.unstubAllGlobals()
})

describe("landing page with the real /landing-copy.json", () => {
  it("renders the sections with the source module's copy and no error", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.includes("landing-copy.json")
        ? new Response(JSON.stringify(REAL_ASSET), { status: 200 })
        : new Response("{}", { status: 200 })
    )
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    // The App shell supplies the QueryClient in production (the
    // landing Footer's support modal uses a mutation); mirror it here.
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
    expect(container.querySelector('[data-testid="landing-load-error"]')).toBeNull()
    expect(container.textContent).toContain(LANDING_COPY.hero.wedge)
    expect(container.textContent).toContain(LANDING_COPY.landCreditScore.title)
    expect(container.textContent).toContain(LANDING_COPY.cta.title)
    expect(container.textContent).toContain(LANDING_COPY.pricing.title)
  })
})
