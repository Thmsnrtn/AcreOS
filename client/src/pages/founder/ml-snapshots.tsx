/**
 * Phase 3 Week 12 — Founder ML training-snapshot dashboard (Magnus §1).
 *
 * Surfaces the state of the future-model training corpus:
 *   • counts by snapshot type (with progress toward training-ready threshold)
 *   • recent additions across all types
 *   • per-type wiring info so we can see which trigger points are firing
 *
 * Reads /api/founder/ml-snapshots/summary and /recent.
 */

import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, Database, Clock, CheckCircle2 } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

type SnapshotType =
  | "avm_vs_actual"
  | "deal_outcome"
  | "lead_conversion"
  | "churn_outcome"
  | "offer_acceptance";

interface SnapshotCount {
  snapshotType: SnapshotType;
  total: number;
  withOutcome: number;
  trainingReadyAt: number;
  trainingReady: boolean;
}

interface SummaryResponse {
  counts: SnapshotCount[];
  thresholds: Record<SnapshotType, number>;
  retentionPolicy: string;
}

interface SnapshotRow {
  id: string;
  snapshotType: string;
  subjectType: string;
  subjectId: string;
  organizationId: number | null;
  decisionAt: string;
  outcomeAt: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<SnapshotType, string> = {
  avm_vs_actual: "AVM vs actual sale price",
  deal_outcome: "Deal outcome (won / lost)",
  lead_conversion: "Lead conversion",
  churn_outcome: "Subscription churn",
  offer_acceptance: "Offer acceptance",
};

const TYPE_DESCRIPTIONS: Record<SnapshotType, string> = {
  avm_vs_actual:
    "Capture: every AVM run. Pair: deal closes with acceptedAmount. Trains a regression model to refine our hybrid comps+ML estimator.",
  deal_outcome:
    "Capture: deal status → closed (won) or cancelled (lost). Trains a classifier predicting close probability from deal/property features.",
  lead_conversion:
    "Capture: lead created. Pair: deal close (converted) or deal cancel (dismissed). Trains a lead-quality scorer.",
  churn_outcome:
    "Capture: customer.subscription.deleted webhook. Features = last-30-day usage. Trains a churn predictor.",
  offer_acceptance:
    "Capture: deal status → offer_sent. Pair: status → accepted / countered / cancelled. Trains an offer-strategy advisor.",
};

const WIRING_INFO: Record<SnapshotType, string> = {
  avm_vs_actual: "server/services/acreOSValuation.ts → generateValuation + generateMarketEstimate",
  deal_outcome: "server/routes-deals.ts → PUT /api/deals/:id (status closed | cancelled)",
  lead_conversion: "server/routes-leads.ts → POST /api/leads (decision); routes-deals.ts (outcome pairing)",
  churn_outcome: "server/webhookHandlers.ts → processSubscriptionCancelled",
  offer_acceptance: "server/routes-deals.ts → PUT /api/deals/:id (offer_sent → accepted/countered/cancelled)",
};

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-500"
        style={{ width: `${pct}%` }}
        aria-label={`${value} of ${max} samples (${Math.round(pct)}%)`}
      />
    </div>
  );
}

function SummaryCard({ count }: { count: SnapshotCount }) {
  const t = count.snapshotType;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{TYPE_LABELS[t] ?? t}</CardTitle>
            <CardDescription className="mt-1 text-xs">
              {TYPE_DESCRIPTIONS[t]}
            </CardDescription>
          </div>
          {count.trainingReady ? (
            <Badge variant="default" className="gap-1">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Training-ready
            </Badge>
          ) : (
            <Badge variant="outline">Accumulating</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Total snapshots</p>
            <p className="text-2xl font-bold tabular-nums">{count.total.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">With outcome label</p>
            <p className="text-2xl font-bold tabular-nums">{count.withOutcome.toLocaleString()}</p>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Training-ready when {count.trainingReadyAt.toLocaleString()} labelled samples accumulated</span>
            <span className="tabular-nums">
              {count.withOutcome.toLocaleString()} / {count.trainingReadyAt.toLocaleString()}
            </span>
          </div>
          <ProgressBar value={count.withOutcome} max={count.trainingReadyAt} />
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Wired from: </span>
          <code className="text-[11px]">{WIRING_INFO[t]}</code>
        </p>
      </CardContent>
    </Card>
  );
}

function SummarySection() {
  const { data, isLoading, error } = useQuery<SummaryResponse>({
    queryKey: ["/api/founder/ml-snapshots/summary"],
    queryFn: async () => {
      const r = await fetch("/api/founder/ml-snapshots/summary", {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load summary");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-sm text-destructive">Failed to load snapshot summary.</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {data.counts.map((c) => (
        <SummaryCard key={c.snapshotType} count={c} />
      ))}
    </div>
  );
}

function RecentSection() {
  const { data, isLoading } = useQuery<{ snapshots: SnapshotRow[] }>({
    queryKey: ["/api/founder/ml-snapshots/recent"],
    queryFn: async () => {
      const r = await fetch("/api/founder/ml-snapshots/recent", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load recent snapshots");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!data?.snapshots?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No snapshots recorded yet. Once AVM runs / deal closes / lead creates start firing, rows
        will appear here.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {data.snapshots.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{s.snapshotType}</Badge>
            <span className="text-muted-foreground">
              {s.subjectType} #{s.subjectId}
            </span>
            {s.organizationId !== null && (
              <Badge variant="secondary" className="text-[10px]">
                org #{s.organizationId}
              </Badge>
            )}
            {s.outcomeAt && (
              <Badge variant="default" className="text-[10px]">
                paired
              </Badge>
            )}
          </div>
          <span className="tabular-nums text-xs text-muted-foreground">
            {new Date(s.createdAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function FounderMlSnapshotsPage() {
  useDocumentTitle("ML snapshots");
  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Brain className="w-7 h-7" aria-hidden="true" />
            ML training snapshots
          </h1>
          <p className="text-muted-foreground mt-1">
            Labelled feature snapshots captured at decision time, paired with outcomes when
            observed. Model training is deferred to month 18+ — this is the measurement
            infrastructure that makes future training possible.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Corpus by snapshot type
            </CardTitle>
            <CardDescription>
              Each card shows total snapshots, how many have an outcome label, and progress
              toward the training-ready threshold (heuristic floor; tighten once a real ML team
              scopes the actual targets).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SummarySection />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent additions
            </CardTitle>
            <CardDescription>
              Last 50 snapshots written across all types. &ldquo;paired&rdquo; means the
              outcome label has been filled in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecentSection />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Retention</CardTitle>
            <CardDescription>
              Snapshots are kept indefinitely. They&rsquo;re cheap (jsonb rows, no PII beyond
              what already lives on source rows) and we want the longest possible training
              history. If GDPR / DSAR deletion runs, the foreign key cascade on
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">organization_id</code>
              wipes that org&rsquo;s snapshots too.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </PageShell>
  );
}
