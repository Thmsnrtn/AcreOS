import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import {
  PhoneCall, CheckCircle2, XCircle,
  ChevronRight, CheckCheck, Loader2, Sparkles, Send,
} from "lucide-react";
import { subDays } from "date-fns";
import { relative } from "@/lib/format";

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

interface PaxPanelState {
  isOpen: boolean;
  contextLabel: string;
  prefillMessage: string;
  response: string | null;
  responseIsError: boolean;
  isLoading: boolean;
}

function SectionHeader({ title, count, description, headingId }: { title: string; count: number; description: string; headingId: string }) {
  return (
    <div className="flex items-start gap-3 mb-3">
      <div>
        <h2 id={headingId} className="font-semibold flex items-center gap-2">
          {title}
          <Badge
            variant={count > 0 ? "destructive" : "secondary"}
            aria-label={`${count} item${count === 1 ? "" : "s"}`}
            className="tabular-nums"
          >
            {count}
          </Badge>
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}.</p>
      </div>
    </div>
  );
}

function AskPaxButton({ label, message, onAsk }: { label: string; message: string; onAsk: (msg: string, label: string) => void }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="text-xs text-acr-brand border-acr-brand-soft hover:bg-acr-brand-soft dark:hover:bg-acr-brand-soft/20 min-h-9"
      onClick={() => onAsk(message, label)}
      aria-label={`Ask Pax about ${label}`}
    >
      <Sparkles className="w-3 h-3 mr-1" aria-hidden="true" />
      Ask Pax
    </Button>
  );
}

