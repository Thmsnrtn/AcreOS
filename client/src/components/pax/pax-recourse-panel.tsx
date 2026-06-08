/**
 * PaxRecoursePanel — the customer-facing "appeal the AI" surface.
 *
 * Quinn (Chief of Alignment) + Rafe (CCO). When Pax refuses a request, the
 * refusal is recorded with the rule it cited, in plain language
 * (`citedImmutableText`). This panel shows the customer those refusals with
 * the reason, lets them FILE AN APPEAL, and — once a human has reviewed it —
 * shows the outcome (upheld | reversed) in their own thread. EU AI Act Art. 86
 * (right to a clear explanation + recourse).
 *
 * Tone (load-bearing — this must NOT be a dark pattern):
 *   - Honest: the refusal text + the exact rule are shown verbatim.
 *   - Calm: muted surface, no alarm styling on the refusal itself.
 *   - Symmetric: "Appeal this" is a plain outline button, never hidden,
 *     never nagging. "Reversed" is celebrated softly; "upheld" is stated
 *     plainly with the reviewer's words — we don't dress up a "no".
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Scale, CheckCircle2, Clock } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type AppealStatus = "open" | "under_review" | "upheld" | "reversed";

interface RefusalAppeal {
  id: number;
  status: AppealStatus;
  reason: string;
  outcomeMessage: string | null;
  resolvedAt: string | null;
  filedAt: string;
}

interface Refusal {
  id: number;
  conversationId: number | null;
  messageId: number | null;
  citedImmutableId: string;
  citedImmutableText: string | null;
  refusalText: string;
  severity: string;
  refusedAt: string;
  appeal: RefusalAppeal | null;
}

interface RefusalsResponse {
  refusals: Refusal[];
}

// ─── Appeal status presentation ──────────────────────────────────────────────

const STATUS_META: Record<
  AppealStatus,
  { label: string; variant: "outline" | "secondary" | "default" | "destructive"; icon: typeof Clock }
> = {
  open: { label: "Appeal filed", variant: "secondary", icon: Clock },
  under_review: { label: "Under review", variant: "default", icon: Clock },
  upheld: { label: "Decision stands", variant: "outline", icon: Scale },
  reversed: { label: "Reversed", variant: "default", icon: CheckCircle2 },
};

// ─── Appeal form (inline, per refusal) ───────────────────────────────────────

function AppealForm({
  refusalId,
  onDone,
}: {
  refusalId: number;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fieldId = `appeal-reason-${refusalId}`;

  const mutation = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest("POST", "/api/pax/appeals", {
        refusalPayloadId: refusalId,
        appealReason: reason.trim(),
      });
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pax/refusals"] });
      toast({
        title: "Appeal filed",
        description: "A person will review this and you'll hear back here.",
      });
      onDone();
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't file your appeal",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const tooShort = reason.trim().length === 0;

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!tooShort) mutation.mutate();
      }}
    >
      <Label htmlFor={fieldId} className="text-xs font-medium text-acr-ink-2">
        Why do you think this was wrong?
      </Label>
      <Textarea
        id={fieldId}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Tell us in your own words — a person reads every appeal."
        className="text-sm"
        aria-describedby={`${fieldId}-hint`}
      />
      <p id={`${fieldId}-hint`} className="sr-only">
        Required. Up to 2,000 characters.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={tooShort || mutation.isPending}
          aria-label="Submit appeal"
        >
          {mutation.isPending ? "Submitting…" : "Submit appeal"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDone}
          disabled={mutation.isPending}
          aria-label="Cancel appeal"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── One refusal card ────────────────────────────────────────────────────────

function RefusalCard({ refusal }: { refusal: Refusal }) {
  const [appealing, setAppealing] = useState(false);
  const appeal = refusal.appeal;

  return (
    <li className="rounded-card border border-border bg-card p-4">
      <div className="flex items-start gap-2 mb-2">
        <ShieldCheck
          className="h-4 w-4 text-acr-ink-3 mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-acr-ink-1">{refusal.refusalText}</p>
        </div>
      </div>

      {/* The cited rule, in plain language — the heart of the explanation. */}
      {refusal.citedImmutableText && (
        <div className="ml-6 rounded-md bg-muted/50 border border-border/50 px-3 py-2 mb-2">
          <p className="text-xs font-medium text-acr-ink-2 mb-0.5">
            The rule Pax followed
          </p>
          <p className="text-xs text-muted-foreground leading-snug">
            {refusal.citedImmutableText}
          </p>
        </div>
      )}

      <div className="ml-6">
        {/* No appeal yet → offer one (calmly). */}
        {!appeal && !appealing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAppealing(true)}
            aria-label="Appeal this decision"
          >
            <Scale className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            Appeal this
          </Button>
        )}

        {!appeal && appealing && (
          <AppealForm refusalId={refusal.id} onDone={() => setAppealing(false)} />
        )}

        {/* Appeal exists → show its lifecycle + outcome. */}
        {appeal && <AppealState appeal={appeal} />}
      </div>
    </li>
  );
}

