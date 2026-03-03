import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Search, Bell, BookmarkPlus, Calendar, DollarSign, MapPin, Gavel, ArrowRight, Star } from "lucide-react";

function fmt(n: number) {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export default function TaxResearcherPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [scanState, setScanState] = useState("");
  const [auctionFilters, setAuctionFilters] = useState({ state: "", county: "" });

  const { data: auctionsData, isLoading: auctionsLoading } = useQuery({
    queryKey: ["/api/tax-researcher/auctions", auctionFilters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (auctionFilters.state) params.set("state", auctionFilters.state);
      if (auctionFilters.county) params.set("county", auctionFilters.county);
      const res = await fetch(`/api/tax-researcher/auctions?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: alertsData } = useQuery({
    queryKey: ["/api/tax-researcher/alerts"],
    queryFn: async () => {
      const res = await fetch("/api/tax-researcher/alerts", { credentials: "include" });
      return res.json();
    },
  });

  const { data: watchlistData } = useQuery({
    queryKey: ["/api/tax-researcher/watchlist"],
    queryFn: async () => {
      const res = await fetch("/api/tax-researcher/watchlist", { credentials: "include" });
      return res.json();
    },
  });

  const { data: delinquentData } = useQuery({
    queryKey: ["/api/tax-researcher/delinquent"],
    queryFn: async () => {
      const res = await fetch("/api/tax-researcher/delinquent", { credentials: "include" });
      return res.json();
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tax-researcher/scan", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: scanState }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Scan complete", description: `Auction calendar scanned for ${scanState}` });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auctions"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addWatchlistMutation = useMutation({
    mutationFn: async (listingId: number) => {
      const res = await fetch("/api/tax-researcher/watchlist", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Added to watchlist" });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/watchlist"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const surfaceToRadarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tax-researcher/surface-to-radar", {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (data) => toast({ title: "Pushed to Acquisition Radar", description: `${data.result?.count ?? "Several"} opportunities surfaced` }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const auctions = auctionsData?.auctions ?? [];
  const alerts = alertsData?.alerts ?? [];
  const watchlist = watchlistData?.watchlist ?? [];
  const delinquent = delinquentData?.properties ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gavel className="w-7 h-7 text-primary" /> Tax Researcher
        </h1>
        <p className="text-muted-foreground mt-1">
          Tax lien auctions, delinquent property tracking, and automated sale alerts
        </p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-2 items-end">
          <div>
            <Label className="text-xs">Scan State</Label>
            <Input className="w-24" placeholder="TX" maxLength={2} value={scanState}
              onChange={e => setScanState(e.target.value.toUpperCase())} />
          </div>
          <Button variant="outline" onClick={() => scanMutation.mutate()} disabled={!scanState || scanMutation.isPending}>
            <Search className="w-4 h-4 mr-1" />
            {scanMutation.isPending ? "Scanning…" : "Scan Calendar"}
          </Button>
        </div>
        <Button variant="outline" onClick={() => surfaceToRadarMutation.mutate()}
          disabled={surfaceToRadarMutation.isPending}>
          <ArrowRight className="w-4 h-4 mr-1" />
          {surfaceToRadarMutation.isPending ? "Pushing…" : "Surface to Radar"}
        </Button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Upcoming Auctions</p>
          <p className="text-2xl font-bold">{auctions.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Active Alerts</p>
          <p className="text-2xl font-bold text-orange-600">{alerts.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Watchlist Items</p>
          <p className="text-2xl font-bold text-blue-600">{watchlist.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Delinquent Props</p>
          <p className="text-2xl font-bold text-yellow-600">{delinquent.length}</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="auctions">
        <TabsList>
          <TabsTrigger value="auctions">Auctions</TabsTrigger>
          <TabsTrigger value="delinquent">Delinquent Props</TabsTrigger>
          <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>

        {/* Auctions */}
        <TabsContent value="auctions" className="mt-4 space-y-4">
          <div className="flex gap-3 items-end">
            <div>
              <Label className="text-xs">Filter State</Label>
              <Input className="w-20" placeholder="TX" maxLength={2} value={auctionFilters.state}
                onChange={e => setAuctionFilters(f => ({ ...f, state: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <Label className="text-xs">Filter County</Label>
              <Input className="w-36" placeholder="Travis" value={auctionFilters.county}
                onChange={e => setAuctionFilters(f => ({ ...f, county: e.target.value }))} />
            </div>
          </div>

          {auctionsLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted/50 rounded-lg animate-pulse" />)}</div>
          ) : auctions.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Gavel className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">No auctions found. Scan a state to populate data.</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {auctions.map((auction: any) => (
                <Card key={auction.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{auction.name ?? `${auction.county} County Tax Sale`}</p>
                          <Badge variant="outline">{auction.state}</Badge>
                          <Badge variant="secondary">{auction.auctionType?.replace(/_/g, " ")}</Badge>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <MapPin className="w-3 h-3" />{auction.county}, {auction.state}
                        </div>
                      </div>
                      <div className="text-right text-xs">
                        <div className="flex items-center gap-1 text-orange-600 font-medium">
                          <Calendar className="w-3 h-3" />
                          {auction.auctionDate ? new Date(auction.auctionDate).toLocaleDateString() : "TBD"}
                        </div>
                        <p className="text-muted-foreground mt-0.5">{auction.listingCount ?? 0} listings</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Delinquent */}
        <TabsContent value="delinquent" className="mt-4">
          {delinquent.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Search className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">No delinquent properties tracked yet.</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {delinquent.map((prop: any) => (
                <Card key={prop.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{prop.address ?? prop.apn ?? `APN ${prop.apn}`}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3" /> {prop.county}, {prop.state}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-red-600 font-bold">{fmt(prop.taxesOwed)}</p>
                        <p className="text-xs text-muted-foreground">taxes owed</p>
                        <Button size="sm" variant="ghost" className="mt-1 h-6 text-xs"
                          onClick={() => addWatchlistMutation.mutate(prop.id)}>
                          <Star className="w-3 h-3 mr-1" /> Watch
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Watchlist */}
        <TabsContent value="watchlist" className="mt-4">
          {watchlist.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <BookmarkPlus className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">Your watchlist is empty.</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {watchlist.map((item: any) => (
                <Card key={item.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{item.address ?? item.apn ?? `Listing #${item.id}`}</p>
                        <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                          <span>{item.county}, {item.state}</span>
                          {item.minimumBid && <span>Min Bid: {fmt(item.minimumBid)}</span>}
                          {item.auctionDate && <span>Auction: {new Date(item.auctionDate).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <Badge variant={item.status === "active" ? "default" : "secondary"}>{item.status ?? "active"}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Alerts */}
        <TabsContent value="alerts" className="mt-4">
          {alerts.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Bell className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">No tax sale alerts configured.</p>
              <p className="text-xs text-muted-foreground mt-1">Alerts notify you when matching tax sales are discovered.</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert: any) => (
                <Card key={alert.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium">{alert.name}</p>
                      <Badge variant={alert.isActive ? "default" : "secondary"}>{alert.isActive ? "Active" : "Paused"}</Badge>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      {alert.state && <span>State: {alert.state}</span>}
                      {alert.county && <span>County: {alert.county}</span>}
                      {alert.minAcres && <span>Min Acres: {alert.minAcres}</span>}
                      {alert.maxBid && <span>Max Bid: {fmt(alert.maxBid)}</span>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