export default function DecisionQueuePage() {
  useDocumentTitle("Decision queue");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [pax, setPax] = useState<PaxPanelState>({
    isOpen: false,
    contextLabel: '',
    prefillMessage: '',
    response: null,
    responseIsError: false,
    isLoading: false,
  });
  const [paxInput, setPaxInput] = useState('');
  const paxInputId = useId();
  const stalledHeadingId = useId();
  const waitingHeadingId = useId();
  const stuckHeadingId = useId();

  // Cycle 9: both /api/leads and /api/deals return paginated
  // { data: [...], total, page, ... } envelopes now. The previous
  // inline queryFn passed the envelope through as-is, which then
  // crashed `.filter(...)` downstream ("q.filter is not a function").
  // Unwrap defensively: accept an array, a { data } envelope, or
  // fall back to [].
  const { data: leads = [], isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    queryFn: async () => {
      const r = await fetch("/api/leads", { credentials: "include" });
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
    },
  });

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: async () => {
      const r = await fetch("/api/deals", { credentials: "include" });
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
    },
  });

  const updateLead = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Lead> }) =>
      fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then(r => {
        if (!r.ok) throw new Error("Failed to update lead");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Lead updated." });
    },
    onError: () =>
      toast({
        title: "Couldn't update lead",
        description: "The lead is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const updateDeal = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Deal> }) =>
      fetch(`/api/deals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then(r => {
        if (!r.ok) throw new Error("Failed to update deal");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: "Deal updated." });
    },
    onError: () =>
      toast({
        title: "Couldn't update deal",
        description: "The deal stage is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
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

  function openPax(prefillMessage: string, contextLabel: string) {
    setPax({ isOpen: true, contextLabel, prefillMessage, response: null, responseIsError: false, isLoading: false });
    setPaxInput(prefillMessage);
  }

  async function sendPaxMessage() {
    const message = paxInput.trim();
    if (!message) return;

    setPax(prev => ({ ...prev, isLoading: true, response: null, responseIsError: false }));

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) throw new Error('Pax unavailable');

      const data = await res.json();
      const replyText: string =
        data.response ?? data.message ?? data.content ?? data.reply ?? 'No response received.';

      setPax(prev => ({ ...prev, response: replyText, responseIsError: false, isLoading: false }));
    } catch (err: any) {
      setPax(prev => ({
        ...prev,
        response: `${err.message ?? 'Network error'} — your question is still in the input above. Try again or open the full AI hub.`,
        responseIsError: true,
        isLoading: false,
      }));
    }
  }

  if (isLoading) {
    return (
      <PageShell label="Decision queue">
        <div
          className="flex items-center justify-center py-16 text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
          Loading queue…
        </div>
      </PageShell>
    );
  }

  if (totalItems === 0) {
    return (
      <PageShell label="Decision queue">
        <div className="space-y-2 mb-6">
          <h1 className="text-2xl font-semibold">Decision queue</h1>
          <p className="text-sm text-muted-foreground">Items requiring your attention.</p>
        </div>
        <div
          className="flex flex-col items-center justify-center py-20 text-center gap-3"
          role="status"
          aria-live="polite"
        >
          <CheckCheck className="w-10 h-10 text-acr-pos" aria-hidden="true" />
          <h2 className="font-semibold text-lg">Pipeline is clear.</h2>
          <p className="text-muted-foreground text-sm max-w-xs">No decisions needed today. All leads are current and deals are moving.</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell label="Decision queue">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Decision queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="tabular-nums">{totalItems}</span> item{totalItems !== 1 ? "s" : ""} need your attention.
          </p>
        </div>

        {/* Stalled Leads */}
        {stalledLeads.length > 0 && (
          <section aria-labelledby={stalledHeadingId}>
            <SectionHeader
              title="Stalled leads"
              count={stalledLeads.length}
              description="No contact in 14+ days — these sellers may go cold"
              headingId={stalledHeadingId}
            />
            <ul className="space-y-2" aria-label="Stalled leads">
              {stalledLeads.map(lead => {
                const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || `Lead #${lead.id}`;
                const lastContact = lead.lastContactedAt
                  ? `Last contact ${relative(lead.lastContactedAt)}`
                  : "Never contacted";
                const paxMsg = `I have a stalled lead named ${name}${lead.propertyAddress ? ` at ${lead.propertyAddress}` : ''}. ${lastContact}. What should I do to re-engage this seller?`;
                return (
                  <li key={lead.id}>
                    <Card className="border-l-4 border-acr-neg">
                      <CardContent className="py-3 px-4 flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{name}</p>
                          {lead.propertyAddress && (
                            <p className="text-xs text-muted-foreground truncate">{lead.propertyAddress}</p>
                          )}
                          <p className="text-xs text-acr-neg mt-0.5">{lastContact}</p>
                        </div>
                        <div className="flex gap-2 shrink-0 flex-wrap">
                          <AskPaxButton
                            label={`stalled lead ${name}`}
                            message={paxMsg}
                            onAsk={openPax}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs min-h-9"
                            onClick={() =>
                              updateLead.mutate({
                                id: lead.id,
                                data: { lastContactedAt: now.toISOString() } as any,
                              })
                            }
                            disabled={updateLead.isPending}
                            aria-label={`Log contact for ${name}`}
                          >
                            <PhoneCall className="w-3 h-3 mr-1" aria-hidden="true" />
                            Log contact
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Waiting Counters */}
        {waitingCounters.length > 0 && (
          <section aria-labelledby={waitingHeadingId}>
            <SectionHeader
              title="Waiting on counter"
              count={waitingCounters.length}
              description="Offers sent 7+ days ago with no response"
              headingId={waitingHeadingId}
            />
            <ul className="space-y-2" aria-label="Deals waiting on counter">
              {waitingCounters.map(deal => {
                const offerAmt = deal.offerAmount
                  ? usd(parseFloat(deal.offerAmount))
                  : 'unknown amount';
                const sentWhen = deal.offerDate
                  ? relative(deal.offerDate)
                  : 'recently';
                const paxMsg = `Deal #${deal.id} has had an offer of ${offerAmt} sitting with no response since ${sentWhen}. Should I follow up, revise the offer, or walk away?`;
                return (
                  <li key={deal.id}>
                    <Card className="border-l-4 border-acr-warn">
                      <CardContent className="py-3 px-4 flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">Deal <span className="tabular-nums">#{deal.id}</span></p>
                          {deal.offerAmount && (
                            <p className="text-xs text-muted-foreground tabular-nums">
                              Offer: {usd(parseFloat(deal.offerAmount))}
                            </p>
                          )}
                          <p className="text-xs text-acr-warn mt-0.5">
                            Sent {relative(deal.offerDate)}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                          <AskPaxButton
                            label={`waiting counter on Deal #${deal.id}`}
                            message={paxMsg}
                            onAsk={openPax}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs text-acr-pos min-h-9"
                            onClick={() => updateDeal.mutate({ id: deal.id, data: { status: "accepted" } })}
                            disabled={updateDeal.isPending}
                            aria-label={`Mark Deal #${deal.id} as accepted`}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" aria-hidden="true" />
                            Accepted
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs text-acr-neg min-h-9"
                            onClick={() => updateDeal.mutate({ id: deal.id, data: { status: "cancelled" } })}
                            disabled={updateDeal.isPending}
                            aria-label={`Mark Deal #${deal.id} as rejected`}
                          >
                            <XCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                            Rejected
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Stuck Deals */}
        {stuckDeals.length > 0 && (
          <section aria-labelledby={stuckHeadingId}>
            <SectionHeader
              title="Stuck in stage"
              count={stuckDeals.length}
              description="No stage change in 14+ days"
              headingId={stuckHeadingId}
            />
            <ul className="space-y-2" aria-label="Deals stuck in stage">
              {stuckDeals.map(deal => {
                const stageMap: Record<string, string> = {
                  negotiating: "countered",
                  countered: "accepted",
                  accepted: "in_escrow",
                  in_escrow: "closed",
                };
                const nextStage = stageMap[deal.status];
                const stalledWhen = deal.updatedAt
                  ? relative(deal.updatedAt)
                  : '';
                const paxMsg = `Deal #${deal.id} is stuck in the "${deal.status.replace(/_/g, ' ')}" stage${stalledWhen ? `, last updated ${stalledWhen}` : ''}. What are the best next steps to move this forward?`;
                return (
                  <li key={deal.id}>
                    <Card className="border-l-4 border-acr-warn">
                      <CardContent className="py-3 px-4 flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">Deal <span className="tabular-nums">#{deal.id}</span></p>
                          <p className="text-xs text-muted-foreground capitalize">
                            Stage: {deal.status.replace(/_/g, " ")}
                          </p>
                          {deal.updatedAt && (
                            <p className="text-xs text-acr-warn mt-0.5">
                              Stalled {relative(deal.updatedAt)}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0 flex-wrap">
                          <AskPaxButton
                            label={`stuck deal #${deal.id}`}
                            message={paxMsg}
                            onAsk={openPax}
                          />
                          {nextStage && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs min-h-9"
                              onClick={() => updateDeal.mutate({ id: deal.id, data: { status: nextStage } })}
                              disabled={updateDeal.isPending}
                              aria-label={`Advance Deal #${deal.id} to ${nextStage.replace(/_/g, ' ')}`}
                            >
                              <ChevronRight className="w-3 h-3 mr-1" aria-hidden="true" />
                              Advance
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {/* Pax Dialog */}
      {/* ResponsiveModal so mobile gets a bottom-sheet that the iOS keyboard
          can push above; the previous centered Dialog left a frosted backdrop
          with only the keyboard visible when the textarea took focus. */}
      <ResponsiveModal open={pax.isOpen} onOpenChange={(open) => setPax(prev => ({ ...prev, isOpen: open }))}>
        <ResponsiveModalContent className="max-w-lg">
          <ResponsiveModalHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-acr-brand" aria-hidden="true" />
              <ResponsiveModalTitle>Ask Pax</ResponsiveModalTitle>
            </div>
            {pax.contextLabel && (
              <p className="text-xs text-muted-foreground mt-1">{pax.contextLabel}</p>
            )}
          </ResponsiveModalHeader>

          <form
            className="space-y-3 mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (pax.isLoading || !paxInput.trim()) return;
              sendPaxMessage();
            }}
          >
            <Label htmlFor={paxInputId} className="sr-only">Question for Pax</Label>
            <Textarea
              id={paxInputId}
              className="text-sm min-h-[100px]"
              value={paxInput}
              onChange={(e) => setPaxInput(e.target.value)}
              placeholder="Ask Pax about this decision…"
            />

            <Button
              type="submit"
              className="w-full min-h-11"
              disabled={pax.isLoading || !paxInput.trim()}
            >
              {pax.isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  Thinking…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" aria-hidden="true" />
                  Send to Pax
                </>
              )}
            </Button>

            {pax.response && (
              <div
                className={`rounded-lg p-4 text-sm whitespace-pre-wrap ${pax.responseIsError ? "bg-acr-neg-soft dark:bg-acr-neg-soft/20 border border-acr-neg-soft dark:border-acr-neg-soft/40" : "bg-muted"}`}
                role={pax.responseIsError ? "alert" : "status"}
                aria-live={pax.responseIsError ? "assertive" : "polite"}
              >
                <p className={`font-semibold text-xs mb-1 ${pax.responseIsError ? "text-acr-neg" : "text-acr-brand"}`}>
                  {pax.responseIsError ? "Pax couldn't reach the assistant" : "Pax replied"}
                </p>
                {pax.response}
              </div>
            )}

            <div className="text-xs text-center text-muted-foreground">
              For a full conversation,{' '}
              <a
                href="/ai"
                className="text-acr-brand underline hover:no-underline"
                aria-label="Open AI hub for a full Pax conversation"
              >
                open AI hub
              </a>.
            </div>
          </form>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </PageShell>
  );
}
