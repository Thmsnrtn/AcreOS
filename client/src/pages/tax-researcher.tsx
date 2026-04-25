import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Search, Bell, BookmarkPlus, Calendar, MapPin, Gavel, ArrowRight, Star } from "lucide-react";
import { usd } from "@/lib/format";

function fmt(n: number) {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return usd(n, { noCents: Number.isInteger(n) });
}

export default function TaxResearcherPage() {
  useDocumentTitle("Tax researcher");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scanStateId = useId();
  const filterStateId = useId();
  const filterCountyId = useId();

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
      toast({ title: "Scan complete", description: `Auction calendar scanned for ${scanState}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auctions"] });
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't run scan",
        description: `${e.message}. The auction list is unchanged — try again, or check that the state code is valid.`,
        variant: "destructive",
      }),
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
    onError: (e: any) =>
      toast({
        title: "Couldn't add to watchlist",
        description: `${e.message}. Your watchlist is unchanged — try again.`,
        variant: "destructive",
      }),
  });

  const surfaceToRadarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tax-researcher/surface-to-radar", {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (data) => toast({ title: "Pushed to acquisition radar", description: `${data.result?.count ?? "Several"} opportunities surfaced.` }),
    onError: (e: any) =>
      toast({
        title: "Couldn't push to radar",
        description: `${e.message}. The acquisition radar is unchanged — try again.`,
        variant: "destructive",
      }),
  });

  const auctions = auctionsData?.auctions ?? [];
  const alerts = alertsData?.alerts ?? [];
  const watchlist = watchlistData?.watchlist ?? [];
  const delinquent = delinquentData?.properties ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gavel className="w-7 h-7 text-primary" aria-hidden="true" /> Tax researcher
        </h1>
        <p className="text-muted-foreground mt-1">
          Tax lien auctions, delinquent property tracking, and automated sale alerts.
        </p>
      </div>

      <form
        className="flex flex-wrap gap-3 items-end"
        onSubmit={(e) => { e.preventDefault(); if (scanState) scanMutation.mutate(); }}
      >
        <div>
          <Label htmlFor={scanStateId} className="text-xs">Scan state</Label>
          <Input
            id={scanStateId}
            className="w-24 mt-1 tabular-nums"
            placeholder="TX"
            maxLength={2}
            value={scanState}
            onChange={e => setScanState(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={!scanState || scanMutation.isPending}
          aria-label={scanState ? `Scan auction calendar for ${scanState}` : "Scan auction calendar"}
        >
          <Search className="w-4 h-4 mr-1" aria-hidden="true" />
          {scanMutation.isPending ? "Scanning…" : "Scan calendar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => surfaceToRadarMutation.mutate()}
          disabled={surfaceToRadarMutation.isPending}
          aria-label="Push tracked opportunities to acquisition radar"
        >
          <ArrowRight className="w-4 h-4 mr-1" aria-hidden="true" />
          {surfaceToRadarMutation.isPending ? "Pushing…" : "Surface to radar"}
        </Button>
      </form>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <dt className="text-xs text-muted-foreground">Upcoming auctions</dt>
          <dd className="text-2xl font-bold tabular-nums">{auctions.length}</dd>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <dt className="text-xs text-muted-foreground">Active alerts</dt>
          <dd className="text-2xl font-bold text-orange-600 tabular-nums">{alerts.length}</dd>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <dt className="text-xs text-muted-foreground">Watchlist items</dt>
          <dd className="text-2xl font-bold text-blue-600 tabular-nums">{watchlist.length}</dd>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <dt className="text-xs text-muted-foreground">Delinquent properties</dt>
          <dd className="text-2xl font-bold text-yellow-600 tabular-nums">{delinquent.length}</dd>
        </CardContent></Card>
      </dl>

      <Tabs defaultValue="auctions">
        <TabsList>
          <TabsTrigger value="auctions">Auctions</TabsTrigger>
          <TabsTrigger value="delinquent">Delinquent properties</TabsTrigger>
          <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="auctions" className="mt-4 space-y-4">
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <Label htmlFor={filterStateId} className="text-xs">Filter state</Label>
              <Input
                id={filterStateId}
                className="w-20 mt-1 tabular-nums"
                placeholder="TX"
                maxLength={2}
                value={auctionFilters.state}
                onChange={e => setAuctionFilters(f => ({ ...f, state: e.target.value.toUpperCase() }))}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div>
              <Label htmlFor={filterCountyId} className="text-xs">Filter county</Label>
              <Input
                id={filterCountyId}
                className="w-36 mt-1"
                placeholder="Travis"
                value={auctionFilters.county}
                onChange={e => setAuctionFilters(f => ({ ...f, county: e.target.value }))}
                autoCapitalize="words"
              />
            </div>
          </div>

          {auctionsLoading ? (
            <div className="space-y-3" role="status" aria-live="polite">
              <span className="sr-only">Loading auctions…</span>
              {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted/50 rounded-lg animate-pulse" />)}
            </div>
          ) : auctions.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Gavel className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
              <p className="text-muted-foreground">No auctions found. Scan a state to populate data.</p>
            </CardContent></Card>
          ) : (
            <ul className="space-y-3" aria-label="Upcoming tax-lien auctions">
              {auctions.map((auction: any) => (
                <li key={auction.id}>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2 gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">{auction.name ?? `${auction.county} County tax sale`}</p>
                            <Badge variant="outline">{auction.state}</Badge>
                            <Badge variant="secondary" className="capitalize">{auction.auctionType?.replace(/_/g, " ")}</Badge>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <MapPin className="w-3 h-3" aria-hidden="true" />{auction.county}, {auction.state}
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          <div className="flex items-center gap-1 text-orange-600 font-medium tabular-nums">
                            <Calendar className="w-3 h-3" aria-hidden="true" />
                            {auction.auctionDate ? new Date(auction.auctionDate).toLocaleDateString() : "TBD"}
                          </div>
                          <p className="text-muted-foreground mt-0.5 tabular-nums">{auction.listingCount ?? 0} listings</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="delinquent" className="mt-4">
          {delinquent.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Search className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
              <p className="text-muted-foreground">No delinquent properties tracked yet.</p>
            </CardContent></Card>
          ) : (
            <ul className="space-y-3" aria-label="Delinquent properties">
              {delinquent.map((prop: any) => {
                const label = prop.address ?? prop.apn ?? `APN ${prop.apn}`;
                return (
                  <li key={prop.id}>
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <p className="font-medium">{label}</p>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="w-3 h-3" aria-hidden="true" /> {prop.county}, {prop.state}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-red-600 font-bold tabular-nums">{fmt(prop.taxesOwed)}</p>
                            <p className="text-xs text-muted-foreground">taxes owed</p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="mt-1 h-6 text-xs"
                              onClick={() => addWatchlistMutation.mutate(prop.id)}
                              disabled={addWatchlistMutation.isPending}
                              aria-label={`Add ${label} to watchlist`}
                            >
                              <Star className="w-3 h-3 mr-1" aria-hidden="true" /> Watch
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="watchlist" className="mt-4">
          {watchlist.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <BookmarkPlus className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
              <p className="text-muted-foreground">Your watchlist is empty.</p>
            </CardContent></Card>
          ) : (
            <ul className="space-y-3" aria-label="Watchlisted listings">
              {watchlist.map((item: any) => (
                <li key={item.id}>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="font-medium">{item.address ?? item.apn ?? `Listing #${item.id}`}</p>
                          <div className="flex gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                            <span>{item.county}, {item.state}</span>
                            {item.minimumBid && <span>Min bid: <span className="tabular-nums">{fmt(item.minimumBid)}</span></span>}
                            {item.auctionDate && <span>Auction: <span className="tabular-nums">{new Date(item.auctionDate).toLocaleDateString()}</span></span>}
                          </div>
                        </div>
                        <Badge variant={item.status === "active" ? "default" : "secondary"} className="capitalize">{item.status ?? "active"}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          {alerts.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Bell className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
              <p className="text-muted-foreground">No tax sale alerts configured.</p>
              <p className="text-xs text-muted-foreground mt-1">Alerts notify you when matching tax sales are discovered.</p>
            </CardContent></Card>
          ) : (
            <ul className="space-y-3" aria-label="Tax sale alerts">
              {alerts.map((alert: any) => (
                <li key={alert.id}>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                        <p className="font-medium">{alert.name}</p>
                        <Badge variant={alert.isActive ? "default" : "secondary"}>{alert.isActive ? "Active" : "Paused"}</Badge>
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                        {alert.state && <span>State: {alert.state}</span>}
                        {alert.county && <span>County: {alert.county}</span>}
                        {alert.minAcres && <span>Min acres: <span className="tabular-nums">{alert.minAcres}</span></span>}
                        {alert.maxBid && <span>Max bid: <span className="tabular-nums">{fmt(alert.maxBid)}</span></span>}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
