import { useEffect, useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoonStar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Verbs } from "@/lib/labels";
import { okOrThrow } from "@/lib/fetch-honesty";
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
  // The controls stay disabled until the saved window has been READ. On a
  // failed read the card used to show the defaults ("off") as the user's
  // setting, and the first toggle PATCHed those defaults over the window they
  // had saved (roadmap W10.1, empty-on-failure).
  const [load, setLoad] = useState<"loading" | "loaded" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const patchTimerRef = useRef<number | undefined>(undefined);

  // Hydrate from server.
  useEffect(() => {
    let cancelled = false;
    setLoad("loading");
    fetch(PREFERENCES_ENDPOINT, { credentials: "include" })
      .then(okOrThrow)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setLoad("loaded");
        if (!data?.notificationQuietHours) return; // none saved: the defaults are the truth
        setHours({
          enabled: data.notificationQuietHours.enabled ?? false,
          startHour: data.notificationQuietHours.startHour ?? 19,
          endHour: data.notificationQuietHours.endHour ?? 8,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        clientLogger.warn("[notifications] could not read quiet hours", err);
        setLoad("failed");
      });
    return () => { cancelled = true; };
  }, [attempt]);
  const editable = load === "loaded";

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
        {load === "failed" && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <span>Couldn&apos;t load your saved quiet hours, so they can&apos;t be changed right now.</span>
            <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)} data-testid="button-quiet-hours-retry">
              {Verbs.RETRY}
            </Button>
          </div>
        )}
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
            disabled={!editable}
            onCheckedChange={(v) => update({ ...hours, enabled: v })}
            data-testid="switch-quiet-hours"
          />
        </div>

        <div className={hours.enabled && editable ? "" : "opacity-50 pointer-events-none"}>
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Quiet from</Label>
              <Select
                value={String(hours.startHour)}
                disabled={!editable || !hours.enabled}
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
                disabled={!editable || !hours.enabled}
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
