// DEPRECATED 2026-05-11 — consolidated into /deals/discover. The /deal-hunter
// route now redirects to /deals/discover (which mounts acquisition-radar.tsx
// as the canonical surface). This file is kept on disk so we can A/B
// alternative deal-discovery layouts later; do not link to /deal-hunter.
import { useId, useState, useEffect, useRef } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { RequiredDisclaimer } from "@/components/required-disclaimer";
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
import { useRealtime } from "@/hooks/use-realtime";
import { Search, Plus, RefreshCw, Flame, TrendingUp, CheckCircle, Database, Play, ToggleLeft, ToggleRight, MapPin, DollarSign, FileText, Home, Bot, Activity, Trash2 } from "lucide-react";

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
  if (score >= 80) return <Badge className="bg-acr-neg text-white">🔥 Hot {score}</Badge>;
  if (score >= 60) return <Badge className="bg-acr-warn text-white">Warm {score}</Badge>;
  if (score >= 40) return <Badge className="bg-acr-warn text-black">Moderate {score}</Badge>;
  return <Badge variant="secondary">Low {score}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    new: "bg-acr-accent text-acr-accent",
    reviewed: "bg-acr-brand-soft text-acr-brand",
    added_to_crm: "bg-acr-pos-soft text-acr-pos",
    rejected: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
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
  const [deleteRuleId, setDeleteRuleId] = useState<number | null>(null);
  const maxPriceId = useId();
  const minScoreId = useId();
  const countiesId = useId();

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
      toast({ title: "Auto-bid rule created", description: "New deals matching this rule will be flagged automatically." });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/auto-bid-rules"] });
      setMaxPrice(""); setMinScore("60"); setCounties("");
    },
    onError: () => toast({ title: "Couldn't save rule", description: "Your draft is preserved. Try again or check the system status.", variant: "destructive" }),
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
    onError: () => toast({ title: "Couldn't delete rule", description: "The rule is still active. Try again.", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" aria-hidden="true" /> Create auto-bid rule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!maxPrice || createRuleMutation.isPending) return;
              createRuleMutation.mutate({
                maxPriceCents: Math.round(parseFloat(maxPrice) * 100),
                minDistressScore: parseInt(minScore),
                counties,
              });
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor={maxPriceId} className="text-xs">Max price ($)</Label>
                <Input
                  id={maxPriceId}
                  type="number"
                  inputMode="decimal"
                  placeholder="e.g. 50000"
                  value={maxPrice}
                  onChange={e => setMaxPrice(e.target.value)}
                  className="h-8 text-sm tabular-nums"
                />
              </div>
              <div>
                <Label htmlFor={minScoreId} className="text-xs">Min distress score</Label>
                <Select value={minScore} onValueChange={setMinScore}>
                  <SelectTrigger id={minScoreId} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="40">40+ moderate</SelectItem>
                    <SelectItem value="60">60+ warm</SelectItem>
                    <SelectItem value="80">80+ hot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={countiesId} className="text-xs">Counties (comma-separated)</Label>
                <Input
                  id={countiesId}
                  placeholder="Travis, Hays, Bastrop"
                  value={counties}
                  onChange={e => setCounties(e.target.value)}
                  className="h-8 text-sm"
                  autoCapitalize="words"
                />
              </div>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!maxPrice || createRuleMutation.isPending}
            >
              <Plus className="w-3 h-3 mr-1" aria-hidden="true" /> Add rule
            </Button>
          </form>
        </CardContent>
      </Card>

      {rules.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground"><span className="tabular-nums">{rules.length}</span> active rule{rules.length !== 1 ? "s" : ""}</p>
          <ul className="space-y-2 list-none p-0 m-0" aria-label={`${rules.length} active auto-bid rule${rules.length === 1 ? "" : "s"}`}>
            {rules.map(rule => (
              <li key={rule.id} className="flex items-center justify-between p-3 border rounded-md text-sm">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={rule.isActive ? "default" : "secondary"} className="text-xs" aria-label={`Rule status: ${rule.isActive ? "active" : "paused"}`}>
                      {rule.isActive ? "Active" : "Paused"}
                    </Badge>
                    <span className="font-medium tabular-nums">Max {usd(rule.maxPriceCents / 100, { noCents: true })}</span>
                    <span className="text-muted-foreground">· Score ≥<span className="tabular-nums">{rule.minDistressScore}</span></span>
                  </div>
                  {rule.counties && <p className="text-xs text-muted-foreground">Counties: {rule.counties}</p>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive h-7 w-7 p-0"
                  onClick={() => setDeleteRuleId(rule.id)}
                  aria-label={`Delete auto-bid rule: max ${usd(rule.maxPriceCents / 100, { noCents: true })}, score ≥${rule.minDistressScore}${rule.counties ? `, counties ${rule.counties}` : ""}`}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={deleteRuleId !== null}
        onOpenChange={(open) => !open && setDeleteRuleId(null)}
        title="Delete deal-hunter rule?"
        description="This permanently removes the rule. Already-flagged deals are kept; new deals matching the criteria will no longer be auto-flagged."
        confirmLabel="Delete rule"
        onConfirm={() => { deleteRuleMutation.mutate(deleteRuleId!); setDeleteRuleId(null); }}
        isLoading={deleteRuleMutation.isPending}
        variant="destructive"
      />
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
          <Activity className="w-4 h-4 text-primary" aria-hidden="true" /> Source health monitor
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto" role="region" aria-label={`Source health for ${sources.length} source${sources.length === 1 ? "" : "s"}`} tabIndex={0}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th scope="col" className="text-left px-4 py-2 font-medium">Source</th>
                <th scope="col" className="text-left px-4 py-2 font-medium">Last scraped</th>
                <th scope="col" className="text-left px-4 py-2 font-medium">Status</th>
                <th scope="col" className="text-left px-4 py-2 font-medium">Failures</th>
                <th scope="col" className="text-left px-4 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(source => {
                const isHealthy = source.consecutiveFailures === 0 && source.isActive;
                return (
                  <tr key={source.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <div>
                        <p className="font-medium truncate max-w-[160px]">{source.name}</p>
                        <p className="text-muted-foreground">{source.sourceType.replace(/_/g, " ")}</p>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground tabular-nums">
                      {source.lastScrapedAt
                        ? <time dateTime={new Date(source.lastScrapedAt).toISOString()}>{new Date(source.lastScrapedAt).toLocaleString()}</time>
                        : "Never"}
                    </td>
                    <td className="px-4 py-2">
                      {!source.isActive ? (
                        <Badge variant="secondary" className="text-xs">Disabled</Badge>
                      ) : isHealthy ? (
                        <Badge className="bg-acr-pos-soft text-acr-pos text-xs">Healthy</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">Failing</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`tabular-nums ${source.consecutiveFailures > 0 ? "text-acr-neg font-medium" : "text-muted-foreground"}`}>
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
  const nameId = useId();
  const typeId = useId();
  const priorityId = useId();
  const stateId = useId();
  const countyId = useId();
  const baseUrlId = useId();

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
      toast({ title: "Source registered", description: "Run a scrape to start pulling deals." });
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Couldn't register source", description: `${e.message} — your draft is preserved.`, variant: "destructive" }),
  });

  const canSubmit = !!form.name && !!form.state && !!form.baseUrl && !registerMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Add source</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register new deal source</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 pt-2"
          onSubmit={(e) => { e.preventDefault(); if (canSubmit) registerMutation.mutate(form); }}
        >
          <div>
            <Label htmlFor={nameId}>Source name</Label>
            <Input id={nameId} placeholder="e.g. Travis County tax auctions" value={form.name}
              autoCapitalize="words"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={typeId}>Type</Label>
              <Select value={form.sourceType} onValueChange={v => setForm(f => ({ ...f, sourceType: v }))}>
                <SelectTrigger id={typeId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tax_lien">Tax lien</SelectItem>
                  <SelectItem value="tax_deed">Tax deed</SelectItem>
                  <SelectItem value="foreclosure">Foreclosure</SelectItem>
                  <SelectItem value="auction">Auction</SelectItem>
                  <SelectItem value="mls">MLS</SelectItem>
                  <SelectItem value="fsbo">FSBO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={priorityId}>Priority (1-100)</Label>
              <Input id={priorityId} type="number" inputMode="numeric" min="1" max="100" className="tabular-nums" value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={stateId}>State</Label>
              <Input id={stateId} placeholder="TX" maxLength={2} autoCapitalize="characters" value={form.state}
                onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <Label htmlFor={countyId}>County (optional)</Label>
              <Input id={countyId} placeholder="Travis" autoCapitalize="words" value={form.county}
                onChange={e => setForm(f => ({ ...f, county: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label htmlFor={baseUrlId}>Base URL</Label>
            <Input
              id={baseUrlId}
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://county.gov/tax-auctions"
              value={form.baseUrl}
              onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
            />
          </div>
          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {registerMutation.isPending ? "Registering…" : "Register source"}
          </Button>
        </form>
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
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/sources"] });
      toast({ title: vars.isActive ? "Source enabled" : "Source disabled" });
    },
    onError: (e: any) => toast({ title: "Couldn't toggle source", description: `${e.message} — its state is unchanged.`, variant: "destructive" }),
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
      toast({ title: "Scrape complete", description: `Source ${sourceId} scraped successfully.` });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/stats"] });
    },
    onError: (e: any) => toast({ title: "Couldn't scrape source", description: `${e.message} — no new deals were imported.`, variant: "destructive" }),
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
    onSuccess: () => toast({ title: "Scraping all sources", description: "Running in background — new deals will appear shortly." }),
    onError: (e: any) => toast({ title: "Couldn't start scrape", description: `${e.message} — sources are unchanged.`, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-muted/50 rounded-card animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground"><span className="tabular-nums">{sources.length}</span> configured source{sources.length === 1 ? "" : "s"}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => scrapeAllMutation.mutate()}
            disabled={scrapeAllMutation.isPending} aria-label="Scrape all configured sources">
            <RefreshCw className="w-4 h-4 mr-1" aria-hidden="true" />
            Scrape all
          </Button>
          <RegisterSourceDialog onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/sources"] })} />
        </div>
      </div>

      {sources.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center" role="status">
            <Database className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">No sources configured yet.</p>
            <p className="text-sm text-muted-foreground mt-1">Add a county tax auction, foreclosure site, or MLS feed to start hunting deals.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3 list-none p-0 m-0" aria-label={`${sources.length} configured deal source${sources.length === 1 ? "" : "s"}`}>
          {sources.map(source => (
            <li key={source.id}>
              <Card className={source.isActive ? "" : "opacity-60"}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{source.name}</span>
                        <Badge variant="outline" className="text-xs" aria-label={`Source type: ${source.sourceType.replace(/_/g, " ")}`}>{source.sourceType.replace(/_/g, " ")}</Badge>
                        <Badge variant="secondary" className="text-xs">{source.state}{source.county ? ` · ${source.county}` : ""}</Badge>
                        {source.consecutiveFailures > 0 && (
                          <Badge variant="destructive" className="text-xs" aria-label={`${source.consecutiveFailures} consecutive failure${source.consecutiveFailures === 1 ? "" : "s"}`}>
                            <span className="tabular-nums">{source.consecutiveFailures}</span> failure{source.consecutiveFailures === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-sm">{source.baseUrl}</p>
                      {source.lastScrapedAt && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Last scraped: <time dateTime={new Date(source.lastScrapedAt).toISOString()}>{new Date(source.lastScrapedAt).toLocaleDateString()}</time>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleMutation.mutate({ id: source.id, isActive: !source.isActive })}
                        aria-pressed={source.isActive}
                        aria-label={`${source.isActive ? "Disable" : "Enable"} source ${source.name}`}
                      >
                        {source.isActive
                          ? <ToggleRight className="w-5 h-5 text-acr-pos" aria-hidden="true" />
                          : <ToggleLeft className="w-5 h-5 text-muted-foreground" aria-hidden="true" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => scrapeMutation.mutate(source.id)}
                        disabled={scrapeMutation.isPending || !source.isActive}
                        aria-label={`Scrape source ${source.name} now`}
                      >
                        <Play className="w-3 h-3 mr-1" aria-hidden="true" /> Scrape
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
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
    sourceType: "all",
    minDistressScore: "any",
  });
  const [selectedDealIds, setSelectedDealIds] = useState<Set<number>>(new Set());
  const [bulkConverting, setBulkConverting] = useState(false);
  const [pendingBulkConvert, setPendingBulkConvert] = useState(false);
  const filterStatusId = useId();
  const filterSourceId = useId();
  const filterScoreId = useId();

  const params = new URLSearchParams({ limit: "50", offset: "0" });
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.sourceType && filters.sourceType !== "all") params.set("sourceType", filters.sourceType);
  if (filters.minDistressScore && filters.minDistressScore !== "any") params.set("minDistressScore", filters.minDistressScore);

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
    let failed = 0;
    const total = selectedDealIds.size;
    for (const id of Array.from(selectedDealIds)) {
      try {
        const res = await fetch(`/api/deal-hunter/deals/${id}/convert-lead`, {
          method: "POST",
          credentials: "include",
        });
        if (res.ok) success++; else failed++;
      } catch {
        failed++;
      }
    }
    setBulkConverting(false);
    setSelectedDealIds(new Set());
    if (failed === 0) {
      toast({ title: "Bulk convert complete", description: `${success} of ${total} deal${total === 1 ? "" : "s"} added as leads.` });
    } else {
      toast({
        variant: "destructive",
        title: failed === total ? "No deals were converted" : "Bulk convert finished with errors",
        description: `${success} of ${total} added as leads. ${failed} failed — they're still in your deal list.`,
      });
    }
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
      toast({ title: "Lead created", description: "Deal added to your CRM as a lead." });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/stats"] });
    },
    onError: (e: any) => toast({ title: "Couldn't convert to lead", description: `${e.message} — the deal is still in your hunt list.`, variant: "destructive" }),
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
      toast({ title: "Property created", description: "Deal added to your portfolio as a property." });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deal-hunter/stats"] });
    },
    onError: (e: any) => toast({ title: "Couldn't convert to property", description: `${e.message} — the deal is still in your hunt list.`, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <fieldset className="flex flex-wrap gap-3 items-end border-0 p-0 m-0">
        <legend className="sr-only">Filter deals</legend>
        <div className="w-40">
          <Label htmlFor={filterStatusId} className="text-xs">Status</Label>
          <Select value={filters.status} onValueChange={v => setFilters(f => ({ ...f, status: v }))}>
            <SelectTrigger id={filterStatusId} className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="added_to_crm">Added to CRM</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Label htmlFor={filterSourceId} className="text-xs">Source type</Label>
          <Select value={filters.sourceType} onValueChange={v => setFilters(f => ({ ...f, sourceType: v }))}>
            <SelectTrigger id={filterSourceId} className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="tax_lien">Tax lien</SelectItem>
              <SelectItem value="tax_deed">Tax deed</SelectItem>
              <SelectItem value="foreclosure">Foreclosure</SelectItem>
              <SelectItem value="auction">Auction</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Label htmlFor={filterScoreId} className="text-xs">Min distress score</Label>
          <Select value={filters.minDistressScore} onValueChange={v => setFilters(f => ({ ...f, minDistressScore: v }))}>
            <SelectTrigger id={filterScoreId} className="h-8"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="40">40+ moderate</SelectItem>
              <SelectItem value="60">60+ warm</SelectItem>
              <SelectItem value="80">80+ hot</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground ml-auto self-end pb-1" aria-live="polite"><span className="tabular-nums">{deals.length}</span> deal{deals.length === 1 ? "" : "s"}</p>
      </fieldset>

      {/* Bulk conversion bar */}
      <div className="flex items-center gap-3" role="group" aria-label="Bulk-convert actions">
        <Button variant="ghost" size="sm" className="text-xs" onClick={selectAllNew}>
          Select all new
        </Button>
        {selectedDealIds.size > 0 && (
          <>
            <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">{selectedDealIds.size} selected</span>
            <Button
              size="sm"
              className="text-xs"
              onClick={() => setPendingBulkConvert(true)}
              disabled={bulkConverting}
              aria-label={`Convert ${selectedDealIds.size} selected deal${selectedDealIds.size === 1 ? "" : "s"} to leads`}
            >
              {bulkConverting ? "Converting…" : `Convert ${selectedDealIds.size} to leads`}
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
          {[1, 2, 3, 4].map(i => <div key={i} className="h-36 bg-muted/50 rounded-card animate-pulse" />)}
        </div>
      ) : deals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center" role="status">
            <Search className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">No deals match your filters.</p>
            <p className="text-sm text-muted-foreground mt-1">Try scraping your sources or adjusting filters.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4 list-none p-0 m-0" aria-label={`${deals.length} matching deal${deals.length === 1 ? "" : "s"}`}>
          {deals.map(deal => (
            <li key={deal.id}>
              <Card className={`hover:shadow-md transition-shadow ${selectedDealIds.has(deal.id) ? "ring-2 ring-primary" : ""}`}>
                <CardContent className="p-4">
                  {deal.status === "new" && (
                    <div className="flex items-center gap-2 mb-2">
                      <Checkbox
                        checked={selectedDealIds.has(deal.id)}
                        onCheckedChange={() => toggleSelectDeal(deal.id)}
                        id={`chk-${deal.id}`}
                        aria-label={`Select ${deal.address || "address-unknown"} deal for bulk convert`}
                      />
                      <Label htmlFor={`chk-${deal.id}`} className="text-xs text-muted-foreground cursor-pointer">Select for bulk convert</Label>
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
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        {[deal.city, deal.county, deal.state].filter(Boolean).join(", ")}
                        {deal.zip && ` ${deal.zip}`}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0" aria-label={`Source: ${deal.sourceType.replace(/_/g, " ")}`}>
                      {deal.sourceType.replace(/_/g, " ")}
                    </Badge>
                  </div>

                  <dl className="grid grid-cols-3 gap-2 my-3 text-xs m-0">
                    {deal.sizeAcres != null && (
                      <div className="bg-muted/50 rounded p-2">
                        <dt className="text-muted-foreground">Acres</dt>
                        <dd className="font-semibold tabular-nums m-0">{deal.sizeAcres.toLocaleString()}</dd>
                      </div>
                    )}
                    {deal.minimumBid != null && (
                      <div className="bg-muted/50 rounded p-2">
                        <dt className="text-muted-foreground">Min bid</dt>
                        <dd className="font-semibold tabular-nums m-0">{usd(deal.minimumBid, { noCents: true })}</dd>
                      </div>
                    )}
                    {deal.assessedValue != null && (
                      <div className="bg-muted/50 rounded p-2">
                        <dt className="text-muted-foreground">Assessed</dt>
                        <dd className="font-semibold tabular-nums m-0">{usd(deal.assessedValue, { noCents: true })}</dd>
                      </div>
                    )}
                    {deal.taxesOwed != null && (
                      <div className="bg-acr-neg-soft dark:bg-acr-neg-soft/20 rounded p-2">
                        <dt className="text-muted-foreground">Taxes owed</dt>
                        <dd className="font-semibold tabular-nums text-acr-neg m-0">{usd(deal.taxesOwed, { noCents: true })}</dd>
                      </div>
                    )}
                  </dl>

                  {deal.auctionDate && (
                    <p className="text-xs text-acr-warn font-medium mb-2">
                      Auction: <time dateTime={new Date(deal.auctionDate).toISOString()}>{new Date(deal.auctionDate).toLocaleDateString()}</time>
                    </p>
                  )}

                  {deal.status === "new" && (
                    <div className="flex gap-2 mt-3" role="group" aria-label={`Convert deal ${deal.address || "address unknown"}`}>
                      <Button size="sm" variant="outline" className="flex-1 text-xs"
                        onClick={() => convertLeadMutation.mutate(deal.id)}
                        disabled={convertLeadMutation.isPending}
                        aria-label={`Add ${deal.address || "this deal"} to CRM as a lead`}>
                        <FileText className="w-3 h-3 mr-1" aria-hidden="true" /> Add as lead
                      </Button>
                      <Button size="sm" className="flex-1 text-xs"
                        onClick={() => convertPropertyMutation.mutate(deal.id)}
                        disabled={convertPropertyMutation.isPending}
                        aria-label={`Add ${deal.address || "this deal"} to portfolio as a property`}>
                        <Home className="w-3 h-3 mr-1" aria-hidden="true" /> Add as property
                      </Button>
                    </div>
                  )}

                  {deal.status === "added_to_crm" && (
                    <div className="flex items-center gap-1 text-xs text-acr-pos mt-2" role="status">
                      <CheckCircle className="w-3 h-3" aria-hidden="true" />
                      {deal.convertedToLeadId
                        ? <>Converted to lead #<span className="tabular-nums">{deal.convertedToLeadId}</span></>
                        : deal.convertedToPropertyId
                        ? <>Converted to property #<span className="tabular-nums">{deal.convertedToPropertyId}</span></>
                        : "Added to CRM"}
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingBulkConvert}
        onOpenChange={(open) => { if (!open) setPendingBulkConvert(false); }}
        title={`Convert ${selectedDealIds.size} deal${selectedDealIds.size === 1 ? "" : "s"} to leads?`}
        description="Each deal becomes a new lead in your CRM. The deals stay on this page marked as added to CRM. You can't undo a bulk convert in one step — leads would need to be deleted individually."
        confirmLabel={`Convert ${selectedDealIds.size}`}
        onConfirm={() => {
          handleBulkConvert();
          setPendingBulkConvert(false);
        }}
        isLoading={bulkConverting}
      />
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
  useDocumentTitle("Deal hunter");
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
        title: "New deal match",
        description: `${deal.title} — ${deal.matchScore}% match${deal.price ? ` · ${usd(Number(deal.price), { noCents: true })}` : ""}`,
      });
      setNewDealCount((c) => c + 1);
    });
    return cleanup;
  }, [on, toast]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <RequiredDisclaimer type="ai" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="w-7 h-7 text-primary" aria-hidden="true" /> Deal hunter
            {newDealCount > 0 && (
              <Badge className="bg-acr-neg text-white ml-1" data-testid="badge-new-deals" aria-live="polite" aria-label={`${newDealCount} new deal match${newDealCount === 1 ? "" : "es"}`}>
                <span className="tabular-nums">{newDealCount}</span> new
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground mt-1">
            Automated sourcing from tax auctions, foreclosures, and distressed property feeds.
          </p>
        </div>
        {newDealCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setNewDealCount(0)} className="text-xs text-muted-foreground" aria-label="Clear new-deal counter">
            Clear
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 m-0">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <dt className="text-sm text-muted-foreground">Total scraped</dt>
              <Database className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <dd className="text-2xl font-bold tabular-nums m-0">{Number(stats.totalDeals).toLocaleString()}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <dt className="text-sm text-muted-foreground">New deals</dt>
              <TrendingUp className="w-4 h-4 text-acr-accent" aria-hidden="true" />
            </div>
            <dd className="text-2xl font-bold tabular-nums text-acr-accent m-0">{Number(stats.newDeals).toLocaleString()}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <dt className="text-sm text-muted-foreground">High quality (70+)</dt>
              <Flame className="w-4 h-4 text-acr-neg" aria-hidden="true" />
            </div>
            <dd className="text-2xl font-bold tabular-nums text-acr-neg m-0">{Number(stats.highQualityDeals).toLocaleString()}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <dt className="text-sm text-muted-foreground">Converted</dt>
              <CheckCircle className="w-4 h-4 text-acr-pos" aria-hidden="true" />
            </div>
            <dd className="text-2xl font-bold tabular-nums text-acr-pos m-0">{Number(stats.convertedDeals).toLocaleString()}</dd>
          </CardContent>
        </Card>
      </dl>

      {/* Main Tabs */}
      <Tabs defaultValue="deals">
        <TabsList>
          <TabsTrigger value="deals">Deals</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="auto-bid">Auto-bid rules</TabsTrigger>
          <TabsTrigger value="health">Source health</TabsTrigger>
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
              <Bot className="w-4 h-4 text-primary" aria-hidden="true" /> Auto-bid rules
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
              <Activity className="w-4 h-4 text-primary" aria-hidden="true" /> Source health monitoring
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
