/**
 * Record a flip decision — the fix-and-flip vertical's kit-recorded call.
 *
 * Sits on the analyzer BESIDE the draft offer, which stays a draft. The MAO
 * card above it is a SCREEN: nothing is recorded by running it. This panel is
 * where a decision is made: acquire / offer / pass, the operator's own
 * rationale and review date, frozen with its evidence through
 * POST /api/fix-and-flip/decide.
 *
 * WHAT IT SHOWS IS WHAT GETS FROZEN
 *   The panel re-runs the MAO on exactly the inputs the server will use — the
 *   ARV from the saved calculation (or the figure the operator states), and,
 *   where the property has a rehab project, the project's scope total rather
 *   than the analyzer's rehab field — and records only while that preview is
 *   current. A rehab figure that differs from the analyzer's is called out, not
 *   silently swapped.
 *
 * Records a decision; sends nothing, contacts nobody, moves no money.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Gavel } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { ReviewDateChoice, reviewDueAtFromDays } from "@/components/decisions/ReviewDateChoice";
import { apiRequest } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";

type Kind = "acquire" | "offer" | "pass";
const KIND_LABEL: Record<Kind, string> = { acquire: "Acquire", offer: "Make an offer", pass: "Pass" };

interface MaoPreview {
  maoCents: number;
  netProfitCents: number | null;
  netRoiPct: number | null;
  totalCashInCents: number;
  rehabWithContingencyCents: number;
  missing: string[];
}

type ArvSource = "calculation" | "operator_stated" | "comp_median_unadjusted";
const ARV_LABEL: Record<ArvSource, string> = {
  calculation: "Your saved ARV calculation",
  operator_stated: "Stated by you — no saved calculation behind it",
  comp_median_unadjusted: "Comp median $/sq ft from the analyzer — unadjusted, not a saved calculation",
};

export interface FlipDecisionPanelProps {
  /**
   * True once the operator has run the MAO screen above on the current inputs.
   * The analyzer computes nothing until asked, and a decision follows a screen.
   */
  screenRun: boolean;
  propertyId: number | null;
  /** The analyzer's ARV field, cents. */
  arvCents: number | null;
  /** The property's saved ARV calculation figure, when one exists. */
  savedArvCents: number | null;
  /** True when the ARV field holds the analyzer's in-browser comp-median derivation, untouched. */
  arvFromCompMedian: boolean;
  /** The property's rehab project, when one exists. */
  rehabProjectId: string | number | null;
  /** The analyzer's rehab field, cents — null when blank (used only when there is no project). */
  rehabFieldCents: number | null;
  purchasePriceCents: number | null;
  feeCents: number;
  /** The hold comparison the operator ran, at this price — recorded as seen-not-chosen. */
  holdComparisonSeen: { purchasePriceCents: number; monthlyRentCents: number; monthlyExpensesCents: number | null } | null;
}

const usd = (cents: number | null) =>
  cents === null ? "not computed" : `${cents < 0 ? "−" : ""}$${Math.abs(Math.round(cents / 100)).toLocaleString("en-US")}`;

