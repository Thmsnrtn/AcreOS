import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, DollarSign, Calendar, TrendingUp, Filter, Loader2, MapPin } from "lucide-react";

interface DelinquentLead {
  id: number;
  ownerName: string;
  propertyAddress: string;
  county: string;
  stateCode: string;
  yearsDelinquent: number;
  taxOwedCents: number;
  propertyValueCents: number;
  equityPercent: number;
  daysUntilTaxSale?: number;
  risk: "critical" | "high" | "medium" | "low";
  score: number;
}

const RISK_CONFIG = {
  critical: { color: "text-red-600", bg: "bg-red-50", badge: "destructive" as const },
  high: { color: "text-orange-600", bg: "bg-orange-50", badge: "secondary" as const },
  medium: { color: "text-yellow-600", bg: "bg-yellow-50", badge: "outline" as const },
  low: { color: "text-blue-600", bg: "bg-blue-50", badge: "outline" as const },
};

export default function TaxDelinquentPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [stateFilter, setStateFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<{ leads: DelinquentLead[]; total: number }>({
    queryKey: ["/api/tax-delinquent", stateFilter, riskFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (stateFilter) params.set("state", stateFilter);
      if (riskFilter !== "all") params.set("risk", riskFilter);
      return fetch(`/api/tax-delinquent?${params}`).then(r => r.json());
    },
  });

  const importMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tax-delinquent/import"),
    onSuccess: () => {
      toast({ title: "Import started" });
      qc.invalidateQueries({ queryKey: ["/api/tax-delinquent"] });
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  const contactMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tax-delinquent/${id}/contact`),
    onSuccess: () => toast({ title: "Lead added to outreach sequence" }),
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const leads = data?.leads ?? [];
  const critical = leads.filter(l => l.risk === "critical").length;
  const avgEquity = leads.length > 0
    ? Math.round(leads.reduce((s, l) => s + l.equityPercent, 0) / leads.length)
    : 0;

  return (
    <PageShell>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-tax-delinquent-title">
            Tax Delinquent Pipeline
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Find motivated sellers through property tax delinquency records.
          </p>
        </div>
        <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
          {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Import Records
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Leads</p>
            <p className="text-2xl font-bold">{data?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-red-600 mb-1">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs">Critical</span>
            </div>
            <p className="text-2xl font-bold">{critical}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs">Avg Equity</span>
            </div>
            <p className="text-2xl font-bold">{avgEquity}%</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 items-center">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Filter by state (e.g. TX)"
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value.toUpperCase())}
          className="w-32"
          maxLength={2}
        />
        {["all", "critical", "high", "medium", "low"].map(risk => (
          <Button
            key={risk}
            variant={riskFilter === risk ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() => setRiskFilter(risk)}
          >
            {risk === "all" ? "All" : risk.charAt(0).toUpperCase() + risk.slice(1)}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading delinquent leads...
        </div>
      ) : leads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">No tax delinquent leads found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {leads.map(lead => {
            const risk = RISK_CONFIG[lead.risk];
            return (
              <Card key={lead.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{lead.ownerName}</span>
                        <Badge variant={risk.badge} className="text-xs">{lead.risk}</Badge>
                        <span className="text-xs text-muted-foreground">Score: {lead.score}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" />
                        {lead.propertyAddress} · {lead.county}, {lead.stateCode}
                      </div>
                      <div className="flex gap-4 text-xs">
                        <span className="text-red-600">
                          <DollarSign className="w-3 h-3 inline" />
                          ${(lead.taxOwedCents / 100).toLocaleString()} owed ({lead.yearsDelinquent}yr)
                        </span>
                        <span>
                          <TrendingUp className="w-3 h-3 inline mr-0.5" />
                          {lead.equityPercent}% equity
                        </span>
                        {lead.daysUntilTaxSale !== undefined && (
                          <span className={lead.daysUntilTaxSale <= 60 ? "text-red-600" : "text-muted-foreground"}>
                            <Calendar className="w-3 h-3 inline mr-0.5" />
                            Tax sale in {lead.daysUntilTaxSale}d
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground">Equity</span>
                          <span>{lead.equityPercent}%</span>
                        </div>
                        <Progress value={lead.equityPercent} className="h-1" />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-3 flex-shrink-0"
                      onClick={() => contactMutation.mutate(lead.id)}
                    >
                      Contact
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
