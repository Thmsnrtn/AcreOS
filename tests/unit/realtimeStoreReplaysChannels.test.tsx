// @vitest-environment jsdom
/**
 * Every consumer of the shared socket must see the connection, and every
 * channel anyone wants must survive a reconnect.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `connect()` returned early when the socket was already OPEN, but `connected`
 * was per-hook-instance state set only inside THAT instance's `ws.onopen`.
 * Three live consequences (2026-09-04 review, CONFIRMED):
 *
 *   1. LATER MOUNT. Any consumer mounting after the socket opened — every
 *      React.lazy one does — kept `connected === false` forever.
 *      use-websocket-channel gates `subscribe(channel)` on `connected`, and
 *      the server delivers only to clients where
 *      `subscribedChannels.has(channel)` (server/websocket.ts:352). So that
 *      consumer's channel was never subscribed and it silently fell back to
 *      its five-minute poll. A notification could take five minutes.
 *
 *   2. SAME-TICK MOUNT. The guard tested OPEN and not CONNECTING, so N
 *      consumers mounting in one commit each built a socket and overwrote the
 *      global; N-1 were orphaned and never closed, because the unmount
 *      cleanup is deliberately a no-op — contradicting use-websocket-channel's
 *      own "no duplicate connections" comment.
 *
 *   3. RECONNECT. Nothing replayed subscriptions. `onclose` cleared
 *      `connected` on the owning instance only; if that instance had since
 *      unmounted, its onclose still reconnected but no mounted instance ever
 *      observed the transition, so NO channel was re-subscribed until a full
 *      page reload.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * The BEHAVIOUR through the public hook, driven by a fake WebSocket, not the
 * shape of the module. Each test names the consequence it reproduces, so a
 * rewrite that keeps the property passes and one that reintroduces the defect
 * fails regardless of how the store is spelled.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// The hook reads auth through react-query. Mocking useQuery keeps this test
// about the socket rather than about a query client.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { user: { id: "u1" }, organization: { id: 7 } } }),
}));

import {
  useRealtime,
  __resetRealtimeStoreForTests,
  __desiredChannelsForTests,
} from "../../client/src/hooks/use-realtime";

/** Every socket the code under test constructed, in order. */
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
  /** Test driver: complete the handshake. */
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  /** The channels this socket was asked to subscribe to. */
  subscribed(): string[] {
    return this.sent
      .map((raw) => JSON.parse(raw) as { type: string; channel?: string })
      .filter((m) => m.type === "subscribe")
      .map((m) => m.channel!)
      .filter(Boolean);
  }
}

/**
 * A consumer that subscribes ONCE on mount, whatever the connection state.
 * This is the shape that isolates the replay: it never re-subscribes, so the
 * only thing that can restore its channel after a reconnect is the store
 * re-asserting the desired set on open.
 *
 * It is also a capability the old hook did not have — `subscribe()` before the
 * socket opened silently did nothing, because it only wrote to an OPEN socket
 * and nothing remembered the intent.
 */
