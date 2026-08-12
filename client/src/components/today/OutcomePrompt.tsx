/**
 * OutcomePrompt — the Today card that ASKS what happened.
 *
 * The canonical loop's last open end, on the customer's side of the screen.
 * `GET /api/decisions/due` has existed since the outcome prompt shipped and
 * nothing rendered it, so the loop still closed only when someone thought to
 * close it — and volunteered outcomes are a biased sample by construction, since
 * people remember the extremes. This card is what turns the learning layer from
 * anecdote into measurement.
 *
 * WHY TODAY AND NOT A NEW ROUTE
 * -----------------------------
 * The customer nav is five fixed doors and no new surface may become a sixth.
 * This is an ATTENTION item — "three decisions are waiting on you" — and Today
 * is the attention door, so it lives here as a card rather than behind a new
 * entry. Nothing is added to NAV_MODULES.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * It never guesses an outcome, never pre-selects one, and never treats
 * dismissing the card as an answer. "Still open" is a real, recordable answer
 * rather than a way to make the card go away — it appends an interim
 * observation, which is exactly what the immutable decision record needs to
 * stay honest about a position that has not resolved.
 *
 * It also asks for NO NUMBERS. An outcome's `actuals` are measurements, and a
 * figure typed into a prompt three months later to make a card disappear is not
 * a measurement. The metrics stay `unmeasured` — which is true — until something
 * measures them.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { motion } from "framer-motion";
import { ClipboardCheck, CircleHelp } from "lucide-react";
import { formatRelative } from "@/lib/format";
// The repo keeps ONE vocabulary for action verbs so the same action never
// reads two ways across surfaces (eslint acreos/prefer-verbs-canon).
import { Verbs } from "@/lib/labels";

/** Mirrors `DecisionDueForOutcome` from server/services/decisions/decisionStore.ts. */
interface DueDecision {
  id: number;
  decidedAt: string;
  reviewDueAt: string;
  subjectType: string;
  subjectId: number;
  kind: string;
  choice: string;
  interimObservations: number;
}

interface DueResponse {
  due: DueDecision[];
  count: number;
}

/**
 * The answers offered, and the vocabulary is the server's own `OUTCOME_KINDS`.
 *
 * Deliberately NOT a free-text box plus a guess. Each option is a fact about
 * what happened, and "still open" is one of them rather than a dismissal —
 * a card you can only silence by claiming a result is a card that manufactures
 * results.
 */
const ANSWERS = [
  { kind: "offer_accepted", label: "Accepted", summary: "The offer was accepted." },
  { kind: "offer_rejected", label: "Rejected", summary: "The offer was rejected." },
  { kind: "acquired", label: "Acquired", summary: "The purchase closed." },
  { kind: "sold", label: "Sold", summary: "The position was exited." },
  { kind: "abandoned", label: "Walked away", summary: "Pursued, then dropped without a transaction." },
  { kind: "still_open", label: "Still open", summary: "Checked in; the position has not resolved." },
] as const;

/** How the choice reads when the decision's own text is long. */
function shortChoice(choice: string): string {
  return choice.length > 90 ? `${choice.slice(0, 87)}…` : choice;
}

export function OutcomePrompt() {
  const { toast } = useToast();
  const [answering, setAnswering] = useState<number | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<DueResponse>({
    queryKey: ["/api/decisions/due"],
  });

  const record = useMutation({
    mutationFn: async (vars: { decisionSnapshotId: number; kind: string; summary: string }) => {
      await apiRequest("POST", `/api/decisions/${vars.decisionSnapshotId}/outcomes`, {
        kind: vars.kind,
        summary: vars.summary,
        // No actuals. See the file header: a number typed to clear a card is
        // not a measurement, and the variance layer reporting `unmeasured` is
        // the honest answer until something measures it.
        actuals: [],
        observedAt: new Date().toISOString(),
      });
    },
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/decisions/due"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decisions/calibration"] });
      setAnswering(null);
      toast({
        title: vars.kind === "still_open" ? "Noted — still open" : "Outcome recorded",
        description:
          vars.kind === "still_open"
            ? "We'll ask again rather than assume it resolved."
            : "It now counts toward how your forecasts are tracking.",
      });
    },
    onError: () => {
      toast({
        title: "Couldn't record that outcome",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card className="rounded-card shadow-acr-1">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">What happened?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="rounded-card shadow-acr-1">
        <CardContent className="py-6">
          <QueryErrorState error={error ?? null} onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  const due = data?.due ?? [];

  if (due.length === 0) {
    return (
      <Card className="rounded-card shadow-acr-1">
        <CardContent className="py-2">
          <EmptyState
            icon={ClipboardCheck}
            headline="Nothing waiting on an answer"
            subtitle="When a decision reaches the date you said you'd know by, it shows up here so what actually happened gets recorded while you still remember it."
            tone="default"
            tips={[
              "Set a review date when you record a decision — that is what puts it here.",
              "Decisions with no review date never appear, by design.",
            ]}
            cta={{ label: "Go to Deals", href: "/deals" }}
            testId="outcome-prompt-empty"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-card shadow-acr-1">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          What happened?
        </CardTitle>
        <Badge variant="secondary" data-testid="outcome-prompt-count">
          {due.length} waiting
        </Badge>
      </CardHeader>
      <CardContent>
        <motion.ul
          className="space-y-4"
          variants={staggerContainer}
          initial="hidden"
          // "visible", not "show". The shared variants are named
          // hidden/visible; animating to a variant that does not exist leaves
          // the whole list stuck at opacity 0 — a card that renders nothing and
          // throws nothing. animationVariantNames.test.ts caught it.
          animate="visible"
        >
          {due.map((d) => (
            <motion.li key={d.id} variants={staggerItem} data-testid={`outcome-due-${d.id}`}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <CircleHelp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium leading-snug">{shortChoice(d.choice)}</p>
                  <p className="text-xs text-muted-foreground">
                    Decided {formatRelative(d.decidedAt)} · you said you'd know by{" "}
                    {formatRelative(d.reviewDueAt)}
                    {d.interimObservations > 0 && (
                      <>
                        {" · "}
                        {/* Shown so the card never asks as though it were the
                            first time. Someone who has already answered "still
                            open" twice is being asked a third time, and saying
                            so is the difference between a prompt and a nag. */}
                        checked {d.interimObservations}× already
                      </>
                    )}
                  </p>

                  {answering === d.id ? (
                    <div
                      className="flex flex-wrap gap-2 pt-1"
                      role="group"
                      aria-label={`Record what happened to: ${d.choice}`}
                    >
                      {ANSWERS.map((a) => (
                        <Button
                          key={a.kind}
                          size="sm"
                          variant={a.kind === "still_open" ? "outline" : "secondary"}
                          disabled={record.isPending}
                          onClick={() =>
                            record.mutate({
                              decisionSnapshotId: d.id,
                              kind: a.kind,
                              summary: a.summary,
                            })
                          }
                          data-testid={`outcome-answer-${a.kind}-${d.id}`}
                        >
                          {a.label}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAnswering(null)}
                        data-testid={`outcome-cancel-${d.id}`}
                      >
                        {Verbs.CANCEL}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => setAnswering(d.id)}
                        data-testid={`outcome-open-${d.id}`}
                      >
                        Record what happened
                      </Button>
                      {/* No "dismiss". Silencing the card without an answer is
                          how the record fills with decisions that simply stopped
                          being asked about — "still open" is the honest way to
                          say not yet, and it is one click inside. */}
                      <Link
                        href="/deals"
                        className="rounded-sm text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Open Deals
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </CardContent>
    </Card>
  );
}
