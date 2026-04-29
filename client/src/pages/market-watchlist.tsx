/**
 * T117 — Market Watchlist Page
 *
 * Watch specific counties for market opportunities:
 *   - Tax delinquent new parcels
 *   - Price drops by threshold %
 *   - Demand score increases
 *   - Foreclosure filings
 *
 * Alerts surface here and can push to email/SMS.
 */
import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bell,
  BellRing,
  Plus,
  Trash2,
  MapPin,
  TrendingDown,
  AlertTriangle,
  Zap,
  Home,
  Loader2,
  CheckCircle2,
  Eye,
  Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { relative } from "@/lib/format";

interface WatchlistEntry {
  id: string;
  state: string;
  county: string;
  alertOnTaxDelinquent: boolean;
  alertOnPriceDrop: boolean;
  priceDropThresholdPct: number;
  alertOnDemandIncrease: boolean;
  demandScoreThreshold: number;
  alertOnForeclosure: boolean;
  emailAlert: boolean;
  pushAlert: boolean;
  active: boolean;
  createdAt: string;
  lastAlertAt?: string;
}

interface MarketAlert {
  id: string;
  watchlistEntryId: string;
  state: string;
  county: string;
  type: "tax_delinquent" | "price_drop" | "demand_increase" | "foreclosure" | "opportunity";
  title: string;
  summary: string;
  severity: "low" | "medium" | "high";
  createdAt: string;
  read: boolean;
}

const ALERT_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  tax_delinquent: Home,
  price_drop: TrendingDown,
  demand_increase: Zap,
  foreclosure: AlertTriangle,
  opportunity: BellRing,
};

// Severity → semantic --acr-* tone (Tier 1 pattern).
const SEVERITY_COLORS = {
  low: "border-acr-line bg-acr-surface-2",
  medium: "border-[color:var(--acr-warn)]/30 bg-acr-warn-soft",
  high: "border-[color:var(--acr-neg)]/30 bg-acr-neg-soft",
};

const US_STATES = [
  "AL","AR","AZ","CA","CO","CT","DE","FL","GA","IA","ID","IL","IN","KS","KY",
  "LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM",
  "NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA",
  "WI","WV","WY",
];

