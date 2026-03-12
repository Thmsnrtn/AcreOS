// @ts-nocheck
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, MapPin, Bell, TrendingUp, TrendingDown, Minus, Search, Star, RefreshCw, BarChart3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

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
    <div className="space-y-3">
      {matches.slice(0, 10).map((m: any, idx: number) => (
        <Card key={idx}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-sm">{m.listingTitle ?? `Listing #${m.listingId}`}</p>
              <Badge className="bg-blue-100 text-blue-800">{m.buyers?.length ?? 0} matches</Badge>
            </div>
            <div className="space-y-2">
              {(m.buyers ?? []).slice(0, 5).map((b: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{b.orgName ?? b.name ?? "Buyer"}</span>
                    {b.investorType && <Badge variant="outline" className="text-xs">{b.investorType}</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, b.score ?? b.matchScore ?? 0)}%` }} />
                    </div>
                    <span className="text-xs font-medium w-8 text-right">{b.score ?? b.matchScore ?? 0}%</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
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
    { key: "newListings" as const, label: "New Matching Listings", desc: "When a new listing matches your buy box" },
    { key: "priceDrops" as const, label: "Price Drops", desc: "When listing prices are reduced" },
    { key: "newBids" as const, label: "New Bids on My Listings", desc: "When someone places a bid on your listing" },
    { key: "dealRoomActivity" as const, label: "Deal Room Activity", desc: "Messages, documents, and changes" },
    { key: "weeklyDigest" as const, label: "Weekly Market Digest", desc: "Summary of market activity every Monday" },
    { key: "pushEnabled" as const, label: "Push Notifications (Mobile)", desc: "Push notifications on your mobile device" },
  ];

  return (
    <div className="space-y-4 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Preferences</CardTitle>
          <CardDescription>Control which marketplace events trigger notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {prefsList.map(({ key, label, desc }) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch checked={prefs[key]} onCheckedChange={() => setPrefs(p => ({ ...p, [key]: !p[key] }))} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Button onClick={() => toast({ title: "Preferences saved", description: "Your notification settings have been updated." })}>
        Save Preferences
      </Button>
    </div>
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
  const [stateFilter, setStateFilter] = useState("TX");
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Buyer Intelligence Network</h1>
          <p className="text-muted-foreground">Real-time buyer demand data and geographic insights</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries()}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{analytics.totalBuyers || 0}</div>
                <div className="text-sm text-muted-foreground">Active Buyers</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <MapPin className="h-8 w-8 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{analytics.hotMarkets || 0}</div>
                <div className="text-sm text-muted-foreground">Hot Markets</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-purple-500" />
              <div>
                <div className="text-2xl font-bold">{analytics.avgMatchScore || 0}%</div>
                <div className="text-sm text-muted-foreground">Avg Match Score</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Bell className="h-8 w-8 text-orange-500" />
              <div>
                <div className="text-2xl font-bold">{analytics.activeAlerts || 0}</div>
                <div className="text-sm text-muted-foreground">Active Alerts</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="demand">
        <TabsList>
          <TabsTrigger value="demand">Demand Heatmap</TabsTrigger>
          <TabsTrigger value="buyers">Buyer Profiles</TabsTrigger>
          <TabsTrigger value="matches">Match Scores</TabsTrigger>
          <TabsTrigger value="alerts">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="demand" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>County Demand Index</CardTitle>
                <Select value={stateFilter} onValueChange={setStateFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["TX", "FL", "GA", "NC", "TN", "AL", "MS", "AR", "OK", "MO"].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {/* Demand legend */}
              <div className="flex gap-3 flex-wrap text-xs mb-3">
                {[
                  { label: "Very High (80+)", color: "#ef4444" },
                  { label: "High (60-79)", color: "#f97316" },
                  { label: "Medium (40-59)", color: "#eab308" },
                  { label: "Low (20-39)", color: "#60a5fa" },
                  { label: "Very Low (<20)", color: "#9ca3af" },
                ].map(item => (
                  <span key={item.label} className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: item.color }} />
                    {item.label}
                  </span>
                ))}
              </div>
              {demandChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={demandChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="county" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="demand" name="Demand Score">
                      {demandChartData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Bar>
                    <Bar dataKey="buyers" fill="#10b981" name="Active Buyers" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  {isLoading ? "Loading demand data..." : `No demand data available for ${stateFilter}`}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Demand Table */}
          <Card>
            <CardHeader><CardTitle>Top Counties by Demand</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>County</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Demand Score</TableHead>
                    <TableHead>Active Buyers</TableHead>
                    <TableHead>Avg Budget</TableHead>
                    <TableHead>Top Property Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {heatmap.slice(0, 10).map((c: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{c.county}</TableCell>
                      <TableCell>{c.state}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-muted rounded-full h-2">
                            <div className="bg-primary h-2 rounded-full" style={{ width: `${c.demandScore}%` }} />
                          </div>
                          <span className="text-sm">{c.demandScore}</span>
                        </div>
                      </TableCell>
                      <TableCell>{c.activeBuyers || 0}</TableCell>
                      <TableCell>${((c.avgBudget || 0) / 1000).toFixed(0)}K</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{c.topPropertyType || "Raw Land"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="buyers" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Buyer Profiles</CardTitle>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search buyers..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-9 w-64"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Preferred States</TableHead>
                    <TableHead>Budget Range</TableHead>
                    <TableHead>Acreage Preference</TableHead>
                    <TableHead>Activity Score</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBuyers.slice(0, 20).map((b: any) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.name || "Anonymous"}</div>
                        <div className="text-xs text-muted-foreground">{b.email}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {(b.preferredStates || []).slice(0, 3).map((s: string) => (
                            <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        ${((b.minBudget || 0) / 1000).toFixed(0)}K – ${((b.maxBudget || 0) / 1000).toFixed(0)}K
                      </TableCell>
                      <TableCell>
                        {b.minAcreage || 0} – {b.maxAcreage || "∞"} ac
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                          <span className="text-sm">{b.activityScore || 0}</span>
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
                        No buyers found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
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
