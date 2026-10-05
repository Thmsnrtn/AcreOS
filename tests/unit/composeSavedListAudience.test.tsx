/**
 * The Outreach mail composer can mail a saved county list (W10.3 audit).
 *
 * The server learned to resolve `leadListIds` through marketing_list_members
 * and to say how many members it could not mail and why; until the composer
 * offered a list, that path had no caller in the product. These pin the
 * client half: choosing a saved list puts exactly that list's id in the
 * quote's audience (and a list alone is an audience), and the server's own
 * accounting sentence is shown as-is — never one the page composes.
 *
 * The Radix Select is replaced by a native <select> shim: jsdom cannot drive
 * Radix's pointer events, and what is under test is the page's wiring, not
 * the widget.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../client/src/lib/clientLogger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../client/src/components/ui/select", () => {
  const Ctx = React.createContext<{ value?: string; onValueChange?: (v: string) => void; disabled?: boolean }>({});
  return {
    Select: ({ value, onValueChange, disabled, children }: any) =>
      React.createElement(Ctx.Provider, { value: { value, onValueChange, disabled } }, children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => {
      const ctx = React.useContext(Ctx);
      return React.createElement(
        "select",
        {
          "data-testid": "native-saved-list",
          value: ctx.value,
          disabled: ctx.disabled,
          onChange: (e: any) => ctx.onValueChange?.(e.target.value),
        },
        children,
      );
    },
    SelectItem: ({ value, children }: any) => React.createElement("option", { value }, children),
  };
});

const NET = {
  quotes: [] as any[],
  /** The server's `total` of the org's saved lists (null = omit it). */
  listsTotal: null as number | null,
  lists: [{ id: 7, name: "Coconino 5-40ac", state: "AZ", county: "Coconino", total: 1312, createdAt: "2026-10-05T10:00:00Z" }],
  listMembers: {
    lists: 1,
    members: 1312,
    included: 0,
    excluded: { optedOut: 3, noMailingAddress: 1309, outsideFilters: 0 },
    message: "None of 1,312 list members can be mailed yet: 1,309 have no mailing address (skip-trace them first), 3 opted out.",
  },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  NET.quotes = [];
  NET.listsTotal = null;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("/api/list-builder/lists")) {
      return json(200, NET.listsTotal === null ? { lists: NET.lists } : { lists: NET.lists, total: NET.listsTotal });
    }
    if (url.startsWith("/api/outreach/mail/quote")) {
      const body = JSON.parse(String(init?.body));
      NET.quotes.push(body);
      return json(200, {
        audienceDigest: "d1",
        pieceCount: 0,
        perPieceCents: 0,
        totalCents: 0,
        provider: "lob",
        savedVsLobCents: 0,
        deliveryEtaDays: null,
        alternatives: [],
        recentlyMailedCount: 0,
        recentlyMailedFraction: 0,
        listMembers: NET.listMembers,
      });
    }
    // Everything else the page reads optionally (saved views, templates…).
    return json(200, []);
  }) as typeof fetch;
});

let root: Root | null = null;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

async function settle(ms = 30) {
  for (let i = 0; i < 40; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
}

async function mount() {
  const { default: ComposeTab } = await import("../../client/src/pages/outreach/mail/compose");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(React.createElement(QueryClientProvider, { client }, React.createElement(ComposeTab)));
  });
  await settle(5);
}

const $ = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe("compose — a saved county list as the audience", () => {
  it("offers the org's saved lists, and none is chosen by default (no quote yet)", async () => {
    await mount();
    const select = $("native-saved-list") as HTMLSelectElement;
    expect(select, "vacuity: the saved-list control renders").not.toBeNull();
    expect([...select.options].map((o) => o.value)).toEqual(["none", "7"]);
    expect(select.value).toBe("none");
    expect(NET.quotes).toEqual([]);
  });

  it("choosing a list quotes exactly that list — a list alone is an audience — and shows the server's sentence", async () => {
    await mount();
    const select = $("native-saved-list") as HTMLSelectElement;
    await act(async () => {
      select.value = "7";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle(30);
    expect(NET.quotes.length).toBeGreaterThan(0);
    expect(NET.quotes.at(-1).audienceFilter).toMatchObject({ leadListIds: [7] });
    expect($("audience-list-members")?.textContent).toBe(NET.listMembers.message);
  });

  it("says when the picker shows only the newest of the org's lists (the server bounds it)", async () => {
    // W10.3 second audit, finding 8: the lists read is bounded (newest 50)
    // with a total; a picker that silently shows 50 of 73 hides 23 lists.
    NET.listsTotal = 73;
    await mount();
    expect($("saved-lists-bounded")?.textContent).toBe("Showing your newest 1 of 73 lists.");
  });

  it("says nothing when every list is shown", async () => {
    NET.listsTotal = 1;
    await mount();
    expect($("native-saved-list"), "vacuity").not.toBeNull();
    expect($("saved-lists-bounded")).toBeNull();
  });
});
