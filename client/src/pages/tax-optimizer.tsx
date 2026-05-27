import { useState, useId } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  RefreshCw,
  FileText,
  Loader2,
  ArrowRightLeft,
  Calendar,
  ChevronRight,
  CheckCircle2,
  Scale,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";

interface TaxPosition {
  taxYear: number;
  totalRealizedGains: number;
  longTermGains: number;
  shortTermGains: number;
  unrealizedGains: number;
  potentialLosses: number;
  estimatedFederalTax: number;
  estimatedNIIT: number;
  totalEstimatedTax: number;
  transactions: TaxTransaction[];
  recommendations: TaxRecommendation[];
  installmentSaleOpportunities: InstallmentSale[];
  exchange1031Candidates: Exchange1031[];
}

interface TaxTransaction {
  dealId: number;
  propertyAddress: string;
  saleProceeds: number;
  acquisitionCost: number;
  realizedGain: number;
  holdingPeriodDays: number;
  isLongTerm: boolean;
  estimatedTax: number;
  taxSavingOpportunities: string[];
}

interface TaxRecommendation {
  priority: "critical" | "high" | "medium" | "low";
  category: string;
  title: string;
  description: string;
  estimatedSavings: number;
  deadline?: string;
  actionItems: string[];
}

interface InstallmentSale {
  dealId: number;
  propertyAddress: string;
  totalGain: number;
  spreadOverYears: number;
  annualTaxSavings: number;
  notes: string;
}

interface Exchange1031 {
  dealId: number;
  propertyAddress: string;
  gain: number;
  deadline45Day: string;
  deadline180Day: string;
  potentialTaxDeferred: number;
}

interface DealerFactor {
  code: string;
  label: string;
  citation: string;
  score: number;
  detail: string;
}

interface DealerClassification {
  signal: "investor" | "ambiguous" | "likely_dealer" | "dealer";
  weightedScore: number;
  dealerProbabilityPct: number;
  factors: DealerFactor[];
  stats: {
    salesLast12Months: number;
    salesLast24Months: number;
    medianHoldDays: number;
    shortHoldShare: number;
    averageActiveListings: number;
  };
  auditDefense: string[];
  dealerConsequences: string[];
}

interface RealEstateProfessionalResult {
  qualifies: boolean;
  passes50PctTest: boolean;
  passes750HourTest: boolean;
  realEstateHours: number;
  totalWorkHours: number;
  realEstateSharePct: number;
  consequences: string[];
  documentationRequirements: string[];
  qualifyingActivities: string[];
}

const PRIORITY_CONFIG = {
  critical: { label: "Critical", variant: "destructive" as const, color: "text-acr-neg" },
  high: { label: "High", variant: "default" as const, color: "text-acr-warn" },
  medium: { label: "Medium", variant: "secondary" as const, color: "text-acr-warn" },
  low: { label: "Low", variant: "outline" as const, color: "text-acr-accent" },
};

