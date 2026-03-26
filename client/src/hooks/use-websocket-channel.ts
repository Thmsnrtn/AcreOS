import { useEffect, useRef, useState, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";

/**
 * useWebSocketChannel — Phase C (Consolidated)
 *
 * Thin wrapper around the existing useRealtime() hook that:
 * 1. Subscribes to a specific channel
 * 2. Filters events for that channel
 * 3. Invokes a callback for matching events
 *
 * Uses the SAME WebSocket connection as useRealtime() — no duplicate connections.
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

export function useWebSocketChannel(
  channel: string,
  onEvent?: (event: WSEvent) => void,
): UseWebSocketChannelResult {
  const { connected, subscribe, on, send } = useRealtime();
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  // Subscribe to the specific channel
  useEffect(() => {
    if (connected && channel) {
      subscribe(channel);
    }
  }, [connected, channel, subscribe]);

  // Listen for ALL events and filter by channel
  useEffect(() => {
    const cleanup = on("*", (payload: any) => {
      const eventChannel = payload._channel;
      const eventType = payload._type;

      // Match on exact channel or wildcard
      if (channel === "*" || eventChannel === channel) {
        const event: WSEvent = {
          type: eventType ?? "unknown",
          channel: eventChannel ?? channel,
          payload,
          timestamp: payload._timestamp ?? new Date().toISOString(),
        };
        setLastEvent(event);
        callbackRef.current?.(event);
      }
    });

    return cleanup;
  }, [channel, on]);

  // Also listen for specific event types that match common patterns
  useEffect(() => {
    // Listen for notification events on founder:activity channel
    if (channel === "founder:activity") {
      const cleanups = [
        on("notification", (payload) => {
          const event: WSEvent = { type: "notification", channel, payload, timestamp: new Date().toISOString() };
          setLastEvent(event);
          callbackRef.current?.(event);
        }),
        on("agent_alert", (payload) => {
          const event: WSEvent = { type: "agent_alert", channel, payload, timestamp: new Date().toISOString() };
          setLastEvent(event);
          callbackRef.current?.(event);
        }),
        on("agent_proposal", (payload) => {
          const event: WSEvent = { type: "agent_proposal", channel, payload, timestamp: new Date().toISOString() };
          setLastEvent(event);
          callbackRef.current?.(event);
        }),
        on("trust_promotion", (payload) => {
          const event: WSEvent = { type: "trust_promotion", channel, payload, timestamp: new Date().toISOString() };
          setLastEvent(event);
          callbackRef.current?.(event);
        }),
        on("action_executed", (payload) => {
          const event: WSEvent = { type: "action_executed", channel, payload, timestamp: new Date().toISOString() };
          setLastEvent(event);
          callbackRef.current?.(event);
        }),
        on("self_healing_executed", (payload) => {
          const event: WSEvent = { type: "self_healing_executed", channel, payload, timestamp: new Date().toISOString() };
          setLastEvent(event);
          callbackRef.current?.(event);
        }),
      ];

      return () => { cleanups.forEach((fn) => fn()); };
    }
  }, [channel, on]);

  const sendMessage = useCallback((msg: Record<string, any>) => {
    send(msg.type ?? "message", msg);
  }, [send]);

  return { lastEvent, isConnected: connected, sendMessage };
}