function OneShotConsumer({ channel }: { channel: string }) {
  const { subscribe } = useRealtime();
  React.useEffect(() => {
    subscribe(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span data-testid={`one-${channel}`} />;
}

/** A consumer: mounts the hook, subscribes when it sees a connection. */
function Consumer({ channel, onState }: { channel: string; onState?: (c: boolean) => void }) {
  const { connected, subscribe } = useRealtime();
  React.useEffect(() => {
    onState?.(connected);
    if (connected) subscribe(channel);
  }, [connected, channel, subscribe, onState]);
  return <span data-testid={`c-${channel}`}>{connected ? "up" : "down"}</span>;
}

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

function mount(node: React.ReactNode): Root {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  containers.push(container);
  roots.push(root);
  act(() => root.render(node));
  return root;
}

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
});

describe("the fake socket is actually driving the code under test", () => {
  it("mounting one consumer builds exactly one socket, to the org+user URL", () => {
    mount(<Consumer channel="org:7" />);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain("orgId=7");
    expect(sockets[0].url).toContain("userId=u1");
    // Vacuity: nothing is subscribed before the handshake completes.
    expect(sockets[0].subscribed()).toEqual([]);
  });
});

describe("(1) a consumer that mounts AFTER the socket is open still subscribes", () => {
  it("the late consumer sees connected and its channel reaches the server", () => {
    mount(<Consumer channel="org:7" />);
    act(() => sockets[0].open());
    expect(sockets[0].subscribed()).toContain("org:7");

    // Now a React.lazy consumer arrives — the socket is already OPEN, which is
    // exactly the case that used to leave `connected` false forever.
    const states: boolean[] = [];
    mount(<Consumer channel="user:u1" onState={(c) => states.push(c)} />);
    expect(states.at(-1), "a later-mounting consumer never observed the connection").toBe(true);
    expect(
      sockets[0].subscribed(),
      "the later consumer's channel was never subscribed — the server delivers only to " +
        "clients where subscribedChannels.has(channel), so this consumer is dead until reload",
    ).toContain("user:u1");
  });
});

describe("(2) consumers mounting in the same commit share one socket", () => {
  it("two consumers in one render build one socket, not two", () => {
    mount(
      <>
        <Consumer channel="org:7" />
        <Consumer channel="user:u1" />
      </>,
    );
    expect(
      sockets,
      "the guard must bail on CONNECTING as well as OPEN — otherwise each consumer " +
        "builds its own socket and all but the last are orphaned, never closed",
    ).toHaveLength(1);
    act(() => sockets[0].open());
    expect(sockets[0].subscribed().sort()).toEqual(["org:7", "user:u1"]);
  });
});

describe("(3) a reconnect replays every desired channel", () => {
  it("channels come back on the new socket even though no consumer re-ran", () => {
    mount(<Consumer channel="org:7" />);
    mount(<Consumer channel="user:u1" />);
    act(() => sockets[0].open());
    expect(sockets[0].subscribed().sort()).toEqual(["org:7", "user:u1"]);

    // The server goes away and comes back.
    act(() => sockets[0].close());
    expect(sockets).toHaveLength(1); // reconnect is on a timer, not immediate
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(sockets.length, "no reconnect was scheduled").toBeGreaterThan(1);
    const fresh = sockets[sockets.length - 1];
    act(() => fresh.open());
    expect(
      fresh.subscribed().sort(),
      "the new socket was never told what to subscribe to — this is the replay that " +
        "did not exist, and without it every channel stays dead until a page reload",
    ).toEqual(["org:7", "user:u1"]);
  });

  it("replays even when the consumer that opened the original socket has unmounted", () => {
    const owner = mount(<Consumer channel="org:7" />);
    mount(<Consumer channel="user:u1" />);
    act(() => sockets[0].open());
    // The instance that happened to own the socket goes away. Under the old
    // code its onclose still reconnected, but nothing mounted ever observed
    // the transition, so nothing re-subscribed.
    act(() => owner.unmount());
    roots = roots.filter((r) => r !== owner);
    act(() => sockets[0].close());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const fresh = sockets[sockets.length - 1];
    act(() => fresh.open());
    expect(fresh.subscribed()).toContain("user:u1");
    // org:7 is gone because its only consumer unmounted — a released channel,
    // not a lost one. The distinction is the point of the refcount.
    expect(__desiredChannelsForTests()).toEqual(["user:u1"]);
  });
});

describe("the replay is what restores a channel nobody re-subscribes", () => {
  it("a consumer that subscribed once, before the socket opened, is subscribed on open", () => {
    mount(<OneShotConsumer channel="org:7" />);
    // It asked while the socket was still CONNECTING. The old hook dropped
    // that on the floor: subscribe() wrote to an OPEN socket or did nothing.
    expect(sockets[0].subscribed()).toEqual([]);
    act(() => sockets[0].open());
    expect(sockets[0].subscribed()).toEqual(["org:7"]);
  });

  it("and again after a reconnect, with no consumer effect re-running", () => {
    mount(<OneShotConsumer channel="org:7" />);
    act(() => sockets[0].open());
    act(() => sockets[0].close());
    act(() => { vi.advanceTimersByTime(60_000); });
    const fresh = sockets[sockets.length - 1];
    act(() => fresh.open());
    expect(
      fresh.subscribed(),
      "nothing re-asserted this channel on the new socket. A consumer whose subscribe " +
        "is not gated on the connection never runs again, so the replay is the only " +
        "thing standing between it and a channel that is dead until a page reload",
    ).toEqual(["org:7"]);
  });

});

/*
 * NOT TESTED HERE, deliberately: that the replay runs BEFORE `setConnected`.
 * An assertion for it was written and then deleted because it could not fail —
 * moving `replayDesiredChannels()` after `setConnected(true)` left all nine
 * tests green. React batches the state update inside act(), so a consumer
 * effect always observes the post-replay socket either way, and no React
 * consumer can see the intermediate state at all. The ordering in the source
 * is still correct — it puts the subscribe on the wire before anything can
 * race it — but it is not a property this harness can falsify, and an
 * assertion that cannot fail is worse than no assertion.
 */

describe("a channel is released only when its LAST consumer goes", () => {
  it("two consumers of one channel: unmounting one keeps the subscription", () => {
    const a = mount(<Consumer channel="org:7" />);
    mount(<Consumer channel="org:7" />);
    act(() => sockets[0].open());
    act(() => a.unmount());
    roots = roots.filter((r) => r !== a);
    expect(__desiredChannelsForTests()).toEqual(["org:7"]);
    act(() => sockets[0].close());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const fresh = sockets[sockets.length - 1];
    act(() => fresh.open());
    expect(fresh.subscribed()).toContain("org:7");
  });
});
