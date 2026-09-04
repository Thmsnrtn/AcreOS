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

  /*
   * DELETED 2026-09-04: a second effect that registered TYPED listeners
   * ("notification", "agent_alert", "agent_proposal", "trust_promotion",
   * "action_executed", "self_healing_executed") whenever channel ===
   * "founder:activity".
   *
   * use-realtime's dispatchEvent delivers every event to `listeners.get(type)`
   * AND then unconditionally to `listeners.get("*")`, and this hook registers
   * into both sets. So a `notification` — the one of those six that is
   * actually broadcast anywhere in server/ (notificationDispatcher.ts:343, on
   * founder:activity) — invoked the callback TWICE, and notification-banner
   * prepended the same row to the tray twice.
   *
   * The typed effect also could not have been right even if it had not
   * duplicated: it fabricated `channel` on the event it built, so an event
   * arriving on a different channel would have been reported as this one. The
   * wildcard path above filters on `_channel` and does not.
   *
   * The five other names have ZERO broadcast call sites in server/, while
   * founder:activity carries four types the typed list never mentioned
   * (briefing_ready, event_mesh_activity, workflow_progress,
   * workflow_complete) — which the wildcard path has been delivering all
   * along. The typed list was strictly a subset, strictly duplicated, and
   * strictly less correct.
   */

  const sendMessage = useCallback((msg: Record<string, any>) => {
    send(msg.type ?? "message", msg);
  }, [send]);

  return { lastEvent, isConnected: connected, sendMessage };
}
