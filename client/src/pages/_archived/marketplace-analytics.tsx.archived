// @ts-nocheck
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, DollarSign, Clock, Activity, Star, BarChart2, Bell } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { chartColor } from "@/lib/chartPalette";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useId } from "react";
import { usd } from "@/lib/format";

export default function MarketplaceAnalytics() {
  useDocumentTitle("Marketplace analytics");
  const periodId = useId();
  const [period, setPeriod] = useState("30d");
  const [newBidCount, setNewBidCount] = useState(0);
  const { toast } = useToast();

  const { data: analyticsData } = useQuery({
    queryKey: ["/api/marketplace/analytics", period],
  });

  const { data: listingsData } = useQuery({
    queryKey: ["/api/marketplace/listings/performance"],
  });

  useQuery({
    queryKey: ["/api/marketplace/my/bids"],
    refetchInterval: 30000,
    onSuccess: (data: any) => {
      const pending = (data?.bids ?? []).filter((b: any) => b.status === "pending").length;
      if (pending > newBidCount && newBidCount > 0) {
        toast({ title: "New bid activity", description: `You have ${pending} pending bids.` });
      }
      setNewBidCount(pending);
    },
  });

  const analytics = analyticsData?.analytics || {};
  const volumeChart = analytics.volumeByMonth || [];
  const feeChart = analytics.feesCollected || [];
  const closeRateChart = (analytics.volumeByMonth || []).map((m: any) => ({
    month: m.month,
    deals: m.deals ?? 0,
    bids: m.bids ?? 0,
    closeRate: m.bids > 0 ? Math.round((m.deals / m.bids) * 100) : 0,
  }));
  const velocityChart = (analytics.velocityData || analytics.volumeByMonth || []).map((m: any) => ({
    month: m.month,
    avgDaysToClose: m.avgDaysToClose ?? m.daysToClose ?? 0,
  }));
  const listings = listingsData?.listings || [];

  const summaryCards = [
    { label: "Total volume", value: `$${((analytics.totalVolume || 0) / 1000000).toFixed(1)}M`, icon: DollarSign, color: "text-acr-pos" },
    { label: "Fees collected", value: `$${((analytics.totalFees || 0) / 1000).toFixed(1)}K`, icon: TrendingUp, color: "text-acr-accent" },
    { label: "Avg days to close", value: `${analytics.avgDaysToClose || 0}d`, icon: Clock, color: "text-acr-warn" },
    { label: "Close rate", value: `${analytics.closeRate || 0}%`, icon: Activity, color: "text-acr-brand" },
    { label: "Active listings", value: analytics.activeListings || 0, icon: BarChart2, color: "text-acr-accent" },
    { label: "Bids placed", value: analytics.totalBids || 0, icon: Star, color: "text-acr-warn" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Marketplace analytics
            {newBidCount > 0 && (
              <span className="relative" aria-label={`${newBidCount} pending bids`}>
                <Bell className="w-5 h-5 text-acr-warn" aria-hidden="true" />
                <span className="absolute -top-1 -right-1 bg-acr-neg text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold tabular-nums">
                  {newBidCount > 9 ? "9+" : newBidCount}
                </span>
              </span>
            )}
          </h1>
          <p className="text-muted-foreground">Transaction volume, fees, and performance insights.</p>
        </div>
        <div>
          <Label htmlFor={periodId} className="sr-only">Reporting period</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger id={periodId} className="w-32" aria-label="Reporting period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {summaryCards.map((card, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <card.icon className={`h-5 w-5 ${card.color} mb-2`} aria-hidden="true" />
              <dd className="text-xl font-bold tabular-nums">{card.value}</dd>
              <dt className="text-xs text-muted-foreground">{card.label}</dt>
            </CardContent>
          </Card>
        ))}
      </dl>

      <Tabs defaultValue="volume">
        <TabsList>
          <TabsTrigger value="volume">Volume &amp; fees</TabsTrigger>
          <TabsTrigger value="listings">Listing performance</TabsTrigger>
          <TabsTrigger value="investors">Investor reputation</TabsTrigger>
          <TabsTrigger value="seller">Seller analytics</TabsTrigger>
          <TabsTrigger value="buyer">Buyer analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="volume" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Monthly transaction volume</CardTitle></CardHeader>
              <CardContent>
                <div role="img" aria-label={`Monthly transaction volume across ${volumeChart.length} months`}>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={volumeChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                      <Tooltip formatter={(v: any) => usd(Number(v))} />
                      <Bar dataKey="volume" fill={chartColor(0)} name="Volume" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Fees collected</CardTitle></CardHeader>
              <CardContent>
                <div role="img" aria-label={`Fees collected across ${feeChart.length} months`}>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={feeChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                      <Tooltip formatter={(v: any) => usd(Number(v))} />
                      <Line type="monotone" dataKey="fees" stroke={chartColor(1)} strokeWidth={2} name="Fees" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Close rate by month</CardTitle></CardHeader>
              <CardContent>
                <div role="img" aria-label={`Deal close rate by month: deals vs bids and percent close`}>
                  <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={closeRateChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="deals" fill={chartColor(0)} name="Deals" />
                      <Bar yAxisId="left" dataKey="bids" fill={chartColor(2)} name="Bids" />
                      <Line yAxisId="right" type="monotone" dataKey="closeRate" stroke={chartColor(3)} strokeWidth={2} name="Close rate %" dot />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Days-to-close velocity</CardTitle></CardHeader>
              <CardContent>
                <div role="img" aria-label="Average days from listing to close, monthly">
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={velocityChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis unit="d" />
                      <Tooltip formatter={(v: any) => `${v} days`} />
                      <Area type="monotone" dataKey="avgDaysToClose" fill={chartColor(4)} stroke={chartColor(5)} strokeWidth={2} name="Avg days to close" />
                      <Line type="monotone" dataKey="avgDaysToClose" stroke={chartColor(5)} strokeWidth={2} name="Avg days to close" dot />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="listings" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Listing performance metrics</CardTitle></CardHeader>
            <CardContent>
              <div role="region" aria-label="Listing performance metrics" tabIndex={0}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Listing</TableHead>
                      <TableHead scope="col">Views</TableHead>
                      <TableHead scope="col">Bids</TableHead>
                      <TableHead scope="col">Conv. rate</TableHead>
                      <TableHead scope="col">Avg bid</TableHead>
                      <TableHead scope="col">Days active</TableHead>
                      <TableHead scope="col">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listings.slice(0, 15).map((l: any) => (
                      <TableRow key={l.id}>
                        <th scope="row" className="px-4 text-left">
                          <div className="font-medium">{l.title || l.address}</div>
                          <div className="text-xs text-muted-foreground">{l.county}, {l.state}</div>
                        </th>
                        <TableCell className="tabular-nums">{l.views || 0}</TableCell>
                        <TableCell className="tabular-nums">{l.bidCount || 0}</TableCell>
                        <TableCell>
                          <Badge variant={l.conversionRate >= 0.1 ? "default" : "secondary"} className="tabular-nums">
                            {((l.conversionRate || 0) * 100).toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">{usd(l.avgBid || 0, { noCents: true })}</TableCell>
                        <TableCell className="tabular-nums">{l.daysActive || 0}</TableCell>
                        <TableCell>
                          <Badge variant={l.status === "active" ? "default" : "secondary"} className="capitalize">{l.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {listings.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No listing data available.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="investors" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Investor reputation scores</CardTitle></CardHeader>
            <CardContent>
              <div role="region" aria-label="Top investors by reputation" tabIndex={0}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Investor</TableHead>
                      <TableHead scope="col">Verification</TableHead>
                      <TableHead scope="col">Deals closed</TableHead>
                      <TableHead scope="col">Rating</TableHead>
                      <TableHead scope="col">Response rate</TableHead>
                      <TableHead scope="col">Reputation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(analytics.topInvestors || []).map((inv: any, i: number) => (
                      <TableRow key={i}>
                        <th scope="row" className="font-medium px-4 text-left">{inv.name}</th>
                        <TableCell>
                          {inv.verified ? (
                            <Badge className="bg-acr-pos-soft text-acr-pos" aria-label="Verified investor">
                              <span aria-hidden="true">✓</span> Verified
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Unverified</Badge>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">{inv.dealsClosed || 0}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1" aria-label={`Rating ${(inv.rating || 0).toFixed(1)} of 5`}>
                            <Star className="h-3 w-3 text-acr-warn fill-acr-warn" aria-hidden="true" />
                            <span className="tabular-nums">{(inv.rating || 0).toFixed(1)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">{inv.responseRate || 0}%</TableCell>
                        <TableCell>
                          <Badge
                            variant={inv.reputation >= 80 ? "default" : inv.reputation >= 50 ? "secondary" : "destructive"}
                            className="tabular-nums"
                            aria-label={`Reputation ${inv.reputation || 0} of 100`}
                          >
                            {inv.reputation || 0}/100
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seller" className="mt-4">
          <Card>
            <CardHeader><CardTitle>My listings performance</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-muted rounded-card">
                  <dd className="text-2xl font-bold tabular-nums">{analytics.myListings || 0}</dd>
                  <dt className="text-sm text-muted-foreground">Total listings</dt>
                </div>
                <div className="text-center p-4 bg-muted rounded-card">
                  <dd className="text-2xl font-bold tabular-nums">{usd(analytics.myRevenue || 0, { noCents: true })}</dd>
                  <dt className="text-sm text-muted-foreground">Total revenue</dt>
                </div>
                <div className="text-center p-4 bg-muted rounded-card">
                  <dd className="text-2xl font-bold tabular-nums">{analytics.myAvgDaysToClose || 0}d</dd>
                  <dt className="text-sm text-muted-foreground">Avg days to close</dt>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground text-center">
                View detailed seller performance in the Listings page.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="buyer" className="mt-4">
          <Card>
            <CardHeader><CardTitle>My buyer activity</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-muted rounded-card">
                  <dd className="text-2xl font-bold tabular-nums">{analytics.myBids || 0}</dd>
                  <dt className="text-sm text-muted-foreground">Bids placed</dt>
                </div>
                <div className="text-center p-4 bg-muted rounded-card">
                  <dd className="text-2xl font-bold tabular-nums">{analytics.myMatches || 0}</dd>
                  <dt className="text-sm text-muted-foreground">Property matches</dt>
                </div>
                <div className="text-center p-4 bg-muted rounded-card">
                  <dd className="text-2xl font-bold tabular-nums">{analytics.myWinRate || 0}%</dd>
                  <dt className="text-sm text-muted-foreground">Bid win rate</dt>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground text-center">
                View all your bid activity in the Marketplace page.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
