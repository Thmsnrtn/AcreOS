/**
 * First deal in 90 days (W5b) — Today's card with the ONE next concrete step
 * toward the org's first closed deal, derived server-side from its real
 * records (shared/growth/firstDeal.ts). "Ask Pax" opens the existing Pax rail
 * with a mentor question — Pax is not a new destination. Renders nothing once
 * the first deal has closed.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { CheckCircle2, Circle, Flag } from "lucide-react";
import { usePaxRail } from "@/contexts/pax-rail-context";
import { FIRST_DEAL_PROGRAM_DAYS, FIRST_DEAL_STEP_COUNT, type FirstDealStep } from "@shared/growth/firstDeal";

export function FirstDealCard() {
  const q = useQuery<FirstDealStep>({ queryKey: ["/api/today/first-deal"] });
  const pax = usePaxRail();

  if (q.isLoading) {
    return (
      <Card className="rounded-card shadow-acr-1" data-testid="card-first-deal-loading">
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-11 w-40" />
        </CardContent>
      </Card>
    );
  }
  if (q.error) return <QueryErrorState error={q.error as Error} onRetry={() => q.refetch()} compact />;
  const step = q.data;
  if (!step || step.step === "done") return null;

  return (
    <Card className="rounded-card shadow-acr-1" data-testid="card-first-deal">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Flag className="w-4 h-4 text-primary" aria-hidden="true" />
            Your first deal
          </CardTitle>
          <Badge variant="outline" className="tabular-nums" data-testid="first-deal-day">
            {step.withinProgram ? `Day ${step.day} of ${FIRST_DEAL_PROGRAM_DAYS}` : `Day ${step.day}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground">Step {step.ordinal} of {FIRST_DEAL_STEP_COUNT}</p>
          <p className="font-semibold" data-testid="first-deal-title">{step.title}</p>
          <p className="text-sm text-muted-foreground" data-testid="first-deal-detail">{step.detail}</p>
        </div>
        {step.checklist && (
          <ul className="space-y-1 text-sm" data-testid="first-deal-checklist">
            {step.checklist.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                {c.done ? (
                  <CheckCircle2 className="w-4 h-4 text-acr-pos" aria-label="Recorded" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground" aria-label="Not recorded" />
                )}
                <span className={c.done ? "" : "text-muted-foreground"}>{c.label}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 flex-wrap">
          {step.cta && (
            <Button asChild className="min-h-11 pointer-fine:sm:min-h-9" data-testid="first-deal-cta">
              <Link href={step.cta.href}>{step.cta.label}</Link>
            </Button>
          )}
          <Button
            variant="outline"
            className="min-h-11 pointer-fine:sm:min-h-9"
            onClick={() =>
              pax.openWithContext({
                entityType: "first_deal_step",
                entityId: step.ordinal,
                entityName: step.title,
                starterPrompt: `I'm working toward my first deal and my next step is "${step.title}". Walk me through exactly what to do next.`,
              })
            }
            data-testid="first-deal-ask-pax"
          >
            Ask Pax how
          </Button>
        </div>
        {!step.withinProgram && (
          <p className="text-xs text-muted-foreground">The 90-day program window has passed; the next step still stands.</p>
        )}
      </CardContent>
    </Card>
  );
}
