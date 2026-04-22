/**
 * FounderOnboardingPage — view every Land Investor's onboarding
 * journey in one place. Shows each org's current step, activation
 * status, founder-flagged journeys needing personal attention.
 *
 * This is the primary founder-side surface for the biggest
 * conversion lever in the product. If activation rate drops, this
 * page is where you diagnose why — which step are journeys getting
 * stuck at? Which orgs need a rescue call?
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Rocket, AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { relative } from "@/lib/format";
import { Link } from "wouter";

interface JourneyRow {
  id: number;
  organizationId: number;
  startedAt: string;
  currentStepKey: string;
  activationStatus: "pending" | "active" | "at_risk" | "churned" | "completed";
  activationDeterminedAt: string | null;
  founderFlag: string | null;
}

interface ActivationStats {
  total: number;
  completed: number;
  byStatus: Record<string, number>;
  activationRatePct: number;
}

const STEP_LABEL: Record<string, string> = {
  day0_welcome: "Day 0 — welcome",
  day1_goals_prompt: "Day 1 — goals",
  day3_starter_leads: "Day 3 — starter leads",
  day7_checkin: "Day 7 — check-in",
  day14_feature_review: "Day 14 — feature review",
  day30_activation_verdict: "Day 30 — verdict",
};

const STATUS_META: Record<
  JourneyRow["activationStatus"],
  { label: string; icon: any; color: string }
> = {
  pending: { label: "In progress", icon: Clock, color: "text-amber-600 dark:text-amber-400" },
  active: { label: "Activated", icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400" },
  at_risk: { label: "At risk", icon: AlertTriangle, color: "text-amber-600 dark:text-amber-400" },
  churned: { label: "Churned", icon: AlertTriangle, color: "text-red-600 dark:text-red-400" },
  completed: { label: "Completed", icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400" },
};

export default function FounderOnboardingPage() {
  const { data, isLoading, isError } = useQuery<{ journeys: JourneyRow[]; stats: ActivationStats }>({
    queryKey: ["/api/founder/intelligence/onboarding/journeys"],
    staleTime: 60_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();

  const sweep = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/founder/intelligence/onboarding/sweep-now", {})).json(),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/onboarding/journeys"] });
      toast({ title: "Swept", description: `fired ${r.fired} step(s)` });
    },
  });

  const journeys = data?.journeys ?? [];
  const stats = data?.stats;
  const flagged = journeys.filter((j) => j.founderFlag === "escalate");
  const active = journeys.filter((j) => j.activationStatus === "pending");
  const complete = journeys.filter((j) => j.activationStatus !== "pending");

  return (
    <PageShell label="Onboarding">
      <div className="space-y-6 max-w-6xl mx-auto">
        <Card>
          <CardContent className="p-6 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold text-foreground mb-2 flex items-center gap-2">
                <Rocket className="h-5 w-5 text-muted-foreground" />
                Customer onboarding
              </h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Sophie's 30-day scripted journey for every new Land Investor: welcome → goals →
                starter leads → week-1 check-in → feature review → day-30 activation verdict. Watch
                activation rate here. Flagged journeys mean Sophie wants you on a personal call.
              </p>
            </div>
            <Button
              onClick={() => sweep.mutate()}
              disabled={sweep.isPending}
              size="sm"
              variant="outline"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              {sweep.isPending ? "Sweeping…" : "Sweep now"}
            </Button>
          </CardContent>
        </Card>

        {/* Stats strip */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total journeys" value={stats.total} />
            <StatCard label="In progress" value={stats.byStatus.pending ?? 0} />
            <StatCard label="Activated" value={stats.byStatus.active ?? 0} />
            <StatCard label="Activation rate" value={`${stats.activationRatePct}%`} />
          </div>
        )}

        {/* Flagged (urgent) */}
        {flagged.length > 0 && (
          <Card className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                Flagged — Sophie wants you on a call
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {flagged.map((j) => (
                <JourneyRowDisplay key={j.id} journey={j} />
              ))}
            </CardContent>
          </Card>
        )}

        {/* Active */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">In progress ({active.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : isError ? (
              <p className="text-sm text-red-600">Could not load.</p>
            ) : active.length === 0 ? (
              <EmptyState
                icon={Rocket}
                title="No journeys in progress"
                description="Journeys start automatically when a new Land Investor org signs up."
              />
            ) : (
              <div className="space-y-2">
                {active.map((j) => (
                  <JourneyRowDisplay key={j.id} journey={j} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Completed */}
        {complete.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Completed ({complete.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {complete.map((j) => (
                  <JourneyRowDisplay key={j.id} journey={j} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function JourneyRowDisplay({ journey }: { journey: JourneyRow }) {
  const status = STATUS_META[journey.activationStatus];
  const stepLabel = STEP_LABEL[journey.currentStepKey] ?? journey.currentStepKey;
  return (
    <Link href={`/organizations/${journey.organizationId}`}>
      <a className="block border border-border rounded p-3 hover:bg-muted/40 transition">
        <div className="flex items-center gap-3 flex-wrap">
          <status.icon className={`h-4 w-4 ${status.color} shrink-0`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Org #{journey.organizationId}</p>
            <p className="text-[11px] text-muted-foreground">
              Started {relative(journey.startedAt)} · {stepLabel}
            </p>
          </div>
          <Badge variant="secondary" className="text-[10px]">
            {status.label}
          </Badge>
          {journey.founderFlag === "escalate" && (
            <Badge variant="destructive" className="text-[10px]">
              call requested
            </Badge>
          )}
        </div>
      </a>
    </Link>
  );
}
