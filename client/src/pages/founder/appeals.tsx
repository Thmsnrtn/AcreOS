/**
 * Founder appeal-review surface — the human half of "appeal the AI".
 *
 * Quinn (Chief of Alignment) + Rafe (CCO). Lists the customer appeals against
 * Pax refusals with full context (the cited immutable in plain language + the
 * refusal the customer saw + their stated reason), and lets the founder render
 * a verdict — UPHOLD (the refusal stands) or REVERSE (it was wrong) — with an
 * internal rationale AND a plain-language outcome the customer receives.
 *
 * Founder-gated (FounderProtectedRoute in App.tsx). The outcome closes the
 * loop: persisted to the appeal row (shown in the customer's Pax thread) +
 * a lifecycle email.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Scale, ShieldCheck, CheckCircle2 } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type AppealStatus = "open" | "under_review" | "upheld" | "reversed";

interface AppealRefusal {
  id: number;
  citedImmutableId: string;
  citedImmutableText: string | null;
  refusalText: string;
  severity: string;
  refusedAt: string;
}

interface FounderAppeal {
  id: number;
  organizationId: number;
  orgName: string | null;
  status: AppealStatus;
  appealReason: string;
  appellantUserId: string | null;
  filedAt: string;
  reviewNotes: string | null;
  customerMessage: string | null;
  resolvedAt: string | null;
  refusal: AppealRefusal;
}

interface AppealsResponse {
  appeals: FounderAppeal[];
  count: number;
}

function formatDate(s: string): string {
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Resolve form (per appeal) ───────────────────────────────────────────────

function ResolveForm({ appeal }: { appeal: FounderAppeal }) {
  const [reviewNotes, setReviewNotes] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [decision, setDecision] = useState<"upheld" | "reversed" | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (chosen: "upheld" | "reversed") => {
      const resp = await apiRequest(
        "POST",
        `/api/founder/appeals/${appeal.id}/resolve`,
        {
          decision: chosen,
          reviewNotes: reviewNotes.trim(),
          customerMessage: customerMessage.trim(),
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.message || "Resolve failed");
      }
      return resp.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/appeals"] });
      const emailStatus = data?.notification?.emailStatus;
      toast({
        title: data?.appeal?.status === "reversed" ? "Reversed" : "Upheld",
        description:
          emailStatus === "sent"
            ? "The customer has been notified."
            : emailStatus === "suppressed"
              ? "Recorded. Customer email is suppressed; they'll see it in their Pax thread."
              : "Recorded in the customer's Pax thread.",
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't record the verdict",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const notesId = `notes-${appeal.id}`;
  const msgId = `msg-${appeal.id}`;
  const incomplete =
    reviewNotes.trim().length === 0 || customerMessage.trim().length === 0;

  return (
    <div className="space-y-3 border-t pt-3 mt-3">
      <div className="space-y-1">
        <Label htmlFor={notesId} className="text-xs font-medium">
          Internal rationale (not shown to the customer)
        </Label>
        <Textarea
          id={notesId}
          value={reviewNotes}
          onChange={(e) => setReviewNotes(e.target.value)}
          maxLength={4000}
          rows={2}
          placeholder="Why this verdict — for the record."
          className="text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={msgId} className="text-xs font-medium">
          Message to the customer (plain language)
        </Label>
        <Textarea
          id={msgId}
          value={customerMessage}
          onChange={(e) => setCustomerMessage(e.target.value)}
          maxLength={4000}
          rows={3}
          placeholder="What you want the customer to hear. They see exactly this."
          className="text-sm"
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="default"
          disabled={incomplete || mutation.isPending}
          onClick={() => {
            setDecision("reversed");
            mutation.mutate("reversed");
          }}
          aria-label="Reverse this decision — the refusal was wrong"
        >
          <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          {mutation.isPending && decision === "reversed"
            ? "Reversing…"
            : "Reverse"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={incomplete || mutation.isPending}
          onClick={() => {
            setDecision("upheld");
            mutation.mutate("upheld");
          }}
          aria-label="Uphold this decision — the refusal stands"
        >
          <Scale className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          {mutation.isPending && decision === "upheld" ? "Upholding…" : "Uphold"}
        </Button>
        {incomplete && (
          <span className="text-xs text-muted-foreground">
            Both fields are required to record a verdict.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Appeal card ─────────────────────────────────────────────────────────────

function AppealCard({ appeal }: { appeal: FounderAppeal }) {
  const resolved =
    appeal.status === "upheld" || appeal.status === "reversed";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="h-4 w-4 text-acr-ink-2" aria-hidden="true" />
              {appeal.orgName ?? `Org #${appeal.organizationId}`}
            </CardTitle>
            <CardDescription className="mt-0.5">
              Filed {formatDate(appeal.filedAt)} · cites{" "}
              {appeal.refusal.citedImmutableId}
            </CardDescription>
          </div>
          <Badge
            variant={
              appeal.status === "reversed"
                ? "default"
                : appeal.status === "upheld"
                  ? "outline"
                  : "secondary"
            }
            className="capitalize shrink-0"
          >
            {appeal.status.replace("_", " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* What the customer saw */}
        <div className="rounded-md bg-muted/50 border border-border/50 px-3 py-2">
          <p className="text-xs font-medium text-acr-ink-2 mb-0.5 flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            What Pax told the customer
          </p>
          <p className="text-sm text-acr-ink-1">{appeal.refusal.refusalText}</p>
          {appeal.refusal.citedImmutableText && (
            <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
              Rule cited: {appeal.refusal.citedImmutableText}
            </p>
          )}
        </div>

        {/* Why the customer is appealing */}
        <div>
          <p className="text-xs font-medium text-acr-ink-2 mb-0.5">
            The customer's appeal
          </p>
          <p className="text-sm text-acr-ink-1 whitespace-pre-wrap">
            {appeal.appealReason}
          </p>
        </div>

        {/* Resolved → show the recorded outcome; otherwise the resolve form */}
        {resolved ? (
          <div className="border-t pt-3 space-y-2">
            {appeal.customerMessage && (
              <div>
                <p className="text-xs font-medium text-acr-ink-2 mb-0.5">
                  Outcome sent to the customer
                </p>
                <p className="text-sm text-acr-ink-1">
                  {appeal.customerMessage}
                </p>
              </div>
            )}
            {appeal.reviewNotes && (
              <div>
                <p className="text-xs font-medium text-acr-ink-3 mb-0.5">
                  Internal rationale
                </p>
                <p className="text-xs text-muted-foreground">
                  {appeal.reviewNotes}
                </p>
              </div>
            )}
            {appeal.resolvedAt && (
              <p className="text-xs text-muted-foreground">
                Resolved {formatDate(appeal.resolvedAt)}
              </p>
            )}
          </div>
        ) : (
          <ResolveForm appeal={appeal} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FounderAppealsPage() {
  useDocumentTitle("Appeals review");
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading, error, refetch, isRefetching } =
    useQuery<AppealsResponse>({
      queryKey: [
        showAll ? "/api/founder/appeals?status=all" : "/api/founder/appeals",
      ],
    });

  const appeals = data?.appeals ?? [];

  return (
    <PageShell>
      <div className="max-w-3xl mx-auto py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Scale className="h-6 w-6" aria-hidden="true" />
              Appeals review
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              When Pax refuses a customer and they appeal, it lands here. Review
              with the cited rule and the customer's words, then uphold or
              reverse — the outcome goes straight back to them.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll((v) => !v)}
            aria-pressed={showAll}
          >
            {showAll ? "Open only" : "Show all"}
          </Button>
        </div>

        {isLoading && (
          <div className="space-y-3" role="status" aria-label="Loading appeals">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-card" />
            ))}
          </div>
        )}

        {error && (
          <QueryErrorState
            error={error}
            onRetry={() => refetch()}
            isRetrying={isRefetching}
            title="Couldn't load appeals"
            description="The appeals queue failed to load. Please try again."
            testId="founder-appeals-error"
          />
        )}

        {!isLoading && !error && appeals.length === 0 && (
          <EmptyState
            icon={CheckCircle2}
            headline={showAll ? "No appeals on record" : "No open appeals"}
            subtitle={
              showAll
                ? "No customer has appealed a Pax refusal yet."
                : "Nothing waiting on a verdict. Switch to Show all to see resolved appeals."
            }
            tone="celebratory"
            // TODO(cta): appeals queue — no action when the queue is clear
            cta={{ label: "", _noOp: true }}
            testId="founder-appeals-empty"
          />
        )}

        {!isLoading && !error && appeals.length > 0 && (
          <div className="space-y-4">
            {appeals.map((a) => (
              <AppealCard key={a.id} appeal={a} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
