import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Clock,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { relative } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncState = "idle" | "syncing" | "success" | "error";

interface OfflineSyncBannerProps {
  isOnline: boolean;
  queueCount: number;
  syncState: SyncState;
  syncProgress: number; // 0-100
  lastSyncedAt?: string;
  syncError?: string;
  onSyncNow: () => void;
  onRetry: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OfflineSyncBanner({
  isOnline,
  queueCount,
  syncState,
  syncProgress,
  lastSyncedAt,
  syncError,
  onSyncNow,
  onRetry,
}: OfflineSyncBannerProps) {
  // Don't render if online with nothing to show
  if (isOnline && queueCount === 0 && syncState === "idle" && !syncError) {
    return null;
  }

  return (
    <div
      className={cn(
        "mx-4 mt-3 rounded-card border p-3 space-y-2",
        !isOnline
          ? "bg-acr-neg-soft/30 border-acr-neg-soft/50"
          : syncState === "error"
          ? "bg-acr-warn-soft/30 border-acr-warn-soft/50"
          : syncState === "syncing"
          ? "bg-acr-accent/30 border-acr-accent/50"
          : syncState === "success"
          ? "bg-acr-pos-soft/30 border-acr-pos-soft/50"
          : "bg-acr-bg-sunken border-border"
      )}
    >
      {/* Status line */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!isOnline ? (
            <>
              <WifiOff className="w-4 h-4 text-acr-neg" />
              <span className="text-xs font-medium text-acr-neg">Offline</span>
            </>
          ) : syncState === "syncing" ? (
            <>
              <Loader2 className="w-4 h-4 text-acr-accent animate-spin" />
              <span className="text-xs font-medium text-acr-accent">Syncing...</span>
            </>
          ) : syncState === "error" ? (
            <>
              <AlertTriangle className="w-4 h-4 text-acr-warn" />
              <span className="text-xs font-medium text-acr-warn">Sync failed</span>
            </>
          ) : syncState === "success" ? (
            <>
              <CheckCircle className="w-4 h-4 text-acr-pos" />
              <span className="text-xs font-medium text-acr-pos">All synced</span>
            </>
          ) : (
            <>
              <Wifi className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Online</span>
            </>
          )}

          {queueCount > 0 && (
            <Badge variant="secondary" className="text-micro bg-acr-bg-sunken text-muted-foreground">
              {queueCount} queued
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {lastSyncedAt && (
            <span className="text-micro text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {relative(lastSyncedAt)}
            </span>
          )}

          {syncState === "error" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="h-6 px-2 text-micro text-acr-warn hover:text-acr-warn"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Retry
            </Button>
          ) : isOnline && queueCount > 0 && syncState !== "syncing" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSyncNow}
              className="h-6 px-2 text-micro text-acr-pos hover:text-acr-pos"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Sync Now
            </Button>
          ) : null}
        </div>
      </div>

      {/* Progress bar during sync */}
      {syncState === "syncing" && (
        <Progress value={syncProgress} className="h-1.5 bg-acr-bg-sunken" />
      )}

      {/* Error detail */}
      {syncState === "error" && syncError && (
        <p className="text-micro text-acr-warn/70">{syncError}</p>
      )}

      {/* Offline details */}
      {!isOnline && queueCount > 0 && (
        <p className="text-micro text-acr-neg/70">
          {queueCount} action{queueCount !== 1 ? "s" : ""} will sync automatically when you reconnect.
        </p>
      )}
    </div>
  );
}
