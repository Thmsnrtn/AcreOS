import { useState, useEffect, useCallback } from "react";
import { useWebSocketChannel } from "@/hooks/use-websocket-channel";
import { useLocation } from "wouter";
import {
  Bell, X, AlertTriangle, CheckCircle, Info,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * NotificationBanner — Phase C+D
 *
 * Displays real-time notifications from the WebSocket event mesh.
 * Shows a toast-like banner at the top of the page when events arrive.
 * Maintains a notification tray that can be toggled open.
 */

interface Notification {
  id: string;
  title: string;
  message: string;
  priority: number;
  eventType: string;
  actionUrl?: string;
  createdAt: string;
  read: boolean;
}

export function NotificationBanner() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showBanner, setShowBanner] = useState(false);
  const [latestNotif, setLatestNotif] = useState<Notification | null>(null);
  const [showTray, setShowTray] = useState(false);
  const [, navigate] = useLocation();

  const handleEvent = useCallback((event: any) => {
    if (event.type === "notification" && event.payload) {
      const notif: Notification = {
        id: event.payload.id ?? `n_${Date.now()}`,
        title: event.payload.title ?? event.type,
        message: event.payload.message ?? "",
        priority: event.payload.priority ?? 5,
        eventType: event.payload.eventType ?? event.type,
        actionUrl: event.payload.actionUrl,
        createdAt: event.payload.createdAt ?? event.timestamp,
        read: false,
      };

      setNotifications((prev) => [notif, ...prev.slice(0, 49)]);
      setLatestNotif(notif);
      setShowBanner(true);

      // Auto-hide banner after 8 seconds (urgent) or 5 seconds (normal)
      const hideDelay = notif.priority <= 2 ? 8000 : 5000;
      setTimeout(() => {
        setShowBanner(false);
      }, hideDelay);
    }
  }, []);

  // Subscribe to org-wide and founder activity channels
  useWebSocketChannel("founder:activity", handleEvent);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleNotifClick = (notif: Notification) => {
    // Mark as read
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)),
    );
    // Navigate if action URL provided
    if (notif.actionUrl) {
      navigate(notif.actionUrl);
      setShowTray(false);
    }
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const getPriorityIcon = (priority: number) => {
    if (priority <= 2) return <AlertTriangle className="w-4 h-4 text-acr-neg" aria-hidden="true" />;
    if (priority <= 4) return <Info className="w-4 h-4 text-acr-warn" aria-hidden="true" />;
    return <CheckCircle className="w-4 h-4 text-acr-pos" aria-hidden="true" />;
  };

  return (
    <>
      {/* Toast Banner — stacked below the permanent bell so both are
          visible when a live notification arrives. */}
      {showBanner && latestNotif && (
        <div
          role={latestNotif.priority <= 2 ? "alert" : "status"}
          aria-live={latestNotif.priority <= 2 ? "assertive" : "polite"}
          className={cn(
            "fixed top-16 right-4 md:right-16 z-50 max-w-sm",
            "bg-card border shadow-lg rounded-card p-4",
            "animate-in slide-in-from-top-2 fade-in duration-300",
            latestNotif.priority <= 2 && "border-acr-neg dark:border-acr-neg-soft",
          )}
        >
          <div className="flex items-start gap-3">
            {getPriorityIcon(latestNotif.priority)}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{latestNotif.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {latestNotif.message}
              </p>
              {latestNotif.actionUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-xs mt-1 underline"
                  onClick={() => handleNotifClick(latestNotif)}
                >
                  View details <ChevronRight className="w-3 h-3 ml-0.5" aria-hidden="true" />
                </Button>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 -mt-1 -mr-1"
              onClick={() => setShowBanner(false)}
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* Notification bell removed 2026-05-01 — PageTopbar (mounted in
          PageShell) already renders a sticky bell + tray. Two bells
          ~50px apart on desktop was the duplicate the audit flagged.
          The transient announcement banner above remains; the bell
          surface is now single-source. */}

      {/* Notification Tray — kept available via the existing showTray
          state for the (rare) places that still call it programmatically.
          Anchored to top-right to avoid colliding with the topbar. */}
      {showTray && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed top-16 right-4 md:right-16 z-50 w-80 max-h-96 bg-card border shadow-xl rounded-card overflow-hidden"
        >
          <div className="flex items-center justify-between p-3 border-b">
            <p className="font-medium text-sm">Notifications</p>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-6" onClick={markAllRead}>
                  Mark all read
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6"
                onClick={() => setShowTray(false)}
                aria-label="Close notifications"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length > 0 ? (
              <ul aria-label="Recent notifications">
                {notifications.map((notif) => (
                  <li
                    key={notif.id}
                    className={cn(
                      "border-b last:border-0",
                      !notif.read && "bg-primary/5",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleNotifClick(notif)}
                      className="w-full text-left p-3 cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`${notif.read ? "" : "Unread — "}${notif.title}`}
                    >
                      <div className="flex items-start gap-2">
                        {getPriorityIcon(notif.priority)}
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm", !notif.read && "font-medium")}>
                            {notif.title}
                          </p>
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {notif.message}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                            {new Date(notif.createdAt).toLocaleTimeString()}
                          </p>
                        </div>
                        {!notif.read && (
                          <span className="w-2 h-2 bg-primary rounded-full mt-1.5 shrink-0" aria-hidden="true" />
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No notifications yet.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
