import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { RefreshCw, Calendar, DollarSign, AlertTriangle, CheckCircle2, Clock, Loader2, Plus, Star, FileText, Bell } from "lucide-react";

interface Exchange1031 {
  id: number;
  dealId: number;
  relinquishedPropertyAddress: string;
  relinquishedSalePriceCents: number;
  identificationDeadline: string; // 45 days
  exchangeDeadline: string; // 180 days
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
    { step: 1, label: "Sale Closed", progress: 20 },
    { step: 2, label: "Identification Period", progress: 45 },
    { step: 3, label: "Properties Identified", progress: 65 },
    { step: 4, label: "Under Contract", progress: 80 },
    { step: 5, label: "Exchange Complete", progress: 100 },
  ];
  if (ex.status === "completed") return stages[4];
  if (ex.status === "failed" || ex.status === "expired") return { step: 0, label: "Exchange Failed", progress: 0 };
  const hasUnderContract = ex.replacementProperties.some(rp => rp.status === "under_contract" || rp.status === "acquired");
  if (hasUnderContract) return stages[3];
  if (ex.status === "identified" || ex.replacementProperties.length > 0) return stages[2];
  return stages[1];
}

function BootMortgagePanel({ salePriceCents, replacementPriceCents }: { salePriceCents: number; replacementPriceCents: number }) {
  const bootAmount = Math.max(0, salePriceCents - replacementPriceCents);
  const taxRate = 0.20; // estimated capital gains
  const taxOwed = bootAmount * taxRate;
  const fullyDeferred = salePriceCents <= replacementPriceCents;
  return (
    <div className="bg-muted/40 rounded-lg p-3 space-y-2 text-xs">
      <p className="font-medium text-sm">Boot / Mortgage Relief Estimate</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-muted-foreground">Relinquished Sale Price</p>
          <p className="font-semibold">${(salePriceCents / 100).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Replacement Price</p>
          <p className="font-semibold">${(replacementPriceCents / 100).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Boot Amount</p>
          <p className={`font-semibold ${bootAmount > 0 ? "text-red-600" : "text-green-600"}`}>
            {bootAmount > 0 ? `$${(bootAmount / 100).toLocaleString()}` : "$0 (Fully Deferred)"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Est. Tax on Boot (20%)</p>
          <p className={`font-semibold ${taxOwed > 0 ? "text-red-600" : "text-green-600"}`}>
            {taxOwed > 0 ? `$${(taxOwed / 100).toLocaleString()}` : "$0"}
          </p>
        </div>
      </div>
      {fullyDeferred && (
        <div className="flex items-center gap-1 text-green-700">
          <CheckCircle2 className="w-3 h-3" /> Full tax deferral achieved
        </div>
      )}
    </div>
  );
}

export default function Exchange1031Page() {
  const { toast } = useToast();
  const qc = useQueryClient();
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
      toast({ title: "1031 Exchange tracker created" });
      qc.invalidateQueries({ queryKey: ["/api/exchange-1031"] });
      setShowCreate(false);
      setRelinquishedAddress(""); setSalePrice("");
    },
    onError: () => toast({ title: "Failed to create", variant: "destructive" }),
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
    <PageShell>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-exchange-1031-title">
            1031 Exchange Tracker
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Track identification and exchange deadlines for tax-deferred land swaps.
          </p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4 mr-2" /> New Exchange
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start 1031 Exchange</CardTitle>
            <CardDescription>Enter the relinquished property details to begin tracking.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Relinquished Property Address</Label>
              <Input
                placeholder="123 Sold Land Dr, Austin TX"
                value={relinquishedAddress}
                onChange={e => setRelinquishedAddress(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Sale Price ($)</Label>
              <Input
                type="number"
                placeholder="250000"
                value={salePrice}
                onChange={e => setSalePrice(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                disabled={!relinquishedAddress || !salePrice || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading exchanges...
        </div>
      ) : exchanges.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">No 1031 exchanges tracked yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {exchanges.map(ex => {
            const idDaysLeft = getDaysRemaining(ex.identificationDeadline);
            const exchDaysLeft = getDaysRemaining(ex.exchangeDeadline);
            const statusCfg = statusConfig[ex.status] ?? statusConfig.open;
            const isUrgent = idDaysLeft <= 10 || exchDaysLeft <= 20;
            const idAlertNear = idDaysLeft <= 7 && idDaysLeft > 0;
            const exchAlertNear = exchDaysLeft <= 7 && exchDaysLeft > 0;
            const stage = getProcessStage(ex);
            const totalReplacementCents = ex.replacementProperties.reduce((s, rp) => s + rp.estimatedPriceCents, 0);

            // Score replacement properties: higher price relative to sale = better
            const scoredRPs = ex.replacementProperties.map(rp => ({
              ...rp,
              score: Math.min(100, Math.round((rp.estimatedPriceCents / ex.relinquishedSalePriceCents) * 100)),
            })).sort((a, b) => b.score - a.score);

            return (
              <Card key={ex.id} className={isUrgent && ex.status === "open" ? "border-yellow-400" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm flex items-center gap-2">
                        {ex.relinquishedPropertyAddress}
                        {(idAlertNear || exchAlertNear) && (
                          <Badge variant="destructive" className="text-xs animate-pulse">
                            <Bell className="w-3 h-3 mr-1" /> Deadline Alert
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <DollarSign className="w-3 h-3 inline" />
                        {(ex.relinquishedSalePriceCents / 100).toLocaleString()} sale price
                        {ex.qualifiedIntermediaryName && ` · QI: ${ex.qualifiedIntermediaryName}`}
                      </p>
                    </div>
                    <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Visual Progress Indicator */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-muted-foreground">Stage: {stage.label}</span>
                      <span className="text-muted-foreground">{stage.progress}%</span>
                    </div>
                    <Progress value={stage.progress} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Sale Closed</span>
                      <span>45-Day ID</span>
                      <span>180-Day Close</span>
                    </div>
                  </div>

                  {/* Timeline Deadlines */}
                  {ex.status === "open" || ex.status === "identified" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className={`p-2 rounded-md ${idDaysLeft <= 7 ? "bg-red-50 border border-red-200" : idDaysLeft <= 10 ? "bg-red-50" : "bg-muted"}`}>
                        <div className="flex items-center gap-1.5 text-xs mb-1">
                          <Clock className={`w-3 h-3 ${idDaysLeft <= 7 ? "text-red-700" : idDaysLeft <= 10 ? "text-red-600" : "text-muted-foreground"}`} />
                          <span className="font-medium">Identification (45-day)</span>
                          {idAlertNear && <AlertTriangle className="w-3 h-3 text-red-600 ml-auto" />}
                        </div>
                        <p className={`text-sm font-bold ${idDaysLeft <= 7 ? "text-red-700" : ""}`}>{idDaysLeft} days left</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(ex.identificationDeadline).toLocaleDateString()}
                        </p>
                      </div>
                      <div className={`p-2 rounded-md ${exchDaysLeft <= 7 ? "bg-orange-50 border border-orange-200" : exchDaysLeft <= 20 ? "bg-yellow-50" : "bg-muted"}`}>
                        <div className="flex items-center gap-1.5 text-xs mb-1">
                          <Calendar className={`w-3 h-3 ${exchDaysLeft <= 7 ? "text-orange-700" : exchDaysLeft <= 20 ? "text-yellow-600" : "text-muted-foreground"}`} />
                          <span className="font-medium">Exchange (180-day)</span>
                          {exchAlertNear && <AlertTriangle className="w-3 h-3 text-orange-600 ml-auto" />}
                        </div>
                        <p className={`text-sm font-bold ${exchDaysLeft <= 7 ? "text-orange-700" : ""}`}>{exchDaysLeft} days left</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(ex.exchangeDeadline).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {ex.taxDeferralEstimateCents && (
                    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-2 rounded">
                      <CheckCircle2 className="w-4 h-4" />
                      Est. tax deferral: <strong>${(ex.taxDeferralEstimateCents / 100).toLocaleString()}</strong>
                    </div>
                  )}

                  {/* Replacement Property Candidates with Scoring */}
                  {scoredRPs.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Replacement Property Candidates</p>
                      <div className="space-y-2">
                        {scoredRPs.map((rp, idx) => (
                          <div key={rp.id} className="flex items-center justify-between text-xs py-1.5 px-2 border rounded-md bg-muted/30">
                            <div className="flex items-center gap-2 min-w-0">
                              {idx === 0 && <Star className="w-3 h-3 text-yellow-500 shrink-0" />}
                              <span className="truncate">{rp.address}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="text-muted-foreground">${(rp.estimatedPriceCents / 100).toLocaleString()}</span>
                              <Badge variant={rp.score >= 100 ? "default" : "outline"} className="text-xs">
                                Score: {rp.score}
                              </Badge>
                              <Badge variant="outline" className="text-xs">{rp.status}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Boot/Mortgage Relief Calculation */}
                  {totalReplacementCents > 0 && (
                    <BootMortgagePanel
                      salePriceCents={ex.relinquishedSalePriceCents}
                      replacementPriceCents={totalReplacementCents}
                    />
                  )}

                  {/* Document Generator Buttons */}
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => toast({ title: "Identification Letter", description: "Generating identification letter PDF…" })}
                    >
                      <FileText className="w-3 h-3 mr-1" /> ID Letter
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => toast({ title: "Exchange Agreement", description: "Generating exchange agreement draft…" })}
                    >
                      <FileText className="w-3 h-3 mr-1" /> Exchange Agreement
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
