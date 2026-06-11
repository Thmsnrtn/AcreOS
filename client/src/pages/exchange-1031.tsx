import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { usd, formatDate } from "@/lib/format";
import { RefreshCw, Calendar, DollarSign, AlertTriangle, CheckCircle2, Clock, Loader2, Plus, Star, FileText, Bell } from "lucide-react";
import { Verbs } from "@/lib/labels";

interface Exchange1031 {
  id: number;
  dealId: number;
  relinquishedPropertyAddress: string;
  relinquishedSalePriceCents: number;
  identificationDeadline: string;
  exchangeDeadline: string;
  qualifiedIntermediaryName?: string;
  replacementProperties: ReplacementProperty[];
  status: "open" | "identified" | "completed" | "failed" | "expired";
  taxDeferralEstimateCents?: number;
  createdAt: string;
}

interface ReplacementProperty {
  id: number;
  address: string;
  estimatedPriceCents: number;
  status: "identified" | "under_contract" | "acquired" | "dropped";
  identifiedAt: string;
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function getDaysRemaining(deadline: string): number {
  return Math.max(0, daysBetween(new Date(), new Date(deadline)));
}

function getProcessStage(ex: Exchange1031): { step: number; label: string; progress: number } {
  const stages = [
    { step: 1, label: "Sale closed", progress: 20 },
    { step: 2, label: "Identification period", progress: 45 },
    { step: 3, label: "Properties identified", progress: 65 },
    { step: 4, label: "Under contract", progress: 80 },
    { step: 5, label: "Exchange complete", progress: 100 },
  ];
  if (ex.status === "completed") return stages[4];
  if (ex.status === "failed" || ex.status === "expired") return { step: 0, label: "Exchange failed", progress: 0 };
  const hasUnderContract = ex.replacementProperties.some(rp => rp.status === "under_contract" || rp.status === "acquired");
  if (hasUnderContract) return stages[3];
  if (ex.status === "identified" || ex.replacementProperties.length > 0) return stages[2];
  return stages[1];
}

function BootMortgagePanel({ salePriceCents, replacementPriceCents }: { salePriceCents: number; replacementPriceCents: number }) {
  const bootAmount = Math.max(0, salePriceCents - replacementPriceCents);
  const taxRate = 0.20;
  const taxOwed = bootAmount * taxRate;
  const fullyDeferred = salePriceCents <= replacementPriceCents;
  return (
    <div className="bg-muted/40 rounded-card p-3 space-y-2 text-xs">
      <p className="font-medium text-sm">Boot / mortgage relief estimate</p>
      <dl className="grid grid-cols-2 gap-2">
        <div>
          <dt className="text-muted-foreground">Relinquished sale price</dt>
          <dd className="font-semibold tabular-nums">{usd(salePriceCents / 100)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Replacement price</dt>
          <dd className="font-semibold tabular-nums">{usd(replacementPriceCents / 100)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Boot amount</dt>
          <dd className={`font-semibold tabular-nums ${bootAmount > 0 ? "text-acr-neg" : "text-acr-pos"}`}>
            {bootAmount > 0 ? usd(bootAmount / 100) : `${usd(0)} (fully deferred)`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Est. tax on boot (20%)</dt>
          <dd className={`font-semibold tabular-nums ${taxOwed > 0 ? "text-acr-neg" : "text-acr-pos"}`}>
            {taxOwed > 0 ? usd(taxOwed / 100) : usd(0)}
          </dd>
        </div>
      </dl>
      {fullyDeferred && (
        <div className="flex items-center gap-1 text-acr-pos">
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Full tax deferral achieved.
        </div>
      )}
    </div>
  );
}

export default function Exchange1031Page() {
  useDocumentTitle("1031 exchange tracker");
  const { toast } = useToast();
  const qc = useQueryClient();
  const addressId = useId();
  const salePriceId = useId();
  const [showCreate, setShowCreate] = useState(false);
  const [relinquishedAddress, setRelinquishedAddress] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const { data, isLoading } = useQuery<{ exchanges: Exchange1031[] }>({
    queryKey: ["/api/exchange-1031"],
    queryFn: () => fetch("/api/exchange-1031").then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/exchange-1031", {
      relinquishedPropertyAddress: relinquishedAddress,
      relinquishedSalePriceCents: Math.round(parseFloat(salePrice) * 100),
    }),
    onSuccess: () => {
      toast({ title: "1031 exchange tracker created" });
      qc.invalidateQueries({ queryKey: ["/api/exchange-1031"] });
      setShowCreate(false);
      setRelinquishedAddress(""); setSalePrice("");
    },
    onError: () =>
      toast({
        title: "Couldn't create exchange",
        description: "Your inputs are unchanged — try again, or check that the sale price is a positive number.",
        variant: "destructive",
      }),
  });

  const exchanges = data?.exchanges ?? [];

  const statusConfig: Record<string, { label: string; variant: any }> = {
    open: { label: "Open", variant: "default" },
    identified: { label: "Identified", variant: "secondary" },
    completed: { label: "Completed", variant: "default" },
    failed: { label: "Failed", variant: "destructive" },
    expired: { label: "Expired", variant: "destructive" },
  };

  return (
    <PageShell label="1031 exchange">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-exchange-1031-title">
            1031 exchange tracker
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Track identification and exchange deadlines for tax-deferred land swaps.
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(!showCreate)}
          aria-expanded={showCreate}
          aria-label={showCreate ? "Close new exchange form" : "Start new 1031 exchange"}
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> New exchange
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start 1031 exchange</CardTitle>
            <CardDescription>Enter the relinquished property details to begin tracking.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => { e.preventDefault(); if (relinquishedAddress && salePrice) createMutation.mutate(); }}
              className="space-y-3"
            >
              <div>
                <Label htmlFor={addressId} className="text-xs">Relinquished property address</Label>
                <Input
                  id={addressId}
                  placeholder="123 Sold Land Dr, Austin TX"
                  value={relinquishedAddress}
                  onChange={e => setRelinquishedAddress(e.target.value)}
                  autoCapitalize="words"
                  required
                />
              </div>
              <div>
                <Label htmlFor={salePriceId} className="text-xs">Sale price ($)</Label>
                <Input
                  id={salePriceId}
                  type="number"
                  placeholder="250000"
                  value={salePrice}
                  onChange={e => setSalePrice(e.target.value)}
                  className="tabular-nums"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={!relinquishedAddress || !salePrice || createMutation.isPending}
                >
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : "Create"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>{Verbs.CANCEL}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading exchanges…
        </div>
      ) : exchanges.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="w-8 h-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
            <p className="text-muted-foreground text-sm">No 1031 exchanges tracked yet.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4" aria-label="Active 1031 exchanges">
          {exchanges.map(ex => {
            const idDaysLeft = getDaysRemaining(ex.identificationDeadline);
            const exchDaysLeft = getDaysRemaining(ex.exchangeDeadline);
            const statusCfg = statusConfig[ex.status] ?? statusConfig.open;
            const isUrgent = idDaysLeft <= 10 || exchDaysLeft <= 20;
            const idAlertNear = idDaysLeft <= 7 && idDaysLeft > 0;
            const exchAlertNear = exchDaysLeft <= 7 && exchDaysLeft > 0;
            const stage = getProcessStage(ex);
            const totalReplacementCents = ex.replacementProperties.reduce((s, rp) => s + rp.estimatedPriceCents, 0);

            const scoredRPs = ex.replacementProperties.map(rp => ({
              ...rp,
              score: Math.min(100, Math.round((rp.estimatedPriceCents / ex.relinquishedSalePriceCents) * 100)),
            })).sort((a, b) => b.score - a.score);

            return (
              <li key={ex.id}>
                <Card className={isUrgent && ex.status === "open" ? "border-acr-warn" : ""}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                          {ex.relinquishedPropertyAddress}
                          {(idAlertNear || exchAlertNear) && (
                            <Badge variant="destructive" className="text-xs animate-pulse" role="alert">
                              <Bell className="w-3 h-3 mr-1" aria-hidden="true" /> Deadline alert
                            </Badge>
                          )}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                          <DollarSign className="w-3 h-3 inline" aria-hidden="true" />
                          {usd(ex.relinquishedSalePriceCents / 100)} sale price
                          {ex.qualifiedIntermediaryName && ` · QI: ${ex.qualifiedIntermediaryName}`}
                        </p>
                      </div>
                      <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-muted-foreground">Stage: {stage.label}</span>
                        <span className="text-muted-foreground tabular-nums">{stage.progress}%</span>
                      </div>
                      <Progress
                        value={stage.progress}
                        className="h-2"
                        aria-label={`Stage: ${stage.label}, ${stage.progress}% complete`}
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Sale closed</span>
                        <span>45-day ID</span>
                        <span>180-day close</span>
                      </div>
                    </div>

                    {(ex.status === "open" || ex.status === "identified") && (
                      <dl className="grid grid-cols-2 gap-3">
                        <div className={`p-2 rounded-md ${idDaysLeft <= 7 ? "bg-acr-neg-soft border border-acr-neg-soft" : idDaysLeft <= 10 ? "bg-acr-neg-soft" : "bg-muted"}`}>
                          <dt className="flex items-center gap-1.5 text-xs mb-1">
                            <Clock className={`w-3 h-3 ${idDaysLeft <= 7 ? "text-acr-neg" : idDaysLeft <= 10 ? "text-acr-neg" : "text-muted-foreground"}`} aria-hidden="true" />
                            <span className="font-medium">Identification (45-day)</span>
                            {idAlertNear && <AlertTriangle className="w-3 h-3 text-acr-neg ml-auto" aria-hidden="true" />}
                          </dt>
                          <dd className={`text-sm font-bold tabular-nums ${idDaysLeft <= 7 ? "text-acr-neg" : ""}`}>
                            {idDaysLeft} days left
                          </dd>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {formatDate(ex.identificationDeadline)}
                          </p>
                        </div>
                        <div className={`p-2 rounded-md ${exchDaysLeft <= 7 ? "bg-acr-warn-soft border border-acr-warn-soft" : exchDaysLeft <= 20 ? "bg-acr-warn-soft" : "bg-muted"}`}>
                          <dt className="flex items-center gap-1.5 text-xs mb-1">
                            <Calendar className={`w-3 h-3 ${exchDaysLeft <= 7 ? "text-acr-warn" : exchDaysLeft <= 20 ? "text-acr-warn" : "text-muted-foreground"}`} aria-hidden="true" />
                            <span className="font-medium">Exchange (180-day)</span>
                            {exchAlertNear && <AlertTriangle className="w-3 h-3 text-acr-warn ml-auto" aria-hidden="true" />}
                          </dt>
                          <dd className={`text-sm font-bold tabular-nums ${exchDaysLeft <= 7 ? "text-acr-warn" : ""}`}>
                            {exchDaysLeft} days left
                          </dd>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {formatDate(ex.exchangeDeadline)}
                          </p>
                        </div>
                      </dl>
                    )}

                    {ex.taxDeferralEstimateCents && (
                      <div className="flex items-center gap-2 text-sm text-acr-pos bg-acr-pos-soft p-2 rounded">
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        Est. tax deferral: <strong className="tabular-nums">{usd(ex.taxDeferralEstimateCents / 100)}</strong>
                      </div>
                    )}

                    {scoredRPs.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Replacement property candidates</p>
                        <ol className="space-y-2" aria-label="Replacement properties ranked by match score">
                          {scoredRPs.map((rp, idx) => (
                            <li key={rp.id} className="flex items-center justify-between text-xs py-1.5 px-2 border rounded-md bg-muted/30 gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {idx === 0 && <Star className="w-3 h-3 text-acr-warn shrink-0" aria-label="Best match" />}
                                <span className="truncate">{rp.address}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                <span className="text-muted-foreground tabular-nums">{usd(rp.estimatedPriceCents / 100)}</span>
                                <Badge variant={rp.score >= 100 ? "default" : "outline"} className="text-xs tabular-nums" aria-label={`Score ${rp.score} of 100`}>
                                  Score: {rp.score}
                                </Badge>
                                <Badge variant="outline" className="text-xs capitalize">{rp.status.replace(/_/g, " ")}</Badge>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {totalReplacementCents > 0 && (
                      <BootMortgagePanel
                        salePriceCents={ex.relinquishedSalePriceCents}
                        replacementPriceCents={totalReplacementCents}
                      />
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => toast({ title: "Identification letter", description: "Generating identification letter PDF…" })}
                        aria-label={`Generate identification letter for ${ex.relinquishedPropertyAddress}`}
                      >
                        <FileText className="w-3 h-3 mr-1" aria-hidden="true" /> ID letter
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => toast({ title: "Exchange agreement", description: "Generating exchange agreement draft…" })}
                        aria-label={`Generate exchange agreement for ${ex.relinquishedPropertyAddress}`}
                      >
                        <FileText className="w-3 h-3 mr-1" aria-hidden="true" /> Exchange agreement
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
