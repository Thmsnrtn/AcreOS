import { useState, useEffect } from "react";
import { WifiOff, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showReconnecting, setShowReconnecting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setShowReconnecting(true);
      setTimeout(() => {
        setIsOffline(false);
        setShowReconnecting(false);
        setDismissed(false);
      }, 1500);
    };
    const handleOffline = () => {
      setIsOffline(true);
      setDismissed(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!isOffline && !showReconnecting) return null;
  if (dismissed && isOffline) return null;

  if (showReconnecting) {
    return (
      <div 
        className="fixed top-0 left-0 right-0 z-[100] bg-emerald-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2"
        data-testid="reconnecting-indicator"
      >
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>Reconnected! Syncing data...</span>
      </div>
    );
  }

  return (
    <div 
      className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2"
      data-testid="offline-indicator"
    >
      <WifiOff className="w-4 h-4" />
      <span>You're offline. Changes will sync when reconnected.</span>
      <Button
        size="sm"
        variant="ghost"
        className="ml-2 text-amber-950"
        onClick={() => setDismissed(true)}
        data-testid="button-dismiss-offline"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
