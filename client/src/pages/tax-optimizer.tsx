import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  DollarSign,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  FileText,
  Loader2,
  ArrowRightLeft,
  Calendar,
  Info,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

const PRIORITY_CONFIG = {
  critical: { label: "Critical", variant: "destructive" as const, color: "text-red-600" },
  high: { label: "High", variant: "default" as const, color: "text-orange-600" },
  medium: { label: "Medium", variant: "secondary" as const, color: "text-amber-600" },
  low: { label: "Low", variant: "outline" as const, color: "text-blue-600" },
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.abs(n).toLocaleString()}`;
}

export default function TaxOptimizerPage() {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState(currentYear.toString());
  const [reportOpen, setReportOpen] = useState(false);

  const { data: position, isLoading, refetch } = useQuery<TaxPosition>({
    queryKey: ["/api/tax-optimizer/position", taxYear],
    queryFn: () =>
      fetch(`/api/tax-optimizer/position?year=${taxYear}`).then(r => r.json()),
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/tax-optimizer/report", { taxYear: parseInt(taxYear) }).then(r => r.json()),
    onSuccess: (data) => {
      toast({ title: "Report generated", description: "AI tax planning report ready." });
    },
    onError: (err: any) =>
      toast({ title: "Failed to generate report", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  const p = position;

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tax Optimizer</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Capital gains analysis, 1031 exchanges, and year-end tax planning</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={taxYear} onValueChange={setTaxYear}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentYear, currentYear - 1, currentYear - 2].map(y => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => reportMutation.mutate()} disabled={reportMutation.isPending}>
            {reportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
            AI Report
          </Button>
        </div>
      </div>
      {/* Tax Position Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Total Gains</p>
            <p className="text-2xl font-bold text-emerald-600">{fmt(p?.totalRealizedGains || 0)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Realized {taxYear}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Est. Federal Tax</p>
            <p className="text-2xl font-bold text-red-600">{fmt(p?.estimatedFederalTax || 0)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">+{fmt(p?.estimatedNIIT || 0)} NIIT</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Long-Term Gains</p>
            <p className="text-2xl font-bold">{fmt(p?.longTermGains || 0)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">≤15% rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Total Tax Owed</p>
            <p className="text-2xl font-bold text-orange-600">{fmt(p?.totalEstimatedTax || 0)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Est. {taxYear}</p>
          </CardContent>
        </Card>
      </div>

      {/* AI Report output */}
      {reportMutation.data && (
        <Card className="mb-6 border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              AI Tax Planning Report — {taxYear}
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
            Recommendations ({p?.recommendations?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="transactions">
            Transactions ({p?.transactions?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="1031">
            1031 Exchange ({p?.exchange1031Candidates?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="installment">
            Installment Sales ({p?.installmentSaleOpportunities?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* Recommendations Tab */}
        <TabsContent value="recommendations" className="mt-4">
          {!p?.recommendations?.length ? (
            <Card>
              <CardContent className="py-10 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
                <p className="text-muted-foreground">No tax recommendations for {taxYear}. No realized gains found.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {p.recommendations.map((rec, i) => {
                const cfg = PRIORITY_CONFIG[rec.priority];
                return (
                  <Card key={i}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={cfg.variant}>{cfg.label}</Badge>
                            <span className="font-medium text-sm">{rec.title}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{rec.description}</p>
                          {rec.estimatedSavings > 0 && (
                            <p className="text-sm text-emerald-600 font-medium mb-2">
                              Potential savings: {fmt(rec.estimatedSavings)}
                            </p>
                          )}
                          {rec.deadline && (
                            <p className="text-xs text-amber-600 flex items-center gap-1 mb-2">
                              <Calendar className="h-3 w-3" />
                              Deadline: {rec.deadline}
                            </p>
                          )}
                          <ul className="space-y-1">
                            {rec.actionItems.map((item, j) => (
                              <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-blue-500" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions" className="mt-4">
          {!p?.transactions?.length ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground">No closed deals found for {taxYear}.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead className="text-right">Sale Price</TableHead>
                    <TableHead className="text-right">Gain/Loss</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Est. Tax</TableHead>
                    <TableHead>Opportunities</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.transactions.map(tx => (
                    <TableRow key={tx.dealId}>
                      <TableCell className="font-medium max-w-[200px] truncate">{tx.propertyAddress}</TableCell>
                      <TableCell className="text-right">{fmt(tx.saleProceeds)}</TableCell>
                      <TableCell className={`text-right font-medium ${tx.realizedGain >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {tx.realizedGain >= 0 ? "+" : ""}{fmt(tx.realizedGain)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tx.isLongTerm ? "default" : "secondary"}>
                          {tx.isLongTerm ? "LT" : "ST"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-red-600">{fmt(tx.estimatedTax)}</TableCell>
                      <TableCell className="max-w-[200px]">
                        {tx.taxSavingOpportunities.length > 0 ? (
                          <span className="text-xs text-emerald-600">{tx.taxSavingOpportunities[0]}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* 1031 Exchange Tab */}
        <TabsContent value="1031" className="mt-4">
          {!p?.exchange1031Candidates?.length ? (
            <Card>
              <CardContent className="py-10 text-center">
                <ArrowRightLeft className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No 1031 exchange candidates for {taxYear}.</p>
                <p className="text-sm text-muted-foreground mt-1">Long-term capital gains over $25k qualify.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {p.exchange1031Candidates.map((c, i) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium">{c.propertyAddress}</h4>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Gain: <span className="text-emerald-600 font-medium">{fmt(c.gain)}</span>
                          {" · "}Tax deferred: <span className="text-blue-600 font-medium">{fmt(c.potentialTaxDeferred)}</span>
                        </p>
                      </div>
                      <Badge variant="outline">Deal #{c.dealId}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3 p-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg">
                      <div>
                        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">45-Day ID Deadline</p>
                        <p className="text-sm font-bold">{format(new Date(c.deadline45Day), "MMM d, yyyy")}</p>
                      </div>
                      <div>
                        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">180-Day Close Deadline</p>
                        <p className="text-sm font-bold">{format(new Date(c.deadline180Day), "MMM d, yyyy")}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Must reinvest at least {fmt(c.potentialTaxDeferred)} in like-kind property to defer 100% of the gain.
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Installment Sales Tab */}
        <TabsContent value="installment" className="mt-4">
          {!p?.installmentSaleOpportunities?.length ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground">No installment sale opportunities identified for {taxYear}.</p>
                <p className="text-sm text-muted-foreground mt-1">Long-term gains over $50k qualify for installment sale treatment.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {p.installmentSaleOpportunities.map((s, i) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <h4 className="font-medium">{s.propertyAddress}</h4>
                    <div className="grid grid-cols-3 gap-4 mt-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Total Gain</p>
                        <p className="font-semibold text-emerald-600">{fmt(s.totalGain)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Spread Over</p>
                        <p className="font-semibold">{s.spreadOverYears} years</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Annual Tax Savings</p>
                        <p className="font-semibold text-blue-600">{fmt(s.annualTaxSavings)}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{s.notes}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
