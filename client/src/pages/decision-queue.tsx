import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Clock, PhoneCall, CheckCircle2, XCircle,
  ChevronRight, CheckCheck, Loader2, Sparkles, Send,
} from "lucide-react";
import { formatDistanceToNow, subDays } from "date-fns";

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

interface AtlasPanelState {
  isOpen: boolean;
  contextLabel: string;
  prefillMessage: string;
  response: string | null;
  isLoading: boolean;
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

function AskAtlasButton({ label, message, onAsk }: { label: string; message: string; onAsk: (msg: string, label: string) => void }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="text-xs text-purple-600 border-purple-200 hover:bg-purple-50 dark:hover:bg-purple-900/20"
      onClick={() => onAsk(message, label)}
    >
      <Sparkles className="w-3 h-3 mr-1" />
      Ask Atlas
    </Button>
  );
}

export default function DecisionQueuePage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [atlas, setAtlas] = useState<AtlasPanelState>({
    isOpen: false,
    contextLabel: '',
    prefillMessage: '',
    response: null,
    isLoading: false,
  });
  const [atlasInput, setAtlasInput] = useState('');

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
    if (d.status === "offer_sent") return false;
    if (!d.updatedAt) return false;
    return new Date(d.updatedAt) < subDays(now, 14);
  });

  const totalItems = stalledLeads.length + waitingCounters.length + stuckDeals.length;
  const isLoading = leadsLoading || dealsLoading;

  function openAtlas(prefillMessage: string, contextLabel: string) {
    setAtlas({ isOpen: true, contextLabel, prefillMessage, response: null, isLoading: false });
    setAtlasInput(prefillMessage);
  }

  async function sendAtlasMessage() {
    const message = atlasInput.trim();
    if (!message) return;

    setAtlas(prev => ({ ...prev, isLoading: true, response: null }));

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) throw new Error('Atlas unavailable');

      const data = await res.json();
      const replyText: string =
        data.response ?? data.message ?? data.content ?? data.reply ?? 'No response received.';

      setAtlas(prev => ({ ...prev, response: replyText, isLoading: false }));
    } catch (err: any) {
      setAtlas(prev => ({ ...prev, response: `Error: ${err.message}`, isLoading: false }));
    }
  }

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
              {stalledLeads.map(lead => {
                const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || `Lead #${lead.id}`;
                const lastContact = lead.lastContactedAt
                  ? `Last contact ${formatDistanceToNow(new Date(lead.lastContactedAt), { addSuffix: true })}`
                  : "Never contacted";
                const atlasMsg = `I have a stalled lead named ${name}${lead.propertyAddress ? ` at ${lead.propertyAddress}` : ''}. ${lastContact}. What should I do to re-engage this seller?`;
                return (
                  <Card key={lead.id} className="border-l-4 border-red-400">
                    <CardContent className="py-3 px-4 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{name}</p>
                        {lead.propertyAddress && (
                          <p className="text-xs text-muted-foreground truncate">{lead.propertyAddress}</p>
                        )}
                        <p className="text-xs text-red-500 mt-0.5">{lastContact}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <AskAtlasButton
                          label={`Stalled lead: ${name}`}
                          message={atlasMsg}
                          onAsk={openAtlas}
                        />
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
                );
              })}
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
              {waitingCounters.map(deal => {
                const offerAmt = deal.offerAmount
                  ? `$${parseFloat(deal.offerAmount).toLocaleString()}`
                  : 'unknown amount';
                const sentWhen = deal.offerDate
                  ? formatDistanceToNow(new Date(deal.offerDate), { addSuffix: true })
                  : 'recently';
                const atlasMsg = `Deal #${deal.id} has had an offer of ${offerAmt} sitting with no response since ${sentWhen}. Should I follow up, revise the offer, or walk away?`;
                return (
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
                      <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                        <AskAtlasButton
                          label={`Waiting counter: Deal #${deal.id}`}
                          message={atlasMsg}
                          onAsk={openAtlas}
                        />
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
                );
              })}
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
                const stalledWhen = deal.updatedAt
                  ? formatDistanceToNow(new Date(deal.updatedAt), { addSuffix: true })
                  : '';
                const atlasMsg = `Deal #${deal.id} is stuck in the "${deal.status.replace(/_/g, ' ')}" stage${stalledWhen ? `, last updated ${stalledWhen}` : ''}. What are the best next steps to move this forward?`;
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
                      <div className="flex gap-2 shrink-0">
                        <AskAtlasButton
                          label={`Stuck deal: Deal #${deal.id}`}
                          message={atlasMsg}
                          onAsk={openAtlas}
                        />
                        {nextStage && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => updateDeal.mutate({ id: deal.id, data: { status: nextStage } })}
                            disabled={updateDeal.isPending}
                          >
                            <ChevronRight className="w-3 h-3 mr-1" />
                            Advance
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Atlas Dialog */}
      <Dialog open={atlas.isOpen} onOpenChange={(open) => setAtlas(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500" />
              <DialogTitle>Ask Atlas</DialogTitle>
            </div>
            {atlas.contextLabel && (
              <p className="text-xs text-muted-foreground mt-1">{atlas.contextLabel}</p>
            )}
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <Textarea
              className="text-sm min-h-[100px]"
              value={atlasInput}
              onChange={(e) => setAtlasInput(e.target.value)}
              placeholder="Ask Atlas about this decision…"
            />

            <Button
              className="w-full"
              onClick={sendAtlasMessage}
              disabled={atlas.isLoading || !atlasInput.trim()}
            >
              {atlas.isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Thinking…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send to Atlas
                </>
              )}
            </Button>

            {atlas.response && (
              <div className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">
                <p className="font-semibold text-xs text-purple-600 mb-1">Atlas</p>
                {atlas.response}
              </div>
            )}

            <div className="text-xs text-center text-muted-foreground">
              For a full conversation,{' '}
              <a href="/atlas" className="text-purple-600 underline hover:no-underline">
                open Atlas
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
