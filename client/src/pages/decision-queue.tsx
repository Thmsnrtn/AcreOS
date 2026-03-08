import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Clock, PhoneCall, CheckCircle2, XCircle,
  ChevronRight, CheckCheck, Loader2,
} from "lucide-react";
import { formatDistanceToNow, subDays, addDays } from "date-fns";

interface Lead {
  id: number;
  firstName?: string;
  lastName?: string;
  propertyAddress?: string;
  lastContactedAt?: string;
  status: string;
}

interface Deal {
  id: number;
  status: string;
  offerDate?: string;
  offerAmount?: string;
  propertyId: number;
  updatedAt?: string;
}

function SectionHeader({ title, count, description }: { title: string; count: number; description: string }) {
  return (
    <div className="flex items-start gap-3 mb-3">
      <div>
        <h2 className="font-semibold flex items-center gap-2">
          {title}
          <Badge variant={count > 0 ? "destructive" : "secondary"}>{count}</Badge>
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}

export default function DecisionQueuePage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: leads = [], isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    queryFn: () => fetch("/api/leads").then(r => r.json()),
  });

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetch("/api/deals").then(r => r.json()),
  });

  const updateLead = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Lead> }) =>
      fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Lead updated" });
    },
  });

  const updateDeal = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Deal> }) =>
      fetch(`/api/deals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: "Deal updated" });
    },
  });

  const now = new Date();

  // 1. Stalled leads — no contact in 14+ days, status active
  const stalledLeads = leads.filter(l => {
    if (["closed", "dead", "converted"].includes(l.status)) return false;
    if (!l.lastContactedAt) return true;
    return new Date(l.lastContactedAt) < subDays(now, 14);
  });

  // 2. Waiting counters — deals in offer_sent for 7+ days
  const waitingCounters = deals.filter(d => {
    if (d.status !== "offer_sent") return false;
    if (!d.offerDate) return false;
    return new Date(d.offerDate) < subDays(now, 7);
  });

  // 3. Stuck deals — same stage for 14+ days (not terminal stages)
  const terminalStages = new Set(["closed", "cancelled"]);
  const stuckDeals = deals.filter(d => {
    if (terminalStages.has(d.status)) return false;
    if (d.status === "offer_sent") return false; // handled above
    if (!d.updatedAt) return false;
    return new Date(d.updatedAt) < subDays(now, 14);
  });

  const totalItems = stalledLeads.length + waitingCounters.length + stuckDeals.length;
  const isLoading = leadsLoading || dealsLoading;

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading queue…
        </div>
      </PageShell>
    );
  }

  if (totalItems === 0) {
    return (
      <PageShell>
        <div className="space-y-2 mb-6">
          <h1 className="text-2xl font-semibold">Decision Queue</h1>
          <p className="text-sm text-muted-foreground">Items requiring your attention</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <CheckCheck className="w-10 h-10 text-green-500" />
          <h2 className="font-semibold text-lg">Pipeline is clear</h2>
          <p className="text-muted-foreground text-sm max-w-xs">No decisions needed today. All leads are current and deals are moving.</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Decision Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalItems} item{totalItems !== 1 ? "s" : ""} need your attention
          </p>
        </div>

        {/* Stalled Leads */}
        {stalledLeads.length > 0 && (
          <section>
            <SectionHeader
              title="Stalled Leads"
              count={stalledLeads.length}
              description="No contact in 14+ days — these sellers may go cold"
            />
            <div className="space-y-2">
              {stalledLeads.map(lead => (
                <Card key={lead.id} className="border-l-4 border-red-400">
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">
                        {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || `Lead #${lead.id}`}
                      </p>
                      {lead.propertyAddress && (
                        <p className="text-xs text-muted-foreground truncate">{lead.propertyAddress}</p>
                      )}
                      <p className="text-xs text-red-500 mt-0.5">
                        {lead.lastContactedAt
                          ? `Last contact ${formatDistanceToNow(new Date(lead.lastContactedAt), { addSuffix: true })}`
                          : "Never contacted"}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() =>
                          updateLead.mutate({
                            id: lead.id,
                            data: { lastContactedAt: now.toISOString() } as any,
                          })
                        }
                        disabled={updateLead.isPending}
                      >
                        <PhoneCall className="w-3 h-3 mr-1" />
                        Log Contact
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Waiting Counters */}
        {waitingCounters.length > 0 && (
          <section>
            <SectionHeader
              title="Waiting on Counter"
              count={waitingCounters.length}
              description="Offers sent 7+ days ago with no response"
            />
            <div className="space-y-2">
              {waitingCounters.map(deal => (
                <Card key={deal.id} className="border-l-4 border-orange-400">
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">Deal #{deal.id}</p>
                      {deal.offerAmount && (
                        <p className="text-xs text-muted-foreground">
                          Offer: ${parseFloat(deal.offerAmount).toLocaleString()}
                        </p>
                      )}
                      <p className="text-xs text-orange-500 mt-0.5">
                        Sent {formatDistanceToNow(new Date(deal.offerDate!), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs text-green-600"
                        onClick={() => updateDeal.mutate({ id: deal.id, data: { status: "accepted" } })}
                        disabled={updateDeal.isPending}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Accepted
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs text-red-600"
                        onClick={() => updateDeal.mutate({ id: deal.id, data: { status: "cancelled" } })}
                        disabled={updateDeal.isPending}
                      >
                        <XCircle className="w-3 h-3 mr-1" />
                        Rejected
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Stuck Deals */}
        {stuckDeals.length > 0 && (
          <section>
            <SectionHeader
              title="Stuck in Stage"
              count={stuckDeals.length}
              description="No stage change in 14+ days"
            />
            <div className="space-y-2">
              {stuckDeals.map(deal => {
                const stageMap: Record<string, string> = {
                  negotiating: "countered",
                  countered: "accepted",
                  accepted: "in_escrow",
                  in_escrow: "closed",
                };
                const nextStage = stageMap[deal.status];
                return (
                  <Card key={deal.id} className="border-l-4 border-yellow-400">
                    <CardContent className="py-3 px-4 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">Deal #{deal.id}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          Stage: {deal.status.replace(/_/g, " ")}
                        </p>
                        {deal.updatedAt && (
                          <p className="text-xs text-yellow-600 mt-0.5">
                            Stalled {formatDistanceToNow(new Date(deal.updatedAt), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                      {nextStage && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs shrink-0"
                          onClick={() => updateDeal.mutate({ id: deal.id, data: { status: nextStage } })}
                          disabled={updateDeal.isPending}
                        >
                          <ChevronRight className="w-3 h-3 mr-1" />
                          Advance
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}
