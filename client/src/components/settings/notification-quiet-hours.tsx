import { useEffect, useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoonStar } from "lucide-react";
import { clientLogger } from "@/lib/clientLogger";
import { apiRequest } from "@/lib/queryClient";

/**
 * Notification quiet hours — per-user preference. Phase C.2 of the port.
 *
 * Sets a daily window during which in-app / email / SMS notifications are
 * suppressed. Local-time hours; wraps midnight when start > end.
 *
 * Server enforcement is wired progressively as Phase E surfaces touch
 * outbound channels — for now this stores the preference and the matrix
 * UI elsewhere on the notifications tab handles per-event toggles.
 */

const PREFERENCES_ENDPOINT = "/api/me/preferences";
const PATCH_DEBOUNCE_MS = 300;

interface QuietHours {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

const DEFAULT_QUIET: QuietHours = { enabled: false, startHour: 19, endHour: 8 };

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function fmtHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

export function NotificationQuietHours() {
  const [hours, setHours] = useState<QuietHours>(DEFAULT_QUIET);
  const patchTimerRef = useRef<number | undefined>(undefined);

  // Hydrate from server.
  useEffect(() => {
    let cancelled = false;
    fetch(PREFERENCES_ENDPOINT, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.notificationQuietHours) return;
        setHours({
          enabled: data.notificationQuietHours.enabled ?? false,
          startHour: data.notificationQuietHours.startHour ?? 19,
          endHour: data.notificationQuietHours.endHour ?? 8,
        });
      })
      .catch(() => {
        // Server unavailable — defaults stay
      });
    return () => { cancelled = true; };
  }, []);

  const update = (next: QuietHours) => {
    setHours(next);
    if (patchTimerRef.current !== undefined) {
      window.clearTimeout(patchTimerRef.current);
    }
    patchTimerRef.current = window.setTimeout(() => {
      patchTimerRef.current = undefined;
      // apiRequest rather than fetch: the .catch below only ever fired on a
      // NETWORK error, so a 4xx/5xx was treated as a successful save and the
      // "PATCH quiet hours failed" line could never appear for the case that
      // actually loses the setting.
      apiRequest("PATCH", PREFERENCES_ENDPOINT, { notificationQuietHours: next }).catch((err) => {
        // eslint-disable-next-line no-console
        clientLogger.warn("[notifications] PATCH quiet hours failed; local state retained", err);
      });
    }, PATCH_DEBOUNCE_MS);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MoonStar className="w-4 h-4" />
          Quiet hours
        </CardTitle>
        <CardDescription>
          Suppress notifications during a daily window. Useful for evenings —
          email, SMS, and in-app stay quiet until the window ends.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <Label htmlFor="quiet-toggle" className="text-sm font-medium">
              Enable quiet hours
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Hours below are in your local time. The window can wrap midnight.
            </p>
          </div>
          <Switch
            id="quiet-toggle"
            checked={hours.enabled}
            onCheckedChange={(v) => update({ ...hours, enabled: v })}
            data-testid="switch-quiet-hours"
          />
        </div>

        <div className={hours.enabled ? "" : "opacity-50 pointer-events-none"}>
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Quiet from</Label>
              <Select
                value={String(hours.startHour)}
                onValueChange={(v) => update({ ...hours, startHour: Number(v) })}
              >
                <SelectTrigger data-testid="select-quiet-start"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)}>{fmtHour(h)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Quiet until</Label>
              <Select
                value={String(hours.endHour)}
                onValueChange={(v) => update({ ...hours, endHour: Number(v) })}
              >
                <SelectTrigger data-testid="select-quiet-end"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)}>{fmtHour(h)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