export function FlipDecisionPanel(p: FlipDecisionPanelProps) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind | null>(null);
  const [choice, setChoice] = useState("");
  const [choiceEdited, setChoiceEdited] = useState(false);
  const [rationale, setRationale] = useState("");
  const [reviewInDays, setReviewInDays] = useState<number | null | undefined>(undefined);
  const [recorded, setRecorded] = useState<{ decisionId: number } | null>(null);

  // ARV: the saved calculation when the analyzer's field still holds its
  // figure; otherwise the operator is stating their own.
  const arvSource: ArvSource | null =
    p.arvCents === null || p.arvCents <= 0
      ? null
      : p.savedArvCents !== null && p.arvCents === p.savedArvCents
        ? "calculation"
        : p.arvFromCompMedian
          ? "comp_median_unadjusted"
          : "operator_stated";

  // Rehab: with a project, its scope total (line budgets summed) is the estimate.
  const scope = useQuery<{ totals: { budgetCents: number }; items: Array<{ budgetCents: number }> }>({
    queryKey: ["/api/rehabs", String(p.rehabProjectId)],
    queryFn: async () => (await apiRequest("GET", `/api/rehabs/${p.rehabProjectId}`)).json(),
    enabled: p.screenRun && p.rehabProjectId !== null,
  });
  const rehabSource: "sow" | "operator_stated" = p.rehabProjectId !== null ? "sow" : "operator_stated";
  const rehabCents = rehabSource === "sow" ? (scope.data?.totals.budgetCents ?? null) : p.rehabFieldCents;
  const scopeLines = scope.data?.items.length ?? 0;
  const scopePriced = scope.data?.items.filter((i) => Number(i.budgetCents) > 0).length ?? 0;
  const rehabMissing = rehabSource === "operator_stated" && rehabCents === null;
  const scopeUnpriced = rehabSource === "sow" && scope.data !== undefined && (scopeLines === 0 || rehabCents === 0);

  const previewInputs =
    p.screenRun && p.propertyId !== null && arvSource !== null && rehabCents !== null && !scopeUnpriced
      ? {
          propertyId: p.propertyId,
          arvCents: p.arvCents as number,
          rehabEstimateCents: rehabCents,
          feeCents: p.feeCents,
          ...(p.purchasePriceCents !== null ? { purchasePriceCents: p.purchasePriceCents } : {}),
        }
      : null;

  const preview = useQuery<MaoPreview>({
    queryKey: ["/api/flip-analyzer/mao", "decision-preview", previewInputs],
    queryFn: async () => (await apiRequest("POST", "/api/flip-analyzer/mao", previewInputs)).json(),
    enabled: previewInputs !== null,
    retry: false,
  });

  useEffect(() => {
    if (choiceEdited || !kind || !preview.data) return;
    const price = p.purchasePriceCents ?? preview.data.maoCents;
    setChoice(kind === "pass" ? `Pass at ${usd(price)}` : kind === "offer" ? `Offer ${usd(price)} (MAO ${usd(preview.data.maoCents)})` : `Acquire at ${usd(price)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- regenerate only when the call or the numbers change
  }, [kind, preview.data]);

  const record = useMutation({
    mutationFn: async () => {
      if (kind === null || reviewInDays === undefined || previewInputs === null || arvSource === null) {
        throw new Error("Answer your call and when you'll know first");
      }
      const res = await apiRequest("POST", "/api/fix-and-flip/decide", {
        propertyId: previewInputs.propertyId,
        // The figures previewed travel with the record, so a calculation or a
        // scope that changed since the preview is refused, not silently frozen.
        arv:
          arvSource === "calculation"
            ? { source: "calculation", expectedArvCents: previewInputs.arvCents }
            : { source: arvSource, arvCents: previewInputs.arvCents },
        operatorRehabEstimateCents: previewInputs.rehabEstimateCents,
        ...(p.purchasePriceCents !== null ? { purchasePriceCents: p.purchasePriceCents } : {}),
        feeCents: p.feeCents,
        ...(p.holdComparisonSeen && p.holdComparisonSeen.purchasePriceCents === p.purchasePriceCents
          ? {
              holdComparisonSeen: {
                monthlyRentCents: p.holdComparisonSeen.monthlyRentCents,
                ...(p.holdComparisonSeen.monthlyExpensesCents !== null ? { monthlyExpensesCents: p.holdComparisonSeen.monthlyExpensesCents } : {}),
              },
            }
          : {}),
        kind,
        choice: choice.trim(),
        rationale: rationale.trim(),
        reviewDueAt: reviewDueAtFromDays(reviewInDays),
      });
      return (await res.json()) as { decisionId: number };
    },
    onSuccess: (d) => {
      setRecorded({ decisionId: d.decisionId });
      queryClient.invalidateQueries({ queryKey: ["/api/decisions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decisions/due"] });
    },
  });

  const canRecord =
    previewInputs !== null &&
    !!preview.data &&
    !preview.isFetching &&
    kind !== null &&
    choice.trim().length > 0 &&
    rationale.trim().length >= 10 &&
    reviewInDays !== undefined &&
    !record.isPending;

  return (
    <Card className="mt-6" data-testid="flip-decision">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gavel className="h-4 w-4 text-primary" aria-hidden="true" />
          Record your decision
        </CardTitle>
        <CardDescription>
          The MAO above is a screen — running it records nothing. Recording here freezes your call,
          your reasons and the evidence behind the numbers, so the outcome can be compared with it
          later. It sends nothing and moves no money; a draft offer stays a separate, draft document.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {recorded ? (
          <p className="flex items-center gap-2 text-sm" role="status" data-testid="flip-decision-recorded">
            <CheckCircle2 className="h-4 w-4 text-acr-pos" aria-hidden="true" />
            Recorded as decision #{recorded.decisionId}, with its ARV and rehab evidence
            {reviewInDays ? ". Today will ask how it went when it's due." : "."}
          </p>
        ) : p.propertyId === null ? (
          <p className="text-sm text-muted-foreground">Pick a property above to record a decision on it.</p>
        ) : !p.screenRun ? (
          <p className="text-sm text-muted-foreground" data-testid="flip-decision-run-screen-first">
            Run the MAO above on your current numbers first — a decision is recorded on numbers you have seen.
          </p>
        ) : arvSource === null ? (
          <p className="text-sm text-muted-foreground">A decision needs an ARV — compute one from comps or enter your own above.</p>
        ) : (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="flip-decision-evidence">
              <div>
                <dt className="text-xs text-muted-foreground">ARV</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">{usd(p.arvCents)}</span>
                  <Badge variant="outline" data-testid="flip-decision-arv-source">
                    {ARV_LABEL[arvSource]}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Rehab estimate</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  {rehabSource === "sow" && scope.isLoading ? (
                    <Skeleton className="h-5 w-24" />
                  ) : rehabMissing ? (
                    <span className="text-muted-foreground">none entered</span>
                  ) : (
                    <span className="tabular-nums">{usd(rehabCents)}</span>
                  )}
                  <Badge variant="outline" data-testid="flip-decision-rehab-source">
                    {rehabSource === "sow"
                      ? `Your project's scope total (${scopePriced} of ${scopeLines} lines priced)`
                      : "Stated by you — no scope of work behind it"}
                  </Badge>
                </dd>
              </div>
            </dl>
            {rehabSource === "sow" && rehabCents !== null && p.rehabFieldCents !== null && rehabCents !== p.rehabFieldCents && !scopeUnpriced ? (
              <p className="text-xs text-muted-foreground" data-testid="flip-decision-rehab-differs">
                This differs from the {usd(p.rehabFieldCents)} in the analyzer's rehab field. With a rehab project, its
                priced scope lines are the estimate, so the decision uses {usd(rehabCents)}.
              </p>
            ) : null}
            {rehabMissing ? (
              <p className="text-sm text-muted-foreground" data-testid="flip-decision-rehab-missing">
                Enter your rehab estimate in the analyzer above — or create a rehab project for this property and price
                its scope. A blank estimate is not recorded as $0.
              </p>
            ) : scopeUnpriced ? (
              <p className="text-sm text-muted-foreground" data-testid="flip-decision-scope-unpriced">
                This property's rehab project has no priced scope lines yet. Price its lines on the project, and the
                decision uses their total.
              </p>
            ) : scope.isError ? (
              <QueryErrorState error={scope.error as Error} onRetry={() => scope.refetch()} compact title="Couldn't read the rehab scope" />
            ) : preview.isError ? (
              <QueryErrorState error={preview.error as Error} onRetry={() => preview.refetch()} compact title="Couldn't compute these numbers" />
            ) : !preview.data ? (
              <Skeleton className="h-14" />
            ) : (
              <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="flip-decision-metrics">
                <div className="rounded-md border border-border p-2">
                  <dt className="text-xs text-muted-foreground">Net profit</dt>
                  <dd className="font-semibold tabular-nums" data-testid="flip-decision-net-profit">{usd(preview.data.netProfitCents)}</dd>
                </div>
                <div className="rounded-md border border-border p-2">
                  <dt className="text-xs text-muted-foreground">MAO</dt>
                  <dd className="font-semibold tabular-nums">{usd(preview.data.maoCents)}</dd>
                </div>
                <div className="rounded-md border border-border p-2">
                  <dt className="text-xs text-muted-foreground">Net ROI</dt>
                  <dd className="font-semibold tabular-nums">{preview.data.netRoiPct === null ? "not computed" : `${preview.data.netRoiPct.toFixed(1)}%`}</dd>
                </div>
                <div className="rounded-md border border-border p-2">
                  <dt className="text-xs text-muted-foreground">Total cash in</dt>
                  <dd className="font-semibold tabular-nums">{usd(preview.data.totalCashInCents)}</dd>
                </div>
              </dl>
              {preview.data.missing.length > 0 ? (
                <ul className="m-0 list-none space-y-1 p-0 text-xs text-muted-foreground" data-testid="flip-decision-missing">
                  {preview.data.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : null}
              </>
            )}

            <fieldset>
              <legend className="text-sm font-medium">Your call</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["acquire", "offer", "pass"] as const).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={kind === k ? "secondary" : "outline"}
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    data-testid={`flip-decision-kind-${k}`}
                  >
                    {KIND_LABEL[k]}
                  </Button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="flip-decision-choice">What you're deciding</Label>
              <Input
                id="flip-decision-choice"
                value={choice}
                onChange={(e) => {
                  setChoice(e.target.value);
                  setChoiceEdited(true);
                }}
                data-testid="flip-decision-choice"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="flip-decision-rationale">Why</Label>
              <Textarea
                id="flip-decision-rationale"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="The sentence you'll want to read when you find out how this went."
                data-testid="flip-decision-rationale"
              />
            </div>
            <ReviewDateChoice value={reviewInDays} onChange={setReviewInDays} testIdPrefix="flip-decision-review-in" />
            {record.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {(record.error as Error).message} — nothing was recorded.
              </p>
            ) : null}
            <Button className="w-full" disabled={!canRecord} onClick={() => record.mutate()} data-testid="flip-decision-record">
              {record.isPending ? "Recording…" : Verbs.SAVE + " decision"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
