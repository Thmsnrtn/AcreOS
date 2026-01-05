import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Bell, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  UserPlus,
  DollarSign,
  MessageSquare,
  Workflow,
  AlertTriangle,
  CheckCheck
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import type { Notification } from "@shared/schema";

const notificationIcons: Record<string, any> = {
  task_assigned: UserPlus,
  task_due: Clock,
  task_overdue: AlertTriangle,
  deal_update: CheckCircle2,
  deal_stage_changed: Workflow,
  payment_received: DollarSign,
  payment_missed: AlertCircle,
  lead_response: MessageSquare,
  lead_assigned: UserPlus,
  team_mention: MessageSquare,
  automation_triggered: Workflow,
  system_alert: AlertTriangle,
};

const notificationColors: Record<string, string> = {
  task_assigned: "text-blue-500",
  task_due: "text-amber-500",
  task_overdue: "text-red-500",
  deal_update: "text-green-500",
  deal_stage_changed: "text-purple-500",
  payment_received: "text-green-500",
  payment_missed: "text-red-500",
  lead_response: "text-blue-500",
  lead_assigned: "text-blue-500",
  team_mention: "text-purple-500",
  automation_triggered: "text-amber-500",
  system_alert: "text-red-500",
};

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);

  const { data: notifications } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/count"],
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("PUT", `/api/notifications/${id}/read`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("PUT", "/api/notifications/read-all");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/count"] });
    },
  });

  const unreadCount = countData?.count || 0;

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markReadMutation.mutate(notification.id);
    }
    setIsOpen(false);
  };

  const getEntityLink = (notification: Notification): string | null => {
    if (!notification.entityType || !notification.entityId) return null;
    
    const links: Record<string, string> = {
      lead: `/leads`,
      property: `/properties`,
      deal: `/deals`,
      task: `/tasks`,
      payment: `/finance`,
    };
    
    return links[notification.entityType] || null;
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="relative"
          data-testid="button-notifications"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs"
              data-testid="badge-notification-count"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <h4 className="font-semibold">Notifications</h4>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="w-4 h-4 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        
        <ScrollArea className="h-80">
          {notifications && notifications.length > 0 ? (
            <div className="divide-y">
              {notifications.map((notification) => {
                const Icon = notificationIcons[notification.type] || Bell;
                const colorClass = notificationColors[notification.type] || "text-muted-foreground";
                const link = getEntityLink(notification);
                
                const content = (
                  <div 
                    className={`p-3 cursor-pointer transition-colors ${
                      notification.isRead ? "bg-background" : "bg-muted/30"
                    } hover:bg-muted/50`}
                    onClick={() => handleNotificationClick(notification)}
                    data-testid={`notification-item-${notification.id}`}
                  >
                    <div className="flex gap-3">
                      <div className={`flex-shrink-0 ${colorClass}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${notification.isRead ? "" : "font-medium"}`}>
                          {notification.title}
                        </p>
                        {notification.message && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                            {notification.message}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {notification.createdAt && formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      {!notification.isRead && (
                        <div className="flex-shrink-0">
                          <div className="w-2 h-2 rounded-full bg-primary" />
                        </div>
                      )}
                    </div>
                  </div>
                );
                
                if (link) {
                  return (
                    <Link key={notification.id} href={link}>
                      {content}
                    </Link>
                  );
                }
                
                return <div key={notification.id}>{content}</div>;
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <Bell className="w-10 h-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">No notifications</p>
              <p className="text-xs text-muted-foreground">You're all caught up!</p>
            </div>
          )}
        </ScrollArea>
        
        <div className="p-2 border-t">
          <Link href="/activity">
            <Button variant="ghost" className="w-full justify-center" size="sm">
              View all activity
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
