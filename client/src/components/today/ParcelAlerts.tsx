import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { motion } from "framer-motion";
import { UserRoundCheck, Landmark, Bell, Check, MapPin } from "lucide-react";
import { formatRelative } from "@/lib/format";

// Mirrors the parcel_alerts row shape returned by GET /api/parcel-alerts.
interface ParcelAlert {
  id: number;
  apn: string;
  state: string;
  county: string;
  alertType: "owner_changed" | "tax_status_changed" | string;
  field: string;
  previousValue: unknown;
  currentValue: unknown;
  source: string | null;
  confidence: number | null;
  leadId: number | null;
  propertyId: number | null;
  isRead: boolean;
  readAt: string | null;
  observedAt: string | null;
  createdAt: string;
}

interface ParcelAlertsResponse {
  alerts: ParcelAlert[];
  unreadCount: number;
}

const FIELD_LABEL: Record<string, string> = {
  owner: "Owner",
  owner_address: "Owner mailing address",
  tax_status: "Tax status",
  tax_amount: "Tax amount",
};

function alertHeadline(a: ParcelAlert): string {
  if (a.alertType === "owner_changed") {
    return a.field === "owner_address"
      ? "Owner mailing address changed on a parcel in your pipeline"
      : "Owner changed on a parcel in your pipeline";
  }
  if (a.alertType === "tax_status_changed") {
    return "Tax status changed on a parcel in your pipeline";
  }
  return "A tracked parcel fact changed in your pipeline";
}

function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function alertIcon(a: ParcelAlert) {
  return a.alertType === "tax_status_changed" ? Landmark : UserRoundCheck;
}

/** Link target back to the pipeline entity that put this parcel on the radar. */
function alertHref(a: ParcelAlert): string | undefined {
  if (a.propertyId) return "/pipeline#properties";
  if (a.leadId) return "/pipeline#leads";
  return undefined;
}

export function ParcelAlerts() {
  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch } = useQuery<ParcelAlertsResponse>({
    queryKey: ["/api/parcel-alerts"],
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/parcel-alerts/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parcel-alerts"] });
    },
    onError: () => {
      toast({
        title: "Couldn't mark as read",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/parcel-alerts/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parcel-alerts"] });
    },
    onError: () => {
      toast({
        title: "Couldn't mark all as read",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card className="rounded-card shadow-acr-1">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Parcel alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="rounded-card shadow-acr-1">
        <CardContent className="py-6">
          <QueryErrorState error={error ?? null} onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  const alerts = data?.alerts ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  if (alerts.length === 0) {
    return (
      <Card className="rounded-card shadow-acr-1">
        <CardContent className="py-2">
          <EmptyState
            icon={Bell}
            headline="No parcel alerts yet"
            subtitle="When the owner or tax status changes on a parcel in your pipeline, we'll surface it here — derived from county records, no extra cost."
            tone="default"
            tips={[
              "Add parcels by saving leads or properties with an APN.",
              "We watch them in the background and notify you on a change.",
            ]}
            cta={{ label: "Go to Deals", href: "/deals" }}
            testId="parcel-alerts-empty"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-card shadow-acr-1">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Parcel alerts
          {unreadCount > 0 && (
            <Badge variant="secondary" data-testid="parcel-alerts-unread-count">
              {unreadCount} new
            </Badge>
          )}
        </CardTitle>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            data-testid="parcel-alerts-mark-all-read"
          >
            Mark all read
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <motion.ul
          className="space-y-2"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {alerts.map((a) => {
            const Icon = alertIcon(a);
            const href = alertHref(a);
            return (
              <motion.li
                key={a.id}
                variants={staggerItem}
                className={`flex items-start gap-3 rounded-card border p-3 transition-colors ${
                  a.isRead ? "border-border bg-card" : "border-primary/30 bg-primary/5"
                }`}
                data-testid={`parcel-alert-${a.id}`}
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/60">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">
                    {alertHeadline(a)}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      APN {a.apn} · {a.county}
                      {a.county ? ", " : ""}
                      {a.state}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {FIELD_LABEL[a.field] ?? a.field}:{" "}
                    <span className="line-through">{valueText(a.previousValue)}</span>{" "}
                    → <span className="font-medium text-foreground">{valueText(a.currentValue)}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[11px] text-muted-foreground">
                      {formatRelative(a.createdAt)}
                      {a.source ? ` · ${a.source}` : ""}
                    </span>
                    {href && (
                      <Link
                        href={href}
                        className="inline-flex min-h-11 items-center px-2 -mx-2 -my-3.5 text-[11px] font-medium text-primary underline-offset-2 hover:underline active:underline focus-visible:underline focus-visible:outline-none"
                      >
                        View in pipeline
                      </Link>
                    )}
                  </div>
                </div>
                {!a.isRead && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => markRead.mutate(a.id)}
                    disabled={markRead.isPending}
                    aria-label="Mark alert as read"
                    data-testid={`parcel-alert-${a.id}-mark-read`}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </motion.li>
            );
          })}
        </motion.ul>
      </CardContent>
    </Card>
  );
}
