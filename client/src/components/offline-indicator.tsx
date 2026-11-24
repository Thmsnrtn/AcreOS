import { useState, useEffect } from "react";
import { WifiOff, RefreshCw, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOfflineSync } from "@/hooks/useOfflineSync";

/**
 * OfflineIndicator — single top-of-viewport banner that surfaces three
 * states:
 *
 *  1. Offline   — yellow, with the queued-mutation count if any are pending.
 *  2. Reconnecting — green pulse for ~1.5s after the connection returns.
 *  3. Queued-while-online — neutral, only if mutations are still pending
 *     after a reconnect (network back but server roundtrip pending). The
 *     "Sync now" button manually drains the queue without waiting for
 *     the 5-min auto-poll.
 *
 * The hook (useOfflineSync) owns the IndexedDB queue + drain loop. This
 * component is the only place that exposes the queue's existence to the
 * user — keeping all queue UX in one banner avoids the trap of putting
 * a "queued mutations" badge on every page.
 */
export function OfflineIndicator() {
  const { isOnline, syncStatus, queuedCount, forceSync } = useOfflineSync();
  const [showReconnecting, setShowReconnecting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setShowReconnecting(true);
      setTimeout(() => {
        setShowReconnecting(false);
        setDismissed(false);
      }, 1500);
    };
    const handleOffline = () => {
      setDismissed(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Body data attribute → sticky topbar shifts down by banner height.
  const bannerVisible =
    (!isOnline && !dismissed) ||
    showReconnecting ||
    (isOnline && queuedCount > 0 && !dismissed);
  useEffect(() => {
    if (bannerVisible) {
      document.body.dataset.offlineBanner = "true";
    } else {
      delete document.body.dataset.offlineBanner;
    }
    return () => {
      delete document.body.dataset.offlineBanner;
    };
  }, [bannerVisible]);

  if (!bannerVisible) return null;

  // One banner shell for all three states (bundle trim, EL-P1 fix
  // round): the states differ only in palette, icon, copy and whether
  // the force-sync / dismiss actions ride along.
  const bannerClass =
    "fixed top-0 left-0 right-0 z-toast px-4 py-2 text-center text-sm font-medium flex items-center justify-center";
  const warnClass = `${bannerClass} bg-acr-warn-soft text-acr-warn-soft-ink flex-wrap`;
  const changes = `${queuedCount} ${queuedCount === 1 ? "change is" : "changes are"}`;
  const dismissButton = (label: string, testId: string, className: string) => (
    <Button
      aria-label={label}
      size="sm"
      variant="ghost"
      className={className}
      onClick={() => setDismissed(true)}
      data-testid={testId}
    >
      <X className="w-4 h-4" aria-hidden="true" />
    </Button>
  );

  if (showReconnecting) {
    return (
      <div
        className={`${bannerClass} bg-acr-pos text-white gap-2`}
        data-testid="reconnecting-indicator"
      >
        <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
        <span>Reconnected — syncing {queuedCount > 0 ? `${queuedCount} queued ${queuedCount === 1 ? "change" : "changes"}` : "data"}…</span>
      </div>
    );
  }

  // Online but mutations still queued (e.g., a backend hiccup).
  if (isOnline && queuedCount > 0) {
    return (
      <div className={`${warnClass} gap-3`} data-testid="queued-indicator">
        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
        <span>{changes} waiting to sync.</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => forceSync()}
          disabled={syncStatus === "syncing"}
          aria-label="Force sync queued changes now"
          data-testid="button-force-sync"
        >
          <RefreshCw
            className={`w-3 h-3 mr-1${syncStatus === "syncing" ? " animate-spin" : ""}`}
            aria-hidden="true"
          />
          {syncStatus === "syncing" ? "Syncing…" : "Sync now"}
        </Button>
        {dismissButton("Dismiss sync banner", "button-dismiss-queued", "h-7 px-1 text-acr-warn")}
      </div>
    );
  }

  // Offline.
  return (
    <div className={`${warnClass} gap-2`} data-testid="offline-indicator">
      <WifiOff className="w-4 h-4" aria-hidden="true" />
      <span>
        You're offline.{" "}
        {queuedCount > 0
          ? `${changes} queued; they'll sync when you're back.`
          : "Changes will sync when reconnected."}
      </span>
      {dismissButton("Dismiss offline notice", "button-dismiss-offline", "ml-2 text-acr-warn")}
    </div>
  );
}
