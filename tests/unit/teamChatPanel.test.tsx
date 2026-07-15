// @vitest-environment jsdom
/**
 * TeamChatPanel — the extracted, self-contained team-chat surface.
 *
 * This panel was lifted out of pages/team-inbox.tsx (Cohesion Wave-1 R4) so it
 * can be reused both at /team-inbox AND behind the "Team" tab of the Inbox
 * door. These tests pin the extraction contract:
 *   1. The panel fetches its OWN data (channels/DMs/members/presence) — no
 *      props, no page shell required.
 *   2. It renders channel rows + auto-selects the first channel, wiring the
 *      thread header and composer.
 *   3. It renders NO page chrome (no Sidebar landmark) — proving it's safe to
 *      drop inside an existing content area.
 *
 * Same harness style as statementsPanel.test.tsx / dock.test.tsx: react-dom
 * createRoot + a per-test QueryClient, no @testing-library/react. useAuth and
 * useRealtime are mocked so we don't drag in Clerk or a live WebSocket.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-me" }, isLoading: false, isAuthenticated: true }),
}));

// No-op realtime: register handlers, return an unsubscribe. Never opens a WS.
vi.mock("@/hooks/use-realtime", () => ({
  useRealtime: () => ({ on: () => () => {}, connected: false, subscribe: () => {}, send: () => {} }),
}));

import { TeamChatPanel } from "../../client/src/components/team-chat-panel";

function wrap(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return React.createElement(QueryClientProvider, { client }, node);
}

// Route the panel's fetches by URL. Covers fetchJsonArray + raw fetch calls.
function installFetchMock() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const json = (body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    if (init?.method === "POST") return json({ ok: true });
    if (url.startsWith("/api/team-messaging/channels")) {
      return json([
        { id: 1, name: "general", isDirect: false, participantIds: ["user-me"], lastMessageAt: null, status: "active" },
        { id: 2, name: "random", isDirect: false, participantIds: [], lastMessageAt: null, status: "active" },
      ]);
    }
    if (url.startsWith("/api/team-messaging/conversations") && url.includes("/messages")) {
      return json({ messages: [], hasMore: false });
    }
    if (url.startsWith("/api/team-messaging/conversations")) return json([]);
    if (url.startsWith("/api/team-messaging/presence")) return json([]);
    if (url.startsWith("/api/team")) return json([]);
    return json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  // jsdom implements neither of these; the panel auto-scrolls to the newest
  // message and Radix ScrollArea observes size. Stub both so mount doesn't throw.
  Element.prototype.scrollIntoView = vi.fn();
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe("TeamChatPanel — self-contained extraction", () => {
  it("fetches its own channels and renders them", async () => {
    installFetchMock();

    await act(async () => {
      root!.render(wrap(React.createElement(TeamChatPanel)));
    });
    await flush();

    expect(container!.textContent).toContain("Channels");
    expect(container!.textContent).toContain("Direct messages");
    // Channel rows are keyed by aria-label "Channel: <name>".
    const general = container!.querySelector('[aria-label="Channel: general"]');
    const random = container!.querySelector('[aria-label="Channel: random"]');
    expect(general).not.toBeNull();
    expect(random).not.toBeNull();
  });

  it("auto-selects the first channel, wiring the thread header + composer", async () => {
    installFetchMock();

    await act(async () => {
      root!.render(wrap(React.createElement(TeamChatPanel)));
    });
    await flush();

    // Thread header shows the active channel name.
    const header = container!.querySelector("h2");
    expect(header?.textContent).toBe("general");
    // Composer send button is present and labelled for the active channel.
    const send = container!.querySelector('[aria-label="Send message to general"]');
    expect(send).not.toBeNull();
  });

  it("renders no page chrome (no Sidebar navigation landmark)", async () => {
    installFetchMock();

    await act(async () => {
      root!.render(wrap(React.createElement(TeamChatPanel)));
    });
    await flush();

    // The panel is pure content: an <aside> (channels) + <main> (thread), with
    // no <nav> landmark — the page Sidebar lives in the host page, not here.
    expect(container!.querySelector("nav")).toBeNull();
    expect(container!.querySelector("aside")).not.toBeNull();
    expect(container!.querySelector("main")).not.toBeNull();
  });
});
