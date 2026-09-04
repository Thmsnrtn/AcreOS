// @vitest-environment jsdom
/**
 * One event, one callback, and only for this channel.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * use-realtime's dispatchEvent delivers every event to `listeners.get(type)`
 * AND then unconditionally to `listeners.get("*")`. useWebSocketChannel
 * registered into BOTH sets whenever the channel was "founder:activity": a
 * wildcard listener that filters on `_channel`, plus a second effect with
 * typed listeners for six named event types.
 *
 * So `notification` — the only one of those six that is broadcast anywhere in
 * server/ (notificationDispatcher.ts:343, on founder:activity) — invoked the
 * callback twice, and notification-banner prepended the same row to the tray
 * twice (2026-09-04 review, CONFIRMED).
 *
 * The typed effect was also wrong in a second way that never fired: it
 * fabricated `channel` on the event it built from the hook's own argument, so
 * an event arriving on a DIFFERENT channel would have been reported as this
 * one. The wildcard path filters on `_channel` and does not.
 *
 * And it was a strict subset. founder:activity carries four types the list
 * never mentioned — briefing_ready, event_mesh_activity, workflow_progress,
 * workflow_complete — which the wildcard path has been delivering all along,
 * while five of the six typed names have zero broadcast call sites anywhere.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * Delivery COUNT, not the absence of a code shape. A future author who
 * reintroduces typed listeners in some other spelling fails here, because what
 * is asserted is that the callback ran once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { user: { id: "u1" }, organization: { id: 7 } } }),
}));

import { useWebSocketChannel } from "../../client/src/hooks/use-websocket-channel";
import { __resetRealtimeStoreForTests } from "../../client/src/hooks/use-realtime";

const sockets: FakeSocket[] = [];

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    sockets.push(this);
  }
  send(raw: string) {
    this.sent.push(raw);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  /** Test driver: the server pushes an event. */
  deliver(channel: string, type: string, payload: Record<string, unknown> = {}) {
    this.onmessage?.({
      data: JSON.stringify({ type, channel, payload, timestamp: "2026-09-04T00:00:00.000Z" }),
    });
  }
}

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

function Consumer({ channel, onEvent }: { channel: string; onEvent: (e: unknown) => void }) {
  useWebSocketChannel(channel, onEvent);
  return null;
}

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  containers.push(container);
  roots.push(root);
  act(() => root.render(node));
}

beforeEach(() => {
  sockets.length = 0;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  __resetRealtimeStoreForTests();
});

afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  containers.forEach((c) => c.remove());
  roots = [];
  containers = [];
  __resetRealtimeStoreForTests();
});

describe("founder:activity delivers each event exactly once", () => {
  it("a notification fires the callback once, not twice", () => {
    const seen: unknown[] = [];
    mount(<Consumer channel="founder:activity" onEvent={(e) => seen.push(e)} />);
    act(() => sockets[0].open());
    act(() => sockets[0].deliver("founder:activity", "notification", { id: 9 }));
    expect(
      seen.length,
      "the callback ran more than once — the typed listeners are registered alongside " +
        "the wildcard again, and the notification tray will show the same row twice",
    ).toBe(1);
  });

  it("the four types the typed list never named still arrive", () => {
    // These are what founder:activity actually carries besides notification
    // (runScheduledJobs, eventMeshDrain, agentWorkflowEngine x2). If a future
    // change swaps the wildcard back for a typed list, these stop arriving.
    const seen: string[] = [];
    mount(
      <Consumer
        channel="founder:activity"
        onEvent={(e) => seen.push((e as { type: string }).type)}
      />,
    );
    act(() => sockets[0].open());
    for (const type of [
      "briefing_ready",
      "event_mesh_activity",
      "workflow_progress",
      "workflow_complete",
    ]) {
      act(() => sockets[0].deliver("founder:activity", type));
    }
    expect(seen).toEqual([
      "briefing_ready",
      "event_mesh_activity",
      "workflow_progress",
      "workflow_complete",
    ]);
  });

  it("an event on another channel is not delivered here", () => {
    const seen: unknown[] = [];
    mount(<Consumer channel="founder:activity" onEvent={(e) => seen.push(e)} />);
    act(() => sockets[0].open());
    act(() => sockets[0].deliver("org:7", "notification", { id: 1 }));
    expect(
      seen,
      "an event from another channel was reported as this one — the deleted typed " +
        "effect built its event with the hook's own channel argument and would have",
    ).toEqual([]);
  });
});

describe("an ordinary org channel behaves the same", () => {
  it("delivers once and reports the real channel and type", () => {
    const seen: Array<{ type: string; channel: string }> = [];
    mount(
      <Consumer
        channel="org:7"
        onEvent={(e) => seen.push(e as { type: string; channel: string })}
      />,
    );
    act(() => sockets[0].open());
    act(() => sockets[0].deliver("org:7", "pax.needs_you", { count: 2 }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "pax.needs_you", channel: "org:7" });
  });
});
