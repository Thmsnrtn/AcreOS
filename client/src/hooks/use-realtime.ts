/**
 * useRealtime — the one browser WebSocket, and the registry of what it is
 * subscribed to.
 *
 * ── WHY THIS IS A STORE AND NOT HOOK STATE ──────────────────────────────────
 * It used to be hook state, and three things followed from that. All three
 * were live (2026-09-04 review):
 *
 *  1. `connect()` returned early when the socket was already OPEN, but
 *     `connected` was per-hook-instance state set only inside THAT instance's
 *     `ws.onopen`. So any consumer mounting after the socket opened — every
 *     React.lazy one does — kept `connected === false` forever, and
 *     use-websocket-channel gates its `subscribe(channel)` on `connected`.
 *     Its channel was therefore never subscribed, the server delivers only to
 *     clients where `subscribedChannels.has(channel)` (server/websocket.ts),
 *     and the consumer silently degraded to its poll fallback. A notification
 *     could take five minutes to appear.
 *
 *  2. The early return tested OPEN and not CONNECTING, so N consumers mounting
 *     in one commit each constructed their own WebSocket and overwrote the
 *     global. N-1 sockets were orphaned and never closed, because the unmount
 *     cleanup is deliberately a no-op — directly contradicting
 *     use-websocket-channel's own "no duplicate connections" comment.
 *
 *  3. Nothing replayed subscriptions after a reconnect. `ws.onclose` cleared
 *     `connected` on the owning instance only; every other instance still
 *     believed it was connected and never re-ran its subscribe effect. If the
 *     owning instance had since unmounted, its onclose still reconnected but
 *     no mounted instance ever observed the transition, so NO channel was
 *     re-subscribed until a full page reload.
 *
 * So the socket, the connection state and the set of desired channels are
 * module-level. Hooks are readers: they register a listener and see every
 * transition, and every channel anyone wants is replayed on every open. This
 * is the shape Linear and Slack use — a singleton store with an explicit
 * subscription registry, and hooks that never own connection state.
 *
 * Usage:
 *   const { connected, subscribe, on } = useRealtime();
 *   on('notification', (payload) => showToast(payload.alert.message));
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

interface RealtimeEvent {
  type: string;
  channel: string;
  payload: Record<string, any>;
  timestamp: string;
}

type EventHandler = (payload: Record<string, any>) => void;
type ConnectionListener = (connected: boolean) => void;

let globalWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;

const listeners = new Map<string, Set<EventHandler>>();

/** Every mounted hook instance, so all of them see the same transitions. */
const connectionListeners = new Set<ConnectionListener>();

/**
 * The channels someone currently wants, refcounted by consumer.
 *
 * This is the piece that was missing entirely. It is the authority replayed
 * to the server on every open — not just on the first one — so a reconnect
 * restores every subscription rather than only whichever instance happened to
 * own the socket.
 */
const desiredChannels = new Map<string, number>();

/** Shared connection state. The hooks mirror it; they never define it. */
let isConnected = false;

/** Auth for the socket URL, at module scope so a reconnect does not need a
 *  mounted component to still be holding it. */
let socketAuth: { userId: string; orgId: number } | null = null;