function AppealState({ appeal }: { appeal: RefusalAppeal }) {
  const meta = STATUS_META[appeal.status];
  const Icon = meta.icon;
  const resolved = appeal.status === "upheld" || appeal.status === "reversed";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant={meta.variant} className="text-xs gap-1">
          <Icon className="w-3 h-3" aria-hidden="true" />
          {meta.label}
        </Badge>
        {!resolved && (
          <span className="text-xs text-muted-foreground">
            A person is reviewing your appeal.
          </span>
        )}
      </div>

      {/* The reviewer's plain-language outcome — the loop closed. */}
      {resolved && appeal.outcomeMessage && (
        <div
          className={
            appeal.status === "reversed"
              ? "rounded-md bg-acr-pos-soft border border-acr-pos/30 px-3 py-2"
              : "rounded-md bg-muted/50 border border-border/50 px-3 py-2"
          }
        >
          <p className="text-xs font-medium text-acr-ink-2 mb-0.5">
            {appeal.status === "reversed"
              ? "We reversed this decision"
              : "We reviewed and the decision stands"}
          </p>
          <p className="text-xs text-acr-ink-1 leading-snug">
            {appeal.outcomeMessage}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function PaxRecoursePanel() {
  const { data, isLoading, error, refetch, isRefetching } =
    useQuery<RefusalsResponse>({
      queryKey: ["/api/pax/refusals"],
    });

  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading your appeals">
        <Skeleton className="h-5 w-48" />
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-card" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <QueryErrorState
        error={error}
        onRetry={() => refetch()}
        isRetrying={isRefetching}
        title="Couldn't load your appeals"
        description="We couldn't load the decisions you can appeal. Please try again."
        testId="recourse-error"
      />
    );
  }

  const refusals = data?.refusals ?? [];

  if (refusals.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        headline="Nothing to appeal"
        subtitle="When Pax declines a request, it shows up here with the rule it followed — and you can appeal it. You have no declined requests right now."
        tone="default"
        // TODO(cta): appeals — no action when there is nothing to appeal
        cta={{ label: "", _noOp: true }}
        testId="recourse-empty"
      />
    );
  }

  return (
    <section aria-labelledby="recourse-heading" className="space-y-3">
      <div>
        <h2
          id="recourse-heading"
          className="text-xs font-semibold text-acr-ink-2 uppercase tracking-wide"
        >
          When Pax says no
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Every time Pax declines a request, you can see why — and appeal it. A
          person reviews each appeal and tells you the outcome here.
        </p>
      </div>
      <ul
        className="space-y-2 list-none p-0 m-0"
        aria-label="Declined requests you can appeal"
      >
        {refusals.map((r) => (
          <RefusalCard key={r.id} refusal={r} />
        ))}
      </ul>
    </section>
  );
}