export default function TaxOptimizerPage() {
  useDocumentTitle("Tax optimizer");
  const { toast } = useToast();
  const yearSelectId = useId();
  const currentYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState(currentYear.toString());

  const { data: position, isLoading, error, refetch } = useQuery<TaxPosition>({
    queryKey: ["/api/tax-optimizer/position", taxYear],
    queryFn: () =>
      fetch(`/api/tax-optimizer/position?year=${taxYear}`).then(r => {
        if (!r.ok) throw new Error(`Failed to load tax position (${r.status})`);
        return r.json();
      }),
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/tax-optimizer/report", { taxYear: parseInt(taxYear) }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Report generated", description: "AI tax planning report ready." });
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't generate AI report",
        description: `${err.message}. Your tax position is unchanged — try again.`,
        variant: "destructive",
      }),
  });

  if (isLoading) {
    return (
      <PageShell label="Tax optimizer">
        <div className="space-y-6" aria-busy="true" aria-label="Loading tax optimizer">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-2">
              <Skeleton className="h-7 w-44" />
              <Skeleton className="h-4 w-72" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-9" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-5 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-7 w-28" />
                  <Skeleton className="h-3 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell label="Tax optimizer">
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Couldn't load tax position"
        />
      </PageShell>
    );
  }

  const p = position;

  return (
    <PageShell label="Tax optimizer">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Tax optimizer</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Capital gains analysis, 1031 exchanges, and year-end tax planning.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Label htmlFor={yearSelectId} className="sr-only">Tax year</Label>
          <Select value={taxYear} onValueChange={setTaxYear}>
            <SelectTrigger id={yearSelectId} className="w-32 tabular-nums" aria-label="Tax year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentYear, currentYear - 1, currentYear - 2].map(y => (
                <SelectItem key={y} value={y.toString()} className="tabular-nums">{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} aria-label="Refresh tax position">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            onClick={() => reportMutation.mutate()}
            disabled={reportMutation.isPending}
            aria-label={`Generate AI tax planning report for ${taxYear}`}
          >
            {reportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : <FileText className="h-4 w-4 mr-2" aria-hidden="true" />}
            AI report
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-5">
            <dt className="text-sm text-muted-foreground">Total gains</dt>
            <dd className="text-2xl font-bold text-acr-pos tabular-nums">{usd(p?.totalRealizedGains || 0, { noCents: true })}</dd>
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">Realized {taxYear}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <dt className="text-sm text-muted-foreground">Est. federal tax</dt>
            <dd className="text-2xl font-bold text-acr-neg tabular-nums">{usd(p?.estimatedFederalTax || 0, { noCents: true })}</dd>
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">+{usd(p?.estimatedNIIT || 0, { noCents: true })} NIIT</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <dt className="text-sm text-muted-foreground">Long-term gains</dt>
            <dd className="text-2xl font-bold tabular-nums">{usd(p?.longTermGains || 0, { noCents: true })}</dd>
            <p className="text-xs text-muted-foreground mt-0.5">≤ <span className="tabular-nums">15</span>% rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <dt className="text-sm text-muted-foreground">Total tax owed</dt>
            <dd className="text-2xl font-bold text-acr-warn tabular-nums">{usd(p?.totalEstimatedTax || 0, { noCents: true })}</dd>
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">Est. {taxYear}</p>
          </CardContent>
        </Card>
      </dl>

      {reportMutation.data && (
        <Card className="mb-6 border-acr-accent dark:border-acr-accent" role="region" aria-label="AI tax planning report">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-acr-accent" aria-hidden="true" />
              AI tax planning report — <span className="tabular-nums">{taxYear}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{reportMutation.data.report}</p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="recommendations">
        <TabsList>
          <TabsTrigger value="recommendations">
            Recommendations (<span className="tabular-nums">{p?.recommendations?.length || 0}</span>)
          </TabsTrigger>
          <TabsTrigger value="transactions">
            Transactions (<span className="tabular-nums">{p?.transactions?.length || 0}</span>)
          </TabsTrigger>
          <TabsTrigger value="1031">
            1031 exchange (<span className="tabular-nums">{p?.exchange1031Candidates?.length || 0}</span>)
          </TabsTrigger>
          <TabsTrigger value="installment">
            Installment sales (<span className="tabular-nums">{p?.installmentSaleOpportunities?.length || 0}</span>)
          </TabsTrigger>
          <TabsTrigger value="classification">
            Dealer vs. investor
          </TabsTrigger>
          <TabsTrigger value="re-professional">
            §469 RE-pro test
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="mt-4">
          {!p?.recommendations?.length ? (
            <Card>
              <CardContent className="py-10 text-center">
                <CheckCircle2 className="h-10 w-10 text-acr-pos mx-auto mb-3" aria-hidden="true" />
                <p className="text-muted-foreground">No tax recommendations for <span className="tabular-nums">{taxYear}</span>. No realized gains found.</p>
              </CardContent>
            </Card>
          ) : (
            <ol className="space-y-3" aria-label="Tax recommendations, ranked by priority">
              {p.recommendations.map((rec, i) => {
                const cfg = PRIORITY_CONFIG[rec.priority];
                return (
                  <li key={i}>
                    <Card role={rec.priority === "critical" ? "alert" : undefined}>
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant={cfg.variant}>{cfg.label}</Badge>
                              <span className="font-medium text-sm">{rec.title}</span>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">{rec.description}</p>
                            {rec.estimatedSavings > 0 && (
                              <p className="text-sm text-acr-pos font-medium mb-2 tabular-nums">
                                Potential savings: {usd(rec.estimatedSavings, { noCents: true })}
                              </p>
                            )}
                            {rec.deadline && (
                              <p className="text-xs text-acr-warn flex items-center gap-1 mb-2 tabular-nums">
                                <Calendar className="h-3 w-3" aria-hidden="true" />
                                Deadline: {rec.deadline}
                              </p>
                            )}
                            <ul className="space-y-1" aria-label={`Action items for ${rec.title}`}>
                              {rec.actionItems.map((item, j) => (
                                <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                  <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-acr-accent" aria-hidden="true" />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
        </TabsContent>

        <TabsContent value="transactions" className="mt-4">
          {!p?.transactions?.length ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground">No closed deals found for <span className="tabular-nums">{taxYear}</span>.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <div role="region" aria-label="Capital gains transactions" tabIndex={0}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Property</TableHead>
                      <TableHead scope="col" className="text-right">Sale price</TableHead>
                      <TableHead scope="col" className="text-right">Gain/loss</TableHead>
                      <TableHead scope="col">Type</TableHead>
                      <TableHead scope="col" className="text-right">Est. tax</TableHead>
                      <TableHead scope="col">Opportunities</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.transactions.map(tx => (
                      <TableRow key={tx.dealId}>
                        <th scope="row" className="font-medium max-w-[200px] truncate px-4 text-left">{tx.propertyAddress}</th>
                        <TableCell className="text-right tabular-nums">{usd(tx.saleProceeds, { noCents: true })}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${tx.realizedGain >= 0 ? "text-acr-pos" : "text-acr-neg"}`}>
                          {tx.realizedGain >= 0 ? "+" : ""}{usd(tx.realizedGain, { noCents: true })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={tx.isLongTerm ? "default" : "secondary"} aria-label={tx.isLongTerm ? "Long-term capital gain" : "Short-term capital gain"}>
                            {tx.isLongTerm ? "LT" : "ST"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-acr-neg tabular-nums">{usd(tx.estimatedTax, { noCents: true })}</TableCell>
                        <TableCell className="max-w-[200px]">
                          {tx.taxSavingOpportunities.length > 0 ? (
                            <span className="text-xs text-acr-pos">{tx.taxSavingOpportunities[0]}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="1031" className="mt-4">
          {!p?.exchange1031Candidates?.length ? (
            <Card>
              <CardContent className="py-10 text-center">
                <ArrowRightLeft className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="text-muted-foreground">No 1031 exchange candidates for <span className="tabular-nums">{taxYear}</span>.</p>
                <p className="text-sm text-muted-foreground mt-1">Long-term capital gains over <span className="tabular-nums">$25,000</span> qualify.</p>
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3" aria-label="1031 exchange candidates">
              {p.exchange1031Candidates.map((c, i) => (
                <li key={i}>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <h3 className="font-medium">{c.propertyAddress}</h3>
                          <p className="text-sm text-muted-foreground mt-0.5 tabular-nums">
                            Gain: <span className="text-acr-pos font-medium">{usd(c.gain, { noCents: true })}</span>
                            {" · "}Tax deferred: <span className="text-acr-accent font-medium">{usd(c.potentialTaxDeferred, { noCents: true })}</span>
                          </p>
                        </div>
                        <Badge variant="outline">Deal #<span className="tabular-nums">{c.dealId}</span></Badge>
                      </div>
                      <dl className="grid grid-cols-2 gap-3 mt-3 p-3 bg-acr-warn-soft dark:bg-acr-warn-soft/10 rounded-card">
                        <div>
                          <dt className="text-xs text-acr-warn dark:text-acr-warn font-medium">45-day ID deadline</dt>
                          <dd className="text-sm font-bold tabular-nums">{format(new Date(c.deadline45Day), "MMM d, yyyy")}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-acr-warn dark:text-acr-warn font-medium">180-day close deadline</dt>
                          <dd className="text-sm font-bold tabular-nums">{format(new Date(c.deadline180Day), "MMM d, yyyy")}</dd>
                        </div>
                      </dl>
                      <p className="text-xs text-muted-foreground mt-2 tabular-nums">
                        Must reinvest at least {usd(c.potentialTaxDeferred, { noCents: true })} in like-kind property to defer 100% of the gain.
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="installment" className="mt-4">
          {!p?.installmentSaleOpportunities?.length ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground">No installment sale opportunities identified for <span className="tabular-nums">{taxYear}</span>.</p>
                <p className="text-sm text-muted-foreground mt-1">Long-term gains over <span className="tabular-nums">$50,000</span> qualify for installment sale treatment.</p>
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3" aria-label="Installment sale opportunities">
              {p.installmentSaleOpportunities.map((s, i) => (
                <li key={i}>
                  <Card>
                    <CardContent className="pt-4">
                      <h3 className="font-medium">{s.propertyAddress}</h3>
                      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
                        <div>
                          <dt className="text-xs text-muted-foreground">Total gain</dt>
                          <dd className="font-semibold text-acr-pos tabular-nums">{usd(s.totalGain, { noCents: true })}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Spread over</dt>
                          <dd className="font-semibold tabular-nums">{s.spreadOverYears} years</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Annual tax savings</dt>
                          <dd className="font-semibold text-acr-accent tabular-nums">{usd(s.annualTaxSavings, { noCents: true })}</dd>
                        </div>
                      </dl>
                      <p className="text-xs text-muted-foreground mt-2">{s.notes}</p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="classification" className="mt-4">
          <DealerClassificationPanel />
        </TabsContent>

        <TabsContent value="re-professional" className="mt-4">
          <RealEstateProfessionalPanel />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

const SIGNAL_LABEL: Record<DealerClassification["signal"], { label: string; variant: "default" | "secondary" | "destructive" | "outline"; tone: string }> = {
  investor: { label: "Investor (capital-asset treatment)", variant: "default", tone: "text-acr-pos" },
  ambiguous: { label: "Ambiguous — facts and circumstances", variant: "secondary", tone: "text-acr-warn" },
  likely_dealer: { label: "Likely dealer", variant: "destructive", tone: "text-acr-neg" },
  dealer: { label: "Dealer (§1221(a)(1) — ordinary income)", variant: "destructive", tone: "text-acr-neg" },
};

function DealerClassificationPanel() {
  const [hoursLast12, setHoursLast12] = useState<string>("");
  const [exclusiveRealEstate, setExclusiveRealEstate] = useState<boolean>(false);

  const { data, isLoading, error, refetch } = useQuery<DealerClassification>({
    queryKey: ["/api/tax-optimizer/dealer-classification", hoursLast12, exclusiveRealEstate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (hoursLast12) params.set("hoursLast12", hoursLast12);
      params.set("exclusiveRealEstate", String(exclusiveRealEstate));
      return fetch(`/api/tax-optimizer/dealer-classification?${params}`).then(r => {
        if (!r.ok) throw new Error(`Failed (${r.status})`);
        return r.json();
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-5 space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return <QueryErrorState error={error as Error} onRetry={() => refetch()} title="Couldn't load classification" />;
  }

  if (!data) return null;

  const sig = SIGNAL_LABEL[data.signal];

  return (
    <div className="space-y-4">
      <Alert variant={data.signal === "dealer" || data.signal === "likely_dealer" ? "destructive" : "default"}>
        <Scale className="h-4 w-4" aria-hidden="true" />
        <AlertTitle className="flex items-center gap-2">
          <span className={sig.tone}>{sig.label}</span>
          <Badge variant={sig.variant} className="ml-auto tabular-nums">
            {data.dealerProbabilityPct}% dealer probability
          </Badge>
        </AlertTitle>
        <AlertDescription className="mt-2 text-xs">
          Decision-support only — not legal advice. The IRS uses the totality of facts and circumstances
          (Suburban Realty, Winthrop, Malat v. Riddell). Your CPA / tax attorney makes the call.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Inputs (self-reported)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Hours in RE trade/business (last 12 mo)</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="e.g. 1800"
                value={hoursLast12}
                onChange={(e) => setHoursLast12(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Checkbox
                id="exclusive-re"
                checked={exclusiveRealEstate}
                onCheckedChange={(v) => setExclusiveRealEstate(v === true)}
              />
              <Label htmlFor="exclusive-re" className="text-xs">
                Real estate is my only trade/business (no W-2, no other ventures)
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Org statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Sales (12mo)</dt>
              <dd className="font-semibold tabular-nums">{data.stats.salesLast12Months}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sales (24mo)</dt>
              <dd className="font-semibold tabular-nums">{data.stats.salesLast24Months}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Median hold</dt>
              <dd className="font-semibold tabular-nums">{data.stats.medianHoldDays} days</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Short-hold share</dt>
              <dd className="font-semibold tabular-nums">{Math.round(data.stats.shortHoldShare * 100)}%</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Factor analysis (Suburban-Realty multi-factor test)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.factors.length === 0 && (
            <p className="text-sm text-muted-foreground">Not enough data — close a few deals and re-run.</p>
          )}
          <ol className="space-y-2" aria-label="Factor analysis">
            {data.factors.map((f) => (
              <li key={f.code} className="border-l-2 pl-3 py-1" style={{ borderColor: f.score > 10 ? "var(--acr-neg)" : f.score > 0 ? "var(--acr-warn)" : "var(--acr-pos)" }}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-xs text-muted-foreground italic">{f.citation}</p>
                    <p className="text-xs mt-1">{f.detail}</p>
                  </div>
                  <Badge variant={f.score > 0 ? "destructive" : "default"} className="tabular-nums shrink-0">
                    {f.score > 0 ? "+" : ""}{f.score}
                  </Badge>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="border-acr-neg/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-acr-neg" aria-hidden="true" />
            If the IRS asserts dealer status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-xs">
            {data.dealerConsequences.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-acr-neg" aria-hidden="true" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Audit-defense considerations (for investor argument)</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-xs">
            {data.auditDefense.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-acr-accent" aria-hidden="true" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function RealEstateProfessionalPanel() {
  const [realEstateHours, setRealEstateHours] = useState<string>("");
  const [totalHours, setTotalHours] = useState<string>("");
  const [hasLog, setHasLog] = useState<boolean>(false);
  const [result, setResult] = useState<RealEstateProfessionalResult | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tax-optimizer/re-professional", {
        realEstateHoursThisYear: parseInt(realEstateHours || "0", 10),
        totalWorkHoursThisYear: parseInt(totalHours || "0", 10),
        hasMaterialParticipationLog: hasLog,
      });
      return res.json() as Promise<RealEstateProfessionalResult>;
    },
    onSuccess: (data) => setResult(data),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">§469(c)(7) Real-Estate Professional Test</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Qualifying makes your rental losses NON-PASSIVE — deductible against ordinary income with no $25,000 cap.
            BOTH conditions must be met: more than 750 hours in real-property trades/businesses AND more than half of
            your total working hours in real property.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Real-estate hours this year</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="e.g. 1200"
                value={realEstateHours}
                onChange={(e) => setRealEstateHours(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div>
              <Label className="text-xs">Total work hours this year (all trades/businesses)</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="e.g. 2000"
                value={totalHours}
                onChange={(e) => setTotalHours(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Checkbox id="has-log" checked={hasLog} onCheckedChange={(v) => setHasLog(v === true)} />
            <Label htmlFor="has-log" className="text-xs">
              I keep a contemporaneous hours log (calendar / diary / app) — NOT a year-end estimate.
            </Label>
          </div>
          <Button className="mt-4" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Clock className="h-4 w-4 mr-2" />}
            Evaluate
          </Button>
        </CardContent>
      </Card>

      {result && (
        <>
          <Alert variant={result.qualifies ? "default" : "destructive"}>
            <Scale className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>
              {result.qualifies ? "You qualify as a Real-Estate Professional under §469(c)(7)" : "You do NOT qualify as a Real-Estate Professional"}
            </AlertTitle>
            <AlertDescription className="text-xs mt-2 grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">750-hour test: </span>
                <span className={result.passes750HourTest ? "text-acr-pos" : "text-acr-neg"}>
                  {result.passes750HourTest ? "PASS" : "FAIL"} ({result.realEstateHours} hours)
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">&gt;50% test: </span>
                <span className={result.passes50PctTest ? "text-acr-pos" : "text-acr-neg"}>
                  {result.passes50PctTest ? "PASS" : "FAIL"} ({result.realEstateSharePct}%)
                </span>
              </div>
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Practical consequences</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs">
                {result.consequences.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-acr-accent" aria-hidden="true" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Documentation your CPA needs</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs">
                {result.documentationRequirements.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-acr-warn" aria-hidden="true" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Qualifying activities (§469(c)(7)(C))</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {result.qualifyingActivities.map((a) => (
                  <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
