import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Building, Users, DollarSign, BarChart2, Plus, ArrowRight } from "lucide-react";

function RatingBadge({ rating }: { rating: string }) {
  const colors: Record<string, string> = { AAA: "bg-green-100 text-green-800", AA: "bg-blue-100 text-blue-800", A: "bg-sky-100 text-sky-800", BBB: "bg-yellow-100 text-yellow-800" };
  return <Badge className={colors[rating] ?? "bg-gray-100 text-gray-600"}>{rating}</Badge>;
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export default function CapitalMarketsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: securitiesData } = useQuery({
    queryKey: ["/api/capital-markets/securities"],
    queryFn: async () => {
      const res = await fetch("/api/capital-markets/securities", { credentials: "include" });
      return res.json();
    },
  });

  const { data: lendersData } = useQuery({
    queryKey: ["/api/capital-markets/lenders"],
    queryFn: async () => {
      const res = await fetch("/api/capital-markets/lenders", { credentials: "include" });
      return res.json();
    },
  });

  const { data: raisesData } = useQuery({
    queryKey: ["/api/capital-markets/raises"],
    queryFn: async () => {
      const res = await fetch("/api/capital-markets/raises", { credentials: "include" });
      return res.json();
    },
  });

  const { data: efficiencyData } = useQuery({
    queryKey: ["/api/capital-markets/efficiency"],
    queryFn: async () => {
      const res = await fetch("/api/capital-markets/efficiency", { credentials: "include" });
      return res.json();
    },
  });

  const securities = securitiesData?.securities ?? [];
  const lenders = lendersData?.lenders ?? [];
  const raises = raisesData?.raises ?? [];
  const metrics = efficiencyData?.metrics;

  // ── Match Lenders Dialog ──
  const [matchForm, setMatchForm] = useState({ dealAmount: "", state: "", ltv: "" });
  const [matchResults, setMatchResults] = useState<any[]>([]);
  const matchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/capital-markets/match-lenders", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealAmount: parseFloat(matchForm.dealAmount), state: matchForm.state, ltv: parseFloat(matchForm.ltv) }),
      });
      return res.json();
    },
    onSuccess: (data) => setMatchResults(data.matches ?? []),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="w-7 h-7 text-primary" /> Capital Markets
        </h1>
        <p className="text-muted-foreground mt-1">
          Note securitization, lender matching, and capital raise management
        </p>
      </div>

      {/* KPI Cards */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Capital Deployed</p>
            <p className="text-xl font-bold">{fmt(metrics.totalCapitalDeployed ?? 0)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active Securities</p>
            <p className="text-xl font-bold text-blue-600">{metrics.activeSecurities ?? securities.length}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Avg Yield</p>
            <p className="text-xl font-bold text-green-600">{metrics.avgYield ? `${metrics.avgYield.toFixed(1)}%` : "—"}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Capital Efficiency</p>
            <p className="text-xl font-bold">{metrics.capitalEfficiencyRatio ? `${(metrics.capitalEfficiencyRatio * 100).toFixed(0)}%` : "—"}</p>
          </CardContent></Card>
        </div>
      )}

      <Tabs defaultValue="securities">
        <TabsList>
          <TabsTrigger value="securities">Securities</TabsTrigger>
          <TabsTrigger value="lenders">Lender Network</TabsTrigger>
          <TabsTrigger value="raises">Capital Raises</TabsTrigger>
          <TabsTrigger value="match">Match Lenders</TabsTrigger>
        </TabsList>

        {/* Securities */}
        <TabsContent value="securities" className="mt-4">
          {securities.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <BarChart2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">No securitization offerings yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Pool your seller-financed notes to create offerings for institutional investors.</p>
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {securities.map((sec: any) => (
                <Card key={sec.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{sec.name ?? `Security #${sec.id}`}</span>
                      <RatingBadge rating={sec.rating ?? "A"} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><p className="text-muted-foreground">Total Principal</p><p className="font-semibold">{fmt(sec.totalPrincipal ?? 0)}</p></div>
                      <div><p className="text-muted-foreground">Yield</p><p className="font-semibold text-green-600">{sec.expectedYield?.toFixed(1) ?? "—"}%</p></div>
                      <div><p className="text-muted-foreground">Min Investment</p><p className="font-semibold">{fmt(sec.minimumInvestment ?? 0)}</p></div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Notes in pool</span>
                        <span>{sec.noteCount ?? "—"}</span>
                      </div>
                      <Progress value={Math.min((sec.soldPercentage ?? 0), 100)} className="h-1.5" />
                      <p className="text-xs text-muted-foreground mt-0.5">{sec.soldPercentage ?? 0}% subscribed</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Lenders */}
        <TabsContent value="lenders" className="mt-4">
          <div className="space-y-3">
            {lenders.length === 0 ? (
              <Card><CardContent className="py-12 text-center">
                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground">No lenders in your network yet.</p>
              </CardContent></Card>
            ) : lenders.map((lender: any) => (
              <Card key={lender.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{lender.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{lender.lenderType?.replace(/_/g, " ")} · {lender.state ?? "National"}</p>
                      <div className="flex gap-3 mt-2 text-xs">
                        <span>Min: {fmt(lender.minLoanAmount ?? 0)}</span>
                        <span>Max: {fmt(lender.maxLoanAmount ?? 0)}</span>
                        <span>Rate: {lender.minRate ?? "—"}–{lender.maxRate ?? "—"}%</span>
                      </div>
                    </div>
                    <Badge variant="outline">{lender.propertyTypes?.join(", ") ?? "All"}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Capital Raises */}
        <TabsContent value="raises" className="mt-4">
          {raises.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <DollarSign className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">No capital raise campaigns active.</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              {raises.map((raise: any) => (
                <Card key={raise.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{raise.name}</p>
                      <Badge variant={raise.status === "active" ? "default" : "secondary"}>{raise.status}</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><p className="text-muted-foreground">Target</p><p className="font-bold">{fmt(raise.targetAmount ?? 0)}</p></div>
                      <div><p className="text-muted-foreground">Raised</p><p className="font-bold text-green-600">{fmt(raise.raisedAmount ?? 0)}</p></div>
                      <div><p className="text-muted-foreground">Investors</p><p className="font-bold">{raise.investorCount ?? 0}</p></div>
                    </div>
                    <div>
                      <Progress value={raise.targetAmount ? Math.min((raise.raisedAmount / raise.targetAmount) * 100, 100) : 0} className="h-2" />
                      <p className="text-xs text-muted-foreground mt-1">
                        {raise.targetAmount ? `${((raise.raisedAmount / raise.targetAmount) * 100).toFixed(0)}% funded` : "—"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Match Lenders */}
        <TabsContent value="match" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-sm">Find Matching Lenders</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Deal Amount ($)</Label>
                  <Input type="number" placeholder="500000" value={matchForm.dealAmount}
                    onChange={e => setMatchForm(f => ({ ...f, dealAmount: e.target.value }))} />
                </div>
                <div>
                  <Label>State</Label>
                  <Input placeholder="TX" maxLength={2} value={matchForm.state}
                    onChange={e => setMatchForm(f => ({ ...f, state: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <Label>LTV (%)</Label>
                  <Input type="number" placeholder="65" value={matchForm.ltv}
                    onChange={e => setMatchForm(f => ({ ...f, ltv: e.target.value }))} />
                </div>
                <Button className="w-full" onClick={() => matchMutation.mutate()} disabled={matchMutation.isPending}>
                  <ArrowRight className="w-4 h-4 mr-1" />
                  {matchMutation.isPending ? "Matching…" : "Find Lenders"}
                </Button>
              </CardContent>
            </Card>
            <div className="space-y-3">
              {matchResults.length === 0 ? (
                <Card><CardContent className="py-10 text-center">
                  <Building className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Enter deal details to find matching lenders.</p>
                </CardContent></Card>
              ) : matchResults.map((l: any, i: number) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <p className="font-semibold">{l.name}</p>
                    <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{l.lenderType}</span>
                      <span>{l.minRate}–{l.maxRate}% rate</span>
                      <span>Max {fmt(l.maxLoanAmount ?? 0)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
