// @ts-nocheck
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, DollarSign, Clock, Activity, Star, BarChart2, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { useToast } from "@/hooks/use-toast";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function MarketplaceAnalytics() {
  const [period, setPeriod] = useState("30d");
  const [newBidCount, setNewBidCount] = useState(0);
  const { toast } = useToast();

  const { data: analyticsData, isLoading } = useQuery({
    queryKey: ["/api/marketplace/analytics", period],
  });

  const { data: listingsData } = useQuery({
    queryKey: ["/api/marketplace/listings/performance"],
  });

  const { data: myBidsData } = useQuery({
    queryKey: ["/api/marketplace/my/bids"],
    refetchInterval: 30000, // Poll every 30 seconds for real-time feel
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
    { label: "Total Volume", value: `$${((analytics.totalVolume || 0) / 1000000).toFixed(1)}M`, icon: DollarSign, color: "text-green-500" },
    { label: "Fees Collected", value: `$${((analytics.totalFees || 0) / 1000).toFixed(1)}K`, icon: TrendingUp, color: "text-blue-500" },
    { label: "Avg Days to Close", value: `${analytics.avgDaysToClose || 0}d`, icon: Clock, color: "text-orange-500" },
    { label: "Close Rate", value: `${analytics.closeRate || 0}%`, icon: Activity, color: "text-purple-500" },
    { label: "Active Listings", value: analytics.activeListings || 0, icon: BarChart2, color: "text-indigo-500" },
    { label: "Bids Placed", value: analytics.totalBids || 0, icon: Star, color: "text-yellow-500" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Marketplace Analytics
            {newBidCount > 0 && (
              <span className="relative">
                <Bell className="w-5 h-5 text-orange-500" />
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {newBidCount > 9 ? "9+" : newBidCount}
                </span>
              </span>
            )}
          </h1>
          <p className="text-muted-foreground">Transaction volume, fees, and performance insights</p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-32">
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {summaryCards.map((card, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <card.icon className={`h-5 w-5 ${card.color} mb-2`} />
              <div className="text-xl font-bold">{card.value}</div>
              <div className="text-xs text-muted-foreground">{card.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="volume">
        <TabsList>
          <TabsTrigger value="volume">Volume & Fees</TabsTrigger>
          <TabsTrigger value="listings">Listing Performance</TabsTrigger>
          <TabsTrigger value="investors">Investor Reputation</TabsTrigger>
          <TabsTrigger value="seller">Seller Analytics</TabsTrigger>
          <TabsTrigger value="buyer">Buyer Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="volume" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Monthly Transaction Volume</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={volumeChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: any) => `$${Number(v).toLocaleString()}`} />
                    <Bar dataKey="volume" fill="#6366f1" name="Volume" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Fees Collected</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={feeChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: any) => `$${Number(v).toLocaleString()}`} />
                    <Line type="monotone" dataKey="fees" stroke="#10b981" strokeWidth={2} name="Fees" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Close Rate by Month</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={closeRateChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="deals" fill="#6366f1" name="Deals" />
                    <Bar yAxisId="left" dataKey="bids" fill="#e5e7eb" name="Bids" />
                    <Line yAxisId="right" type="monotone" dataKey="closeRate" stroke="#f59e0b" strokeWidth={2} name="Close Rate %" dot />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Days-to-Close Velocity</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={velocityChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis unit="d" />
                    <Tooltip formatter={(v: any) => `${v} days`} />
                    <Area type="monotone" dataKey="avgDaysToClose" fill="#ddd6fe" stroke="#8b5cf6" strokeWidth={2} name="Avg Days to Close" />
                    <Line type="monotone" dataKey="avgDaysToClose" stroke="#8b5cf6" strokeWidth={2} name="Avg Days to Close" dot />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="listings" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Listing Performance Metrics</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Listing</TableHead>
                    <TableHead>Views</TableHead>
                    <TableHead>Bids</TableHead>
                    <TableHead>Conv. Rate</TableHead>
                    <TableHead>Avg Bid</TableHead>
                    <TableHead>Days Active</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listings.slice(0, 15).map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="font-medium">{l.title || l.address}</div>
                        <div className="text-xs text-muted-foreground">{l.county}, {l.state}</div>
                      </TableCell>
                      <TableCell>{l.views || 0}</TableCell>
                      <TableCell>{l.bidCount || 0}</TableCell>
                      <TableCell>
                        <Badge variant={l.conversionRate >= 0.1 ? "default" : "secondary"}>
                          {((l.conversionRate || 0) * 100).toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell>${((l.avgBid || 0) / 1000).toFixed(0)}K</TableCell>
                      <TableCell>{l.daysActive || 0}</TableCell>
                      <TableCell>
                        <Badge variant={l.status === "active" ? "default" : "secondary"}>{l.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {listings.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No listing data available
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="investors" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Investor Reputation Scores</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Investor</TableHead>
                    <TableHead>Verification</TableHead>
                    <TableHead>Deals Closed</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Response Rate</TableHead>
                    <TableHead>Reputation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(analytics.topInvestors || []).map((inv: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{inv.name}</TableCell>
                      <TableCell>
                        {inv.verified ? (
                          <Badge className="bg-green-100 text-green-700">✓ Verified</Badge>
                        ) : (
                          <Badge variant="secondary">Unverified</Badge>
                        )}
                      </TableCell>
                      <TableCell>{inv.dealsClosed || 0}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                          {(inv.rating || 0).toFixed(1)}
                        </div>
                      </TableCell>
                      <TableCell>{inv.responseRate || 0}%</TableCell>
                      <TableCell>
                        <Badge variant={inv.reputation >= 80 ? "default" : inv.reputation >= 50 ? "secondary" : "destructive"}>
                          {inv.reputation || 0}/100
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seller" className="mt-4">
          <Card>
            <CardHeader><CardTitle>My Listings Performance</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{analytics.myListings || 0}</div>
                  <div className="text-sm text-muted-foreground">Total Listings</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">${((analytics.myRevenue || 0) / 1000).toFixed(0)}K</div>
                  <div className="text-sm text-muted-foreground">Total Revenue</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{analytics.myAvgDaysToClose || 0}d</div>
                  <div className="text-sm text-muted-foreground">Avg Days to Close</div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                View detailed seller performance in the Listings page.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="buyer" className="mt-4">
          <Card>
            <CardHeader><CardTitle>My Buyer Activity</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{analytics.myBids || 0}</div>
                  <div className="text-sm text-muted-foreground">Bids Placed</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{analytics.myMatches || 0}</div>
                  <div className="text-sm text-muted-foreground">Property Matches</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{analytics.myWinRate || 0}%</div>
                  <div className="text-sm text-muted-foreground">Bid Win Rate</div>
                </div>
              </div>
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
