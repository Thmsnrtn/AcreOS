// @vitest-environment jsdom
/**
 * An embedded PageShell (a tab rendered inside a host page's shell) neither
 * publishes nor clears the host's rail offsets.
 *
 * PageShell publishes --shell-rail-left/right so App.tsx's banner stack can sit
 * beside the fixed navigation rail. The effect first ran for embedded shells
 * too, so an embedded tab's UNMOUNT removed the host's values and the banner
 * slid back under the rail. Found by independent review, 2026-10-18.
 *
 * Mutation probe: delete `if (embedded) return;` in page-shell.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/components/layout-sidebar", () => ({ Sidebar: () => null, useSidebarCollapsed: () => ({ isCollapsed: false }) }));
vi.mock("@/components/page-topbar", () => ({ PageTopbar: () => null }));
vi.mock("@/contexts/pax-rail-context", () => ({ usePaxRail: () => ({ isOpen: false }) }));
vi.mock("@/components/usage-limit-banner", () => ({ UsageLimitBanner: () => null }));
vi.mock("@/components/legal-hold-banner", () => ({ LegalHoldBanner: () => null }));
vi.mock("@/components/error-boundary", () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => children }));

import { PageShell } from "../../client/src/components/page-shell";

let root: Root | null = null;
let el: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  el?.remove();
  document.documentElement.style.removeProperty("--shell-rail-left");
});

describe("embedded PageShell and the rail offsets", () => {
  it("a host shell publishes; an embedded shell mounting and unmounting leaves them alone", async () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    const Host = ({ tab }: { tab: boolean }) => (
      <PageShell label="Host">{tab ? <PageShell embedded label="Tab"><p>tab</p></PageShell> : <p>none</p>}</PageShell>
    );
    await act(async () => root!.render(<Host tab />));
    expect(document.documentElement.style.getPropertyValue("--shell-rail-left")).toBe("17rem");
    await act(async () => root!.render(<Host tab={false} />));
    expect(
      document.documentElement.style.getPropertyValue("--shell-rail-left"),
      "the embedded shell's unmount cleared the host's offset",
    ).toBe("17rem");
  });
});
