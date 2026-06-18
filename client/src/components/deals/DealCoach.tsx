/**
 * Deal Coach (D4) — surfaces the autopilot's next-best actions over the pipeline
 * INSIDE the Deals door (per the five-door rule, a section — never a new nav
 * entry). Read-only guidance: what to do next on which deal and why.
 */
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Sparkles, CheckCircle2, ArrowUpRight, Clock, PhoneCall, UserPlus, Filter } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";

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

export function DealCoach() {
  const { data, isLoading, error, refetch } = useQuery<{ items: DealCoachItem[] }>({
    queryKey: ["/api/deals/coach"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/deals/coach");
      return res.json();
    },
  });

  return (
    <Card data-testid="deal-coach">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          What to work next
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : error ? (
          <QueryErrorState error={error as Error} onRetry={() => refetch()} title="Couldn't load your deal coach" />
        ) : !data?.items?.length ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-6 w-6 text-[hsl(var(--acr-pos))]" aria-hidden="true" />
            <p className="text-sm font-medium">You're all caught up</p>
            <p className="text-xs text-muted-foreground">No deals need attention right now.</p>
          </div>
        ) : (
          <motion.ul role="list" className="space-y-2" variants={staggerContainer} initial="hidden" animate="visible">
            {data.items.map((item) => {
              const Icon = KIND_ICON[item.kind];
              return (
                <motion.li
                  key={item.dealId}
                  variants={staggerItem}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{item.label}</span>
                      <Badge variant={URGENCY_VARIANT[item.urgency]} className="text-[10px] uppercase tracking-wide">
                        {item.urgency}
                      </Badge>
                    </div>
                    <p className="truncate text-sm text-foreground">{item.leadName}</p>
                    <p className="text-xs text-muted-foreground">{item.reason}</p>
                  </div>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </CardContent>
    </Card>
  );
}
