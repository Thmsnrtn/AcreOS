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
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";

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

const SEVERITY_COLORS = {
  low: "border-blue-200 bg-blue-50/50 dark:bg-blue-900/10",
  medium: "border-yellow-200 bg-yellow-50/50 dark:bg-yellow-900/10",
  high: "border-red-200 bg-red-50/50 dark:bg-red-900/10",
};

const US_STATES = [
  "AL","AR","AZ","CA","CO","CT","DE","FL","GA","IA","ID","IL","IN","KS","KY",
  "LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM",
  "NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA",
  "WI","WV","WY",
];

export default function MarketWatchlistPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
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
    mutationFn: () => apiRequest("/api/market/watchlist", { method: "POST", body: JSON.stringify(newEntry) }),
    onSuccess: () => {
      toast({ title: `${newEntry.county}, ${newEntry.state} added to watchlist` });
      setAddOpen(false);
      setNewEntry(prev => ({ ...prev, county: "" }));
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/market/watchlist/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Removed from watchlist" });
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/market/watchlist/${id}/test`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Test alert sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist/unread"] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (alertIds: string[]) =>
      apiRequest("/api/market/watchlist/alerts/read", { method: "POST", body: JSON.stringify({ alertIds }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/watchlist/unread"] });
    },
  });

  const unreadCount = unreadData?.count ?? 0;
  const unreadAlerts = alerts?.filter(a => !a.read) ?? [];

  return (
    <PageShell>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Eye className="w-6 h-6 text-primary" /> Market Watchlist
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Monitor counties for deal opportunities, price drops, and tax delinquency events.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-1" /> Watch County</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add County to Watchlist</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Select value={newEntry.state} onValueChange={v => setNewEntry(e => ({ ...e, state: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>County</Label>
                  <Input
                    placeholder="e.g. Travis"
                    value={newEntry.county}
                    onChange={e => setNewEntry(prev => ({ ...prev, county: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Alert Triggers</Label>
                {[
                  { key: "alertOnTaxDelinquent", label: "New tax delinquent parcels" },
                  { key: "alertOnPriceDrop", label: `Price drop ≥ ${newEntry.priceDropThresholdPct}%` },
                  { key: "alertOnDemandIncrease", label: `Demand score ≥ ${newEntry.demandScoreThreshold}` },
                  { key: "alertOnForeclosure", label: "Foreclosure filings" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Switch
                      checked={(newEntry as any)[key]}
                      onCheckedChange={v => setNewEntry(e => ({ ...e, [key]: v }))}
                    />
                    <span className="text-sm">{label}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Notification Channels</Label>
                {[
                  { key: "emailAlert", label: "Email alerts" },
                  { key: "pushAlert", label: "Push notifications" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Switch
                      checked={(newEntry as any)[key]}
                      onCheckedChange={v => setNewEntry(e => ({ ...e, [key]: v }))}
                    />
                    <span className="text-sm">{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                onClick={() => addMutation.mutate()}
                disabled={!newEntry.county || addMutation.isPending}
              >
                {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Add to Watchlist
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="watchlist">
        <TabsList>
          <TabsTrigger value="watchlist" className="gap-2">
            <MapPin className="w-3.5 h-3.5" /> Watched Counties
            {watchlist && <Badge variant="secondary" className="ml-1 text-xs">{watchlist.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <Bell className="w-3.5 h-3.5" /> Alerts
            {unreadCount > 0 && <Badge variant="destructive" className="ml-1 text-xs">{unreadCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* Watchlist Tab */}
        <TabsContent value="watchlist" className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
          ) : !watchlist?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <MapPin className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No counties on your watchlist yet.</p>
                <Button variant="outline" className="mt-3" onClick={() => setAddOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Watch a County
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {watchlist.map(entry => (
                <Card key={entry.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-primary" />
                          {entry.county} County, {entry.state}
                        </div>
                        {entry.lastAlertAt && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Last alert {formatDistanceToNow(new Date(entry.lastAlertAt), { addSuffix: true })}
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
                        >
                          Test
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground"
                          onClick={() => removeMutation.mutate(entry.id)}
                          disabled={removeMutation.isPending}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {entry.alertOnTaxDelinquent && <Badge variant="outline" className="text-xs">Tax Delinq.</Badge>}
                      {entry.alertOnPriceDrop && <Badge variant="outline" className="text-xs">Price ↓{entry.priceDropThresholdPct}%</Badge>}
                      {entry.alertOnDemandIncrease && <Badge variant="outline" className="text-xs">Demand ≥{entry.demandScoreThreshold}</Badge>}
                      {entry.alertOnForeclosure && <Badge variant="outline" className="text-xs">Foreclosure</Badge>}
                      {entry.emailAlert && <Badge variant="secondary" className="text-xs">Email</Badge>}
                      {entry.pushAlert && <Badge variant="secondary" className="text-xs">Push</Badge>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
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
                <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No alerts yet. Watch counties to receive market alerts.</p>
              </CardContent>
            </Card>
          ) : (
            alerts.map(alert => {
              const Icon = ALERT_TYPE_ICONS[alert.type] ?? BellRing;
              return (
                <Card key={alert.id} className={`border ${SEVERITY_COLORS[alert.severity]} ${alert.read ? "opacity-60" : ""}`}>
                  <CardContent className="pt-4 flex gap-3">
                    <Icon className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{alert.title}</span>
                        <Badge variant="outline" className="text-xs">{alert.county}, {alert.state}</Badge>
                        <Badge variant="outline" className="text-xs">{alert.type.replace("_", " ")}</Badge>
                        {!alert.read && <div className="w-2 h-2 rounded-full bg-primary" />}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{alert.summary}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
