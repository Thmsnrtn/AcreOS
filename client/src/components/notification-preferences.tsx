import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Mail, Smartphone, Monitor, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { NOTIFICATION_EVENT_TYPES, type NotificationPreference } from "@shared/schema";

const eventTypeLabels: Record<string, { label: string; description: string }> = {
  lead_created: { label: "New Lead", description: "When a new lead is added" },
  lead_updated: { label: "Lead Updated", description: "When a lead is modified" },
  lead_stage_changed: { label: "Lead Stage Changed", description: "When a lead moves to a different stage" },
  property_created: { label: "New Property", description: "When a new property is added" },
  property_updated: { label: "Property Updated", description: "When a property is modified" },
  deal_created: { label: "New Deal", description: "When a new deal is created" },
  deal_updated: { label: "Deal Updated", description: "When a deal is modified" },
  deal_stage_changed: { label: "Deal Stage Changed", description: "When a deal moves to a different stage" },
  payment_received: { label: "Payment Received", description: "When a payment is recorded" },
  payment_overdue: { label: "Payment Overdue", description: "When a payment becomes overdue" },
  campaign_started: { label: "Campaign Started", description: "When a campaign begins" },
  campaign_completed: { label: "Campaign Completed", description: "When a campaign finishes" },
  email_sent: { label: "Email Sent", description: "When an email is sent to a lead" },
  sms_sent: { label: "SMS Sent", description: "When an SMS is sent to a lead" },
  mail_sent: { label: "Direct Mail Sent", description: "When direct mail is sent" },
};

interface PreferenceRowProps {
  eventType: string;
  preference: NotificationPreference | undefined;
  onUpdate: (eventType: string, field: string, value: boolean) => void;
  isPending: boolean;
}

function PreferenceRow({ eventType, preference, onUpdate, isPending }: PreferenceRowProps) {
  const info = eventTypeLabels[eventType] || { label: eventType, description: "" };
  
  return (
    <div 
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 border-b last:border-b-0"
      data-testid={`notification-pref-${eventType}`}
    >
      <div className="flex-1">
        <Label className="text-sm font-medium">{info.label}</Label>
        <p className="text-xs text-muted-foreground">{info.description}</p>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-muted-foreground" />
          <Switch
            checked={preference?.inAppEnabled ?? true}
            onCheckedChange={(value) => onUpdate(eventType, "inAppEnabled", value)}
            disabled={isPending}
            data-testid={`notification-pref-${eventType}-inapp`}
          />
        </div>
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <Switch
            checked={preference?.emailEnabled ?? true}
            onCheckedChange={(value) => onUpdate(eventType, "emailEnabled", value)}
            disabled={isPending}
            data-testid={`notification-pref-${eventType}-email`}
          />
        </div>
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-muted-foreground" />
          <Switch
            checked={preference?.pushEnabled ?? false}
            onCheckedChange={(value) => onUpdate(eventType, "pushEnabled", value)}
            disabled={isPending}
            data-testid={`notification-pref-${eventType}-push`}
          />
        </div>
      </div>
    </div>
  );
}

export function NotificationPreferences() {
  const { toast } = useToast();
  
  const { data: preferences = [], isLoading } = useQuery<NotificationPreference[]>({
    queryKey: ["/api/notification-preferences"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ eventType, emailEnabled, pushEnabled, inAppEnabled }: {
      eventType: string;
      emailEnabled?: boolean;
      pushEnabled?: boolean;
      inAppEnabled?: boolean;
    }) => {
      const res = await apiRequest("POST", "/api/notification-preferences", {
        eventType,
        emailEnabled,
        pushEnabled,
        inAppEnabled,
      });
      if (!res.ok) throw new Error("Failed to update preference");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      toast({
        title: "Preference updated",
        description: "Your notification preference has been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update notification preference",
        variant: "destructive",
      });
    },
  });

  const handleUpdate = (eventType: string, field: string, value: boolean) => {
    const existingPref = preferences.find(p => p.eventType === eventType);
    updateMutation.mutate({
      eventType,
      emailEnabled: field === "emailEnabled" ? value : existingPref?.emailEnabled ?? true,
      pushEnabled: field === "pushEnabled" ? value : existingPref?.pushEnabled ?? false,
      inAppEnabled: field === "inAppEnabled" ? value : existingPref?.inAppEnabled ?? true,
    });
  };

  const preferencesMap = preferences.reduce((acc, pref) => {
    acc[pref.eventType] = pref;
    return acc;
  }, {} as Record<string, NotificationPreference>);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Notification Preferences
          </CardTitle>
          <CardDescription>
            Configure how you receive notifications for different events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="notification-preferences">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Notification Preferences
        </CardTitle>
        <CardDescription>
          Configure how you receive notifications for different events.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-end gap-6 pb-3 mb-3 border-b text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Monitor className="w-3 h-3" />
            <span>In-App</span>
          </div>
          <div className="flex items-center gap-1">
            <Mail className="w-3 h-3" />
            <span>Email</span>
          </div>
          <div className="flex items-center gap-1">
            <Smartphone className="w-3 h-3" />
            <span>Push</span>
          </div>
        </div>
        <div>
          {NOTIFICATION_EVENT_TYPES.map((eventType) => (
            <PreferenceRow
              key={eventType}
              eventType={eventType}
              preference={preferencesMap[eventType]}
              onUpdate={handleUpdate}
              isPending={updateMutation.isPending}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
