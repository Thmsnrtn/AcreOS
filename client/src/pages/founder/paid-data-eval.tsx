/**
 * /founder/paid-data-eval — the paid-data buy-decision surface.
 *
 * Iyari (Chief of Future) #6 + Lena (CFO/CIO) #3.
 *
 * "If we ran Regrid/Zamplo/PropGrid against the parcels our customers actually
 * worked, which fields would diverge — and how many DEAL DECISIONS would flip?"
 * The answer makes the paid-data upgrade SURGICAL: buy the fields that flip
 * decisions, skip the ones free data already nails — never a blanket
 * subscription bought on vibes.
 *
 * Founder-only — gated by FounderProtectedRoute in App.tsx and again at the API
 * layer (GET/POST /api/founder/paid-data-eval* return 403 to non-founder orgs).
 *
 * Today the harness runs in SAMPLE / DRY-RUN mode against a deterministic mock
 * paid provider (no API key, no spend). The page reads the latest persisted run
 * and lets the founder kick a fresh one. When Lena greenlights a trial the
 * server swaps the mock for the real Regrid adapter — this page is unchanged.
 *
 * Layout (top → bottom):
 *   1. Headline strip — corpus size, decision-flip rate, projected trial cost.
 *   2. Buy recommendation (plain language).
 *   3. Field divergence table — ranked by value score; the buy/skip guide.
 *   4. Decision flips list — the parcels whose deal call would change.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  GitCompareArrows,
  DollarSign,
  Layers,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

// ─── Types — must match server/services/paidDataEvalHarness.ts ──────────────

interface FieldDivergenceResult {
  field: string;
  label: string;
  kind: "numeric" | "categorical" | "boolean";
  eligible: number;
  divergent: number;
  divergenceRate: number;
  fillCount: number;
  fillRate: number;
  meanAbsPctDiff: number | null;
  flipsParticipated: number;
  valueScore: number;
}

interface DecisionFlipDetail {
  parcelKey: string;
  apn: string | null;
  state: string;
  county: string;
  freeBucket: string;
  paidBucket: string;
  dealKillerFlip: boolean;
  divergentFields: string[];
  reason: string;
}

interface PaidDataEvalResult {
  provider: string;
  mode: "sample" | "trial";
  totalParcels: number;
  parcelsCompared: number;
  errors: number;
  estTrialCostCents: number;
  fieldDivergence: FieldDivergenceResult[];
  decisionFlipCount: number;
  decisionFlipRate: number;
  decisionFlips: DecisionFlipDetail[];
  recommendation: string;
  generatedAt: string;
}

interface LatestRun {
  id: number;
  createdAt: string;
  result: PaidDataEvalResult;
}

interface PaidDataEvalResponse {
  asOf: string;
  corpusSize: number;
  latestRun: LatestRun | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtUsdFromCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function bucketLabel(b: string): string {
  switch (b) {
    case "buy":
      return "Buy";
    case "caution":
      return "Caution";
    case "no_buy":
      return "No buy";
    default:
      return b;
  }
}

function bucketTone(b: string): string {
  switch (b) {
    case "buy":
      return "text-acr-pos";
    case "caution":
      return "text-acr-warn";
    case "no_buy":
      return "text-destructive";
    default:
      return "";
  }
}

// ─── Summary tile ───────────────────────────────────────────────────────────

function SummaryTile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "pos" | "neg" | "warn";
}) {
  const toneClass =
    tone === "pos"
      ? "text-acr-pos"
      : tone === "neg"
      ? "text-destructive"
      : tone === "warn"
      ? "text-acr-warn"
      : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          {icon}
          {label}
        </div>
        <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
        {hint ? <div className="text-xs text-muted-foreground mt-1">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function PaidDataEvalContent() {
  useDocumentTitle("Paid-data eval");
  const [lastRunResult, setLastRunResult] = useState<PaidDataEvalResult | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<PaidDataEvalResponse>({
    queryKey: ["/api/founder/paid-data-eval"],
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/paid-data-eval/run", {});
      return (await res.json()) as { runId: number | null; result: PaidDataEvalResult };
    },
    onSuccess: (payload) => {
      setLastRunResult(payload.result);
      queryClient.invalidateQueries({ queryKey: ["/api/founder/paid-data-eval"] });
    },
  });

  // Prefer the just-run result, else the latest persisted run.
  const result: PaidDataEvalResult | null = lastRunResult ?? data?.latestRun?.result ?? null;
  const corpusSize = data?.corpusSize ?? 0;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Paid-data eval harness</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Would Regrid / Zamplo / PropGrid actually move outcomes? This runs the
            persisted free Land-Intelligence corpus against a paid provider and
            reports field divergence + how many deal decisions would flip — so a
            paid-data trial is bought <strong>surgically</strong>, not as a blanket
            subscription. Running in sample / dry-run mode (mock provider, no spend).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Database className="h-3 w-3" aria-hidden="true" />
            {corpusSize} corpus
          </Badge>
          <Button
            size="sm"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending || isLoading || corpusSize === 0}
            aria-label="Run paid-data eval against the persisted corpus"
          >
            {runMutation.isPending ? "Running…" : "Run eval"}
          </Button>
        </div>
      </div>

      {isError ? (
        <QueryErrorState
          title="Failed to load paid-data eval"
          error={(error as Error) ?? null}
          onRetry={() => refetch()}
        />
      ) : null}

      {runMutation.isError ? (
        <Card className="mb-6">
          <CardContent className="p-4 text-sm text-destructive">
            Run failed: {(runMutation.error as Error)?.message ?? "unknown error"}
          </CardContent>
        </Card>
      ) : null}

      {/* Empty state — no persisted corpus yet */}
      {!isLoading && corpusSize === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Database}
              headline="No Land-Intelligence corpus yet"
              subtitle="The eval corpus fills as customers run parcel lookups (each persisted report becomes a ground-truth row). Once there are reports here, run the eval to see what a paid-data trial would change."
              cta={{ label: "", _noOp: true }}
              testId="paid-data-eval-empty"
            />
          </CardContent>
        </Card>
      ) : null}

      {/* No run yet but corpus exists */}
      {!isLoading && corpusSize > 0 && !result ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {corpusSize} persisted report{corpusSize === 1 ? "" : "s"} ready. Click{" "}
            <strong>Run eval</strong> to compare them against a paid provider and see
            the divergence + decision-flip report.
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : null}

      {result ? (
        <>
          {/* Headline strip */}
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryTile
              icon={<Layers className="h-4 w-4" aria-hidden />}
              label="Parcels compared"
              value={result.parcelsCompared}
              hint={`of ${result.totalParcels} in corpus${
                result.errors ? ` · ${result.errors} errors` : ""
              }`}
            />
            <SummaryTile
              icon={<ArrowRightLeft className="h-4 w-4" aria-hidden />}
              label="Decision-flip rate"
              value={fmtPct(result.decisionFlipRate)}
              hint={`${result.decisionFlipCount} deal call${
                result.decisionFlipCount === 1 ? "" : "s"
              } would change`}
              tone={result.decisionFlipCount > 0 ? "warn" : "pos"}
            />
            <SummaryTile
              icon={<DollarSign className="h-4 w-4" aria-hidden />}
              label="Projected trial cost"
              value={fmtUsdFromCents(result.estTrialCostCents)}
              hint={
                result.estTrialCostCents === 0
                  ? "mock provider (no spend)"
                  : `${result.provider} · per-parcel est.`
              }
            />
            <SummaryTile
              icon={<GitCompareArrows className="h-4 w-4" aria-hidden />}
              label="Provider"
              value={<span className="text-base">{result.provider}</span>}
              hint={`${result.mode} mode · ${new Date(result.generatedAt).toLocaleString()}`}
            />
          </div>

          {/* Buy recommendation */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4 text-acr-pos" aria-hidden />
                Buy recommendation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{result.recommendation}</p>
            </CardContent>
          </Card>

          {/* Field divergence */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GitCompareArrows className="h-4 w-4" aria-hidden />
                Field divergence
              </CardTitle>
              <CardDescription>
                Ranked by value score (divergence weighted by decision-flip
                participation). High rows are worth buying; low rows free data
                already covers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead className="text-right">Divergence</TableHead>
                    <TableHead className="text-right">Eligible</TableHead>
                    <TableHead className="text-right">Fills</TableHead>
                    <TableHead className="text-right">Mean Δ</TableHead>
                    <TableHead className="text-right">Flips</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.fieldDivergence.map((f) => (
                    <TableRow key={f.field}>
                      <TableCell>
                        <div className="font-medium">{f.label}</div>
                        <div className="text-xs text-muted-foreground">{f.kind}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPct(f.divergenceRate)}
                        <span className="text-muted-foreground text-xs ml-1">
                          ({f.divergent}/{f.eligible})
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {f.eligible}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {f.fillCount} ({fmtPct(f.fillRate)})
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {f.meanAbsPctDiff != null ? fmtPct(f.meanAbsPctDiff) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.flipsParticipated > 0 ? (
                          <span className="text-acr-warn font-medium">
                            {f.flipsParticipated}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Decision flips */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowRightLeft className="h-4 w-4 text-acr-warn" aria-hidden />
                Decision flips ({result.decisionFlipCount})
              </CardTitle>
              <CardDescription>
                Parcels where the paid value would change the buy/no-buy call or a
                deal-killer flag — the spend that actually earns its keep.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result.decisionFlips.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No decision flips — free data already covers the decision-relevant
                  signal on this corpus. The strongest possible "don't buy paid data
                  yet" signal.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parcel</TableHead>
                      <TableHead>County</TableHead>
                      <TableHead>Flip</TableHead>
                      <TableHead>Why</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.decisionFlips.slice(0, 50).map((flip) => (
                      <TableRow key={flip.parcelKey}>
                        <TableCell>
                          <div className="font-medium flex items-center gap-1.5">
                            {flip.apn ?? flip.parcelKey.slice(0, 12)}
                            {flip.dealKillerFlip ? (
                              <AlertTriangle
                                className="h-3.5 w-3.5 text-destructive"
                                aria-label="Deal-killer flag changed"
                              />
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {flip.county}, {flip.state}
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className={bucketTone(flip.freeBucket)}>
                            {bucketLabel(flip.freeBucket)}
                          </span>
                          <ArrowRightLeft
                            className="inline h-3 w-3 mx-1 text-muted-foreground"
                            aria-hidden
                          />
                          <span className={bucketTone(flip.paidBucket)}>
                            {bucketLabel(flip.paidBucket)}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-md">
                          {flip.reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}

export default function FounderPaidDataEvalPage() {
  return (
    <PageShell label="Paid-data eval">
      <PaidDataEvalContent />
    </PageShell>
  );
}
