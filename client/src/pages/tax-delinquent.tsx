import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
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
  useDocumentTitle("Tax-delinquent pipeline");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [stateFilter, setStateFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const stateFilterId = useId();

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
      toast({ title: "Import started.", description: "Records will appear as the import completes." });
      qc.invalidateQueries({ queryKey: ["/api/tax-delinquent"] });
    },
    onError: () =>
      toast({
        title: "Couldn't start import",
        description: "No records were imported — your existing leads are unchanged.",
        variant: "destructive",
      }),
  });

  const contactMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tax-delinquent/${id}/contact`),
    onSuccess: () => toast({ title: "Lead added to outreach sequence." }),
    onError: () =>
      toast({
        title: "Couldn't add lead to outreach",
        description: "The lead wasn't added — no outreach was sent. Try again.",
        variant: "destructive",
      }),
  });

  const leads = data?.leads ?? [];
  const critical = leads.filter(l => l.risk === "critical").length;
  const avgEquity = leads.length > 0
    ? Math.round(leads.reduce((s, l) => s + l.equityPercent, 0) / leads.length)
    : 0;

  return (
    <PageShell>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-tax-delinquent-title">
            Tax-delinquent pipeline
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Find motivated sellers through property tax delinquency records.
          </p>
        </div>
        <Button
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending}
          className="min-h-11"
        >
          {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> : null}
          Import records
        </Button>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <dt className="text-xs text-muted-foreground mb-1">Total leads</dt>
            <dd className="text-2xl font-bold tabular-nums">{data?.total ?? 0}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-red-600 mb-1">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Critical</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{critical}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Avg equity</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{avgEquity}%</dd>
          </CardContent>
        </Card>
      </dl>

      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <Label htmlFor={stateFilterId} className="sr-only">Filter by state</Label>
        <Input
          id={stateFilterId}
          placeholder="Filter by state (e.g. TX)"
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value.toUpperCase())}
          className="w-32 uppercase"
          maxLength={2}
          autoCapitalize="characters"
          autoComplete="address-level1"
          autoCorrect="off"
          spellCheck={false}
        />
        <div role="group" aria-label="Filter by risk level" className="flex flex-wrap gap-2">
          {["all", "critical", "high", "medium", "low"].map(risk => (
            <Button
              key={risk}
              type="button"
              variant={riskFilter === risk ? "default" : "outline"}
              size="sm"
              className="text-xs min-h-9"
              onClick={() => setRiskFilter(risk)}
              aria-pressed={riskFilter === risk}
            >
              {risk === "all" ? "All" : risk.charAt(0).toUpperCase() + risk.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading delinquent leads…
        </div>
      ) : leads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
            <p className="text-muted-foreground text-sm">No tax-delinquent leads found.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" aria-label="Tax-delinquent leads">
          {leads.map(lead => {
            const risk = RISK_CONFIG[lead.risk];
            return (
              <li key={lead.id}>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{lead.ownerName}</span>
                          <Badge variant={risk.badge} className="text-xs capitalize">{lead.risk}</Badge>
                          <span className="text-xs text-muted-foreground">Score: <span className="tabular-nums">{lead.score}</span></span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                          <span className="truncate">{lead.propertyAddress} · {lead.county}, {lead.stateCode}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <span className="text-red-600">
                            <DollarSign className="w-3 h-3 inline" aria-hidden="true" />
                            <span className="tabular-nums">{usd(lead.taxOwedCents / 100)}</span> owed (<span className="tabular-nums">{lead.yearsDelinquent}</span>yr)
                          </span>
                          <span>
                            <TrendingUp className="w-3 h-3 inline mr-0.5" aria-hidden="true" />
                            <span className="tabular-nums">{lead.equityPercent}%</span> equity
                          </span>
                          {lead.daysUntilTaxSale !== undefined && (
                            <span className={lead.daysUntilTaxSale <= 60 ? "text-red-600" : "text-muted-foreground"}>
                              <Calendar className="w-3 h-3 inline mr-0.5" aria-hidden="true" />
                              Tax sale in <span className="tabular-nums">{lead.daysUntilTaxSale}</span>d
                            </span>
                          )}
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">Equity</span>
                            <span className="tabular-nums">{lead.equityPercent}%</span>
                          </div>
                          <Progress
                            value={lead.equityPercent}
                            className="h-1"
                            aria-label={`${lead.ownerName} equity: ${lead.equityPercent}%`}
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-3 flex-shrink-0 min-h-9"
                        onClick={() => contactMutation.mutate(lead.id)}
                        aria-label={`Add ${lead.ownerName} to outreach sequence`}
                      >
                        Contact
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
