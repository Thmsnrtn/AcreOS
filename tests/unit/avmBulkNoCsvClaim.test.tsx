// @vitest-environment jsdom
/**
 * Bulk AVM — no CSV-upload claim, no fake progress (P1-C item 3).
 *
 * POST /api/avm/bulk never read an uploaded file: it values the org's own
 * properties. The page offered a CSV upload with a column guide and animated
 * a setInterval progress bar, and the command-palette entry promised "Bulk AI
 * valuations via CSV upload". This renders the REAL page and the REAL nav
 * entry and asserts neither offers a file, and that what the page shows after
 * a run is the server's own counts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import AvmBulk from "../../client/src/pages/avm-bulk";
import { ALL_NAV_ITEMS } from "../../client/src/lib/nav-items";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

describe("Bulk AVM page", () => {
  it("offers no file upload, no CSV column guide, and no progress bar", async () => {
    const client = new QueryClient();
    await act(async () => {
      root.render(<QueryClientProvider client={client}><AvmBulk /></QueryClientProvider>);
    });
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/csv/i);
    expect(container.querySelector('[data-testid="button-run-bulk-valuation"]')).not.toBeNull();
  });

  it("after a run, shows the server's own counts (refused is not valued)", async () => {
    const body = {
      success: true, total: 3, valuated: 1, refused: 1, skipped: 1, failed: 0,
      message: "Valued 1 of 3 properties you own.",
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient();
    await act(async () => {
      root.render(<QueryClientProvider client={client}><AvmBulk /></QueryClientProvider>);
    });
    const btn = container.querySelector('[data-testid="button-run-bulk-valuation"]') as HTMLButtonElement;
    await act(async () => { btn.click(); });
    await flush();
    const summary = container.querySelector('[data-testid="bulk-valuation-summary"]');
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toContain("Valued 1 of 3 properties you own.");
    // The request carries no file.
    const init = (fetchMock.mock.calls[0] as any[])[1] as RequestInit | undefined;
    expect(init?.body instanceof FormData).toBe(false);
  });
});

describe("Bulk AVM nav entry", () => {
  it("does not promise CSV upload", () => {
    const entry = ALL_NAV_ITEMS.find((i) => i.href === "/avm-bulk");
    expect(entry).toBeDefined();
    expect(`${entry!.label} ${entry!.description ?? ""}`).not.toMatch(/csv|upload/i);
  });
});
