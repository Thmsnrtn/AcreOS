// @vitest-environment jsdom
/**
 * W10.3 — the public county primer may not promise a pre-screened list pull.
 *
 * /learn/county/:state/:county said "a {county} list pull arrives already
 * screened on the diligence that kills resale". No list pull screens anything:
 * the W10.3 list builder pulls owner/parcel rows from the county's own records,
 * and the flood/soil/elevation/wetlands reads run per parcel, on demand. The
 * test renders the real page (every published county route) and reads the
 * rendered text — not the source, whose comments may legitimately name the
 * retired sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../client/src/lib/marketing-touch", () => ({ emitMarketingTouch: vi.fn() }));
// The public chrome (theme, header, footer) is not the subject — render the body bare.
vi.mock("../../client/src/components/seo/SeoPageShell", async () => {
  const R = await import("react");
  return { SeoPageShell: ({ children }: { children?: React.ReactNode }) => R.createElement("main", null, children) };
});

import CountyLearnPage from "../../client/src/pages/learn/county";
import { listCountyRoutes } from "../../client/src/pages/learn/county-registry";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const routes = listCountyRoutes();

describe("county primer copy", () => {
  it("vacuity: there are published county routes to read", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes.map((r) => [`/learn/county/${r.stateSlug}/${r.countySlug}`] as const))("%s promises no screened list pull", async (path) => {
    window.history.pushState({}, "", path);
    await act(async () => {
      root.render(React.createElement(CountyLearnPage));
    });
    const section = container.querySelector('[data-testid="section-county-value"]');
    expect(section, `vacuity: ${path} did not render its value section`).not.toBeNull();
    const pageText = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(pageText).not.toMatch(/already screened/i);
    expect(pageText).not.toMatch(/list pull/i);
    expect(pageText).not.toMatch(/arrives? (already )?(pre-?)?screened/i);
  });
});
