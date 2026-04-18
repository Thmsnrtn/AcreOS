import { useState, useEffect, useCallback } from "react";
import { useWebSocketChannel } from "@/hooks/use-websocket-channel";
import { useLocation } from "wouter";
import {
  Bell, X, AlertTriangle, CheckCircle, Info,
  ChevronRight, Volume2,
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
    if (priority <= 2) return <AlertTriangle className="w-4 h-4 text-red-500" />;
    if (priority <= 4) return <Info className="w-4 h-4 text-yellow-500" />;
    return <CheckCircle className="w-4 h-4 text-green-500" />;
  };

  return (
    <>
      {/* Toast Banner */}
      {showBanner && latestNotif && (
        <div className={cn(
          "fixed top-4 right-4 z-50 max-w-sm",
          "bg-card border shadow-lg rounded-lg p-4",
          "animate-in slide-in-from-top-2 fade-in duration-300",
          latestNotif.priority <= 2 && "border-red-300 dark:border-red-800",
        )}>
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
                  View details <ChevronRight className="w-3 h-3 ml-0.5" />
                </Button>
              )}
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 -mt-1 -mr-1" onClick={() => setShowBanner(false)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Notification Bell (fixed bottom-right, above FAB) */}
      <div className="fixed bottom-20 right-4 z-40 md:bottom-4 md:right-20">
        <Button
          variant="outline"
          size="sm"
          className="relative rounded-full w-10 h-10 p-0 shadow-md bg-background"
          onClick={() => setShowTray(!showTray)}
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </div>

      {/* Notification Tray */}
      {showTray && (
        <div className="fixed bottom-32 right-4 z-50 md:bottom-16 md:right-20 w-80 max-h-96 bg-card border shadow-xl rounded-lg overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b">
            <p className="font-medium text-sm">Notifications</p>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-6" onClick={markAllRead}>
                  Mark all read
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-6" onClick={() => setShowTray(false)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length > 0 ? (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={cn(
                    "p-3 border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors",
                    !notif.read && "bg-primary/5",
                  )}
                  onClick={() => handleNotifClick(notif)}
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
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(notif.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                    {!notif.read && (
                      <span className="w-2 h-2 bg-primary rounded-full mt-1.5 shrink-0" />
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No notifications yet
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
