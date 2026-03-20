import { useEffect, useRef, useCallback, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

/**
 * useWebSocketChannel — Phase C
 *
 * Subscribes to a WebSocket channel and invokes a callback when matching events arrive.
 * Handles auto-reconnection, authentication, and channel subscription lifecycle.
 *
 * Usage:
 *   const { lastEvent, isConnected } = useWebSocketChannel("founder:activity", (event) => {
 *     console.log("Got event:", event);
 *   });
 */

interface WSEvent {
  type: string;
  channel: string;
  payload: Record<string, any>;
  timestamp: string;
}

interface UseWebSocketChannelResult {
  lastEvent: WSEvent | null;
  isConnected: boolean;
  sendMessage: (msg: Record<string, any>) => void;
}

// Shared singleton connection
let sharedWs: WebSocket | null = null;
let sharedListeners: Map<string, Set<(event: WSEvent) => void>> = new Map();
let connectionState: "disconnected" | "connecting" | "connected" = "disconnected";
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

function getWsUrl(userId: number, orgId: number): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws?userId=${userId}&orgId=${orgId}`;
}

function ensureConnection(userId: number, orgId: number) {
  if (sharedWs && (sharedWs.readyState === WebSocket.OPEN || sharedWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (connectionState === "connecting") return;
  connectionState = "connecting";

  const ws = new WebSocket(getWsUrl(userId, orgId));

  ws.onopen = () => {
    connectionState = "connected";
    reconnectAttempts = 0;
    sharedWs = ws;

    // Re-subscribe to all channels
    for (const channel of sharedListeners.keys()) {
      ws.send(JSON.stringify({ type: "subscribe", channel }));
    }
  };

  ws.onmessage = (msg) => {
    try {
      const event: WSEvent = JSON.parse(msg.data);
      // Dispatch to channel-specific listeners
      const listeners = sharedListeners.get(event.channel);
      if (listeners) {
        for (const fn of listeners) {
          try { fn(event); } catch { /* listener error */ }
        }
      }
      // Also dispatch to wildcard listeners
      const wildcardListeners = sharedListeners.get("*");
      if (wildcardListeners) {
        for (const fn of wildcardListeners) {
          try { fn(event); } catch { /* listener error */ }
        }
      }
    } catch { /* ignore non-JSON */ }
  };

  ws.onclose = () => {
    connectionState = "disconnected";
    sharedWs = null;
    // Auto-reconnect with exponential backoff
    if (sharedListeners.size > 0) {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30_000);
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => {
        ensureConnection(userId, orgId);
      }, delay);
    }
  };

  ws.onerror = () => {
    // onclose will handle reconnection
  };

  sharedWs = ws;
}

export function useWebSocketChannel(
  channel: string,
  onEvent?: (event: WSEvent) => void,
): UseWebSocketChannelResult {
  const { user } = useAuth();
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!user) return;

    const userId = (user as any).id;
    const orgId = (user as any).organizationId ?? (user as any).orgId ?? 0;
    if (!userId) return;

    // Ensure connection
    ensureConnection(userId, orgId);

    // Register listener for this channel
    const handler = (event: WSEvent) => {
      setLastEvent(event);
      callbackRef.current?.(event);
    };

    if (!sharedListeners.has(channel)) {
      sharedListeners.set(channel, new Set());
    }
    sharedListeners.get(channel)!.add(handler);

    // Subscribe to channel if connected
    if (sharedWs?.readyState === WebSocket.OPEN) {
      sharedWs.send(JSON.stringify({ type: "subscribe", channel }));
    }

    // Poll connection state
    const stateInterval = setInterval(() => {
      setIsConnected(sharedWs?.readyState === WebSocket.OPEN);
    }, 2000);

    return () => {
      sharedListeners.get(channel)?.delete(handler);
      if (sharedListeners.get(channel)?.size === 0) {
        sharedListeners.delete(channel);
        // Unsubscribe from channel
        if (sharedWs?.readyState === WebSocket.OPEN) {
          sharedWs.send(JSON.stringify({ type: "unsubscribe", channel }));
        }
      }
      clearInterval(stateInterval);

      // If no more listeners, close connection
      if (sharedListeners.size === 0 && sharedWs) {
        sharedWs.close();
        sharedWs = null;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      }
    };
  }, [channel, user]);

  const sendMessage = useCallback((msg: Record<string, any>) => {
    if (sharedWs?.readyState === WebSocket.OPEN) {
      sharedWs.send(JSON.stringify(msg));
    }
  }, []);

  return { lastEvent, isConnected, sendMessage };
}
