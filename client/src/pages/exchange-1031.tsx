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
import { RefreshCw, Calendar, DollarSign, AlertTriangle, CheckCircle2, Clock, Loader2, Plus } from "lucide-react";

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

            return (
              <Card key={ex.id} className={isUrgent && ex.status === "open" ? "border-yellow-400" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm">{ex.relinquishedPropertyAddress}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <DollarSign className="w-3 h-3 inline" />
                        {(ex.relinquishedSalePriceCents / 100).toLocaleString()} sale price
                      </p>
                    </div>
                    <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ex.status === "open" || ex.status === "identified" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className={`p-2 rounded-md ${idDaysLeft <= 10 ? "bg-red-50" : "bg-muted"}`}>
                        <div className="flex items-center gap-1.5 text-xs mb-1">
                          <Clock className={`w-3 h-3 ${idDaysLeft <= 10 ? "text-red-600" : "text-muted-foreground"}`} />
                          <span className="font-medium">Identification Deadline</span>
                        </div>
                        <p className="text-sm font-bold">{idDaysLeft} days left</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(ex.identificationDeadline).toLocaleDateString()}
                        </p>
                      </div>
                      <div className={`p-2 rounded-md ${exchDaysLeft <= 20 ? "bg-yellow-50" : "bg-muted"}`}>
                        <div className="flex items-center gap-1.5 text-xs mb-1">
                          <Calendar className={`w-3 h-3 ${exchDaysLeft <= 20 ? "text-yellow-600" : "text-muted-foreground"}`} />
                          <span className="font-medium">Exchange Deadline</span>
                        </div>
                        <p className="text-sm font-bold">{exchDaysLeft} days left</p>
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

                  {ex.replacementProperties.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Replacement Properties</p>
                      {ex.replacementProperties.map(rp => (
                        <div key={rp.id} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                          <span>{rp.address}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">${(rp.estimatedPriceCents / 100).toLocaleString()}</span>
                            <Badge variant="outline" className="text-xs">{rp.status}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