export default function MarketWatchlistPage() {
  useDocumentTitle("Market watchlist");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const stateSelectId = useId();
  const countyInputId = useId();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<WatchlistEntry | null>(null);
  const [newEntry, setNewEntry] = useState({
    state: "TX",
    county: "",
    alertOnTaxDelinquent: true,
    alertOnPriceDrop: true,
    priceDropThresholdPct: 10,
    alertOnDemandIncrease: true,
    demandScoreThreshold: 70,
    alertOnForeclosure: true,
    emailAlert: true,
    pushAlert: true,
  });

  const { data: watchlist, isLoading } = useQuery<WatchlistEntry[]>({
    queryKey: ["/api/market/watchlist"],
  });

  const { data: alerts } = useQuery<MarketAlert[]>({
    queryKey: ["/api/market/watchlist/alerts"],
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/market/watchlist/unread"],
  });

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/market/watchlist", newEntry),
    onSuccess: () => {
      toast({ title: `${newEntry.county}, ${newEntry.state} added to watchlist` });
      setAddOpen(false);
      setNewEntry(prev => ({ ...prev, county: "" }));
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist"] });
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't add to watchlist",
        description: `${err.message}. Your county and alert preferences are unchanged — try again.`,
        variant: "destructive",
      }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/market/watchlist/${id}`),
    onSuccess: () => {
      toast({ title: "Removed from watchlist" });
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist"] });
      setPendingRemove(null);
    },
    onError: () =>
      toast({
        title: "Couldn't remove from watchlist",
        description: "The county is still on your watchlist. Try again, or pause alerts manually.",
        variant: "destructive",
      }),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/market/watchlist/${id}/test`),
    onSuccess: () => {
      toast({ title: "Test alert sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist/unread"] });
    },
    onError: () =>
      toast({
        title: "Couldn't send test alert",
        description: "Your alert config is unchanged. Check that email/push channels are enabled, then try again.",
        variant: "destructive",
      }),
  });

  const markReadMutation = useMutation({
    mutationFn: (alertIds: string[]) =>
      apiRequest("POST", "/api/market/watchlist/alerts/read", { alertIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist/unread"] });
    },
  });

  const unreadCount = unreadData?.count ?? 0;
  const unreadAlerts = alerts?.filter(a => !a.read) ?? [];

  return (
    <PageShell label="Market watchlist">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Eye className="w-6 h-6 text-primary" aria-hidden="true" /> Market watchlist
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Monitor counties for deal opportunities, price drops, and tax delinquency events.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button aria-label="Add a county to watchlist"><Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Watch county</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add county to watchlist</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => { e.preventDefault(); if (newEntry.county) addMutation.mutate(); }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={stateSelectId}>State</Label>
                  <Select value={newEntry.state} onValueChange={v => setNewEntry(e => ({ ...e, state: v }))}>
                    <SelectTrigger id={stateSelectId} aria-label="State"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={countyInputId}>County</Label>
                  <Input
                    id={countyInputId}
                    placeholder="e.g. Travis"
                    value={newEntry.county}
                    onChange={e => setNewEntry(prev => ({ ...prev, county: e.target.value }))}
                    autoCapitalize="words"
                    required
                  />
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Alert triggers</legend>
                <ul className="space-y-2" aria-label="Alert triggers">
                  {[
                    { key: "alertOnTaxDelinquent", label: "New tax delinquent parcels" },
                    { key: "alertOnPriceDrop", label: `Price drop ≥ ${newEntry.priceDropThresholdPct}%` },
                    { key: "alertOnDemandIncrease", label: `Demand score ≥ ${newEntry.demandScoreThreshold}` },
                    { key: "alertOnForeclosure", label: "Foreclosure filings" },
                  ].map(({ key, label }) => {
                    const switchId = `${key}-switch`;
                    return (
                      <li key={key} className="flex items-center gap-2">
                        <Switch
                          id={switchId}
                          checked={(newEntry as any)[key]}
                          onCheckedChange={v => setNewEntry(e => ({ ...e, [key]: v }))}
                        />
                        <Label htmlFor={switchId} className="text-sm cursor-pointer">{label}</Label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Notification channels</legend>
                <ul className="space-y-2" aria-label="Notification channels">
                  {[
                    { key: "emailAlert", label: "Email alerts" },
                    { key: "pushAlert", label: "Push notifications" },
                  ].map(({ key, label }) => {
                    const switchId = `${key}-switch`;
                    return (
                      <li key={key} className="flex items-center gap-2">
                        <Switch
                          id={switchId}
                          checked={(newEntry as any)[key]}
                          onCheckedChange={v => setNewEntry(e => ({ ...e, [key]: v }))}
                        />
                        <Label htmlFor={switchId} className="text-sm cursor-pointer">{label}</Label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button
                  type="submit"
                  disabled={!newEntry.county || addMutation.isPending}
                >
                  {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> : null}
                  Add to watchlist
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="watchlist">
        <TabsList>
          <TabsTrigger value="watchlist" className="gap-2">
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" /> Watched counties
            {watchlist && <Badge variant="secondary" className="ml-1 text-xs tabular-nums">{watchlist.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <Bell className="w-3.5 h-3.5" aria-hidden="true" /> Alerts
            {unreadCount > 0 && <Badge variant="destructive" className="ml-1 text-xs tabular-nums">{unreadCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="watchlist" className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-12" role="status" aria-live="polite">
              <span className="sr-only">Loading watchlist…</span>
              <Loader2 className="animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : !watchlist?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <MapPin className="w-8 h-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">No counties on your watchlist yet.</p>
                <Button variant="outline" className="mt-3" onClick={() => setAddOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Watch a county
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3" aria-label="Watched counties">
              {watchlist.map(entry => {
                const label = `${entry.county} County, ${entry.state}`;
                return (
                  <li key={entry.id}>
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="min-w-0">
                            <div className="font-semibold flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-primary" aria-hidden="true" />
                              {label}
                            </div>
                            {entry.lastAlertAt && (
                              <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                                Last alert {relative(entry.lastAlertAt)}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => testMutation.mutate(entry.id)}
                              disabled={testMutation.isPending}
                              aria-label={`Send test alert for ${label}`}
                            >
                              <Send className="w-3 h-3 mr-1" aria-hidden="true" /> Test
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground"
                              onClick={() => setPendingRemove(entry)}
                              disabled={removeMutation.isPending}
                              aria-label={`Remove ${label} from watchlist`}
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                        <ul className="flex flex-wrap gap-1 mt-2" aria-label={`Active alerts for ${label}`}>
                          {entry.alertOnTaxDelinquent && <li><Badge variant="outline" className="text-xs">Tax delinq.</Badge></li>}
                          {entry.alertOnPriceDrop && <li><Badge variant="outline" className="text-xs tabular-nums">Price ↓{entry.priceDropThresholdPct}%</Badge></li>}
                          {entry.alertOnDemandIncrease && <li><Badge variant="outline" className="text-xs tabular-nums">Demand ≥{entry.demandScoreThreshold}</Badge></li>}
                          {entry.alertOnForeclosure && <li><Badge variant="outline" className="text-xs">Foreclosure</Badge></li>}
                          {entry.emailAlert && <li><Badge variant="secondary" className="text-xs">Email</Badge></li>}
                          {entry.pushAlert && <li><Badge variant="secondary" className="text-xs">Push</Badge></li>}
                        </ul>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        {/* Alerts Tab */}
        <TabsContent value="alerts" className="space-y-3">
          {unreadAlerts.length > 0 && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => markReadMutation.mutate(unreadAlerts.map(a => a.id))}
                disabled={markReadMutation.isPending}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Mark all read
              </Button>
            </div>
          )}

          {!alerts?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">No alerts yet. Watch counties to receive market alerts.</p>
              </CardContent>
            </Card>
          ) : (
            <ol className="space-y-3" aria-label="Market alerts, newest first">
              {alerts.map(alert => {
                const Icon = ALERT_TYPE_ICONS[alert.type] ?? BellRing;
                const isHighOrUnread = alert.severity === "high" || !alert.read;
                return (
                  <li key={alert.id}>
                    <Card
                      className={`border ${SEVERITY_COLORS[alert.severity]} ${alert.read ? "opacity-60" : ""}`}
                      role={alert.severity === "high" && !alert.read ? "alert" : undefined}
                    >
                      <CardContent className="pt-4 flex gap-3">
                        <Icon className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" aria-label={`Alert type: ${alert.type.replace(/_/g, " ")}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{alert.title}</span>
                            <Badge variant="outline" className="text-xs">{alert.county}, {alert.state}</Badge>
                            <Badge variant="outline" className="text-xs capitalize">{alert.type.replace(/_/g, " ")}</Badge>
                            {!alert.read && <span className="w-2 h-2 rounded-full bg-primary" aria-label="Unread" />}
                            <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                              {relative(alert.createdAt)}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{alert.summary}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(open) => { if (!open) setPendingRemove(null); }}
        title={`Remove ${pendingRemove ? `${pendingRemove.county} County, ${pendingRemove.state}` : ""} from watchlist?`}
        description={
          pendingRemove
            ? `Stops monitoring ${pendingRemove.county} County, ${pendingRemove.state}. You'll no longer receive alerts about new tax delinquencies, price drops, or foreclosures in this county. Past alerts stay in your alert history. Re-adding restarts monitoring.`
            : ""
        }
        confirmLabel="Yes, remove"
        variant="destructive"
        isLoading={removeMutation.isPending}
        onConfirm={() => pendingRemove && removeMutation.mutate(pendingRemove.id)}
      />
    </PageShell>
  );
}
