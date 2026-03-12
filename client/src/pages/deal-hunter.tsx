import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useRealtime } from "@/hooks/use-realtime";
import { Search, Plus, RefreshCw, Flame, TrendingUp, CheckCircle, Database, Play, ToggleLeft, ToggleRight, MapPin, DollarSign, FileText, Home } from "lucide-react";

const LAST_VISITED_KEY = "deal-hunter-last-visited";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DealSource {
  id: number;
  name: string;
  sourceType: string;
  state: string;
  county?: string;
  baseUrl: string;
  isActive: boolean;
  priority: number;
  lastScrapedAt?: string;
  consecutiveFailures: number;
}

interface ScrapedDeal {
  id: number;
  sourceId: number;
  sourceType: string;
  externalId?: string;
  apn?: string;
  address?: string;
  city?: string;
  state?: string;
  county?: string;
  zip?: string;
  sizeAcres?: number;
  zoning?: string;
  assessedValue?: number;
  minimumBid?: number;
  taxesOwed?: number;
  ownerName?: string;
  distressScore: number;
  status: string;
  auctionDate?: string;
  scrapedAt: string;
  convertedToLeadId?: number;
  convertedToPropertyId?: number;
}

interface DealStats {
  totalDeals: number;
  newDeals: number;
  highQualityDeals: number;
  convertedDeals: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DistressBadge({ score }: { score: number }) {
  if (score >= 80) return <Badge className="bg-red-600 text-white">🔥 Hot {score}</Badge>;
  if (score >= 60) return <Badge className="bg-orange-500 text-white">Warm {score}</Badge>;
  if (score >= 40) return <Badge className="bg-yellow-500 text-black">Moderate {score}</Badge>;
  return <Badge variant="secondary">Low {score}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    new: "bg-blue-100 text-blue-800",
    reviewed: "bg-purple-100 text-purple-800",
    added_to_crm: "bg-green-100 text-green-800",
    rejected: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Source Registration Dialog ───────────────────────────────────────────────

function RegisterSourceDialog({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    sourceType: "tax_lien",
    state: "",
    county: "",
    baseUrl: "",
    priority: "50",
  });

  const registerMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch("/api/deal-hunter/sources", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          priority: parseInt(data.priority),
          scrapingConfig: { method: "puppeteer" },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Source registered successfully" });
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Source</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register New Deal Source</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Source Name</Label>
            <Input placeholder="e.g. Travis County Tax Auctions" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.sourceType} onValueChange={v => setForm(f => ({ ...f, sourceType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tax_lien">Tax Lien</SelectItem>
                  <SelectItem value="tax_deed">Tax Deed</SelectItem>
                  <SelectItem value="foreclosure">Foreclosure</SelectItem>
                  <SelectItem value="auction">Auction</SelectItem>
                  <SelectItem value="mls">MLS</SelectItem>
                  <SelectItem value="fsbo">FSBO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority (1-100)</Label>
              <Input type="number" min="1" max="100" value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>State</Label>
              <Input placeholder="TX" maxLength={2} value={form.state}
                onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <Label>County (optional)</Label>
              <Input placeholder="Travis" value={form.county}
                onChange={e => setForm(f => ({ ...f, county: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Base URL</Label>
            <Input placeholder="https://county.gov/tax-auctions" value={form.baseUrl}
              onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} />
          </div>
          <Button className="w-full" onClick={() => registerMutation.mutate(form)}
            disabled={registerMutation.isPending || !form.name || !form.state || !form.baseUrl}>
            {registerMutation.isPending ? "Registering…" : "Register Source"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sources Tab ──────────────────────────────────────────────────────────────

function SourcesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: sourcesData, isLoading } = useQuery({
    queryKey: ["/api/deal-hunter/sources"],
    queryFn: async () => {
      const res = await fetch("/api/deal-hunter/sources", { credentials: "include" });
      return res.json();
    },
  });

  const sources: DealSource[] = sourcesData?.sources ?? [];

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await fetch(`/api/deal-hunter/sources/${id}/toggle`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/sources"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const scrapeMutation = useMutation({
    mutationFn: async (sourceId: number) => {
      const res = await fetch(`/api/deal-hunter/sources/${sourceId}/scrape`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (_, sourceId) => {
      toast({ title: "Scrape complete", description: `Source ${sourceId} scraped successfully` });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/stats"] });
    },
    onError: (e: any) => toast({ title: "Scrape failed", description: e.message, variant: "destructive" }),
  });

  const scrapeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/deal-hunter/scrape-all", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => toast({ title: "Scraping all sources", description: "Running in background…" }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-muted/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{sources.length} configured sources</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => scrapeAllMutation.mutate()}
            disabled={scrapeAllMutation.isPending}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Scrape All
          </Button>
          <RegisterSourceDialog onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/sources"] })} />
        </div>
      </div>

      {sources.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Database className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No sources configured yet.</p>
            <p className="text-sm text-muted-foreground mt-1">Add a county tax auction, foreclosure site, or MLS feed to start hunting deals.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sources.map(source => (
            <Card key={source.id} className={source.isActive ? "" : "opacity-60"}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{source.name}</span>
                      <Badge variant="outline" className="text-xs">{source.sourceType.replace(/_/g, " ")}</Badge>
                      <Badge variant="secondary" className="text-xs">{source.state}{source.county ? ` · ${source.county}` : ""}</Badge>
                      {source.consecutiveFailures > 0 && (
                        <Badge variant="destructive" className="text-xs">{source.consecutiveFailures} failures</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate max-w-sm">{source.baseUrl}</p>
                    {source.lastScrapedAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Last scraped: {new Date(source.lastScrapedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Button variant="ghost" size="sm"
                      onClick={() => toggleMutation.mutate({ id: source.id, isActive: !source.isActive })}>
                      {source.isActive
                        ? <ToggleRight className="w-5 h-5 text-green-500" />
                        : <ToggleLeft className="w-5 h-5 text-gray-400" />}
                    </Button>
                    <Button variant="outline" size="sm"
                      onClick={() => scrapeMutation.mutate(source.id)}
                      disabled={scrapeMutation.isPending || !source.isActive}>
                      <Play className="w-3 h-3 mr-1" /> Scrape
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Deals Tab ────────────────────────────────────────────────────────────────

function DealsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    status: "new",
    sourceType: "",
    minDistressScore: "",
  });

  const params = new URLSearchParams({ limit: "50", offset: "0" });
  if (filters.status) params.set("status", filters.status);
  if (filters.sourceType) params.set("sourceType", filters.sourceType);
  if (filters.minDistressScore) params.set("minDistressScore", filters.minDistressScore);

  const { data: dealsData, isLoading } = useQuery({
    queryKey: ["/api/deal-hunter/deals", filters],
    queryFn: async () => {
      const res = await fetch(`/api/deal-hunter/deals?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const deals: ScrapedDeal[] = dealsData?.deals ?? [];

  const convertLeadMutation = useMutation({
    mutationFn: async (dealId: number) => {
      const res = await fetch(`/api/deal-hunter/deals/${dealId}/convert-lead`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Lead created", description: "Deal added to your CRM as a lead" });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/stats"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const convertPropertyMutation = useMutation({
    mutationFn: async (dealId: number) => {
      const res = await fetch(`/api/deal-hunter/deals/${dealId}/convert-property`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Property created", description: "Deal added to your portfolio as a property" });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/stats"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="w-40">
          <Label className="text-xs">Status</Label>
          <Select value={filters.status} onValueChange={v => setFilters(f => ({ ...f, status: v }))}>
            <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="added_to_crm">Added to CRM</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Label className="text-xs">Source Type</Label>
          <Select value={filters.sourceType} onValueChange={v => setFilters(f => ({ ...f, sourceType: v }))}>
            <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="tax_lien">Tax Lien</SelectItem>
              <SelectItem value="tax_deed">Tax Deed</SelectItem>
              <SelectItem value="foreclosure">Foreclosure</SelectItem>
              <SelectItem value="auction">Auction</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Label className="text-xs">Min Distress Score</Label>
          <Select value={filters.minDistressScore} onValueChange={v => setFilters(f => ({ ...f, minDistressScore: v }))}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Any</SelectItem>
              <SelectItem value="40">40+ Moderate</SelectItem>
              <SelectItem value="60">60+ Warm</SelectItem>
              <SelectItem value="80">80+ Hot</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground ml-auto self-end pb-1">{deals.length} deals</p>
      </div>

      {/* Deal cards */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-36 bg-muted/50 rounded-lg animate-pulse" />)}
        </div>
      ) : deals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Search className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No deals match your filters.</p>
            <p className="text-sm text-muted-foreground mt-1">Try scraping your sources or adjusting filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {deals.map(deal => (
            <Card key={deal.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <DistressBadge score={deal.distressScore} />
                      <StatusBadge status={deal.status} />
                    </div>
                    <p className="font-medium mt-1">{deal.address || "Address unknown"}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="w-3 h-3" />
                      {[deal.city, deal.county, deal.state].filter(Boolean).join(", ")}
                      {deal.zip && ` ${deal.zip}`}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {deal.sourceType.replace(/_/g, " ")}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 my-3 text-xs">
                  {deal.sizeAcres != null && (
                    <div className="bg-muted/50 rounded p-2">
                      <p className="text-muted-foreground">Acres</p>
                      <p className="font-semibold">{deal.sizeAcres.toLocaleString()}</p>
                    </div>
                  )}
                  {deal.minimumBid != null && (
                    <div className="bg-muted/50 rounded p-2">
                      <p className="text-muted-foreground">Min Bid</p>
                      <p className="font-semibold">${deal.minimumBid.toLocaleString()}</p>
                    </div>
                  )}
                  {deal.assessedValue != null && (
                    <div className="bg-muted/50 rounded p-2">
                      <p className="text-muted-foreground">Assessed</p>
                      <p className="font-semibold">${deal.assessedValue.toLocaleString()}</p>
                    </div>
                  )}
                  {deal.taxesOwed != null && (
                    <div className="bg-red-50 dark:bg-red-950/20 rounded p-2">
                      <p className="text-muted-foreground">Taxes Owed</p>
                      <p className="font-semibold text-red-600">${deal.taxesOwed.toLocaleString()}</p>
                    </div>
                  )}
                </div>

                {deal.auctionDate && (
                  <p className="text-xs text-orange-600 font-medium mb-2">
                    Auction: {new Date(deal.auctionDate).toLocaleDateString()}
                  </p>
                )}

                {deal.status === "new" && (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" className="flex-1 text-xs"
                      onClick={() => convertLeadMutation.mutate(deal.id)}
                      disabled={convertLeadMutation.isPending}>
                      <FileText className="w-3 h-3 mr-1" /> Add as Lead
                    </Button>
                    <Button size="sm" className="flex-1 text-xs"
                      onClick={() => convertPropertyMutation.mutate(deal.id)}
                      disabled={convertPropertyMutation.isPending}>
                      <Home className="w-3 h-3 mr-1" /> Add as Property
                    </Button>
                  </div>
                )}

                {deal.status === "added_to_crm" && (
                  <div className="flex items-center gap-1 text-xs text-green-600 mt-2">
                    <CheckCircle className="w-3 h-3" />
                    {deal.convertedToLeadId
                      ? `Converted to Lead #${deal.convertedToLeadId}`
                      : deal.convertedToPropertyId
                      ? `Converted to Property #${deal.convertedToPropertyId}`
                      : "Added to CRM"}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DealHunterPage() {
  const { data: statsData } = useQuery({
    queryKey: ["/api/deal-hunter/stats"],
    queryFn: async () => {
      const res = await fetch("/api/deal-hunter/stats", { credentials: "include" });
      return res.json();
    },
  });

  const stats: DealStats = statsData?.stats ?? { totalDeals: 0, newDeals: 0, highQualityDeals: 0, convertedDeals: 0 };

  const { toast } = useToast();
  const { on } = useRealtime();
  const [newDealCount, setNewDealCount] = useState(0);
  const lastVisitedRef = useRef<number>(0);

  // Load last-visited timestamp from localStorage and record current visit
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LAST_VISITED_KEY);
      lastVisitedRef.current = stored ? parseInt(stored, 10) : 0;
      localStorage.setItem(LAST_VISITED_KEY, Date.now().toString());
    } catch {}
  }, []);

  // Listen for real-time deal_match WebSocket events
  useEffect(() => {
    const cleanup = on("deal_match", (payload) => {
      const deal = payload as { id: number; title: string; price?: number; matchScore: number; url?: string };
      toast({
        title: "New Deal Match!",
        description: `${deal.title} — ${deal.matchScore}% match${deal.price ? ` · $${Number(deal.price).toLocaleString()}` : ""}`,
      });
      setNewDealCount((c) => c + 1);
    });
    return cleanup;
  }, [on, toast]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="w-7 h-7 text-primary" /> Deal Hunter
            {newDealCount > 0 && (
              <Badge className="bg-red-500 text-white ml-1" data-testid="badge-new-deals">
                {newDealCount} new
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground mt-1">
            Automated sourcing from tax auctions, foreclosures, and distressed property feeds
          </p>
        </div>
        {newDealCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setNewDealCount(0)} className="text-xs text-muted-foreground">
            Clear
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">Total Scraped</p>
              <Database className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{Number(stats.totalDeals).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">New Deals</p>
              <TrendingUp className="w-4 h-4 text-blue-500" />
            </div>
            <p className="text-2xl font-bold text-blue-600">{Number(stats.newDeals).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">High Quality (70+)</p>
              <Flame className="w-4 h-4 text-red-500" />
            </div>
            <p className="text-2xl font-bold text-red-600">{Number(stats.highQualityDeals).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">Converted</p>
              <CheckCircle className="w-4 h-4 text-green-500" />
            </div>
            <p className="text-2xl font-bold text-green-600">{Number(stats.convertedDeals).toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="deals">
        <TabsList>
          <TabsTrigger value="deals">Deals</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>

        <TabsContent value="deals" className="mt-4">
          <DealsTab />
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          <SourcesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
