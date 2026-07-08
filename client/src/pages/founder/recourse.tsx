/**
 * Founder recourse surface — the Recourse Loop.
 *
 * Rafe (CCO). Every NEGATIVE customer signal (detractor NPS ≤6, low support
 * rating ≤2/5, cancellation) lands here as a DRAFTED, personal, same-hour human
 * reply — pre-filled from the customer's verbatim words + their account
 * context. The founder edits the draft and sends in one click; the sent reply
 * is persisted back so the loop is auditable. Never a template; always the
 * customer's situation.
 *
 * Distinct from /founder/appeals (the "appeal the AI" verdict surface).
 * Founder-gated (FounderProtectedRoute in App.tsx).
 */

import { useEffect, useState } from "react";
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
import {
  Heart,
  MessageSquareReply,
  Send,
  Sparkles,
  CheckCircle2,
  X,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type DraftStatus = "draft" | "sent" | "dismissed";
type SignalType = "detractor_nps" | "low_support_rating" | "cancellation";

interface RecourseDraftRow {
  id: number;
  organizationId: number;
  orgName: string | null;
  signalType: SignalType;
  signalLabel: string;
  signalRefType: string;
  customerVerbatim: string | null;
  contextSummary: string | null;
  draftBody: string | null;
  draftModel: string | null;
  sentBody: string | null;
  recipientEmail: string | null;
  status: DraftStatus;
  sentAt: string | null;
  emailStatus: string | null;
  createdAt: string;
}

interface RecourseResponse {
  drafts: RecourseDraftRow[];
  count: number;
}

function formatDate(s: string | null): string {
  if (!s) return "";
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const QUERY_OPEN = "/api/founder/recourse";
const QUERY_ALL = "/api/founder/recourse?status=all";

// ─── Reply form (per open draft) ─────────────────────────────────────────────

function ReplyForm({ draft }: { draft: RecourseDraftRow }) {
  const [body, setBody] = useState(draft.draftBody ?? "");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // When a fresh draft body arrives (generate/regenerate), seed the editor —
  // but don't clobber edits the founder has already typed past the draft.
  useEffect(() => {
    if (draft.draftBody && body.trim().length === 0) {
      setBody(draft.draftBody);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.draftBody]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [QUERY_OPEN] });
    queryClient.invalidateQueries({ queryKey: [QUERY_ALL] });
  };

  // allow-no-invalidation: onSuccess calls the local invalidate() helper (QUERY_OPEN + QUERY_ALL above)
  const generate = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest(
        "POST",
        `/api/founder/recourse/${draft.id}/draft`,
        {},
      );
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}));
        throw new Error(b.message || "Draft failed");
      }
      return resp.json();
    },
    onSuccess: (data) => {
      const generated: string | undefined = data?.draft?.draftBody;
      if (generated) setBody(generated);
      invalidate();
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't draft a reply",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  // allow-no-invalidation: onSuccess calls the local invalidate() helper (QUERY_OPEN + QUERY_ALL above)
  const send = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest(
        "POST",
        `/api/founder/recourse/${draft.id}/send`,
        { body: body.trim() },
      );
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}));
        throw new Error(b.message || "Send failed");
      }
      return resp.json();
    },
    onSuccess: (data) => {
      invalidate();
      const emailStatus = data?.notification?.emailStatus;
      toast({
        title: "Reply sent",
        description:
          emailStatus === "suppressed"
            ? "Recorded. This customer opted out of email; the reply is on file."
            : "The customer just heard back from you.",
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't send the reply",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  // allow-no-invalidation: onSuccess calls the local invalidate() helper (QUERY_OPEN + QUERY_ALL above)
  const dismiss = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest(
        "POST",
        `/api/founder/recourse/${draft.id}/dismiss`,
        {},
      );
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}));
        throw new Error(b.message || "Dismiss failed");
      }
      return resp.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Dismissed", description: "Removed from the queue." });
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't dismiss",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const bodyId = `reply-${draft.id}`;
  const busy = send.isPending || generate.isPending || dismiss.isPending;
  const empty = body.trim().length === 0;

  return (
    <div className="space-y-3 border-t pt-3 mt-3">
      <div className="space-y-1">
        <Label htmlFor={bodyId} className="text-xs font-medium">
          Your reply{" "}
          {draft.recipientEmail ? (
            <span className="text-muted-foreground font-normal">
              → {draft.recipientEmail}
            </span>
          ) : (
            <span className="text-muted-foreground font-normal">
              (no email on file — can't send)
            </span>
          )}
        </Label>
        <Textarea
          id={bodyId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={6000}
          rows={6}
          placeholder={
            draft.draftBody
              ? ""
              : "Write a personal reply — or generate a draft to start from."
          }
          className="text-sm"
        />
        {draft.draftModel && (
          <p className="text-xs text-muted-foreground">
            Draft seeded by {draft.draftModel}. Edit freely — they see exactly
            what you send.
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="default"
          disabled={busy || empty || !draft.recipientEmail}
          onClick={() => send.mutate()}
          aria-label="Send this reply to the customer"
        >
          <Send className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          {send.isPending ? "Sending…" : "Edit & send"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => generate.mutate()}
          aria-label="Generate a draft reply from the customer's words"
        >
          <Sparkles className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          {generate.isPending
            ? "Drafting…"
            : draft.draftBody
              ? "Regenerate"
              : "Draft reply"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => dismiss.mutate()}
          aria-label="Dismiss without replying"
        >
          <X className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}

// ─── Draft card ──────────────────────────────────────────────────────────────

function badgeVariant(signal: SignalType): "default" | "secondary" | "outline" {
  return signal === "cancellation"
    ? "outline"
    : signal === "detractor_nps"
      ? "secondary"
      : "default";
}

function DraftCard({ draft }: { draft: RecourseDraftRow }) {
  const terminal = draft.status === "sent" || draft.status === "dismissed";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-acr-ink-2" aria-hidden="true" />
              {draft.orgName ?? `Org #${draft.organizationId}`}
            </CardTitle>
            <CardDescription className="mt-0.5">
              {draft.signalLabel} · {formatDate(draft.createdAt)}
            </CardDescription>
          </div>
          <Badge
            variant={
              draft.status === "sent"
                ? "default"
                : draft.status === "dismissed"
                  ? "outline"
                  : badgeVariant(draft.signalType)
            }
            className="capitalize shrink-0"
          >
            {draft.status === "draft" ? draft.signalLabel : draft.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* The customer's verbatim words — the seed of the reply */}
        <div className="rounded-md bg-muted/50 border border-border/50 px-3 py-2">
          <p className="text-xs font-medium text-acr-ink-2 mb-0.5 flex items-center gap-1.5">
            <MessageSquareReply className="h-3 w-3" aria-hidden="true" />
            What the customer told us
          </p>
          <p className="text-sm text-acr-ink-1 whitespace-pre-wrap">
            {draft.customerVerbatim ?? "(no written comment was left)"}
          </p>
          {draft.contextSummary && (
            <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
              {draft.contextSummary}
            </p>
          )}
        </div>

        {/* Terminal → show what was sent; otherwise the reply form */}
        {terminal ? (
          <div className="border-t pt-3 space-y-2">
            {draft.status === "sent" && draft.sentBody && (
              <div>
                <p className="text-xs font-medium text-acr-ink-2 mb-0.5 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  Reply sent {formatDate(draft.sentAt)}
                  {draft.emailStatus === "suppressed"
                    ? " (recorded — customer opted out of email)"
                    : ""}
                </p>
                <p className="text-sm text-acr-ink-1 whitespace-pre-wrap">
                  {draft.sentBody}
                </p>
              </div>
            )}
            {draft.status === "dismissed" && (
              <p className="text-xs text-muted-foreground">
                Dismissed without a reply.
              </p>
            )}
          </div>
        ) : (
          <ReplyForm draft={draft} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FounderRecoursePage() {
  useDocumentTitle("Recourse");
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading, error, refetch, isRefetching } =
    useQuery<RecourseResponse>({
      queryKey: [showAll ? QUERY_ALL : QUERY_OPEN],
    });

  const drafts = data?.drafts ?? [];

  return (
    <PageShell>
      <div className="max-w-3xl mx-auto py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Heart className="h-6 w-6" aria-hidden="true" />
              Recourse
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every customer who gave us a low score, a bad support experience,
              or cancelled lands here — with a personal reply pre-drafted from
              their own words. Edit it, send it, and they hear back the same
              hour. Never a template.
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
          <div
            className="space-y-3"
            role="status"
            aria-label="Loading the recourse queue"
          >
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-48 w-full rounded-card" />
            ))}
          </div>
        )}

        {error && (
          <QueryErrorState
            error={error}
            onRetry={() => refetch()}
            isRetrying={isRefetching}
            title="Couldn't load the recourse queue"
            description="The recourse queue failed to load. Please try again."
            testId="founder-recourse-error"
          />
        )}

        {!isLoading && !error && drafts.length === 0 && (
          <EmptyState
            icon={CheckCircle2}
            headline={showAll ? "No recourse on record" : "Nobody's waiting"}
            subtitle={
              showAll
                ? "No negative customer signals have come in yet."
                : "No open replies. Every detractor, low rating, and cancellation has been answered or dismissed."
            }
            tone="celebratory"
            // TODO(cta): recourse queue — no action when the queue is clear
            cta={{ label: "", _noOp: true }}
            testId="founder-recourse-empty"
          />
        )}

        {!isLoading && !error && drafts.length > 0 && (
          <div className="space-y-4">
            {drafts.map((d) => (
              <DraftCard key={d.id} draft={d} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
