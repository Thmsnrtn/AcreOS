/**
 * T42 — useKpiStream — Client-side hook for real-time KPI updates
 *
 * Subscribes to the org WebSocket channel and updates dashboard metric values
 * in real-time without polling.
 *
 * Usage:
 *   const { metrics, lastUpdated } = useKpiStream(orgId, userId);
 */

import { useState, useEffect, useRef, useCallback } from "react";

export interface KpiMetrics {
  "leads.total"?: number;
  "deals.active"?: number;
  "deals.closed"?: number;
  "notes.balance"?: number;
  "offers.sent"?: number;
  "pipeline.value"?: number;
  [key: string]: number | undefined;
}

interface KpiUpdate {
  type: "kpi.update";
  metric: string;
  value: number | string;
  delta?: number;
  label?: string;
}

export function useKpiStream(orgId: number | undefined, userId: number | undefined) {
  const [metrics, setMetrics] = useState<KpiMetrics>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!orgId || !userId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws?orgId=${orgId}&userId=${userId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Subscribe to org channel
      ws.send(JSON.stringify({ type: "subscribe", channel: `org:${orgId}` }));
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as KpiUpdate;
        if (msg.type === "kpi.update") {
          const numericValue = typeof msg.value === "string"
            ? parseFloat(msg.value)
            : msg.value;
          if (!isNaN(numericValue)) {
            setMetrics(prev => ({ ...prev, [msg.metric]: numericValue }));
            setLastUpdated(new Date());
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
      // Reconnect after 5s
      reconnectTimer.current = setTimeout(() => connect(), 5000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [orgId, userId]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { metrics, lastUpdated, isConnected };
}
