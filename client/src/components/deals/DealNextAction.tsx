/**
 * W6.2c — the deal's single next-best action, at the top of its track.
 *
 * The deal-coach engine (server/services/autopilot/dealActions.ts) already
 * computes per-deal next actions; the org-wide DealCoach widget shows them
 * as a list on the Deals door. This banner surfaces THE ONE action for the
 * deal being viewed, so opening a deal reads: "here's the story so far,
 * here's what to do next." Same /api/deals/coach query (shared cache with
 * the door widget), filtered to this deal. Renders nothing when the coach
 * has no action for this deal — quiet, not a nag.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock, PhoneCall, UserPlus, Filter, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface DealCoachItem {
  dealId: string;
  kind: "advance_to_close" | "follow_up" | "contact_now" | "first_contact" | "requalify_or_drop";
  label: string;
  urgency: "high" | "medium" | "low";
  reason: string;
  leadName: string;
}

const KIND_ICON: Record<DealCoachItem["kind"], typeof Clock> = {
  advance_to_close: ArrowUpRight,
  follow_up: Clock,
  contact_now: PhoneCall,
  first_contact: UserPlus,
  requalify_or_drop: Filter,
};

const URGENCY_VARIANT: Record<DealCoachItem["urgency"], "destructive" | "default" | "secondary"> = {
  high: "destructive",
  medium: "default",
  low: "secondary",
};

export function DealNextAction({ dealId }: { dealId: number }) {
  const { data } = useQuery<{ items: DealCoachItem[] }>({
    queryKey: ["/api/deals/coach"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/deals/coach");
      return res.json();
    },
  });

  const item = data?.items?.find((i) => String(i.dealId) === String(dealId));
  if (!item) return null;

  const Icon = KIND_ICON[item.kind] ?? Sparkles;

  return (
    <Card className="border-primary/30 bg-primary/5" data-testid="deal-next-action">
      <CardContent className="flex items-start gap-3 p-4">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold" data-testid="deal-next-action-label">
              {item.label}
            </span>
            <Badge variant={URGENCY_VARIANT[item.urgency]} className="text-[10px] uppercase tracking-wide">
              {item.urgency}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{item.reason}</p>
        </div>
      </CardContent>
    </Card>
  );
}
