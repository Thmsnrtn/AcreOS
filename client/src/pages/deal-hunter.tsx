import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, RefreshCw, Flame, TrendingUp, CheckCircle, Database, Play, ToggleLeft, ToggleRight, MapPin, DollarSign, FileText, Home, Bot, Activity, Trash2 } from "lucide-react";

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

// ─── Auto-Bid Rules Panel ─────────────────────────────────────────────────────

interface AutoBidRule {
  id: number;
  maxPriceCents: number;
  minDistressScore: number;
  counties: string;
  isActive: boolean;
  createdAt: string;
}

function AutoBidRulesPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [maxPrice, setMaxPrice] = useState("");
  const [minScore, setMinScore] = useState("60");
  const [counties, setCounties] = useState("");

  const { data: rulesData } = useQuery({
    queryKey: ["/api/deal-hunter/auto-bid-rules"],
    queryFn: async () => {
      const res = await fetch("/api/deal-hunter/auto-bid-rules", { credentials: "include" });
      if (!res.ok) return { rules: [] };
      return res.json();
    },
  });
  const rules: AutoBidRule[] = rulesData?.rules ?? [];

  const createRuleMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await fetch("/api/deal-hunter/auto-bid-rules", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create rule");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Auto-bid rule created" });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/auto-bid-rules"] });
      setMaxPrice(""); setMinScore("60"); setCounties("");
    },
    onError: () => toast({ title: "Failed to save rule", variant: "destructive" }),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/deal-hunter/auto-bid-rules/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete rule");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rule deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/auto-bid-rules"] });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" /> Create Auto-Bid Rule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Max Price ($)</Label>
              <Input
                type="number"
                placeholder="e.g. 50000"
                value={maxPrice}
                onChange={e => setMaxPrice(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Min Distress Score</Label>
              <Select value={minScore} onValueChange={setMinScore}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="40">40+ Moderate</SelectItem>
                  <SelectItem value="60">60+ Warm</SelectItem>
                  <SelectItem value="80">80+ Hot</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Counties (comma-separated)</Label>
              <Input
                placeholder="Travis, Hays, Bastrop"
                value={counties}
                onChange={e => setCounties(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <Button
            size="sm"
            disabled={!maxPrice || createRuleMutation.isPending}
            onClick={() => createRuleMutation.mutate({
              maxPriceCents: Math.round(parseFloat(maxPrice) * 100),
              minDistressScore: parseInt(minScore),
              counties,
            })}
          >
            <Plus className="w-3 h-3 mr-1" /> Add Rule
          </Button>
        </CardContent>
      </Card>

      {rules.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{rules.length} Active Rule{rules.length !== 1 ? "s" : ""}</p>
          {rules.map(rule => (
            <div key={rule.id} className="flex items-center justify-between p-3 border rounded-md text-sm">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Badge variant={rule.isActive ? "default" : "secondary"} className="text-xs">
                    {rule.isActive ? "Active" : "Paused"}
                  </Badge>
                  <span className="font-medium">Max ${(rule.maxPriceCents / 100).toLocaleString()}</span>
                  <span className="text-muted-foreground">· Score ≥{rule.minDistressScore}</span>
                </div>
                {rule.counties && <p className="text-xs text-muted-foreground">Counties: {rule.counties}</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive h-7 w-7 p-0"
                onClick={() => deleteRuleMutation.mutate(rule.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Source Health Monitoring ─────────────────────────────────────────────────

function SourceHealthPanel({ sources }: { sources: any[] }) {
  if (sources.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Source Health Monitor
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2 font-medium">Source</th>
                <th className="text-left px-4 py-2 font-medium">Last Scraped</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Failures</th>
                <th className="text-left px-4 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(source => {
                const lastScrape = source.lastScrapedAt
                  ? new Date(source.lastScrapedAt).toLocaleString()
                  : "Never";
                const isHealthy = source.consecutiveFailures === 0 && source.isActive;
                return (
                  <tr key={source.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <div>
                        <p className="font-medium truncate max-w-[160px]">{source.name}</p>
                        <p className="text-muted-foreground">{source.sourceType.replace(/_/g, " ")}</p>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{lastScrape}</td>
                    <td className="px-4 py-2">
                      {!source.isActive ? (
                        <Badge variant="secondary" className="text-xs">Disabled</Badge>
                      ) : isHealthy ? (
                        <Badge className="bg-green-100 text-green-800 text-xs">Healthy</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">Failing</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={source.consecutiveFailures > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}>
                        {source.consecutiveFailures}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{source.state}{source.county ? ` / ${source.county}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
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
  const [selectedDealIds, setSelectedDealIds] = useState<Set<number>>(new Set());
  const [bulkConverting, setBulkConverting] = useState(false);

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

  const toggleSelectDeal = (id: number) => {
    setSelectedDealIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllNew = () => {
    const newIds = deals.filter(d => d.status === "new").map(d => d.id);
    setSelectedDealIds(new Set(newIds));
  };

  const handleBulkConvert = async () => {
    if (selectedDealIds.size === 0) return;
    setBulkConverting(true);
    let success = 0;
    for (const id of Array.from(selectedDealIds)) {
      try {
        await fetch(`/api/deal-hunter/deals/${id}/convert-lead`, {
          method: "POST",
          credentials: "include",
        });
        success++;
      } catch {}
    }
    setBulkConverting(false);
    setSelectedDealIds(new Set());
    toast({ title: `Bulk converted`, description: `${success} of ${selectedDealIds.size} deals converted to leads` });
    queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/deals"] });
    queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/stats"] });
  };

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

      {/* Bulk conversion bar */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="text-xs" onClick={selectAllNew}>
          Select all new
        </Button>
        {selectedDealIds.size > 0 && (
          <>
            <span className="text-xs text-muted-foreground">{selectedDealIds.size} selected</span>
            <Button size="sm" className="text-xs" onClick={handleBulkConvert} disabled={bulkConverting}>
              {bulkConverting ? "Converting…" : `Convert ${selectedDealIds.size} to Leads`}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedDealIds(new Set())}>
              Clear
            </Button>
          </>
        )}
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
            <Card key={deal.id} className={`hover:shadow-md transition-shadow ${selectedDealIds.has(deal.id) ? "ring-2 ring-primary" : ""}`}>
              <CardContent className="p-4">
                {deal.status === "new" && (
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      checked={selectedDealIds.has(deal.id)}
                      onCheckedChange={() => toggleSelectDeal(deal.id)}
                      id={`chk-${deal.id}`}
                    />
                    <label htmlFor={`chk-${deal.id}`} className="text-xs text-muted-foreground cursor-pointer">Select for bulk convert</label>
                  </div>
                )}
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

// ─── Source Health Tab Content ────────────────────────────────────────────────

function SourceHealthTabContent() {
  const { data: sourcesData, isLoading } = useQuery({
    queryKey: ["/api/deal-hunter/sources"],
    queryFn: async () => {
      const res = await fetch("/api/deal-hunter/sources", { credentials: "include" });
      return res.json();
    },
  });
  const sources = sourcesData?.sources ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />)}
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Activity className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">No sources configured. Add sources first.</p>
        </CardContent>
      </Card>
    );
  }

  return <SourceHealthPanel sources={sources} />;
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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Search className="w-7 h-7 text-primary" /> Deal Hunter
        </h1>
        <p className="text-muted-foreground mt-1">
          Automated sourcing from tax auctions, foreclosures, and distressed property feeds
        </p>
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
          <TabsTrigger value="auto-bid">Auto-Bid Rules</TabsTrigger>
          <TabsTrigger value="health">Source Health</TabsTrigger>
        </TabsList>

        <TabsContent value="deals" className="mt-4">
          <DealsTab />
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          <SourcesTab />
        </TabsContent>

        <TabsContent value="auto-bid" className="mt-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-0.5 flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" /> Auto-Bid Rules
            </h2>
            <p className="text-xs text-muted-foreground">
              Define rules to automatically flag or bid on deals matching your criteria.
            </p>
          </div>
          <AutoBidRulesPanel />
        </TabsContent>

        <TabsContent value="health" className="mt-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-0.5 flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Source Health Monitoring
            </h2>
            <p className="text-xs text-muted-foreground">
              Monitor scraping success rates, last-scraped times, and failure counts per source.
            </p>
          </div>
          <SourceHealthTabContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}
