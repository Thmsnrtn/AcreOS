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
import { format, formatDistanceToNow } from "date-fns";

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
        "mx-4 mt-3 rounded-lg border p-3 space-y-2",
        !isOnline
          ? "bg-red-950/30 border-red-900/50"
          : syncState === "error"
          ? "bg-yellow-950/30 border-yellow-900/50"
          : syncState === "syncing"
          ? "bg-blue-950/30 border-blue-900/50"
          : syncState === "success"
          ? "bg-emerald-950/30 border-emerald-900/50"
          : "bg-gray-900 border-gray-800"
      )}
    >
      {/* Status line */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!isOnline ? (
            <>
              <WifiOff className="w-4 h-4 text-red-400" />
              <span className="text-xs font-medium text-red-300">Offline</span>
            </>
          ) : syncState === "syncing" ? (
            <>
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              <span className="text-xs font-medium text-blue-300">Syncing...</span>
            </>
          ) : syncState === "error" ? (
            <>
              <AlertTriangle className="w-4 h-4 text-yellow-400" />
              <span className="text-xs font-medium text-yellow-300">Sync failed</span>
            </>
          ) : syncState === "success" ? (
            <>
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-300">All synced</span>
            </>
          ) : (
            <>
              <Wifi className="w-4 h-4 text-gray-400" />
              <span className="text-xs font-medium text-gray-300">Online</span>
            </>
          )}

          {queueCount > 0 && (
            <Badge variant="secondary" className="text-[10px] bg-gray-800 text-gray-400">
              {queueCount} queued
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {lastSyncedAt && (
            <span className="text-[10px] text-gray-600 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })}
            </span>
          )}

          {syncState === "error" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="h-6 px-2 text-[10px] text-yellow-400 hover:text-yellow-300"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Retry
            </Button>
          ) : isOnline && queueCount > 0 && syncState !== "syncing" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSyncNow}
              className="h-6 px-2 text-[10px] text-emerald-400 hover:text-emerald-300"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Sync Now
            </Button>
          ) : null}
        </div>
      </div>

      {/* Progress bar during sync */}
      {syncState === "syncing" && (
        <Progress value={syncProgress} className="h-1.5 bg-gray-800" />
      )}

      {/* Error detail */}
      {syncState === "error" && syncError && (
        <p className="text-[10px] text-yellow-400/70">{syncError}</p>
      )}

      {/* Offline details */}
      {!isOnline && queueCount > 0 && (
        <p className="text-[10px] text-red-400/70">
          {queueCount} action{queueCount !== 1 ? "s" : ""} will sync automatically when you reconnect.
        </p>
      )}
    </div>
  );
}
