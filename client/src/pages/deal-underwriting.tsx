import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, TrendingUp, DollarSign, BarChart3, CheckCircle } from "lucide-react";

interface UnderwritingResult {
  scenario: "base" | "bull" | "bear";
  purchasePrice: number;
  totalInvested: number;
  holdingCosts: { totalHoldingCost: number };
  exitAnalysis: {
    projectedValue: number;
    netProfit: number;
    roi: number;
    annualizedROI: number;
    irr: number;
    equityMultiple: number;
  };
  exitStrategies: {
    wholesale: { netProfit: number; timeMonths: number; recommendation: string };
    ownerFinance: { monthlyIncome: number; totalReturn: number; recommendation: string };
    retail: { netProfit: number; timeMonths: number; recommendation: string };
    recommended: string;
  };
  riskFactors: string[];
  confidence: number;
}

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

const scenarioColors = {
  base: "blue",
  bull: "green",
  bear: "red",
};

const scenarioLabels = {
  base: "Base Case (3% appreciation)",
  bull: "Bull Case (7% appreciation)",
  bear: "Bear Case (-2% depreciation)",
};

export default function DealUnderwriting() {
  const [form, setForm] = useState({
    purchasePrice: "",
    acreage: "",
    state: "TX",
    county: "",
    currentAnnualTaxes: "",
    hasRoadAccess: true,
    hasUtilities: false,
    zoning: "rural",
  });

  const [results, setResults] = useState<UnderwritingResult[] | null>(null);

  const analyzeMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/deal-underwriting/analyze", data);
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data.results);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    analyzeMutation.mutate({
      purchasePrice: parseFloat(form.purchasePrice),
      acreage: parseFloat(form.acreage),
      state: form.state,
      county: form.county || undefined,
      currentAnnualTaxes: form.currentAnnualTaxes ? parseFloat(form.currentAnnualTaxes) : undefined,
      hasRoadAccess: form.hasRoadAccess,
      hasUtilities: form.hasUtilities,
      zoning: form.zoning,
    });
  };

  const formatCurrency = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  const formatPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Deal Underwriting Workbench</h1>
        <p className="text-muted-foreground">Model acquisition scenarios before committing capital</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Form */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Deal Parameters</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Purchase Price</Label>
                <Input
                  type="number"
                  placeholder="25000"
                  value={form.purchasePrice}
                  onChange={e => setForm(f => ({ ...f, purchasePrice: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>Acreage</Label>
                <Input
                  type="number"
                  placeholder="10"
                  value={form.acreage}
                  onChange={e => setForm(f => ({ ...f, acreage: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>State</Label>
                <Select value={form.state} onValueChange={v => setForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Annual Taxes (optional)</Label>
                <Input
                  type="number"
                  placeholder="800"
                  value={form.currentAnnualTaxes}
                  onChange={e => setForm(f => ({ ...f, currentAnnualTaxes: e.target.value }))}
                />
              </div>
              <div>
                <Label>Zoning</Label>
                <Select value={form.zoning} onValueChange={v => setForm(f => ({ ...f, zoning: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rural">Rural / Agricultural</SelectItem>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="recreational">Recreational</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.hasRoadAccess} onChange={e => setForm(f => ({ ...f, hasRoadAccess: e.target.checked }))} />
                  <span className="text-sm">Road Access</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.hasUtilities} onChange={e => setForm(f => ({ ...f, hasUtilities: e.target.checked }))} />
                  <span className="text-sm">Utilities</span>
                </label>
              </div>
              <Button type="submit" className="w-full" disabled={analyzeMutation.isPending}>
                {analyzeMutation.isPending ? "Analyzing..." : "Run Scenarios"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          {!results && !analyzeMutation.isPending && (
            <Card>
              <CardContent className="pt-12 pb-12 text-center text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>Enter deal parameters and click Run Scenarios to see base, bull, and bear case analysis.</p>
              </CardContent>
            </Card>
          )}

          {analyzeMutation.isPending && (
            <Card>
              <CardContent className="pt-12 pb-12 text-center">
                <div className="animate-pulse text-muted-foreground">Running scenario analysis...</div>
              </CardContent>
            </Card>
          )}

          {results && (
            <Tabs defaultValue="base">
              <TabsList className="grid w-full grid-cols-3">
                {results.map(r => (
                  <TabsTrigger key={r.scenario} value={r.scenario}>
                    {r.scenario === "base" ? "Base" : r.scenario === "bull" ? "Bull" : "Bear"}
                  </TabsTrigger>
                ))}
              </TabsList>

              {results.map(r => (
                <TabsContent key={r.scenario} value={r.scenario} className="space-y-4">
                  {/* Key Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Net Profit</p>
                        <p className={`text-lg font-bold ${r.exitAnalysis.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {formatCurrency(r.exitAnalysis.netProfit)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">ROI</p>
                        <p className={`text-lg font-bold ${r.exitAnalysis.roi >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {formatPct(r.exitAnalysis.roi)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Annual. ROI</p>
                        <p className="text-lg font-bold">{formatPct(r.exitAnalysis.annualizedROI)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Equity Multiple</p>
                        <p className="text-lg font-bold">{r.exitAnalysis.equityMultiple.toFixed(2)}x</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Exit Strategies */}
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Exit Strategy Comparison</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {(["wholesale", "ownerFinance", "retail"] as const).map(strategy => {
                        const s = r.exitStrategies[strategy];
                        const isRecommended = r.exitStrategies.recommended === strategy || r.exitStrategies.recommended === "owner_finance" && strategy === "ownerFinance";
                        return (
                          <div key={strategy} className={`p-3 rounded-lg border ${isRecommended ? "border-green-500 bg-green-50 dark:bg-green-950" : "border-border"}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-sm capitalize">
                                {strategy === "ownerFinance" ? "Owner Finance" : strategy}
                              </span>
                              {isRecommended && <Badge variant="default" className="text-xs bg-green-600">Recommended</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground">{s.recommendation}</p>
                            {strategy === "ownerFinance" ? (
                              <p className="text-sm font-semibold text-green-600 mt-1">
                                {formatCurrency((s as any).monthlyIncome)}/mo · {formatCurrency((s as any).totalReturn)} total
                              </p>
                            ) : (
                              <p className="text-sm font-semibold mt-1">
                                {formatCurrency((s as any).netProfit)} profit · {(s as any).timeMonths} mo hold
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>

                  {/* Risk Factors */}
                  {r.riskFactors.length > 0 && (
                    <Card>
                      <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-500" />Risk Factors</CardTitle></CardHeader>
                      <CardContent>
                        <ul className="space-y-1">
                          {r.riskFactors.map((risk, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-yellow-500 mt-0.5">•</span>
                              {risk}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  {/* Cost Breakdown */}
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Cost Breakdown</CardTitle></CardHeader>
                    <CardContent className="text-sm space-y-2">
                      <div className="flex justify-between"><span className="text-muted-foreground">Purchase Price</span><span>{formatCurrency(r.purchasePrice)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Acquisition Costs</span><span>{formatCurrency(r.totalInvested - r.purchasePrice)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Holding Costs</span><span>{formatCurrency(r.holdingCosts.totalHoldingCost)}</span></div>
                      <div className="flex justify-between font-medium border-t pt-2"><span>Total Invested</span><span>{formatCurrency(r.totalInvested + r.holdingCosts.totalHoldingCost)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Projected Exit Value</span><span>{formatCurrency(r.exitAnalysis.projectedValue)}</span></div>
                      <div className="flex justify-between font-semibold text-green-600 border-t pt-2"><span>Net Profit</span><span>{formatCurrency(r.exitAnalysis.netProfit)}</span></div>
                    </CardContent>
                  </Card>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
