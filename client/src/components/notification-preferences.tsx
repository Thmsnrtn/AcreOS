import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Mail, MessageSquare, Smartphone, Monitor } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

/**
 * Notification preferences — JC#11 calm matrix per brief §6.3.
 *
 * Reads the richer category/event tree from
 * /api/notifications/preferences/schema and the user's stored overrides
 * from /api/notifications/preferences. Renders one row per event grouped
 * by category, four channel toggles per row (in-app / email / sms / push).
 *
 * Calm-matrix rules:
 *   - Default state is whatever the schema declares, but we frame the UI
 *     around opting in deliberately — toggles read as "let this through,"
 *     not "block this."
 *   - Categories get spacing + a header; events read as a list, not a grid.
 *   - Global mute is an explicit kill-switch at the top, separate from
 *     per-event toggles.
 *
 * The legacy /api/notification-preferences (table-backed) is kept around
 * for older callers but no longer surfaced here.
 */

const SCHEMA_QUERY_KEY = ["/api/notifications/preferences/schema"] as const;
const PREFS_QUERY_KEY = ["/api/notifications/preferences"] as const;

type Channel = "inApp" | "email" | "sms" | "push";

interface NotificationEvent {
  id: string;
  label: string;
  description: string;
  defaultChannels: Record<Channel, boolean>;
}

interface NotificationCategory {
  id: string;
  label: string;
  description: string;
  events: NotificationEvent[];
}

interface UserPrefs {
  overrides: Record<string, Partial<Record<Channel, boolean>>>;
  globalMute: boolean;
  weeklyDigest: boolean;
  digestDay: "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
  digestHour: number;
}

const CHANNEL_META: { id: Channel; label: string; icon: typeof Monitor }[] = [
  { id: "inApp", label: "In-app", icon: Monitor },
  { id: "email", label: "Email", icon: Mail },
  { id: "sms", label: "SMS", icon: MessageSquare },
  { id: "push", label: "Push", icon: Smartphone },
];

function effectiveValue(
  event: NotificationEvent,
  channel: Channel,
  overrides: UserPrefs["overrides"],
): boolean {
  const override = overrides[event.id];
  if (override && override[channel] !== undefined) return override[channel] as boolean;
  return event.defaultChannels[channel] ?? false;
}

export function NotificationPreferences() {
  const { toast } = useToast();

  const { data: schema, isLoading: schemaLoading } = useQuery<NotificationCategory[]>({
    queryKey: SCHEMA_QUERY_KEY,
  });
  const { data: serverPrefs, isLoading: prefsLoading } = useQuery<UserPrefs>({
    queryKey: PREFS_QUERY_KEY,
  });

  // Local optimistic state — keeps the toggles snappy during PATCH inflight.
  const [localPrefs, setLocalPrefs] = useState<UserPrefs | null>(null);
  useEffect(() => {
    if (serverPrefs) setLocalPrefs(serverPrefs);
  }, [serverPrefs]);

  const updateMutation = useMutation({
    mutationFn: async (next: UserPrefs) => {
      const res = await apiRequest("PUT", "/api/notifications/preferences", next);
      if (!res.ok) throw new Error("Failed to update preferences");
      return res.json() as Promise<UserPrefs>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PREFS_QUERY_KEY, data);
    },
    onError: () => {
      // Revert local state to last known server state.
      if (serverPrefs) setLocalPrefs(serverPrefs);
      toast({
        title: "Couldn't save preferences",
        description: "The earlier setting is unchanged. Try again.",
        variant: "destructive",
      });
    },
  });

  const persist = (next: UserPrefs) => {
    setLocalPrefs(next);
    updateMutation.mutate(next);
  };

  const toggleChannel = (eventId: string, channel: Channel, value: boolean) => {
    if (!localPrefs) return;
    const nextOverrides = {
      ...localPrefs.overrides,
      [eventId]: { ...(localPrefs.overrides[eventId] ?? {}), [channel]: value },
    };
    persist({ ...localPrefs, overrides: nextOverrides });
  };

  const toggleGlobalMute = (value: boolean) => {
    if (!localPrefs) return;
    persist({ ...localPrefs, globalMute: value });
  };

  const isLoading = schemaLoading || prefsLoading || !localPrefs;

  const optedInCount = useMemo(() => {
    if (!schema || !localPrefs) return 0;
    let count = 0;
    for (const cat of schema) {
      for (const evt of cat.events) {
        for (const ch of CHANNEL_META) {
          if (effectiveValue(evt, ch.id, localPrefs.overrides)) count++;
        }
      }
    }
    return count;
  }, [schema, localPrefs]);

  if (isLoading) {
    return (
      <Card data-testid="notification-preferences-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Notifications
          </CardTitle>
          <CardDescription>Choose which events reach you, and where.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="notification-preferences">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5" aria-hidden="true" />
          Notifications
        </CardTitle>
        <CardDescription>
          Choose which events reach you, and where. Defaults are conservative —
          flip a toggle to opt in deliberately.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-8">
        {/* Global mute — explicit kill switch above per-event rows. */}
        <div className="flex items-start justify-between gap-4 rounded-card border bg-muted/30 px-4 py-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Pause all notifications</p>
            <p className="text-xs text-muted-foreground">
              {localPrefs.globalMute
                ? "Everything is paused. Re-enable to resume per-event delivery."
                : `${optedInCount} channel${optedInCount === 1 ? "" : "s"} active across categories below.`}
            </p>
          </div>
          <Switch
            checked={localPrefs.globalMute}
            onCheckedChange={toggleGlobalMute}
            data-testid="notification-global-mute"
            aria-label="Pause all notifications"
          />
        </div>

        {/* Channel column header — only on md+ where row layout is grid-like. */}
        <div className="hidden md:flex items-center justify-end gap-8 pb-2 border-b text-xs text-muted-foreground">
          {CHANNEL_META.map(({ id, label, icon: Icon }) => (
            <div key={id} className="flex items-center gap-1.5 w-12 justify-center">
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* One section per category. */}
        {schema?.map((category) => (
          <section key={category.id} className="space-y-3" data-testid={`notification-category-${category.id}`}>
            <header className="space-y-0.5">
              <h3 className="text-sm font-semibold">{category.label}</h3>
              <p className="text-xs text-muted-foreground">{category.description}</p>
            </header>

            <ul className="divide-y rounded-card border">
              {category.events.map((event) => (
                <li
                  key={event.id}
                  className={cn(
                    "flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3",
                    localPrefs.globalMute && "opacity-50",
                  )}
                  data-testid={`notification-event-${event.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{event.label}</p>
                    <p className="text-xs text-muted-foreground">{event.description}</p>
                  </div>
                  <div className="flex items-center justify-end gap-8">
                    {CHANNEL_META.map(({ id: channelId, label: channelLabel, icon: ChannelIcon }) => {
                      const value = effectiveValue(event, channelId, localPrefs.overrides);
                      return (
                        <div key={channelId} className="flex flex-col items-center gap-1 w-12">
                          <ChannelIcon className="w-3.5 h-3.5 text-muted-foreground md:hidden" aria-hidden="true" />
                          <Switch
                            checked={value}
                            onCheckedChange={(v) => toggleChannel(event.id, channelId, v)}
                            disabled={localPrefs.globalMute || updateMutation.isPending}
                            aria-label={`${event.label} via ${channelLabel}`}
                            data-testid={`notification-${event.id}-${channelId}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
