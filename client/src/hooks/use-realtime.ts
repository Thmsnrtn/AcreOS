/**
 * useRealtime — AcreOS Phase 3
 *
 * Manages the WebSocket connection to AcreOS's real-time server.
 * Provides:
 * - Connection state management with auto-reconnect
 * - Channel subscription/unsubscription
 * - Event listener registration
 * - Notification badge counts
 *
 * Usage:
 *   const { connected, subscribe, on, unreadCount } = useRealtime();
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

let globalWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;
const listeners = new Map<string, Set<EventHandler>>();

function getWsUrl(user: { id: number }, org: { id: number }): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws?orgId=${org.id}&userId=${user.id}`;
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

export function useRealtime() {
  const [connected, setConnected] = useState(false);
  const userRef = useRef<any>(null);
  const orgRef = useRef<any>(null);

  // Get auth state via polling (avoids import cycle)
  const { data: authData } = useQuery<{ user: any; organization: any }>({
    queryKey: ['/api/user'],
    staleTime: 60_000,
  });

  useEffect(() => {
    if (authData?.user) userRef.current = authData.user;
    if (authData?.organization) orgRef.current = authData.organization;
  }, [authData]);

  const connect = useCallback(() => {
    if (!userRef.current || !orgRef.current) return;
    if (globalWs && globalWs.readyState === WebSocket.OPEN) return;

    const url = getWsUrl(userRef.current, orgRef.current);
    const ws = new WebSocket(url);
    globalWs = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay = 1000; // Reset backoff on successful connect
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: RealtimeEvent = JSON.parse(event.data);
        dispatchEvent(data);
      } catch (_) {}
    };

    ws.onclose = () => {
      setConnected(false);
      globalWs = null;

      // Exponential backoff reconnect
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        connect();
      }, reconnectDelay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (authData?.user && authData?.organization) {
      connect();
    }

    return () => {
      // Don't close on unmount — global connection persists across renders
    };
  }, [authData, connect]);

  /**
   * Subscribe to a channel.
   */
  const subscribe = useCallback((channel: string) => {
    if (globalWs?.readyState === WebSocket.OPEN) {
      globalWs.send(JSON.stringify({ type: 'subscribe', channel }));
    }
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
 * Lightweight hook for notification badge count only.
 * Polls the REST endpoint as a fallback when WebSocket is disconnected.
 */
export function useNotificationCount() {
  const [count, setCount] = useState(0);
  const { on } = useRealtime();

  // Poll unread count every 60 seconds
  useQuery({
    queryKey: ['/api/realtime/alerts/count'],
    refetchInterval: 60_000,
    onSuccess: (data: any) => {
      if (typeof data?.count === 'number') {
        setCount(data.count);
      }
    },
  } as any);

  // Update count in real-time when new notification arrives
  useEffect(() => {
    return on('notification', () => {
      setCount(prev => prev + 1);
    });
  }, [on]);

  const reset = useCallback(() => setCount(0), []);

  return { count, reset };
}