function getWsUrl(auth: { userId: string; orgId: number }): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws?orgId=${auth.orgId}&userId=${auth.userId}`;
}

function setConnected(next: boolean): void {
  if (isConnected === next) return;
  isConnected = next;
  for (const listener of connectionListeners) {
    try { listener(next); } catch (_) {}
  }
}

/**
 * Channels already asserted on the CURRENT socket. Cleared for every new one,
 * so a reconnect re-sends everything and a steady connection sends each
 * channel once — the replay on open and the consumers' own subscribe effects
 * both run, and without this every channel would be sent twice on every open.
 */
let sentOnCurrentSocket = new Set<string>();

function sendSubscribe(channel: string): void {
  if (globalWs?.readyState !== WebSocket.OPEN) return;
  if (sentOnCurrentSocket.has(channel)) return;
  sentOnCurrentSocket.add(channel);
  globalWs.send(JSON.stringify({ type: 'subscribe', channel }));
}

/** Re-assert every desired channel. Runs on EVERY open, including reconnects. */
function replayDesiredChannels(): void {
  for (const channel of desiredChannels.keys()) sendSubscribe(channel);
}

function dispatchEvent(event: RealtimeEvent): void {
  // Dispatch to type-specific handlers
  const typeHandlers = listeners.get(event.type);
  if (typeHandlers) {
    for (const handler of typeHandlers) {
      try { handler(event.payload); } catch (_) {}
    }
  }

  // Dispatch to wildcard handlers
  const wildcardHandlers = listeners.get('*');
  if (wildcardHandlers) {
    for (const handler of wildcardHandlers) {
      try { handler({ ...event.payload, _type: event.type, _channel: event.channel }); } catch (_) {}
    }
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  // Jitter: without it every tab that lost the same server reconnects on the
  // same millisecond and the herd knocks it over again.
  const jittered = reconnectDelay * (0.5 + Math.random());
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connect();
  }, jittered);
}

function connect(): void {
  if (!socketAuth) return;
  if (typeof window === 'undefined') return;
  // CONNECTING as well as OPEN: testing OPEN alone is what let a same-tick
  // double mount build two sockets and orphan one of them.
  if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  // A reconnect is already scheduled. Without this, any render that re-runs
  // the connect effect reconnects instantly and the backoff never applies —
  // which is the same herd the jitter above exists to prevent. The `online`
  // and `visibilitychange` handlers clear the timer first, deliberately, so
  // those two DO come back immediately.
  if (reconnectTimer) return;
  // Offline is not a reason to burn reconnect attempts; the `online` listener
  // below brings us straight back.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const ws = new WebSocket(getWsUrl(socketAuth));
  globalWs = ws;
  sentOnCurrentSocket = new Set();

  ws.onopen = () => {
    reconnectDelay = 1000; // Reset backoff on successful connect
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // Replay before announcing, so the subscribe is on the wire as early as
    // possible and a listener reacting to `connected` is re-asserting rather
    // than repairing. No React consumer can observe the difference (state
    // updates batch), so the test suite does not assert this ordering — see
    // the note in realtimeStoreReplaysChannels.test.tsx.
    replayDesiredChannels();
    setConnected(true);
  };

  ws.onmessage = (event) => {
    try {
      const data: RealtimeEvent = JSON.parse(event.data);
      dispatchEvent(data);
    } catch (_) {}
  };

  ws.onclose = () => {
    // Only the CURRENT socket may clear the shared state — a late close from
    // a superseded socket must not knock the live one offline.
    if (globalWs !== null && globalWs !== ws) return;
    globalWs = null;
    setConnected(false);
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws.close();
  };
}

// Come back immediately when the network or the tab does, rather than waiting
// out a backoff that grew while nothing could have succeeded anyway.
if (typeof window !== 'undefined') {
  const reconnectNow = () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectDelay = 1000;
    connect();
  };
  window.addEventListener('online', reconnectNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectNow();
  });
}

export function useRealtime() {
  const [connected, setConnectedState] = useState(isConnected);
  // Channels this instance asked for, so its refcounts are released on unmount.
  const ownedChannels = useRef<Set<string>>(new Set());

  // Get auth state via polling (avoids import cycle). STR-007: the
  // canonical endpoint is /api/auth/user — /api/user is a 404.
  const { data: authData } = useQuery<{ user: any; organization: any }>({
    queryKey: ['/api/auth/user'],
    staleTime: 60_000,
  });

  // Mirror the shared connection state. EVERY instance registers, which is
  // what makes a later-mounting consumer see `connected` at all.
  useEffect(() => {
    const listener: ConnectionListener = (next) => setConnectedState(next);
    connectionListeners.add(listener);
    setConnectedState(isConnected);
    return () => { connectionListeners.delete(listener); };
  }, []);

  // Keyed on the IDENTIFIERS, not on the query result's object identity: a
  // hook that re-ran whenever react-query handed back a new wrapper would call
  // connect() on every render, and connect() is the thing that owns the
  // backoff.
  const userId: string | undefined = authData?.user?.id;
  const orgId: number | undefined = authData?.organization?.id;
  useEffect(() => {
    if (userId === undefined || orgId === undefined) return;
    socketAuth = { userId, orgId };
    connect();
    return () => {
      // Don't close on unmount — the connection is shared and outlives any
      // one component. Channel refcounts ARE released, below.
    };
  }, [userId, orgId]);

  /**
   * Subscribe to a channel, and keep wanting it until this instance unmounts.
   */
  const subscribe = useCallback((channel: string) => {
    if (!channel) return;
    if (!ownedChannels.current.has(channel)) {
      ownedChannels.current.add(channel);
      desiredChannels.set(channel, (desiredChannels.get(channel) ?? 0) + 1);
    }
    sendSubscribe(channel);
  }, []);

  // Release this instance's channels on unmount. The socket keeps them until
  // the last consumer goes, and only then stops asking for them.
  useEffect(() => {
    const owned = ownedChannels.current;
    return () => {
      for (const channel of owned) {
        const next = (desiredChannels.get(channel) ?? 1) - 1;
        if (next > 0) {
          desiredChannels.set(channel, next);
        } else {
          desiredChannels.delete(channel);
          sentOnCurrentSocket.delete(channel);
          if (globalWs?.readyState === WebSocket.OPEN) {
            globalWs.send(JSON.stringify({ type: 'unsubscribe', channel }));
          }
        }
      }
      owned.clear();
    };
  }, []);

  /**
   * Register an event handler.
   * Returns a cleanup function.
   */
  const on = useCallback((eventType: string, handler: EventHandler): (() => void) => {
    if (!listeners.has(eventType)) {
      listeners.set(eventType, new Set());
    }
    listeners.get(eventType)!.add(handler);

    return () => {
      listeners.get(eventType)?.delete(handler);
    };
  }, []);

  /**
   * Send a message through the WebSocket.
   */
  const send = useCallback((type: string, payload: Record<string, any> = {}) => {
    if (globalWs?.readyState === WebSocket.OPEN) {
      globalWs.send(JSON.stringify({ type, ...payload }));
    }
  }, []);

  return { connected, subscribe, on, send };
}

/**
 * TEST SEAM. The store above is module state by design; a test that asserts
 * replay-on-reconnect has to be able to start from a known one.
 */
export function __resetRealtimeStoreForTests(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  try { globalWs?.close(); } catch (_) {}
  globalWs = null;
  reconnectDelay = 1000;
  isConnected = false;
  socketAuth = null;
  listeners.clear();
  connectionListeners.clear();
  desiredChannels.clear();
  sentOnCurrentSocket = new Set();
}

/** TEST SEAM — the channels currently being asked for. */
export function __desiredChannelsForTests(): string[] {
  return [...desiredChannels.keys()];
}

/*
 * `useNotificationCount` lived here and was deleted 2026-09-04. It passed
 * `{ queryKey, refetchInterval, onSuccess } as any` to useQuery; `onSuccess`
 * was removed from useQuery in TanStack Query v5 and this repo pins 5.101.2,
 * so the callback could never fire and the count could only ever have counted
 * events arriving over the socket while mounted. The `as any` is precisely
 * what let a v4 API survive the v5 migration — and the client had no as-any
 * ratchet to catch it, because both erasure ratchets scan server/**\/*.ts only.
 * It had zero call sites, so nothing rendered the badge it could not fill.
 * Deleted rather than repaired: a hook nobody calls is not a feature to fix.
 */
