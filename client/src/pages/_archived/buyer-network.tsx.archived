// @ts-nocheck
import { useState, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, MapPin, Bell, TrendingUp, Search, Star, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { usd } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

import { chartColor } from "@/lib/chartPalette";
// ─── Match Score Panel ────────────────────────────────────────────────────────
function MatchScoreSection({ matches }: { matches: any[] }) {
  if (!matches || matches.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          No property matches yet. Add listings to see matched buyers.
        </CardContent>
      </Card>
    );
  }
  return (
    <ul className="space-y-3" aria-label="Listings with matched buyers">
      {matches.slice(0, 10).map((m: any, idx: number) => (
        <li key={idx}>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <p className="font-semibold text-sm">{m.listingTitle ?? `Listing #${m.listingId}`}</p>
                <Badge className="bg-acr-brand-soft text-acr-brand border-transparent tabular-nums">{m.buyers?.length ?? 0} matches</Badge>
              </div>
              <ul className="space-y-2" aria-label={`Top buyers for ${m.listingTitle ?? `listing ${m.listingId}`}`}>
                {(m.buyers ?? []).slice(0, 5).map((b: any, i: number) => {
                  const score = b.score ?? b.matchScore ?? 0;
                  const buyerName = b.orgName ?? b.name ?? "Buyer";
                  return (
                    <li key={i} className="flex items-center justify-between text-sm gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                        <span>{buyerName}</span>
                        {b.investorType && <Badge variant="outline" className="text-xs">{b.investorType}</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-24 h-2 bg-acr-surface-2 rounded-full overflow-hidden"
                          role="progressbar"
                          aria-valuenow={Math.round(score)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${buyerName} match score ${Math.round(score)}%`}
                        >
                          <div className="h-full bg-acr-pos rounded-full" style={{ width: `${Math.min(100, score)}%` }} />
                        </div>
                        <span className="text-xs font-medium w-8 text-right tabular-nums">{score}%</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// ─── Notification Preferences ─────────────────────────────────────────────────
function NotificationPrefsSection() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState({
    newListings: true,
    priceDrops: true,
    newBids: true,
    dealRoomActivity: true,
    weeklyDigest: false,
    pushEnabled: false,
  });

  const prefsList = [
    { key: "newListings" as const, label: "New matching listings", desc: "When a new listing matches your buy box." },
    { key: "priceDrops" as const, label: "Price drops", desc: "When listing prices are reduced." },
    { key: "newBids" as const, label: "New bids on my listings", desc: "When someone places a bid on your listing." },
    { key: "dealRoomActivity" as const, label: "Deal room activity", desc: "Messages, documents, and changes." },
    { key: "weeklyDigest" as const, label: "Weekly market digest", desc: "Summary of market activity every Monday." },
    { key: "pushEnabled" as const, label: "Push notifications (mobile)", desc: "Push notifications on your mobile device." },
  ];

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); toast({ title: "Preferences saved", description: "Your notification settings have been updated." }); }}
      className="space-y-4 max-w-xl"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification preferences</CardTitle>
          <CardDescription>Control which marketplace events trigger notifications.</CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset>
            <legend className="sr-only">Notification preferences</legend>
            <ul className="space-y-4" aria-label="Notification preferences">
              {prefsList.map(({ key, label, desc }) => {
                const switchId = `pref-${key}`;
                return (
                  <li key={key} className="flex items-start justify-between gap-4">
                    <div>
                      <Label htmlFor={switchId} className="text-sm font-medium cursor-pointer">{label}</Label>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch
                      id={switchId}
                      checked={prefs[key]}
                      onCheckedChange={() => setPrefs(p => ({ ...p, [key]: !p[key] }))}
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </CardContent>
      </Card>
      <Button type="submit">
        Save preferences
      </Button>
    </form>
  );
}

function demandColor(score: number) {
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f97316";
  if (score >= 40) return "#eab308";
  if (score >= 20) return "#60a5fa";
  return "#9ca3af";
}

export default function BuyerNetwork() {
  useDocumentTitle("Buyer network");
  const stateSelectId = useId();
  const buyerSearchId = useId();
  const [stateFilter, setStateFilter] = useState("TX");
  const [searchTerm, setSearchTerm] = useState("");
  const qc = useQueryClient();

  const { data: networkData, isLoading } = useQuery({
    queryKey: ["/api/buyer-network/analytics"],
  });

  const { data: buyersData } = useQuery({
    queryKey: ["/api/buyer-network/buyers"],
  });

  const { data: heatmapData } = useQuery({
    queryKey: ["/api/buyer-network/demand", stateFilter],
    queryFn: () => apiRequest(`/api/buyer-network/demand/${stateFilter}`),
  });

  const { data: matchData } = useQuery({
    queryKey: ["/api/marketplace/matches"],
  });

  const buyers = buyersData?.buyers || [];
  const analytics = networkData?.analytics || {};
  const heatmap = heatmapData?.data || [];
  const matches = matchData?.matches || [];

  const filteredBuyers = buyers.filter((b: any) =>
    b.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.preferredStates?.some((s: string) => s.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const demandChartData = heatmap.slice(0, 10).map((c: any) => ({
    county: c.county,
    demand: c.demandScore,
    buyers: c.activeBuyers,
    fill: demandColor(c.demandScore),
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Buyer intelligence network</h1>
          <p className="text-muted-foreground">Real-time buyer demand data and geographic insights.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries()} aria-label="Refresh buyer network data">
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" /> Refresh
        </Button>
      </div>

      <dl className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-acr-brand" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{analytics.totalBuyers || 0}</dd>
                <dt className="text-sm text-muted-foreground">Active buyers</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <MapPin className="h-8 w-8 text-acr-pos" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{analytics.hotMarkets || 0}</dd>
                <dt className="text-sm text-muted-foreground">Hot markets</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-acr-accent" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{analytics.avgMatchScore || 0}%</dd>
                <dt className="text-sm text-muted-foreground">Avg match score</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Bell className="h-8 w-8 text-acr-warn" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{analytics.activeAlerts || 0}</dd>
                <dt className="text-sm text-muted-foreground">Active alerts</dt>
              </div>
            </div>
          </CardContent>
        </Card>
      </dl>

      <Tabs defaultValue="demand">
        <TabsList>
          <TabsTrigger value="demand">Demand heatmap</TabsTrigger>
          <TabsTrigger value="buyers">Buyer profiles</TabsTrigger>
          <TabsTrigger value="matches">Match scores</TabsTrigger>
          <TabsTrigger value="alerts">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="demand" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle>County demand index</CardTitle>
                <div>
                  <Label htmlFor={stateSelectId} className="sr-only">State filter</Label>
                  <Select value={stateFilter} onValueChange={setStateFilter}>
                    <SelectTrigger id={stateSelectId} className="w-32" aria-label="State filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["TX", "FL", "GA", "NC", "TN", "AL", "MS", "AR", "OK", "MO"].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="flex gap-3 flex-wrap text-xs mb-3" aria-label="Demand score legend">
                {[
                  { label: "Very high (80+)", color: "#ef4444" },
                  { label: "High (60–79)", color: "#f97316" },
                  { label: "Medium (40–59)", color: "#eab308" },
                  { label: "Low (20–39)", color: "#60a5fa" },
                  { label: "Very low (<20)", color: "#9ca3af" },
                ].map(item => (
                  <li key={item.label} className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
                    {item.label}
                  </li>
                ))}
              </ul>
              {demandChartData.length > 0 ? (
                <div role="img" aria-label={`County demand index for ${stateFilter}, top 10 counties`}>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={demandChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="county" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="demand" name="Demand score">
                        {demandChartData.map((entry, index) => (
                          <Cell key={index} fill={entry.fill} />
                        ))}
                      </Bar>
                      <Bar dataKey="buyers" fill={chartColor(0)} name="Active buyers" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground" role="status" aria-live="polite">
                  {isLoading ? "Loading demand data…" : `No demand data available for ${stateFilter}.`}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Top counties by demand</CardTitle></CardHeader>
            <CardContent>
              <div role="region" aria-label="Top counties by demand" tabIndex={0}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">County</TableHead>
                      <TableHead scope="col">State</TableHead>
                      <TableHead scope="col">Demand score</TableHead>
                      <TableHead scope="col">Active buyers</TableHead>
                      <TableHead scope="col">Avg budget</TableHead>
                      <TableHead scope="col">Top property type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {heatmap.slice(0, 10).map((c: any, i: number) => (
                      <TableRow key={i}>
                        <th scope="row" className="font-medium px-4 text-left">{c.county}</th>
                        <TableCell>{c.state}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-16 bg-muted rounded-full h-2"
                              role="progressbar"
                              aria-valuenow={c.demandScore}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${c.county} demand score ${c.demandScore}`}
                            >
                              <div className="bg-primary h-2 rounded-full" style={{ width: `${c.demandScore}%` }} />
                            </div>
                            <span className="text-sm tabular-nums">{c.demandScore}</span>
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">{c.activeBuyers || 0}</TableCell>
                        <TableCell className="tabular-nums">{usd(c.avgBudget || 0, { noCents: true })}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{c.topPropertyType || "Raw land"}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="buyers" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle>Buyer profiles</CardTitle>
                <div className="relative">
                  <Label htmlFor={buyerSearchId} className="sr-only">Search buyers</Label>
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id={buyerSearchId}
                    type="search"
                    placeholder="Search buyers…"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-9 w-64"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div role="region" aria-label="Buyer profiles" tabIndex={0}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Buyer</TableHead>
                      <TableHead scope="col">Preferred states</TableHead>
                      <TableHead scope="col">Budget range</TableHead>
                      <TableHead scope="col">Acreage preference</TableHead>
                      <TableHead scope="col">Activity score</TableHead>
                      <TableHead scope="col">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBuyers.slice(0, 20).map((b: any) => (
                      <TableRow key={b.id}>
                        <th scope="row" className="px-4 text-left">
                          <div className="font-medium">{b.name || "Anonymous"}</div>
                          <div className="text-xs text-muted-foreground">{b.email}</div>
                        </th>
                        <TableCell>
                          <ul className="flex gap-1 flex-wrap" aria-label={`${b.name || "Buyer"} preferred states`}>
                            {(b.preferredStates || []).slice(0, 3).map((s: string) => (
                              <li key={s}><Badge variant="outline" className="text-xs">{s}</Badge></li>
                            ))}
                          </ul>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {usd(b.minBudget || 0, { noCents: true })} – {usd(b.maxBudget || 0, { noCents: true })}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {b.minAcreage || 0} – {b.maxAcreage || "∞"} ac
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1" aria-label={`Activity score ${b.activityScore || 0}`}>
                            <Star className="h-3 w-3 text-acr-warn fill-acr-warn" aria-hidden="true" />
                            <span className="text-sm tabular-nums">{b.activityScore || 0}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={b.isActive ? "default" : "secondary"}>
                            {b.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredBuyers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No buyers found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="matches" className="mt-4">
          <MatchScoreSection matches={matches} />
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <NotificationPrefsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
