// @vitest-environment jsdom
/**
 * PullToRefresh puts the caller's className on the element that holds the
 * children, in BOTH branches.
 *
 * On phones it wraps children in a translate wrapper for the pull gesture.
 * The caller's className (Today passes `space-y-6 md:space-y-8`) sat on the
 * OUTER container, whose only children were the indicator and that wrapper,
 * so on an iPhone every Today section touched the next — found in the
 * Fieldstone redesign's real-app screenshots, 2026-10-18. Desktop (the
 * disabled branch) was fine, which is why it survived.
 *
 * Mutation probe: move `className` back to the pull-to-refresh-container.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/lib/haptics", () => ({ mediumImpact: () => {} }));

import { PullToRefresh } from "../../client/src/components/mobile/PullToRefresh";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia = (q: string) => ({
    matches: q.includes("max-width") ? w < 768 : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  });
}

async function render(width: number) {
  setWidth(width);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <PullToRefresh onRefresh={async () => {}} className="space-y-6">
        <section data-testid="a" />
        <section data-testid="b" />
      </PullToRefresh>,
    );
  });
  return container.querySelector('[data-testid="a"]')!.parentElement!;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("PullToRefresh keeps the caller's layout on the children's parent", () => {
  it("phone (gesture branch)", async () => {
    const parent = await render(390);
    expect(document.querySelector('[data-testid="pull-to-refresh-container"]'), "gesture branch did not render").toBeTruthy();
    expect(parent.className).toContain("space-y-6");
  });

  it("desktop (disabled branch)", async () => {
    const parent = await render(1440);
    expect(parent.className).toContain("space-y-6");
  });
});
