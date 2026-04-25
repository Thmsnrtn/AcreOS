import { useState, useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { AlertTriangle, BarChart3 } from "lucide-react";

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

export default function DealUnderwriting() {
  useDocumentTitle("Deal underwriting");
  const { toast } = useToast();
  const purchasePriceId = useId();
  const acreageId = useId();
  const stateId = useId();
  const taxesId = useId();
  const zoningId = useId();
  const roadId = useId();
  const utilitiesId = useId();

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
    onError: () =>
      toast({
        title: "Couldn't run scenarios",
        description: "Your inputs are unchanged. Try again, or check that price + acreage are positive numbers.",
        variant: "destructive",
      }),
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

  const formatPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Deal underwriting workbench</h1>
        <p className="text-muted-foreground">Model acquisition scenarios before committing capital.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Deal parameters</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor={purchasePriceId}>Purchase price</Label>
                <Input
                  id={purchasePriceId}
                  type="number"
                  placeholder="25000"
                  value={form.purchasePrice}
                  onChange={e => setForm(f => ({ ...f, purchasePrice: e.target.value }))}
                  className="tabular-nums"
                  inputMode="numeric"
                  min={0}
                  required
                />
              </div>
              <div>
                <Label htmlFor={acreageId}>Acreage</Label>
                <Input
                  id={acreageId}
                  type="number"
                  step="0.1"
                  placeholder="10"
                  value={form.acreage}
                  onChange={e => setForm(f => ({ ...f, acreage: e.target.value }))}
                  className="tabular-nums"
                  inputMode="decimal"
                  min={0}
                  required
                />
              </div>
              <div>
                <Label htmlFor={stateId}>State</Label>
                <Select value={form.state} onValueChange={v => setForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger id={stateId} aria-label="State"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={taxesId}>Annual taxes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id={taxesId}
                  type="number"
                  placeholder="800"
                  value={form.currentAnnualTaxes}
                  onChange={e => setForm(f => ({ ...f, currentAnnualTaxes: e.target.value }))}
                  className="tabular-nums"
                  inputMode="numeric"
                  min={0}
                />
              </div>
              <div>
                <Label htmlFor={zoningId}>Zoning</Label>
                <Select value={form.zoning} onValueChange={v => setForm(f => ({ ...f, zoning: v }))}>
                  <SelectTrigger id={zoningId} aria-label="Zoning"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rural">Rural / agricultural</SelectItem>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="recreational">Recreational</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={roadId}
                    checked={form.hasRoadAccess}
                    onCheckedChange={(v) => setForm(f => ({ ...f, hasRoadAccess: v === true }))}
                  />
                  <Label htmlFor={roadId} className="text-sm cursor-pointer">Road access</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={utilitiesId}
                    checked={form.hasUtilities}
                    onCheckedChange={(v) => setForm(f => ({ ...f, hasUtilities: v === true }))}
                  />
                  <Label htmlFor={utilitiesId} className="text-sm cursor-pointer">Utilities</Label>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={analyzeMutation.isPending}>
                {analyzeMutation.isPending ? "Analyzing…" : "Run scenarios"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {!results && !analyzeMutation.isPending && (
            <Card>
              <CardContent className="pt-12 pb-12 text-center text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" aria-hidden="true" />
                <p>Enter deal parameters and click <strong>Run scenarios</strong> to see base, bull, and bear case analysis.</p>
              </CardContent>
            </Card>
          )}

          {analyzeMutation.isPending && (
            <Card>
              <CardContent className="pt-12 pb-12 text-center" role="status" aria-live="polite">
                <span className="sr-only">Running scenario analysis…</span>
                <div className="animate-pulse text-muted-foreground">Running scenario analysis…</div>
              </CardContent>
            </Card>
          )}

          {results && (
            <Tabs defaultValue="base">
              <TabsList className="grid w-full grid-cols-3">
                {results.map(r => (
                  <TabsTrigger key={r.scenario} value={r.scenario} className="capitalize">
                    {r.scenario}
                  </TabsTrigger>
                ))}
              </TabsList>

              {results.map(r => (
                <TabsContent key={r.scenario} value={r.scenario} className="space-y-4">
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="pt-4">
                        <dt className="text-xs text-muted-foreground">Net profit</dt>
                        <dd className={`text-lg font-bold tabular-nums ${r.exitAnalysis.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {usd(r.exitAnalysis.netProfit)}
                        </dd>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <dt className="text-xs text-muted-foreground">ROI</dt>
                        <dd className={`text-lg font-bold tabular-nums ${r.exitAnalysis.roi >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {formatPct(r.exitAnalysis.roi)}
                        </dd>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <dt className="text-xs text-muted-foreground">Annualized ROI</dt>
                        <dd className="text-lg font-bold tabular-nums">{formatPct(r.exitAnalysis.annualizedROI)}</dd>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <dt className="text-xs text-muted-foreground">Equity multiple</dt>
                        <dd className="text-lg font-bold tabular-nums">{r.exitAnalysis.equityMultiple.toFixed(2)}x</dd>
                      </CardContent>
                    </Card>
                  </dl>

                  <Card>
                    <CardHeader><CardTitle className="text-sm">Exit strategy comparison</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="space-y-3" aria-label="Exit strategy options">
                        {(["wholesale", "ownerFinance", "retail"] as const).map(strategy => {
                          const s = r.exitStrategies[strategy];
                          const isRecommended = r.exitStrategies.recommended === strategy || (r.exitStrategies.recommended === "owner_finance" && strategy === "ownerFinance");
                          const label = strategy === "ownerFinance" ? "Owner finance" : strategy.charAt(0).toUpperCase() + strategy.slice(1);
                          return (
                            <li
                              key={strategy}
                              className={`p-3 rounded-lg border ${isRecommended ? "border-green-500 bg-green-50 dark:bg-green-950" : "border-border"}`}
                            >
                              <div className="flex items-center justify-between mb-1 gap-2">
                                <span className="font-medium text-sm">{label}</span>
                                {isRecommended && <Badge variant="default" className="text-xs bg-green-600">Recommended</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground">{s.recommendation}</p>
                              {strategy === "ownerFinance" ? (
                                <p className="text-sm font-semibold text-green-600 mt-1 tabular-nums">
                                  {usd((s as any).monthlyIncome)}/mo · {usd((s as any).totalReturn)} total
                                </p>
                              ) : (
                                <p className="text-sm font-semibold mt-1 tabular-nums">
                                  {usd((s as any).netProfit)} profit · <span>{(s as any).timeMonths} mo hold</span>
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>

                  {r.riskFactors.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-yellow-500" aria-hidden="true" />
                          Risk factors
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1" aria-label="Identified risk factors">
                          {r.riskFactors.map((risk, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-yellow-500 mt-0.5" aria-hidden="true">•</span>
                              {risk}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader><CardTitle className="text-sm">Cost breakdown</CardTitle></CardHeader>
                    <CardContent>
                      <dl className="text-sm space-y-2">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Purchase price</dt>
                          <dd className="tabular-nums">{usd(r.purchasePrice)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Acquisition costs</dt>
                          <dd className="tabular-nums">{usd(r.totalInvested - r.purchasePrice)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Holding costs</dt>
                          <dd className="tabular-nums">{usd(r.holdingCosts.totalHoldingCost)}</dd>
                        </div>
                        <div className="flex justify-between font-medium border-t pt-2">
                          <dt>Total invested</dt>
                          <dd className="tabular-nums">{usd(r.totalInvested + r.holdingCosts.totalHoldingCost)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Projected exit value</dt>
                          <dd className="tabular-nums">{usd(r.exitAnalysis.projectedValue)}</dd>
                        </div>
                        <div className="flex justify-between font-semibold text-green-600 border-t pt-2">
                          <dt>Net profit</dt>
                          <dd className="tabular-nums">{usd(r.exitAnalysis.netProfit)}</dd>
                        </div>
                      </dl>
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
