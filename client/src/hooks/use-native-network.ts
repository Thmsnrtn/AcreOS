/**
 * useNativeNetwork — Capacitor Network plugin with web fallback
 *
 * Uses the Capacitor Network plugin when running natively for accurate
 * connection-type detection; falls back to navigator.onLine on web.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { isNative } from "@/lib/platform";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectionType =
  | "wifi"
  | "cellular"
  | "none"
  | "unknown";

export interface UseNativeNetworkReturn {
  isOnline: boolean;
  connectionType: ConnectionType;
  isNative: boolean;
}

type StatusChangeCallback = (online: boolean, type: ConnectionType) => void;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useNativeNetwork(
  onStatusChange?: StatusChangeCallback,
): UseNativeNetworkReturn {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [connectionType, setConnectionType] = useState<ConnectionType>("unknown");

  // Keep a ref to the callback so we don't re-subscribe on every render
  const callbackRef = useRef<StatusChangeCallback | undefined>(onStatusChange);
  callbackRef.current = onStatusChange;

  const updateStatus = useCallback(
    (online: boolean, type: ConnectionType) => {
      setIsOnline(online);
      setConnectionType(type);
      callbackRef.current?.(online, type);
    },
    [],
  );

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (isNative) {
      // Use Capacitor Network plugin
      let listenerHandle: any;

      import("@capacitor/network")
        .then(async ({ Network }) => {
          // Get initial status
          const status = await Network.getStatus();
          const type = mapConnectionType(status.connectionType);
          updateStatus(status.connected, type);

          // Listen for changes
          listenerHandle = await Network.addListener(
            "networkStatusChange",
            (newStatus: any) => {
              const newType = mapConnectionType(newStatus.connectionType);
              updateStatus(newStatus.connected, newType);
            },
          );
        })
        .catch((err) => {
          console.warn("[Network] Capacitor Network plugin unavailable:", err);
          // Fall through to web listeners below
          setupWebListeners();
        });

      cleanup = () => {
        listenerHandle?.remove?.();
      };
    } else {
      setupWebListeners();
    }

    function setupWebListeners() {
      const handleOnline = () => updateStatus(true, "unknown");
      const handleOffline = () => updateStatus(false, "none");

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      // Try to detect connection type from Network Information API (Chrome)
      const nav = navigator as any;
      if (nav.connection) {
        const detectType = () => {
          const ct = nav.connection.type ?? nav.connection.effectiveType ?? "unknown";
          const mapped = ct === "wifi" ? "wifi" : ct === "cellular" ? "cellular" : "unknown";
          setConnectionType(mapped as ConnectionType);
        };
        detectType();
        nav.connection.addEventListener?.("change", detectType);
      }

      cleanup = () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }

    return () => {
      cleanup?.();
    };
  }, [updateStatus]);

  return {
    isOnline,
    connectionType,
    isNative,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapConnectionType(type: string): ConnectionType {
  switch (type) {
    case "wifi":
      return "wifi";
    case "cellular":
      return "cellular";
    case "none":
      return "none";
    default:
      return "unknown";
  }
}
