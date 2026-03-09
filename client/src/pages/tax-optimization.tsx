import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingDown, Star, Trash2, Plus, RefreshCw, Building2, DollarSign,
  BarChart2, FileText, AlertCircle, MapPin,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Strategy {
  id: string;
  name: string;
  type: "1031_exchange" | "opportunity_zone" | "depreciation" | "cost_segregation" | "installment_sale" | "charitable";
  estimatedSavings: number;
  complexity: "low" | "medium" | "high";
  timeHorizon: string;
  description: string;
  applicableStates?: string[];
  requirements?: string[];
}

interface TaxScenario {
  id: string;
  name: string;
  scenarioType: "hold" | "sell" | "exchange";
  propertyId?: string;
  estimatedTax: number;
  netProceeds: number;
  effectiveRate: number;
  notes: string;
  createdAt: string;
}

interface CostBasisRecord {
  propertyId: string;
  propertyAddress?: string;
  purchasePrice: number;
  closingCosts: number;
  improvements: number;
  depreciationTaken: number;
  adjustedBasis: number;
  acquisitionDate: string;
}

interface DepreciationScheduleEntry {
  year: number;
  depreciation: number;
  cumulativeDepreciation: number;
  bookValue: number;
}

interface ProjectionYear {
  year: number;
  taxLiability: number;
  afterTaxReturn: number;
  strategySavings: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtCurrency(val: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-muted/50 rounded animate-pulse ${className}`} />;
}

function ComplexityBadge({ complexity }: { complexity: string }) {
  const map: Record<string, string> = {
    low: "bg-green-100 text-green-800",
    medium: "bg-yellow-100 text-yellow-800",
    high: "bg-red-100 text-red-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[complexity] ?? "bg-gray-100 text-gray-600"}`}>
      {complexity} complexity
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    "1031_exchange": "1031 Exchange",
    "opportunity_zone": "Opportunity Zone",
    "depreciation": "Depreciation",
    "cost_segregation": "Cost Segregation",
    "installment_sale": "Installment Sale",
    "charitable": "Charitable",
  };
  return <Badge variant="outline" className="text-xs">{labels[type] ?? type}</Badge>;
}

// ─── Strategy Cards Tab ───────────────────────────────────────────────────────

function StrategiesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/tax-optimization/strategies"],
    queryFn: async () => {
      const res = await fetch("/api/tax-optimization/strategies", { credentials: "include" });
      return res.json();
    },
  });

  const strategies: Strategy[] = data?.strategies ?? [];

  const analysisMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tax-optimization/analyze", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxYear: new Date().getFullYear(), includeProjections: true }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{strategies.length} recommended strategies</p>
        <Button size="sm" variant="outline" onClick={() => analysisMutation.mutate()}
          disabled={analysisMutation.isPending}>
          <RefreshCw className={`w-4 h-4 mr-1 ${analysisMutation.isPending ? "animate-spin" : ""}`} />
          Run Analysis
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : strategies.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Star className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No strategies available yet</p>
            <p className="text-sm text-muted-foreground mt-1">Run an analysis to get personalized recommendations</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {strategies.map(s => (
            <Card key={s.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <TypeBadge type={s.type} />
                      <ComplexityBadge complexity={s.complexity} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">Est. Savings</p>
                    <p className="text-lg font-bold text-green-600">{fmtCurrency(s.estimatedSavings)}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{s.description}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Horizon: <strong>{s.timeHorizon}</strong></span>
                  {s.applicableStates && s.applicableStates.length > 0 && (
                    <span>States: <strong>{s.applicableStates.join(", ")}</strong></span>
                  )}
                </div>
                {s.requirements && s.requirements.length > 0 && (
                  <ul className="text-xs space-y-0.5 mt-1">
                    {s.requirements.map((r, i) => (
                      <li key={i} className="text-muted-foreground flex gap-1.5">
                        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> {r}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Scenarios Tab ────────────────────────────────────────────────────────────

function CreateScenarioDialog({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    scenarioType: "hold",
    propertyId: "",
    notes: "",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tax-optimization/scenarios", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, propertyId: form.propertyId || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Scenario created" });
      setOpen(false);
      setForm({ name: "", scenarioType: "hold", propertyId: "", notes: "" });
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Scenario</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Tax Scenario</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Scenario Name</Label>
            <Input placeholder="e.g. Hold 5 years vs 1031" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.scenarioType} onValueChange={v => setForm(f => ({ ...f, scenarioType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hold">Hold</SelectItem>
                  <SelectItem value="sell">Sell</SelectItem>
                  <SelectItem value="exchange">1031 Exchange</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Property ID (optional)</Label>
              <Input placeholder="prop_123" value={form.propertyId}
                onChange={e => setForm(f => ({ ...f, propertyId: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea placeholder="Assumptions and notes…" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
          </div>
          <Button className="w-full" onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.name}>
            {createMutation.isPending ? "Creating…" : "Create Scenario"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScenariosTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/tax-optimization/scenarios"],
    queryFn: async () => {
      const res = await fetch("/api/tax-optimization/scenarios", { credentials: "include" });
      return res.json();
    },
  });

  const scenarios: TaxScenario[] = data?.scenarios ?? [];

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tax-optimization/scenarios/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Scenario deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-optimization/scenarios"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const scenarioTypeColors: Record<string, string> = {
    hold: "bg-blue-100 text-blue-800",
    sell: "bg-orange-100 text-orange-800",
    exchange: "bg-green-100 text-green-800",
  };

  // Chart data for comparison
  const chartData = scenarios.map(s => ({
    name: s.name.length > 16 ? s.name.slice(0, 14) + "…" : s.name,
    "Est. Tax": s.estimatedTax,
    "Net Proceeds": s.netProceeds,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{scenarios.length} scenarios</p>
        <CreateScenarioDialog onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/tax-optimization/scenarios"] })} />
      </div>

      {scenarios.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Hold / Sell / Exchange Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={(val: number) => fmtCurrency(val)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Est. Tax" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Net Proceeds" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-28" />)}</div>
      ) : scenarios.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No scenarios yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create scenarios to compare hold, sell, and exchange outcomes</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scenarios.map(s => (
            <Card key={s.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${scenarioTypeColors[s.scenarioType] ?? "bg-gray-100"}`}>
                      {s.scenarioType}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMutation.mutate(s.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-red-50 dark:bg-red-950/20 rounded p-2">
                    <p className="text-muted-foreground">Est. Tax</p>
                    <p className="font-semibold text-red-600">{fmtCurrency(s.estimatedTax)}</p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-950/20 rounded p-2">
                    <p className="text-muted-foreground">Net Proceeds</p>
                    <p className="font-semibold text-green-600">{fmtCurrency(s.netProceeds)}</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-muted-foreground">Eff. Rate</p>
                    <p className="font-semibold">{(s.effectiveRate * 100).toFixed(1)}%</p>
                  </div>
                </div>
                {s.notes && <p className="text-xs text-muted-foreground mt-2">{s.notes}</p>}
                <p className="text-xs text-muted-foreground mt-1">Created {fmtDate(s.createdAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Cost Basis Tab ──────────────────────────────────────────────────────────

function CostBasisTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/tax-optimization/cost-basis"],
    queryFn: async () => {
      // Use a generic endpoint — cost basis per property fetched individually in real usage
      const res = await fetch("/api/tax-optimization/cost-basis/all", { credentials: "include" });
      return res.json();
    },
  });

  const records: CostBasisRecord[] = data?.records ?? [];

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No cost basis records</p>
            <p className="text-sm text-muted-foreground mt-1">Cost basis is tracked per property</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Purchase Price</TableHead>
                <TableHead>Closing Costs</TableHead>
                <TableHead>Improvements</TableHead>
                <TableHead>Depreciation Taken</TableHead>
                <TableHead>Adjusted Basis</TableHead>
                <TableHead>Acquired</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map(r => (
                <TableRow key={r.propertyId}>
                  <TableCell>
                    <p className="font-medium text-sm">{r.propertyAddress ?? r.propertyId}</p>
                    <p className="text-xs text-muted-foreground font-mono">{r.propertyId}</p>
                  </TableCell>
                  <TableCell>{fmtCurrency(r.purchasePrice)}</TableCell>
                  <TableCell>{fmtCurrency(r.closingCosts)}</TableCell>
                  <TableCell>{fmtCurrency(r.improvements)}</TableCell>
                  <TableCell className="text-red-600">-{fmtCurrency(r.depreciationTaken)}</TableCell>
                  <TableCell className="font-semibold">{fmtCurrency(r.adjustedBasis)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(r.acquisitionDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Projections Chart ────────────────────────────────────────────────────────

function ProjectionsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/tax-optimization/projections"],
    queryFn: async () => {
      const res = await fetch("/api/tax-optimization/projections", { credentials: "include" });
      return res.json();
    },
  });

  const projections: ProjectionYear[] = data?.projections ?? [];

  return (
    <div className="space-y-4">
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : projections.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No projection data available</p>
            <p className="text-sm text-muted-foreground mt-1">Run a portfolio analysis to generate multi-year projections</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Multi-Year Tax Projection</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={projections} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={65} />
                <Tooltip formatter={(val: number) => fmtCurrency(val)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="taxLiability" name="Tax Liability" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="afterTaxReturn" name="After-Tax Return" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="strategySavings" name="Strategy Savings" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* State-specific notes section */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" /> State-Specific Tax Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {[
              { state: "TX", note: "No state income tax. Property tax rates average 1.8%." },
              { state: "FL", note: "No state income tax. Homestead exemption reduces assessed value." },
              { state: "CA", note: "13.3% top rate. Prop 13 limits reassessment at 2% annually." },
              { state: "NY", note: "10.9% top rate. NYC additional local tax applies in city." },
            ].map(item => (
              <div key={item.state} className="border rounded p-3">
                <p className="font-semibold text-xs mb-1">{item.state}</p>
                <p className="text-xs text-muted-foreground">{item.note}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Depreciation Viewer ──────────────────────────────────────────────────────

function DepreciationTab() {
  const [propertyId, setPropertyId] = useState("");
  const [method, setMethod] = useState("straight_line");
  const [submitted, setSubmitted] = useState<{ id: string; method: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/tax-optimization/depreciation", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const res = await fetch(
        `/api/tax-optimization/depreciation/${submitted!.id}?method=${submitted!.method}`,
        { credentials: "include" }
      );
      return res.json();
    },
  });

  const schedule: DepreciationScheduleEntry[] = data?.schedule?.entries ?? [];
  const summary = data?.schedule?.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]">
              <Label className="text-xs">Property ID</Label>
              <Input placeholder="prop_123" value={propertyId}
                onChange={e => setPropertyId(e.target.value)} />
            </div>
            <div className="w-48">
              <Label className="text-xs">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="straight_line">Straight-Line</SelectItem>
                  <SelectItem value="accelerated">Accelerated (MACRS)</SelectItem>
                  <SelectItem value="bonus">Bonus Depreciation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setSubmitted({ id: propertyId, method })} disabled={!propertyId}>
              View Schedule
            </Button>
          </div>
        </CardContent>
      </Card>

      {submitted && (
        <>
          {summary && (
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Depreciable Basis</p>
                  <p className="text-lg font-bold">{fmtCurrency(summary.depreciableBasis ?? 0)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Useful Life</p>
                  <p className="text-lg font-bold">{summary.usefulLife ?? "—"} yrs</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Annual Deduction</p>
                  <p className="text-lg font-bold">{fmtCurrency(summary.annualDeduction ?? 0)}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {isLoading ? (
            <Skeleton className="h-48" />
          ) : schedule.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">No depreciation schedule available for this property</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead>
                    <TableHead>Annual Depreciation</TableHead>
                    <TableHead>Cumulative Depreciation</TableHead>
                    <TableHead>Book Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.slice(0, 30).map(row => (
                    <TableRow key={row.year}>
                      <TableCell className="font-medium">{row.year}</TableCell>
                      <TableCell>{fmtCurrency(row.depreciation)}</TableCell>
                      <TableCell>{fmtCurrency(row.cumulativeDepreciation)}</TableCell>
                      <TableCell>{fmtCurrency(row.bookValue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TaxOptimizationPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <DollarSign className="w-7 h-7 text-primary" /> Tax Optimization
        </h1>
        <p className="text-muted-foreground mt-1">
          Strategy recommendations, scenario modeling, cost basis tracking, and depreciation schedules
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="strategies">
        <TabsList>
          <TabsTrigger value="strategies">Strategies</TabsTrigger>
          <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
          <TabsTrigger value="cost-basis">Cost Basis</TabsTrigger>
          <TabsTrigger value="projections">Projections</TabsTrigger>
          <TabsTrigger value="depreciation">Depreciation</TabsTrigger>
        </TabsList>

        <TabsContent value="strategies" className="mt-4">
          <StrategiesTab />
        </TabsContent>
        <TabsContent value="scenarios" className="mt-4">
          <ScenariosTab />
        </TabsContent>
        <TabsContent value="cost-basis" className="mt-4">
          <CostBasisTab />
        </TabsContent>
        <TabsContent value="projections" className="mt-4">
          <ProjectionsTab />
        </TabsContent>
        <TabsContent value="depreciation" className="mt-4">
          <DepreciationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
